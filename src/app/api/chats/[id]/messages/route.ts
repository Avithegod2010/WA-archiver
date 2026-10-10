import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

const MAX_MESSAGES = 12000

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const chat = await db.chat.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      isGroup: true,
      messageCount: true,
      mediaCount: true,
      firstAt: true,
      lastAt: true,
      sourceFile: true,
    },
  })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const messages = await db.message.findMany({
    where: { chatId: id },
    orderBy: [{ idx: 'asc' }],
    take: MAX_MESSAGES,
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
    },
  })

  return NextResponse.json({ chat, messages })
}
