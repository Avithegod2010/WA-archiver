import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { refreshChatAggregates } from '@/lib/chat-service'
import { parseReactions } from '@/lib/message-dto'
import { assertAppUnlocked } from '@/lib/server-lock'

export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_BODY_BYTES = 50 * 1024 * 1024 // ~50MB guard
const MEDIA_NOTE = 'Media files are not included in JSON backups'

// Task 2-d — voice-note transcript sync. Server-side on-demand transcription
// caches its result in AppSetting under `transcript:<messageId>` (see
// /api/transcribe). The same prefix is used here so transcripts round-trip
// through the backup envelope.
const TRANSCRIPT_KEY_PREFIX = 'transcript:'
/** Same cap the transcription cache itself enforces (64k chars). */
const MAX_SYNC_TRANSCRIPT_CHARS = 64_000

interface BackupChat {
  id?: unknown
  title?: unknown
  isGroup?: unknown
  sourceFile?: unknown
  pinned?: unknown
  archived?: unknown
  lastPreview?: unknown
  lastSender?: unknown
  lastType?: unknown
  createdAt?: unknown
  messages?: unknown
}

interface BackupMessage {
  id?: unknown
  idx?: unknown
  ts?: unknown
  sender?: unknown
  body?: unknown
  type?: unknown
  mediaPath?: unknown
  mediaName?: unknown
  starred?: unknown
  edited?: unknown
  forwardedFrom?: unknown
  pollOptions?: unknown
  pinned?: unknown
  reactions?: unknown
  replyToId?: unknown
  /** Task 2-d — optional voice-note transcript carried in the envelope. */
  transcript?: unknown
}

const strOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null

/**
 * Basename-only path value for media references coming from a backup file.
 * Backups are untrusted input: a `mediaPath` like `../../custom.db` must
 * never be stored, or `/api/chats/:id/media-zip` would zip arbitrary files.
 */
const basePathOrNull = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length === 0) return null
  const base = v.split(/[/\\]/).pop() ?? ''
  if (!base || base === '.' || base === '..') return null
  return base.slice(0, 255)
}

const boolOr = (v: unknown, fallback = false): boolean =>
  typeof v === 'boolean' ? v : fallback

/** Accept a JSON array of strings (or a raw JSON string) → compact JSON column value. */
function jsonListColumn(v: unknown): string | null {
  let arr: unknown = v
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (!Array.isArray(arr)) return null
  const list = arr
    .filter((o): o is string => typeof o === 'string' && o.length > 0)
    .slice(0, 12)
  return list.length ? JSON.stringify(list) : null
}

/** Accept a parsed reactions record (or raw JSON string) → compact JSON column value. */
function jsonReactionsColumn(v: unknown): string | null {
  let raw: string | null = null
  if (typeof v === 'string') raw = v
  else if (v && typeof v === 'object' && !Array.isArray(v)) {
    try {
      raw = JSON.stringify(v)
    } catch {
      return null
    }
  }
  const parsed = parseReactions(raw)
  return parsed ? JSON.stringify(parsed) : null
}

/**
 * GET /api/backup
 * Full JSON snapshot of every chat + message (media files excluded).
 */
export async function GET(req: Request) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  const chats = await db.chat.findMany({
    orderBy: [{ createdAt: 'asc' }],
  })
  const messages = await db.message.findMany({
    orderBy: [{ chatId: 'asc' }, { idx: 'asc' }],
    select: {
      id: true,
      chatId: true,
      idx: true,
      ts: true,
      sender: true,
      body: true,
      type: true,
      mediaPath: true,
      mediaName: true,
      starred: true,
      edited: true,
      forwardedFrom: true,
      pollOptions: true,
      pinned: true,
      reactions: true,
      replyToId: true,
    },
  })

  // Task 2-d — load cached voice-note transcripts and attach them to their
  // messages so a restore on another device can show them instantly. This is
  // best-effort: a settings-table hiccup must never fail the whole backup.
  const transcriptMap = new Map<string, string>()
  try {
    const rows = await db.appSetting.findMany({
      where: { key: { startsWith: TRANSCRIPT_KEY_PREFIX } },
      select: { key: true, value: true },
    })
    for (const r of rows) {
      const id = r.key.slice(TRANSCRIPT_KEY_PREFIX.length)
      if (id && r.value) transcriptMap.set(id, r.value)
    }
  } catch {
    /* transcripts are optional — proceed without them */
  }

  const byChat = new Map<string, BackupMessage[]>()
  for (const m of messages) {
    let list = byChat.get(m.chatId)
    if (!list) {
      list = []
      byChat.set(m.chatId, list)
    }
    list.push({
      id: m.id,
      idx: m.idx,
      ts: m.ts.toISOString(),
      sender: m.sender,
      body: m.body,
      type: m.type,
      mediaPath: m.mediaPath,
      mediaName: m.mediaName,
      starred: m.starred,
      edited: m.edited,
      forwardedFrom: m.forwardedFrom,
      pollOptions: m.pollOptions ? JSON.parse(m.pollOptions) : null,
      pinned: m.pinned,
      reactions: parseReactions(m.reactions),
      replyToId: m.replyToId,
      // Task 2-d — only included when a transcript exists (older consumers
      // ignore unknown fields; absent means "nothing to restore").
      ...(transcriptMap.has(m.id)
        ? { transcript: transcriptMap.get(m.id) }
        : {}),
    })
  }

  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    mediaNote: MEDIA_NOTE,
    chats: chats.map((c) => ({
      id: c.id,
      title: c.title,
      isGroup: c.isGroup,
      messageCount: c.messageCount,
      mediaCount: c.mediaCount,
      firstAt: c.firstAt ? c.firstAt.toISOString() : null,
      lastAt: c.lastAt ? c.lastAt.toISOString() : null,
      lastPreview: c.lastPreview,
      lastSender: c.lastSender,
      lastType: c.lastType,
      sourceFile: c.sourceFile,
      pinned: c.pinned,
      archived: c.archived,
      createdAt: c.createdAt.toISOString(),
      messages: byChat.get(c.id) ?? [],
    })),
  }

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

/**
 * POST /api/backup
 * Restore a JSON snapshot. Chats whose id OR (title + sourceFile) already
 * exist are skipped; new chats keep their original id when free. Message
 * rows with invalid dates or duplicate ids are dropped. Reply links are
 * preserved verbatim (plain id column, no FK): a reply whose parent was
 * skipped/dropped simply resolves to null in the UI, like a deleted
 * original in WhatsApp.
 *
 * version 2 backups carry replyToId; version 1 backups (pre-1.5.1) restore
 * fine too — their replies come back unlinked, matching what they exported.
 */
export async function POST(req: NextRequest) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'Backup payload too large (max ~50MB)' },
      { status: 413 }
    )
  }
  let text: string
  try {
    text = await req.text()
  } catch {
    return NextResponse.json({ error: 'Could not read request body' }, { status: 400 })
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'Backup payload too large (max ~50MB)' },
      { status: 413 }
    )
  }
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { chats } = (payload ?? {}) as { chats?: unknown }
  if (!Array.isArray(chats)) {
    return NextResponse.json(
      { error: 'Field "chats" must be an array' },
      { status: 400 }
    )
  }

  let chatsCreated = 0
  let chatsSkipped = 0
  let messagesImported = 0
  let transcriptsRestored = 0
  const createdIds: string[] = []
  // Prisma's createMany({ skipDuplicates }) is unsupported on SQLite, so
  // explicit message ids that already exist are pre-filtered instead.
  let existingMessageIds: Set<string> | null = null

  for (const raw of chats) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      chatsSkipped++
      continue
    }
    const c = raw as BackupChat
    if (typeof c.title !== 'string' || !c.title.trim()) {
      chatsSkipped++
      continue
    }

    // Duplicate guard: same id OR same title+sourceFile
    const candidateId = strOrNull(c.id)
    const sourceFile = typeof c.sourceFile === 'string' ? c.sourceFile : ''
    const dupWhere = candidateId
      ? { OR: [{ id: candidateId }, { title: c.title, sourceFile }] }
      : { title: c.title, sourceFile }
    const existing = await db.chat.findFirst({ where: dupWhere, select: { id: true } })
    if (existing) {
      chatsSkipped++
      continue
    }

    // Preserve the original id when free; let cuid generate otherwise.
    let chatId: string | null = null
    if (candidateId) {
      try {
        const created = await db.chat.create({
          data: {
            id: candidateId,
            title: c.title.trim().slice(0, 300),
            isGroup: boolOr(c.isGroup),
            sourceFile,
            pinned: boolOr(c.pinned),
            archived: boolOr(c.archived),
          },
        })
        chatId = created.id
      } catch {
        chatId = null // id taken in the meantime — fall through to generated id
      }
    }
    if (!chatId) {
      try {
        const created = await db.chat.create({
          data: {
            title: c.title.trim().slice(0, 300),
            isGroup: boolOr(c.isGroup),
            sourceFile,
            pinned: boolOr(c.pinned),
            archived: boolOr(c.archived),
          },
        })
        chatId = created.id
      } catch {
        chatsSkipped++ // raced with an identical title+sourceFile insert
        continue
      }
    }
    chatsCreated++
    createdIds.push(chatId)

    // Messages — chunked createMany (SQLite parameter limit safety)
    const rows: {
      id?: string
      chatId: string
      idx: number
      ts: Date
      sender: string | null
      body: string
      type: string
      mediaPath: string | null
      mediaName: string | null
      starred: boolean
      edited: boolean
      forwardedFrom: string | null
      pollOptions: string | null
      pinned: boolean
      reactions: string | null
      replyToId: string | null
      /** Task 2-d — transcript to write back after the row is inserted. */
      transcript: string | null
    }[] = []

    if (Array.isArray(c.messages)) {
      for (let i = 0; i < c.messages.length; i++) {
        const rawMsg = c.messages[i]
        if (!rawMsg || typeof rawMsg !== 'object' || Array.isArray(rawMsg)) {
          continue
        }
        const m = rawMsg as BackupMessage
        const ts = new Date(typeof m.ts === 'string' ? m.ts : '')
        if (Number.isNaN(ts.getTime())) continue // invalid date — drop the row
        const idx =
          typeof m.idx === 'number' && Number.isFinite(m.idx)
            ? Math.max(0, Math.floor(m.idx))
            : i
        const messageId = strOrNull(m.id)
        if (messageId) {
          if (!existingMessageIds) {
            const all = await db.message.findMany({ select: { id: true } })
            existingMessageIds = new Set(all.map((r) => r.id))
          }
          if (existingMessageIds.has(messageId)) continue // duplicate id — skip row
        }
        rows.push({
          ...(messageId ? { id: messageId } : {}),
          chatId: chatId!,
          idx,
          ts,
          sender: strOrNull(m.sender),
          body: typeof m.body === 'string' ? m.body.slice(0, 8000) : '',
          type: typeof m.type === 'string' && m.type ? m.type.slice(0, 40) : 'text',
          mediaPath: basePathOrNull(m.mediaPath),
          mediaName: basePathOrNull(m.mediaName),
          starred: boolOr(m.starred),
          edited: boolOr(m.edited),
          forwardedFrom: strOrNull(m.forwardedFrom),
          pollOptions: jsonListColumn(m.pollOptions),
          pinned: boolOr(m.pinned),
          reactions: jsonReactionsColumn(m.reactions),
          replyToId: strOrNull(m.replyToId)?.slice(0, 64) ?? null,
          // Task 2-d — restore the transcript only for voice-note rows that
          // keep their original id (the one the producer keyed it by). The
          // transcribe route only ever reads these keys for type='audio'
          // messages, so non-audio transcripts would be dead weight anyway.
          transcript:
            (typeof m.type === 'string' ? m.type : '') === 'audio'
              ? (strOrNull(m.transcript)?.slice(0, MAX_SYNC_TRANSCRIPT_CHARS) ??
                null)
              : null,
        })
      }
    }

    const CHUNK = 150
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const res = await db.message.createMany({
        data: chunk.map(({ transcript: _t, ...row }) => row),
      })
      messagesImported += res.count
      // Task 2-d — write the carried transcripts back into the AppSetting
      // cache so /api/transcribe serves them instantly after a restore.
      // (Only rows that were actually inserted have an id here — duplicate
      // ids were skipped above and keep their existing local transcript.)
      for (const r of chunk) {
        if (!r.id || !r.transcript) continue
        try {
          await db.appSetting.upsert({
            where: { key: `${TRANSCRIPT_KEY_PREFIX}${r.id}` },
            update: { value: r.transcript },
            create: {
              key: `${TRANSCRIPT_KEY_PREFIX}${r.id}`,
              value: r.transcript,
            },
          })
          transcriptsRestored++
        } catch {
          /* best-effort — the message itself is already restored */
        }
      }
    }
  }

  for (const chatId of createdIds) {
    await refreshChatAggregates(chatId)
  }

  return NextResponse.json({
    ok: true,
    chatsCreated,
    chatsSkipped,
    messagesImported,
    transcriptsRestored,
  })
}
