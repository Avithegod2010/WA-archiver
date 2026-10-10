import { NextRequest, NextResponse } from 'next/server'
import { promises as fsp } from 'fs'
import { resolveMediaPath, mimeFromName } from '@/lib/media-store'

export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ chatId: string; name: string }> }
) {
  const { chatId, name } = await ctx.params
  const filePath = await resolveMediaPath(chatId, name)
  if (!filePath) {
    return NextResponse.json({ error: 'Media not found' }, { status: 404 })
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
        const chunk = await fsp.readFile(filePath)
        const body = chunk.subarray(start, end + 1)
        return new NextResponse(new Uint8Array(body), {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Content-Length': String(body.length),
          },
        })
      }
    }
  }

  const buf = await fsp.readFile(filePath)
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      ...baseHeaders,
      'Content-Length': String(stat.size),
    },
  })
}
