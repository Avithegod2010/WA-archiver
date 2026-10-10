import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/** Starred messages in a chat (chronological), for the starred list dialog. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const chat = await db.chat.findUnique({
    where: { id },
    select: { id: true, title: true },
  })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const items = await db.message.findMany({
    where: { chatId: id, starred: true },
    orderBy: [{ idx: 'asc' }],
    select: {
      id: true,
      idx: true,
      ts: true,
      sender: true,
      body: true,
      type: true,
      mediaPath: true,
      mediaName: true,
    },
  })

  return NextResponse.json({ chat, items })
}
