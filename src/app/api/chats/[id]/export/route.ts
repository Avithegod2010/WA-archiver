import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildWhatsAppText, safeFileTitle } from '@/lib/export-text'
import { buildChatHtml } from '@/lib/export-html'
import { MESSAGE_SELECT, withReplyTos } from '@/lib/message-dto'
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
 * ?format=json → raw data dump: chat metadata + fully serialized messages.
 * ?format=csv → spreadsheet-friendly flat table (one row per message).
 */

/** Spreadsheet formula-injection guard + RFC-4180 quoting for one CSV cell. */
function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value)
  // CRLF-safe: normalize line endings inside the quoted cell
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Guard against Excel/Sheets formula injection when the cell is the first
  // character of a field: =, +, -, @, tab (OWASP mitigation — prefix with ')
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

/** Compact "👍: You, Mom; ❤️: Dad" summary of a parsed reactions record. */
function reactionsSummary(
  reactions: Record<string, string[]> | null
): string {
  if (!reactions) return ''
  return Object.entries(reactions)
    .map(([emoji, senders]) => `${emoji}: ${senders.join(', ')}`)
    .join('; ')
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Locale-independent "YYYY-MM-DD HH:MM:SS" in the server's local time. */
function timestampLocal(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  )
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const format = req.nextUrl.searchParams.get('format')
  const chat = await db.chat.findUnique({
    where: { id },
    select: {
      title: true,
      sourceFile: true,
      isGroup: true,
      createdAt: true,
      firstAt: true,
      lastAt: true,
    },
  })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  // JSON / CSV need the fully serialized message list (reactions parsed,
  // replyTo resolved, starred/edited/forwardedFrom/pinned included).
  if (format === 'json' || format === 'csv') {
    const rows = await db.message.findMany({
      where: { chatId: id },
      orderBy: [{ idx: 'asc' }],
      select: MESSAGE_SELECT,
    })
    const msgs = await withReplyTos(rows)

    if (format === 'json') {
      const mediaCount = msgs.filter((m) => m.mediaName).length
      const body = {
        chat: {
          id,
          title: chat.title,
          isGroup: chat.isGroup,
          createdAt: chat.createdAt?.toISOString() ?? null,
          sourceFile: chat.sourceFile,
          firstAt: chat.firstAt?.toISOString() ?? null,
          lastAt: chat.lastAt?.toISOString() ?? null,
          counts: {
            messages: msgs.length,
            media: mediaCount,
            senders: new Set(msgs.map((m) => m.sender).filter(Boolean)).size,
            starred: msgs.filter((m) => m.starred).length,
            pinned: msgs.filter((m) => m.pinned).length,
            edited: msgs.filter((m) => m.edited).length,
            reacted: msgs.filter((m) => m.reactions).length,
          },
        },
        messages: msgs,
      }
      const jsonName = `WhatsApp Chat - ${safeFileTitle(chat.title)}.json`
      return new NextResponse(JSON.stringify(body, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${jsonName}"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    // CSV — one flat row per message, RFC-4180 quoted, BOM for Excel.
    const header = [
      'idx',
      'timestamp_iso',
      'timestamp_local',
      'sender',
      'type',
      'body',
      'media_name',
      'starred',
      'edited',
      'forwarded',
      'pinned',
      'reactions_summary',
    ]
    const lines = [header.map(csvCell).join(',')]
    for (const m of msgs) {
      lines.push(
        [
          m.idx,
          m.ts,
          timestampLocal(m.ts),
          m.sender,
          m.type,
          m.body,
          m.mediaName,
          m.starred,
          m.edited,
          m.forwardedFrom,
          m.pinned,
          reactionsSummary(m.reactions),
        ]
          .map(csvCell)
          .join(',')
      )
    }
    const csv = '\uFEFF' + lines.join('\r\n') + '\r\n'
    const csvName = `WhatsApp Chat - ${safeFileTitle(chat.title)}.csv`
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csvName}"`,
        'Cache-Control': 'no-store',
      },
    })
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
