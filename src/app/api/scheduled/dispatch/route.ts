import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { refreshChatAggregates } from '@/lib/chat-service'
import { assertAppUnlocked } from '@/lib/server-lock'

export const runtime = 'nodejs'

const DISPATCH_LIMIT = 50
const MAX_MESSAGE_BODY = 8000

/** Next sequential idx for a chat (same rule as POST /api/chats/:id/messages). */
async function nextIdx(chatId: string): Promise<number> {
  const last = await db.message.findFirst({
    where: { chatId },
    orderBy: { idx: 'desc' },
    select: { idx: true },
  })
  return (last?.idx ?? -1) + 1
}

/**
 * POST /api/scheduled/dispatch
 * Delivers every pending scheduled message whose time has come (limit 50):
 * creates a real Message row stamped with the SCHEDULED time, marks the item
 * "sent" and refreshes the chat aggregates. Idempotent — the status claim
 * (pending → sent) guards against double delivery by overlapping callers.
 * Returns { delivered, chatIds } so the client can refresh open chats.
 */
export async function POST(_req: NextRequest) {
  const denied = await assertAppUnlocked(_req)
  if (denied) return denied

  const now = new Date()
  const due = await db.scheduledMessage.findMany({
    where: { status: 'pending', deliverAt: { lte: now } },
    orderBy: { deliverAt: 'asc' },
    take: DISPATCH_LIMIT,
  })

  const deliveredChatIds = new Set<string>()
  let delivered = 0

  for (const item of due) {
    // Claim first (atomic pending → sent) so a second dispatch can't send it.
    const claim = await db.scheduledMessage.updateMany({
      where: { id: item.id, status: 'pending' },
      data: { status: 'sent' },
    })
    if (claim.count !== 1) continue

    try {
      const chat = await db.chat.findUnique({
        where: { id: item.chatId },
        select: { id: true },
      })
      if (!chat) {
        // Chat vanished since scheduling — drop the item instead of looping.
        await db.scheduledMessage.updateMany({
          where: { id: item.id, status: 'sent' },
          data: { status: 'cancelled' },
        })
        continue
      }
      await db.message.create({
        data: {
          chatId: item.chatId,
          idx: await nextIdx(item.chatId),
          ts: item.deliverAt,
          sender: item.sender,
          body: item.body.slice(0, MAX_MESSAGE_BODY),
          type: 'text',
        },
      })
      await refreshChatAggregates(item.chatId)
      deliveredChatIds.add(item.chatId)
      delivered += 1
    } catch (err) {
      console.error('Scheduled dispatch failed for item', item.id, err)
      // Release the claim so the next tick can retry.
      await db.scheduledMessage
        .updateMany({
          where: { id: item.id, status: 'sent' },
          data: { status: 'pending' },
        })
        .catch(() => undefined)
    }
  }

  return NextResponse.json({
    delivered,
    chatIds: [...deliveredChatIds],
  })
}
