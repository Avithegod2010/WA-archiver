import { NextRequest, NextResponse } from 'next/server'
import { promises as fsp } from 'fs'
import path from 'path'
import JSZip from 'jszip'
import { db } from '@/lib/db'
import { buildWhatsAppText, safeFileTitle } from '@/lib/export-text'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * GET /api/chats/:id/media-zip
 * Bundles every media file stored for this chat — plus the WhatsApp-format
 * .txt transcript, mirroring an official "Export chat (with media)" zip.
 * Media is STOREd (no compression) since photos/videos are already compressed.
 */
/**
 * POST /api/chats/:id/media-zip
 * Body: { ids: string[] } — message ids to bundle.
 * Zips ONLY the selected items' media (no transcript), for gallery
 * multi-select download. Same STORE compression as the full export.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { ids } = (body ?? {}) as { ids?: unknown }
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.some((v) => typeof v !== 'string')
  ) {
    return NextResponse.json(
      { error: 'Field "ids" must be a non-empty array of strings' },
      { status: 400 }
    )
  }
  const chat = await db.chat.findUnique({
    where: { id },
    select: { title: true },
  })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const messages = await db.message.findMany({
    where: { chatId: id, id: { in: ids as string[] } },
    orderBy: [{ idx: 'asc' }],
    select: { mediaPath: true },
  })

  const mediaDir = path.join(process.cwd(), 'db', 'media', id)
  const zip = new JSZip()
  let bundled = 0
  const seen = new Set<string>()
  for (const m of messages) {
    if (!m.mediaPath || seen.has(m.mediaPath)) continue
    seen.add(m.mediaPath)
    if (m.mediaPath.endsWith('.poster.jpg')) continue
    try {
      const buf = await fsp.readFile(path.join(mediaDir, m.mediaPath))
      zip.file(path.basename(m.mediaPath), buf)
      bundled++
    } catch {
      // file missing on disk — skip silently
    }
  }

  if (bundled === 0) {
    return NextResponse.json(
      { error: 'None of the selected items have downloadable media' },
      { status: 422 }
    )
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'STORE',
  })
  const filename = `WhatsApp Media - ${safeFileTitle(chat.title)} (${bundled}).zip`

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
      'X-Media-Count': String(bundled),
    },
  })
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const chat = await db.chat.findUnique({
    where: { id },
    select: { title: true },
  })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const messages = await db.message.findMany({
    where: { chatId: id },
    orderBy: [{ idx: 'asc' }],
    select: {
      ts: true,
      sender: true,
      body: true,
      type: true,
      mediaName: true,
      mediaPath: true,
    },
  })

  const mediaDir = path.join(process.cwd(), 'db', 'media', id)
  const zip = new JSZip()

  // Media files that actually exist on disk (skip posters and duplicates)
  let bundled = 0
  const seen = new Set<string>()
  for (const m of messages) {
    if (!m.mediaPath || seen.has(m.mediaPath)) continue
    seen.add(m.mediaPath)
    if (m.mediaPath.endsWith('.poster.jpg')) continue
    try {
      const buf = await fsp.readFile(path.join(mediaDir, m.mediaPath))
      // Flatten any folder prefix; WhatsApp zips keep media next to the txt
      zip.file(path.basename(m.mediaPath), buf)
      bundled++
    } catch {
      // file missing on disk — skip silently
    }
  }

  // WhatsApp-format transcript, always included
  zip.file(
    `${safeFileTitle(chat.title)}.txt`,
    buildWhatsAppText(
      messages.map((m) => ({
        ts: m.ts,
        sender: m.sender,
        body: m.body,
        type: m.type,
        mediaName: m.mediaName,
      }))
    )
  )

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'STORE',
  })

  const filename = `WhatsApp Chat - ${safeFileTitle(chat.title)}.zip`

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
      'X-Media-Count': String(bundled),
    },
  })
}
