import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { assertAppUnlocked } from '@/lib/server-lock'

export const runtime = 'nodejs'

/**
 * DELETE /api/scheduled/:id
 * Cancels a scheduled message — only while it is still pending.
 * Returns { ok: true } on success.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await assertAppUnlocked(_req)
  if (denied) return denied

  const { id } = await ctx.params

  // Idempotent claim: only a still-pending row can be cancelled.
  const cancelled = await db.scheduledMessage.updateMany({
    where: { id, status: 'pending' },
    data: { status: 'cancelled' },
  })
  if (cancelled.count === 1) {
    return NextResponse.json({ ok: true })
  }

  const existing = await db.scheduledMessage.findUnique({
    where: { id },
    select: { status: true },
  })
  if (!existing) {
    return NextResponse.json(
      { error: 'Scheduled message not found' },
      { status: 404 }
    )
  }
  return NextResponse.json(
    { error: `Message was already ${existing.status}` },
    { status: 409 }
  )
}
