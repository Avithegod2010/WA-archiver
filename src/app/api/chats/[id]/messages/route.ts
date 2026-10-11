import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { MESSAGE_SELECT, withReplyTos } from '@/lib/message-dto'
import { refreshChatAggregates } from '@/lib/chat-service'
import {
  generateVideoPoster,
  isVideoName,
  saveMediaFile,
} from '@/lib/media-store'

export const runtime = 'nodejs'

const MAX_MESSAGES = 12000

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const chat = await db.chat.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      isGroup: true,
      messageCount: true,
      mediaCount: true,
      firstAt: true,
      lastAt: true,
      sourceFile: true,
    },
  })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const rows = await db.message.findMany({
    where: { chatId: id },
    orderBy: [{ idx: 'asc' }],
    take: MAX_MESSAGES,
    select: MESSAGE_SELECT,
  })

  return NextResponse.json({ chat, messages: await withReplyTos(rows) })
}

function typeFromMime(mime: string): 'image' | 'video' | 'audio' | 'document' {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

async function nextIdx(chatId: string): Promise<number> {
  const last = await db.message.findFirst({
    where: { chatId },
    orderBy: { idx: 'desc' },
    select: { idx: true },
  })
  return (last?.idx ?? -1) + 1
}

/**
 * Validate an optional replyToId: only accepted when the target message
 * exists AND belongs to the same chat; otherwise silently ignored.
 */
async function resolveReplyToId(
  chatId: string,
  raw: unknown
): Promise<string | null> {
  if (typeof raw !== 'string') return null
  const candidate = raw.trim()
  if (!candidate) return null
  const target = await db.message.findFirst({
    where: { id: candidate, chatId },
    select: { id: true },
  })
  return target ? target.id : null
}

function sanitizeForwardedFrom(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim().slice(0, 120)
  return value || null
}

/**
 * Serialize a freshly created message, resolving its replyTo (if any) so the
 * client can render the quote immediately. Single-row fast path.
 */
async function serializeCreated(message: { id: string }) {
  const row = await db.message.findUnique({
    where: { id: message.id },
    select: MESSAGE_SELECT,
  })
  if (!row) throw new Error('Message vanished after create')
  const [serialized] = await withReplyTos([row])
  return serialized
}

/**
 * POST /api/chats/:id/messages
 * - JSON   { type: 'text' | 'poll', body, pollOptions?, sender?, replyToId?, forwardedFrom? }
 * - multipart (file, caption?, replyToId?, forwardedFrom?)           → uploads media
 * JSON sender is trimmed/≤80 chars and defaults to "You" (used for simulated
 * persona replies). replyToId must reference a message of the same chat —
 * invalid ids are ignored, not rejected. forwardedFrom is trimmed/≤120 chars.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const chat = await db.chat.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const contentType = req.headers.get('content-type') ?? ''

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file')
      const caption = String(form.get('caption') ?? '').slice(0, 8000)
      if (!(file instanceof File) || file.size === 0) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 })
      }
      if (file.size > 400 * 1024 * 1024) {
        return NextResponse.json({ error: 'File too large (max 400MB)' }, { status: 413 })
      }
      const replyToId = await resolveReplyToId(id, form.get('replyToId'))
      const forwardedFrom = sanitizeForwardedFrom(form.get('forwardedFrom'))
      const buffer = Buffer.from(await file.arrayBuffer())
      const stored = await saveMediaFile(id, file.name, buffer)
      const type = typeFromMime(file.type || '')
      if (type === 'video' && isVideoName(stored)) {
        await generateVideoPoster(id, stored)
      }
      const message = await db.message.create({
        data: {
          chatId: id,
          idx: await nextIdx(id),
          ts: new Date(),
          sender: 'You',
          body: caption,
          type,
          mediaPath: stored,
          mediaName: stored.split('/').pop() ?? stored,
          replyToId,
          forwardedFrom,
        },
        select: MESSAGE_SELECT,
      })
      await refreshChatAggregates(id)
      return NextResponse.json({ message: await serializeCreated(message) })
    }

    const payload = (await req.json().catch(() => null)) as {
      type?: unknown
      body?: unknown
      pollOptions?: unknown
      sender?: unknown
      replyToId?: unknown
      forwardedFrom?: unknown
    } | null
    if (!payload) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const type = payload.type === 'poll' ? 'poll' : 'text'
    const body = typeof payload.body === 'string' ? payload.body.trim() : ''
    if (!body) {
      return NextResponse.json({ error: 'Message text is empty' }, { status: 400 })
    }

    const senderRaw =
      typeof payload.sender === 'string' ? payload.sender.trim() : ''
    const sender = (senderRaw || 'You').slice(0, 80)
    const replyToId = await resolveReplyToId(id, payload.replyToId)
    const forwardedFrom = sanitizeForwardedFrom(payload.forwardedFrom)

    let pollOptions: string | null = null
    if (type === 'poll') {
      const opts = Array.isArray(payload.pollOptions) ? payload.pollOptions : []
      const clean = [
        ...new Set(
          opts
            .filter((o): o is string => typeof o === 'string')
            .map((o) => o.trim().slice(0, 100))
            .filter(Boolean)
        ),
      ].slice(0, 12)
      if (clean.length < 2) {
        return NextResponse.json(
          { error: 'A poll needs at least two options' },
          { status: 400 }
        )
      }
      pollOptions = JSON.stringify(clean)
    }

    const message = await db.message.create({
      data: {
        chatId: id,
        idx: await nextIdx(id),
        ts: new Date(),
        sender,
        body: body.slice(0, 8000),
        type,
        pollOptions,
        replyToId,
        forwardedFrom,
      },
      select: MESSAGE_SELECT,
    })
    await refreshChatAggregates(id)
    return NextResponse.json({ message: await serializeCreated(message) })
  } catch (err) {
    console.error('Create message failed:', err)
    return NextResponse.json({ error: 'Could not send message' }, { status: 500 })
  }
}
