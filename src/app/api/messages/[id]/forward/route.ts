import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  SAVED_CHAT_ID,
  ensureSavedMessagesChat,
  refreshChatAggregates,
} from '@/lib/chat-service'
import {
  generateVideoPoster,
  isVideoName,
  resolveMediaPath,
  saveMediaFile,
} from '@/lib/media-store'
import { MESSAGE_SELECT, serializeMessage } from '@/lib/message-dto'
import { promises as fs } from 'fs'

export const runtime = 'nodejs'

/**
 * POST /api/messages/:id/forward  { targetChatId?: string }
 * Copies a message (including its media file) into another chat — by default
 * into the personal "Saved Messages" chat, Telegram-style. The copy is
 * attributed to "You" and keeps a "Forwarded from <sender>" marker.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const payload = (await req.json().catch(() => ({}))) as {
    targetChatId?: unknown
  }
  const targetChatId =
    typeof payload.targetChatId === 'string' && payload.targetChatId
      ? payload.targetChatId
      : SAVED_CHAT_ID

  const source = await db.message.findUnique({ where: { id } })
  if (!source) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  if (targetChatId === SAVED_CHAT_ID) {
    await ensureSavedMessagesChat()
  } else {
    const target = await db.chat.findUnique({
      where: { id: targetChatId },
      select: { id: true },
    })
    if (!target) {
      return NextResponse.json({ error: 'Target chat not found' }, { status: 404 })
    }
  }

  try {
    // Copy media into the target chat's media folder
    let mediaPath: string | null = null
    let mediaName: string | null = source.mediaName
    if (source.mediaPath) {
      const abs = await resolveMediaPath(source.chatId, source.mediaPath)
      if (abs) {
        const buf = await fs.readFile(abs)
        const stored = await saveMediaFile(
          targetChatId,
          mediaName ?? source.mediaPath,
          buf
        )
        mediaPath = stored
        mediaName = stored.split('/').pop() ?? stored
        if (isVideoName(stored)) await generateVideoPoster(targetChatId, stored)
      }
    }

    const last = await db.message.findFirst({
      where: { chatId: targetChatId },
      orderBy: { idx: 'desc' },
      select: { idx: true },
    })

    // Avoid duplicating straight into the source chat it came from with no change
    const forwardedFrom =
      source.chatId === targetChatId ? (source.forwardedFrom ?? source.sender) : source.sender

    const message = await db.message.create({
      data: {
        chatId: targetChatId,
        idx: (last?.idx ?? -1) + 1,
        ts: new Date(),
        sender: 'You',
        body: source.body,
        type: source.type,
        mediaPath,
        mediaName,
        pollOptions: source.pollOptions,
        forwardedFrom: forwardedFrom ?? 'Unknown',
      },
      select: MESSAGE_SELECT,
    })
    await refreshChatAggregates(targetChatId)
    return NextResponse.json({ message: serializeMessage(message) })
  } catch (err) {
    console.error('Forward failed:', err)
    return NextResponse.json({ error: 'Could not forward message' }, { status: 500 })
  }
}
