import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { statSync } from 'fs'
import path from 'path'
import { assertAppUnlocked } from '@/lib/server-lock'

export const runtime = 'nodejs'

const MEDIA_TYPES = [
  'image',
  'video',
  'gif',
  'audio',
  'sticker',
  'document',
  'media',
]

/** Safety cap — the hub renders newest-first, older rows are simply omitted. */
const MAX_ROWS = 5000

/**
 * Global media index across every chat (media hub). Newest first, with the
 * owning chat's title so the UI can group/filter/label without N requests.
 *
 * Chat titles are joined in JS (not via the Prisma relation) so a stray
 * orphaned message row can never fail the whole index with P2023.
 */
export async function GET(req: NextRequest) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  const rows = await db.message.findMany({
    where: { type: { in: MEDIA_TYPES }, mediaPath: { not: null } },
    orderBy: [{ ts: 'desc' }, { idx: 'desc' }],
    take: MAX_ROWS,
    select: {
      id: true,
      idx: true,
      ts: true,
      sender: true,
      body: true,
      type: true,
      mediaPath: true,
      mediaName: true,
      starred: true,
      chatId: true,
    },
  })

  // title lookup for the owning chats — tolerant of orphaned rows
  const chatIds = [...new Set(rows.map((m) => m.chatId))]
  const chats = await db.chat.findMany({
    where: { id: { in: chatIds } },
    select: { id: true, title: true },
  })
  const titleById = new Map(chats.map((c) => [c.id, c.title]))

  const truncated = rows.length >= MAX_ROWS

  const items = rows.map((m) => {
    let bytes: number | null = null
    if (m.mediaPath) {
      try {
        bytes = statSync(
          path.join(process.cwd(), 'db', 'media', m.chatId, m.mediaPath)
        ).size
      } catch {
        bytes = null
      }
    }
    return {
      id: m.id,
      idx: m.idx,
      ts: m.ts.toISOString(),
      sender: m.sender,
      body: m.body,
      type: m.type,
      mediaPath: m.mediaPath,
      mediaName: m.mediaName,
      bytes,
      chatId: m.chatId,
      chatTitle: titleById.get(m.chatId) ?? 'Unknown chat',
      starred: m.starred,
    }
  })

  return NextResponse.json({ items, truncated })
}
