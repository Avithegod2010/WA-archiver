import { NextRequest, NextResponse } from "next/server"
import { db } from '@/lib/db'
import { ensureSavedMessagesChat } from '@/lib/chat-service'
import { assertAppUnlocked } from '@/lib/server-lock'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  // The personal Saved Messages chat always exists and sorts first (pinned)
  await ensureSavedMessagesChat()
  const chats = await db.chat.findMany({
    orderBy: [{ lastAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      isGroup: true,
      messageCount: true,
      mediaCount: true,
      firstAt: true,
      lastAt: true,
      lastPreview: true,
      lastSender: true,
      lastType: true,
      sourceFile: true,
      pinned: true,
      archived: true,
      createdAt: true,
    },
  })
  return NextResponse.json({ chats })
}

/**
 * POST /api/chats — create an empty chat row.
 * Used by the DataClient transport (createChat) for flows that need a chat
 * shell before messages arrive. Mirrors the LocalDataClient.createChat
 * defaults so both transports produce the same shape.
 */
export async function POST(req: NextRequest) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { title, isGroup, sourceFile, pinned, lastPreview } = (body ?? {}) as {
    title?: unknown
    isGroup?: unknown
    sourceFile?: unknown
    pinned?: unknown
    lastPreview?: unknown
  }

  const cleanTitle =
    typeof title === 'string' && title.trim()
      ? title.trim().slice(0, 120)
      : 'Imported Chat'

  const chat = await db.chat.create({
    data: {
      title: cleanTitle,
      isGroup: isGroup === true,
      sourceFile: typeof sourceFile === 'string' ? sourceFile.slice(0, 255) : '',
      pinned: pinned === true,
      lastPreview: typeof lastPreview === 'string' ? lastPreview.slice(0, 300) : '',
    },
  })
  return NextResponse.json({ chat })
}
