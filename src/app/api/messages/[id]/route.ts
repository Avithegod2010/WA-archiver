import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * PATCH /api/messages/:id  { starred: boolean }
 * Toggles the viewer-local "starred" bookmark on a message.
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
  const { starred } = (payload ?? {}) as { starred?: unknown }
  if (typeof starred !== 'boolean') {
    return NextResponse.json(
      { error: 'Field "starred" must be a boolean' },
      { status: 400 }
    )
  }

  try {
    const msg = await db.message.update({
      where: { id },
      data: { starred },
      select: {
        id: true,
        chatId: true,
        starred: true,
      },
    })
    return NextResponse.json({ message: msg })
  } catch {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }
}
