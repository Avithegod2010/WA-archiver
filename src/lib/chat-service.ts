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
