import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { refreshChatAggregates } from '@/lib/chat-service'
import { parseReactions } from '@/lib/message-dto'

export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_BODY_BYTES = 50 * 1024 * 1024 // ~50MB guard
const MEDIA_NOTE = 'Media files are not included in JSON backups'

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
}

const strOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null

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
export async function GET() {
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
    },
  })

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
    })
  }

  const payload = {
    version: 1,
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
 * rows with invalid dates or duplicate ids are dropped.
 */
export async function POST(req: NextRequest) {
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
          mediaPath: strOrNull(m.mediaPath),
          mediaName: strOrNull(m.mediaName),
          starred: boolOr(m.starred),
          edited: boolOr(m.edited),
          forwardedFrom: strOrNull(m.forwardedFrom),
          pollOptions: jsonListColumn(m.pollOptions),
          pinned: boolOr(m.pinned),
          reactions: jsonReactionsColumn(m.reactions),
        })
      }
    }

    const CHUNK = 150
    for (let i = 0; i < rows.length; i += CHUNK) {
      const res = await db.message.createMany({
        data: rows.slice(i, i + CHUNK),
      })
      messagesImported += res.count
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
  })
}
