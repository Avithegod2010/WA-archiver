import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  MESSAGE_SELECT,
  serializeMessage,
} from '@/lib/message-dto'
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

  return NextResponse.json({ chat, messages: rows.map(serializeMessage) })
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
 * POST /api/chats/:id/messages
 * - JSON   { type: 'text' | 'poll', body, pollOptions? }  → creates a message
 * - multipart (file, caption?)                            → uploads media
 * Local composing is attributed to sender "You".
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
        },
        select: MESSAGE_SELECT,
      })
      await refreshChatAggregates(id)
      return NextResponse.json({ message: serializeMessage(message) })
    }

    const payload = (await req.json().catch(() => null)) as {
      type?: unknown
      body?: unknown
      pollOptions?: unknown
    } | null
    if (!payload) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const type = payload.type === 'poll' ? 'poll' : 'text'
    const body = typeof payload.body === 'string' ? payload.body.trim() : ''
    if (!body) {
      return NextResponse.json({ error: 'Message text is empty' }, { status: 400 })
    }

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
        sender: 'You',
        body: body.slice(0, 8000),
        type,
        pollOptions,
      },
      select: MESSAGE_SELECT,
    })
    await refreshChatAggregates(id)
    return NextResponse.json({ message: serializeMessage(message) })
  } catch (err) {
    console.error('Create message failed:', err)
    return NextResponse.json({ error: 'Could not send message' }, { status: 500 })
  }
}
