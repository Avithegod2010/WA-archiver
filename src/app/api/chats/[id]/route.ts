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
  const { pinned, archived } = (body ?? {}) as {
    pinned?: unknown
    archived?: unknown
  }
  const data: { pinned?: boolean; archived?: boolean } = {}
  if (pinned !== undefined) {
    if (typeof pinned !== 'boolean') {
      return NextResponse.json(
        { error: 'Field "pinned" must be a boolean' },
        { status: 400 }
      )
    }
    data.pinned = pinned
  }
  if (archived !== undefined) {
    if (typeof archived !== 'boolean') {
      return NextResponse.json(
        { error: 'Field "archived" must be a boolean' },
        { status: 400 }
      )
    }
    data.archived = archived
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: 'Provide "pinned" and/or "archived" (boolean)' },
      { status: 400 }
    )
  }
  const chat = await db.chat.findUnique({ where: { id }, select: { id: true } })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }
  const updated = await db.chat.update({
    where: { id },
    data,
    select: { id: true, pinned: true, archived: true },
  })
  return NextResponse.json({ chat: updated })
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  if (id === 'saved-messages') {
    return NextResponse.json(
      { error: 'Saved Messages cannot be deleted' },
      { status: 403 }
    )
  }
  const chat = await db.chat.findUnique({ where: { id }, select: { id: true } })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }
  await db.chat.delete({ where: { id } })
  await removeChatMedia(id)
  return NextResponse.json({ ok: true })
}
