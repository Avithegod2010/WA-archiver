import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { removeChatMedia } from '@/lib/media-store'

export const runtime = 'nodejs'

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const chat = await db.chat.findUnique({ where: { id }, select: { id: true } })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }
  await db.chat.delete({ where: { id } })
  await removeChatMedia(id)
  return NextResponse.json({ ok: true })
}
