import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

const MIN_BODY = 1
const MAX_BODY = 4000
const MAX_SENDER = 80
/** Small clock-skew allowance so "now" deliveries are accepted. */
const PAST_TOLERANCE_MS = 10_000
const MAX_HORIZON_MS = 30 * 24 * 60 * 60 * 1000

/**
 * POST /api/scheduled
 * Body: { chatId, body, deliverAt (ISO string), sender? }
 * Validates the chat exists, the body length and the delivery window
 * (now-10s … now+30 days), then stores a pending scheduled message.
 * Returns { item }.
 */
export async function POST(req: NextRequest) {
  const payload = (await req.json().catch(() => null)) as {
    chatId?: unknown
    body?: unknown
    deliverAt?: unknown
    sender?: unknown
  } | null
  if (!payload) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const chatId =
    typeof payload.chatId === 'string' ? payload.chatId.trim() : ''
  if (!chatId) {
    return NextResponse.json(
      { error: 'Field "chatId" must be a non-empty string' },
      { status: 400 }
    )
  }
  const chat = await db.chat.findUnique({
    where: { id: chatId },
    select: { id: true },
  })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const body = typeof payload.body === 'string' ? payload.body.trim() : ''
  if (body.length < MIN_BODY) {
    return NextResponse.json(
      { error: 'Message text is empty' },
      { status: 400 }
    )
  }
  if (body.length > MAX_BODY) {
    return NextResponse.json(
      { error: `Message text must be at most ${MAX_BODY} characters` },
      { status: 400 }
    )
  }

  const senderRaw =
    typeof payload.sender === 'string' ? payload.sender.trim() : ''
  const sender = (senderRaw || 'You').slice(0, MAX_SENDER)

  if (typeof payload.deliverAt !== 'string' || !payload.deliverAt.trim()) {
    return NextResponse.json(
      { error: 'Field "deliverAt" must be an ISO date string' },
      { status: 400 }
    )
  }
  const deliverAt = new Date(payload.deliverAt)
  if (Number.isNaN(deliverAt.getTime())) {
    return NextResponse.json(
      { error: 'Field "deliverAt" is not a valid date' },
      { status: 400 }
    )
  }
  const now = Date.now()
  if (deliverAt.getTime() < now - PAST_TOLERANCE_MS) {
    return NextResponse.json(
      { error: 'Pick a time in the future' },
      { status: 400 }
    )
  }
  if (deliverAt.getTime() > now + MAX_HORIZON_MS) {
    return NextResponse.json(
      { error: 'Pick a time within the next 30 days' },
      { status: 400 }
    )
  }

  const item = await db.scheduledMessage.create({
    data: {
      chatId,
      body,
      sender,
      deliverAt,
      status: 'pending',
    },
  })

  return NextResponse.json({ item }, { status: 201 })
}

/**
 * GET /api/scheduled?chatId=…
 * Pending scheduled messages of one chat, soonest first.
 */
export async function GET(req: NextRequest) {
  const chatId = req.nextUrl.searchParams.get('chatId')?.trim() ?? ''
  if (!chatId) {
    return NextResponse.json(
      { error: 'Query param "chatId" is required' },
      { status: 400 }
    )
  }
  const chat = await db.chat.findUnique({
    where: { id: chatId },
    select: { id: true },
  })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }
  const items = await db.scheduledMessage.findMany({
    where: { chatId, status: 'pending' },
    orderBy: { deliverAt: 'asc' },
  })
  return NextResponse.json({ items })
}
