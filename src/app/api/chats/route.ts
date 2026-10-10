import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
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
      createdAt: true,
    },
  })
  return NextResponse.json({ chats })
}
