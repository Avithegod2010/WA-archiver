import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSavedMessagesChat } from '@/lib/chat-service'

export const runtime = 'nodejs'

export async function GET() {
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
