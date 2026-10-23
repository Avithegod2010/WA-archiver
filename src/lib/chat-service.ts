import { db } from '@/lib/db'
import {
  buildPreview,
  type ParseResult,
  type ParsedMessage,
} from '@/lib/whatsapp-parser'

export interface PersistOptions {
  title: string
  sourceFile: string
  parsed: ParseResult
  /** lowercase basename -> stored media filename (already saved on disk) */
  mediaMap?: Map<string, string>
  /** When provided, messages are inserted into this existing chat. */
  chatId?: string
}

const MEDIA_TYPES = new Set([
  'image',
  'video',
  'audio',
  'sticker',
  'gif',
  'document',
  'contact',
  'media',
])

export { MEDIA_TYPES }

/** Fixed id of the personal "Saved Messages" (you) chat. */
export const SAVED_CHAT_ID = 'saved-messages'

/**
 * Get (or lazily create) the Saved Messages chat. It always exists so the
 * user can forward messages to themselves and compose notes.
 */
export async function ensureSavedMessagesChat() {
  const existing = await db.chat.findUnique({ where: { id: SAVED_CHAT_ID } })
  if (existing) return existing
  try {
    return await db.chat.create({
      data: {
        id: SAVED_CHAT_ID,
        title: 'Saved Messages',
        isGroup: false,
        sourceFile: 'local',
        pinned: true,
        lastType: 'text',
        lastPreview: 'Your personal space — notes, links & media',
      },
    })
  } catch {
    // Raced with another request — re-read
    const chat = await db.chat.findUnique({ where: { id: SAVED_CHAT_ID } })
    if (!chat) throw new Error('Could not create Saved Messages chat')
    return chat
  }
}

/**
 * Human preview for call messages (Task 14-g). The real parser only ever
 * stores "Missed [group ](voice|video) call" bodies (see whatsapp-parser),
 * but answered-call wording and durations from old imports / synthetic rows
 * are recognized too. Unclassifiable bodies keep the legacy fallback (the
 * raw body) so existing previews never change shape. Mirrors the CallCard
 * classification in MessageBubble.tsx — keep both in sync.
 */
function callPreviewText(body: string): string {
  const text = (body ?? '').trim()
  if (!text) return ''
  const lower = text.toLowerCase()
  const video = lower.includes('video')
  if (/missed|no answer|cancel(?:l)?ed/.test(lower)) {
    return video ? 'Missed video call' : 'Missed voice call'
  }
  const kind = video ? 'Video call' : 'Voice call'
  const dur = text.match(/(\d+)\s*(hours?|hrs?|min(?:ute)?s?|sec(?:ond)?s?)/i)
  let duration: string | null = null
  if (dur) {
    const n = parseInt(dur[1], 10)
    const unit = dur[2].toLowerCase()
    duration = unit.startsWith('h')
      ? `${n} ${n === 1 ? 'hour' : 'hours'}`
      : unit.startsWith('min')
        ? `${n} min`
        : `${n} ${n === 1 ? 'sec' : 'secs'}`
  }
  if (
    lower.includes('incoming') ||
    lower.includes('outgoing') ||
    lower.includes('started a call')
  ) {
    return duration ? `${kind} · ${duration}` : kind
  }
  // Legacy fallback — unknown call bodies keep the raw text.
  return text.slice(0, 120)
}

function previewText(type: string, body: string, mediaName: string | null): string {
  if (type === 'system') return body.slice(0, 300)
  // Types where the chat list renders its own label chip ("Photo:", "Poll:"…);
  // the stored preview only carries the caption / question / file name, if any.
  const LABELED = new Set([
    'image',
    'video',
    'gif',
    'audio',
    'sticker',
    'document',
    'contact',
    'media',
    'poll',
    'location',
    'call',
    'deleted',
  ])
  if (LABELED.has(type)) {
    if (type === 'document') {
      return (body || mediaName || '').slice(0, 120)
    }
    // Task 12-d: location/contact cards store a JSON string in body —
    // surface the human label/name instead of the raw payload. Legacy
    // plain-text bodies (imported chats) keep working through the fallbacks.
    if (type === 'location' || type === 'contact') {
      let rec: Record<string, unknown> | null = null
      if (body.startsWith('{')) {
        try {
          const o: unknown = JSON.parse(body)
          if (o && typeof o === 'object' && !Array.isArray(o)) {
            rec = o as Record<string, unknown>
          }
        } catch {
          /* legacy plain-text body */
        }
      }
      if (type === 'location') {
        const label =
          rec && typeof rec.label === 'string' ? rec.label.trim() : ''
        if (label) return label.slice(0, 120)
        const rest = body.replace(/^(live\s+)?location[:\s]*/i, '').trim()
        return rest ? rest.slice(0, 120) : ''
      }
      const name = rec && typeof rec.name === 'string' ? rec.name.trim() : ''
      if (name) {
        const phone =
          rec && typeof rec.phone === 'string' ? rec.phone.trim() : ''
        return (phone ? `${name} · ${phone}` : name).slice(0, 120)
      }
      return (body || mediaName || '').slice(0, 120)
    }
    if (type === 'call') return callPreviewText(body)
    if (type === 'poll') return body.slice(0, 120)
    // Caption-less media falls back to its file name so the chat list never
    // renders a bare "Photo:" chip (matches import-time previews).
    return (body || mediaName || '').slice(0, 120)
  }
  return body.slice(0, 300)
}

/**
 * Recompute aggregate fields (counts, first/last, preview) for a chat from
 * its messages. Used after local edits: send / delete / forward.
 */
export async function refreshChatAggregates(chatId: string): Promise<void> {
  const [messageCount, mediaCount, first, last] = await Promise.all([
    db.message.count({ where: { chatId } }),
    // Media-typed messages, files or not: a photo that wasn't included in
    // the export is still a photo message (the gallery shows its
    // "not in export" tile). Keeps re-aggregates in sync with imports and
    // with synthetic/demo media.
    db.message.count({
      where: { chatId, type: { in: [...MEDIA_TYPES] } },
    }),
    db.message.findFirst({ where: { chatId }, orderBy: { idx: 'asc' } }),
    db.message.findFirst({ where: { chatId }, orderBy: { idx: 'desc' } }),
  ])
  const saved = chatId === SAVED_CHAT_ID
  await db.chat.update({
    where: { id: chatId },
    data: {
      messageCount,
      mediaCount,
      firstAt: first?.ts ?? null,
      lastAt: last?.ts ?? null,
      lastPreview: last
        ? previewText(last.type, last.body, last.mediaName)
        : saved
          ? 'Your personal space — notes, links & media'
          : '',
      lastSender: last?.sender ?? null,
      lastType: last?.type ?? 'text',
    },
  })
}

/**
 * Persist a parsed chat (messages + aggregate fields) to the database.
 * If `chatId` is provided the messages are attached to that chat,
 * otherwise a new chat record is created.
 * Returns the chat id.
 */
export async function persistParsedChat(opts: PersistOptions): Promise<string> {
  const { title, sourceFile, parsed, mediaMap = new Map() } = opts

  const chatId =
    opts.chatId ??
    (
      await db.chat.create({
        data: {
          title,
          isGroup: parsed.isGroup,
          sourceFile,
        },
      })
    ).id

  const rows = parsed.messages.map((m: ParsedMessage, i: number) => {
    let mediaPath: string | null = null
    let mediaName: string | null = m.mediaName

    if (mediaName) {
      const stored = mediaMap.get(mediaName.toLowerCase())
      if (stored) {
        mediaPath = stored
        mediaName = stored.split('/').pop() ?? stored
      }
    }

    return {
      chatId,
      idx: i,
      ts: m.ts,
      sender: m.sender,
      body: m.body.slice(0, 8000),
      type: m.type,
      mediaPath,
      mediaName: mediaName ? mediaName.slice(0, 255) : null,
      isMedia: MEDIA_TYPES.has(m.type) && !!mediaPath,
      pollOptions: m.pollOptions?.length ? JSON.stringify(m.pollOptions) : null,
      reactions: m.reactions && Object.keys(m.reactions).length > 0
        ? JSON.stringify(m.reactions)
        : null,
      replyToId: null,
      _replyQuote: m.replyQuote ?? null,
    }
  })

  // Reply quotes (v1.9 round-trip) resolve in a second pass — target rows
  // need to exist first. Kept as an internal marker column, then stripped.
  const quoteList = rows
    .map((r, i) => ({ i, q: r._replyQuote as { sender: string; body: string } | null }))
    .filter((x): x is { i: number; q: { sender: string; body: string } } => !!x.q)

  // Insert in chunks (SQLite parameter limit safety)
  const CHUNK = 150
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows
      .slice(i, i + CHUNK)
      .map(({ isMedia: _m, _replyQuote: _q, ...r }) => r)
    await db.message.createMany({ data: chunk })
  }

  // Resolve reply quotes → replyToId (sender + flattened-body prefix match
  // over the chat's recent rows; misses simply leave replyToId null).
  if (quoteList.length > 0) {
    const senders = [...new Set(quoteList.map((x) => x.q.sender))]
    const candidates = await db.message.findMany({
      where: { chatId, sender: { in: senders } },
      select: { id: true, sender: true, body: true },
      orderBy: { idx: 'desc' },
      take: 400,
    })
    for (const { i, q } of quoteList) {
      const want = q.body.toLowerCase()
      const hit = candidates.find(
        (c) =>
          c.sender === q.sender &&
          c.body
            .replace(/\s*\n\s*/g, ' ')
            .trim()
            .toLowerCase()
            .startsWith(want)
      )
      if (!hit) continue
      const row = await db.message.findFirst({
        where: { chatId, idx: rows[i].idx },
        select: { id: true },
      })
      if (row) {
        await db.message.update({
          where: { id: row.id },
          data: { replyToId: hit.id },
        })
      }
    }
  }

  // Broad definition — every media-typed parsed message (see
  // refreshChatAggregates); mediaPath may be null when the file wasn't
  // included in the export.
  const mediaCount = rows.filter((r) => MEDIA_TYPES.has(r.type)).length
  const last =
    parsed.messages.length > 0 ? parsed.messages[parsed.messages.length - 1] : null
  const first = parsed.messages.length > 0 ? parsed.messages[0] : null

  await db.chat.update({
    where: { id: chatId },
    data: {
      title,
      isGroup: parsed.isGroup,
      sourceFile,
      messageCount: parsed.messages.length,
      mediaCount,
      firstAt: first ? first.ts : null,
      lastAt: last ? last.ts : null,
      lastPreview: last ? buildPreview(last).slice(0, 300) : '',
      lastSender: last?.sender ?? null,
      lastType: last?.type ?? 'text',
    },
  })

  return chatId
}
