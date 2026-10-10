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
    if (type === 'document' || type === 'contact') {
      return (body || mediaName || '').slice(0, 120)
    }
    if (type === 'poll') return body.slice(0, 120)
    return body ? body.slice(0, 120) : ''
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
    db.message.count({ where: { chatId, type: { in: [...MEDIA_TYPES] } } }),
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
    }
  })

  // Insert in chunks (SQLite parameter limit safety)
  const CHUNK = 150
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows
      .slice(i, i + CHUNK)
      .map(({ isMedia: _m, ...r }) => r)
    await db.message.createMany({ data: chunk })
  }

  const mediaCount = rows.filter((r) => r.isMedia).length
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
