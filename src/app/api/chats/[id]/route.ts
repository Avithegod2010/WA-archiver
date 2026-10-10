import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { removeChatMedia } from '@/lib/media-store'

export const runtime = 'nodejs'

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { pinned } = (body ?? {}) as { pinned?: unknown }
  if (typeof pinned !== 'boolean') {
    return NextResponse.json(
      { error: 'Field "pinned" must be a boolean' },
      { status: 400 }
    )
  }
  const chat = await db.chat.findUnique({ where: { id }, select: { id: true } })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }
  const updated = await db.chat.update({
    where: { id },
    data: { pinned },
    select: { id: true, pinned: true },
  })
  return NextResponse.json({ chat: updated })
}

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
