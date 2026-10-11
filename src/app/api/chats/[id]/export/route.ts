import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildWhatsAppText, safeFileTitle } from '@/lib/export-text'
import { buildChatHtml } from '@/lib/export-html'
import { resolveMediaPath } from '@/lib/media-store'
import JSZip from 'jszip'
import path from 'path'
import { promises as fsp } from 'fs'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * GET /api/chats/:id/export
 * Plain GET  → authentic WhatsApp-format .txt transcript.
 * ?format=html → standalone HTML page (bubbles + reactions + embedded media).
 * ?format=zip → ZIP bundle: `_chat.txt` transcript + `media/<file>` for every
 * media file that exists on disk (mirrors an official "with media" export).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const format = req.nextUrl.searchParams.get('format')
  const chat = await db.chat.findUnique({
    where: { id },
    select: { title: true, sourceFile: true, isGroup: true },
  })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const messages = await db.message.findMany({
    where: { chatId: id },
    orderBy: [{ idx: 'asc' }],
    select: { ts: true, sender: true, body: true, type: true, mediaName: true },
  })

  const text = buildWhatsAppText(messages)

  if (format === 'html') {
    const rows = await db.message.findMany({
      where: { chatId: id },
      orderBy: [{ idx: 'asc' }],
      select: {
        ts: true,
        sender: true,
        body: true,
        type: true,
        mediaName: true,
        mediaPath: true,
        reactions: true,
        pinned: true,
        starred: true,
        edited: true,
        forwardedFrom: true,
        pollOptions: true,
      },
    })
    const html = await buildChatHtml(id, chat.title, chat.isGroup, rows)
    const htmlName = `WhatsApp Chat - ${safeFileTitle(chat.title)}.html`
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${htmlName}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  if (format !== 'zip') {
    const filename = `WhatsApp Chat - ${safeFileTitle(chat.title)}.txt`
    return new NextResponse(text, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // ZIP export — same transcript plus the chat's media files.
  const mediaRows = await db.message.findMany({
    where: { chatId: id },
    orderBy: [{ idx: 'asc' }],
    select: { mediaPath: true },
  })

  const zip = new JSZip()
  zip.file('_chat.txt', text)

  let bundled = 0
  const seen = new Set<string>()
  for (const m of mediaRows) {
    if (!m.mediaPath || seen.has(m.mediaPath)) continue
    seen.add(m.mediaPath)
    if (m.mediaPath.endsWith('.poster.jpg')) continue
    try {
      const abs = await resolveMediaPath(id, m.mediaPath)
      if (!abs) continue // missing on disk — skip
      const buf = await fsp.readFile(abs)
      // Flatten any folder prefix; WhatsApp zips keep media in one folder
      zip.file(path.join('media', path.basename(m.mediaPath)), buf)
      bundled++
    } catch {
      // unreadable file — skip silently
    }
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'STORE',
  })
  const zipName = `WhatsApp-${safeFileTitle(chat.title)}.zip`

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'no-store',
      'X-Media-Count': String(bundled),
    },
  })
}
