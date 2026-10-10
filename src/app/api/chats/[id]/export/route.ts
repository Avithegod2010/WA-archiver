import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildWhatsAppText, safeFileTitle } from '@/lib/export-text'

export const runtime = 'nodejs'

/** Downloads the chat as an authentic WhatsApp-format .txt log. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const chat = await db.chat.findUnique({
    where: { id },
    select: { title: true, sourceFile: true },
  })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const messages = await db.message.findMany({
    where: { chatId: id },
    orderBy: [{ idx: 'asc' }],
    select: { ts: true, sender: true, body: true, type: true, mediaName: true },
  })

  const text = buildWhatsAppText(messages)
  const filename = `WhatsApp Chat - ${safeFileTitle(chat.title)}.txt`

  return new NextResponse(text, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
