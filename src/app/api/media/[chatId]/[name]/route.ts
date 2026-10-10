import { NextRequest, NextResponse } from 'next/server'
import { promises as fsp, createReadStream } from 'fs'
import { Readable } from 'stream'
import {
  resolveMediaPath,
  mimeFromName,
  generateVideoPoster,
  posterPathFor,
  isVideoName,
} from '@/lib/media-store'

export const runtime = 'nodejs'

/** Node stream -> web body so large videos are never buffered fully in memory. */
function streamOf(filePath: string, start?: number, end?: number): ReadableStream {
  const node = createReadStream(filePath, { start, end })
  return Readable.toWeb(node) as unknown as ReadableStream
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ chatId: string; name: string }> }
) {
  const { chatId, name } = await ctx.params
  const filePath = await resolveMediaPath(chatId, name)
  if (!filePath) {
    return NextResponse.json({ error: 'Media not found' }, { status: 404 })
  }

  // Poster thumbnail request: `<file>?poster=1` serves `<file>.poster.jpg`,
  // lazily generating it with ffmpeg for videos that don't have one yet.
  if (req.nextUrl.searchParams.get('poster') === '1') {
    const posterName = posterPathFor(name)
    let posterPath = await resolveMediaPath(chatId, posterName)
    if (!posterPath && isVideoName(name)) {
      await generateVideoPoster(chatId, name)
      posterPath = await resolveMediaPath(chatId, posterName)
    }
    if (posterPath) {
      const stat = await fsp.stat(posterPath)
      const buf = await fsp.readFile(posterPath)
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Length': String(stat.size),
        },
      })
    }
    return NextResponse.json({ error: 'Poster not available' }, { status: 404 })
  }

  const stat = await fsp.stat(filePath)
  const mime = mimeFromName(name)
  const range = req.headers.get('range')

  const baseHeaders: Record<string, string> = {
    'Content-Type': mime,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Accept-Ranges': 'bytes',
  }

  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/)
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0
      const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1
      if (start <= end && start < stat.size) {
        // Stream only the requested slice — seeks stay cheap on big videos
        return new NextResponse(streamOf(filePath, start, end), {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Content-Length': String(end - start + 1),
          },
        })
      }
    }
  }

  return new NextResponse(streamOf(filePath), {
    status: 200,
    headers: {
      ...baseHeaders,
      'Content-Length': String(stat.size),
    },
  })
}
