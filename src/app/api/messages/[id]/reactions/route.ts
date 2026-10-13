import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseReactions } from '@/lib/message-dto'
import { assertAppUnlocked } from '@/lib/server-lock'

export const runtime = 'nodejs'

/**
 * POST /api/messages/:id/reactions
 * Body: { emoji: string }
 * Toggles "You" as the sender for that emoji on the message. Adding when
 * absent, removing when present; the emoji key is dropped once its sender
 * list becomes empty. Stored shape in DB: {"👍":["You"]}.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  const { id } = await ctx.params
  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { emoji } = (payload ?? {}) as { emoji?: unknown }
  if (typeof emoji !== 'string' || !emoji.trim()) {
    return NextResponse.json(
      { error: 'Field "emoji" must be a non-empty string' },
      { status: 400 }
    )
  }
  const key = emoji.trim()
  if ([...key].length > 8) {
    return NextResponse.json(
      { error: 'Field "emoji" must be at most 8 UTF-16 code units' },
      { status: 400 }
    )
  }

  try {
    const current = await db.message.findUnique({
      where: { id },
      select: { reactions: true },
    })
    if (!current) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    const reactions = parseReactions(current.reactions) ?? {}
    const senders = reactions[key] ?? []
    const idx = senders.indexOf('You')
    if (idx >= 0) {
      senders.splice(idx, 1)
    } else {
      senders.push('You')
    }
    if (senders.length > 0) {
      reactions[key] = senders
    } else {
      delete reactions[key]
    }

    const hasAny = Object.keys(reactions).length > 0
    await db.message.update({
      where: { id },
      data: { reactions: hasAny ? JSON.stringify(reactions) : null },
    })

    return NextResponse.json({ reactions })
  } catch {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }
}
