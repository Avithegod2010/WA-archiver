import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildWhatsAppText, safeFileTitle } from '@/lib/export-text'
import { buildChatHtml } from '@/lib/export-html'
import { MESSAGE_SELECT, parseReactions, withReplyTos } from '@/lib/message-dto'
import { resolveMediaPath } from '@/lib/media-store'
import JSZip from 'jszip'
import path from 'path'
import { promises as fsp } from 'fs'
import { assertAppUnlocked } from '@/lib/server-lock'

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
 *
 * Audio embedding is OPT-IN: `?audio=1` or the `wa_export_audio=1` cookie
 * (set by Settings → Export). With it, HTML exports embed voice notes as
 * data URIs and ZIP exports add an `audio/` folder; without it the output is
 * unchanged. Filenames stay identical either way.
 */

/** ZIP: voice notes go to `audio/` with a 100 MB total budget. */
const ZIP_AUDIO_TOTAL_CAP = 100 * 1024 * 1024
/** Cookie written by SettingsDialog → "Embed audio files in exports". */
const EXPORT_AUDIO_COOKIE = 'wa_export_audio'

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
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  const { id } = await ctx.params
  const format = req.nextUrl.searchParams.get('format')
  // Embed audio in HTML / add an audio/ folder in ZIP — via ?audio=1 or the
  // Settings toggle cookie so exports need no ChatView changes.
  const audioOn =
    req.nextUrl.searchParams.get('audio') === '1' ||
    req.cookies.get(EXPORT_AUDIO_COOKIE)?.value === '1'
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
    select: {
      ts: true,
      sender: true,
      body: true,
      type: true,
      mediaName: true,
      edited: true,
      reactions: true,
      replyToId: true,
    },
  })

  // Resolve reply targets (v1.9 round-trip: quotes re-encode as prefixes).
  const replyIds = [
    ...new Set(messages.map((m) => m.replyToId).filter((v): v is string => !!v)),
  ]
  const replyRows = replyIds.length
    ? await db.message.findMany({
        where: { id: { in: replyIds } },
        select: { id: true, sender: true, body: true },
      })
    : []
  const replyMap = new Map(
    replyRows.map((r) => [
      r.id,
      { sender: r.sender ?? '', body: r.body ?? '' },
    ])
  )

  // Pending scheduled sends are part of the chat's future transcript — merge
  // them into the .txt with a "[Scheduled for …]" prefix (round-trips as a
  // plain message from You when the file is re-imported).
  const scheduled = await db.scheduledMessage.findMany({
    where: { chatId: id, status: 'pending' },
    orderBy: [{ deliverAt: 'asc' }],
    select: { body: true, sender: true, deliverAt: true },
  })

  const merged: Array<{
    ts: Date
    sender: string | null
    body: string
    type: string
    mediaName: string | null
    edited: boolean
    scheduledFor?: Date | null
    reactions?: Record<string, string[]> | null
    replyTo?: { sender: string; body: string } | null
  }> = [
    ...messages.map((m) => ({
      ts: m.ts,
      sender: m.sender,
      body: m.body,
      type: m.type,
      mediaName: m.mediaName,
      edited: m.edited,
      scheduledFor: null,
      reactions: parseReactions(m.reactions),
      replyTo: m.replyToId ? (replyMap.get(m.replyToId) ?? null) : null,
    })),
    ...scheduled.map((s) => ({
      ts: s.deliverAt,
      sender: s.sender,
      body: s.body,
      type: 'text',
      mediaName: null,
      edited: false,
      scheduledFor: s.deliverAt,
    })),
  ].sort((a, b) => a.ts.getTime() - b.ts.getTime())

  const text = buildWhatsAppText(merged)

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
    const html = await buildChatHtml(id, chat.title, chat.isGroup, rows, {
      embedAudio: audioOn,
    })
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

  // ZIP export — same transcript plus the chat's media files. When audio is
  // enabled, voice notes move into a dedicated `audio/` folder (not duplicated
  // under media/) with a 100 MB total budget; skipped files get a note.
  const mediaRows = await db.message.findMany({
    where: { chatId: id },
    orderBy: [{ idx: 'asc' }],
    select: { mediaPath: true, type: true },
  })

  const zip = new JSZip()
  zip.file('_chat.txt', text)

  let bundled = 0
  let audioBudget = audioOn ? ZIP_AUDIO_TOTAL_CAP : 0
  const audioSkipped: string[] = []
  const seen = new Set<string>()
  for (const m of mediaRows) {
    if (!m.mediaPath || seen.has(m.mediaPath)) continue
    seen.add(m.mediaPath)
    if (m.mediaPath.endsWith('.poster.jpg')) continue
    const base = path.basename(m.mediaPath)
    try {
      const abs = await resolveMediaPath(id, m.mediaPath)
      if (!abs) continue // missing on disk — skip
      if (audioOn && m.type === 'audio') {
        const size = (await fsp.stat(abs)).size
        if (size > audioBudget) {
          audioSkipped.push(base) // over the shared audio budget
          continue
        }
        zip.file(path.join('audio', base), await fsp.readFile(abs))
        audioBudget -= size
        continue
      }
      const buf = await fsp.readFile(abs)
      // Flatten any folder prefix; WhatsApp zips keep media in one folder
      zip.file(path.join('media', base), buf)
      bundled++
    } catch {
      // unreadable file — skip silently
    }
  }

  if (audioSkipped.length > 0) {
    zip.file(
      '_audio-skipped.txt',
      [
        'Some voice notes were not added to the audio/ folder of this export:',
        ...audioSkipped.map((n) => `- ${n}`),
        '',
        `Reason: the ${Math.round(ZIP_AUDIO_TOTAL_CAP / (1024 * 1024))} MB total audio budget for exports was reached.`,
        'The messages are still in _chat.txt; re-export with fewer chats/media to include them.',
        '',
      ].join('\n')
    )
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
