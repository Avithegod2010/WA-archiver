import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { refreshChatAggregates } from '@/lib/chat-service'
import { resolveMediaPath } from '@/lib/media-store'
import { promises as fs } from 'fs'

export const runtime = 'nodejs'

/**
 * PATCH /api/messages/:id
 * - { starred: boolean }  → viewer-local bookmark
 * - { body: string }      → local edit of the message text (marks "edited")
 * - { pinned: boolean }   → keep this message pinned to the top of the chat
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { starred, body, pinned } = (payload ?? {}) as {
    starred?: unknown
    body?: unknown
    pinned?: unknown
  }

  const data: {
    starred?: boolean
    body?: string
    edited?: boolean
    pinned?: boolean
  } = {}
  if (starred !== undefined) {
    if (typeof starred !== 'boolean') {
      return NextResponse.json(
        { error: 'Field "starred" must be a boolean' },
        { status: 400 }
      )
    }
    data.starred = starred
  }
  if (body !== undefined) {
    if (typeof body !== 'string' || !body.trim()) {
      return NextResponse.json(
        { error: 'Field "body" must be a non-empty string' },
        { status: 400 }
      )
    }
    data.body = body.trim().slice(0, 8000)
    data.edited = true
  }
  if (pinned !== undefined) {
    if (typeof pinned !== 'boolean') {
      return NextResponse.json(
        { error: 'Field "pinned" must be a boolean' },
        { status: 400 }
      )
    }
    data.pinned = pinned
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: 'Provide "starred", "body" and/or "pinned"' },
      { status: 400 }
    )
  }

  try {
    const msg = await db.message.update({
      where: { id },
      data,
      select: {
        id: true,
        chatId: true,
        body: true,
        starred: true,
        edited: true,
        pinned: true,
      },
    })
    if (data.body !== undefined) {
      await refreshChatAggregates(msg.chatId)
    }
    return NextResponse.json({ message: msg })
  } catch {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }
}

/**
 * DELETE /api/messages/:id — locally deletes one message (and its media file).
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  try {
    const msg = await db.message.delete({
      where: { id },
      select: { id: true, chatId: true, mediaPath: true },
    })
    if (msg.mediaPath) {
      try {
        const abs = await resolveMediaPath(msg.chatId, msg.mediaPath)
        if (abs) await fs.rm(abs, { force: true })
      } catch {
        /* ignore */
      }
    }
    await refreshChatAggregates(msg.chatId)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }
}
