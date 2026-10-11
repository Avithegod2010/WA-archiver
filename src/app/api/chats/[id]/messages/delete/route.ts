import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { refreshChatAggregates } from '@/lib/chat-service'
import { resolveMediaPath } from '@/lib/media-store'
import { promises as fs } from 'fs'

export const runtime = 'nodejs'

/**
 * POST /api/chats/:id/messages/delete  { ids: string[] }
 * Locally deletes the given messages of one chat (and their media files),
 * then recomputes the chat aggregates once.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const payload = (await req.json().catch(() => null)) as {
    ids?: unknown
  } | null
  const ids = Array.isArray(payload?.ids)
    ? payload.ids.filter((v): v is string => typeof v === 'string')
    : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No message ids given' }, { status: 400 })
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: 'Too many ids (max 500)' }, { status: 400 })
  }

  const chat = await db.chat.findUnique({ where: { id }, select: { id: true } })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const victims = await db.message.findMany({
    where: { chatId: id, id: { in: ids } },
    select: { id: true, mediaPath: true },
  })
  if (victims.length === 0) {
    return NextResponse.json({ deleted: 0 })
  }

  await db.message.deleteMany({
    where: { chatId: id, id: { in: victims.map((v) => v.id) } },
  })

  // Best-effort media cleanup (files + poster thumbnails)
  for (const v of victims) {
    if (!v.mediaPath) continue
    try {
      const abs = await resolveMediaPath(id, v.mediaPath)
      if (abs) await fs.rm(abs, { force: true })
      const poster = await resolveMediaPath(id, `${v.mediaPath}.poster.jpg`)
      if (poster && poster.endsWith('.poster.jpg')) {
        await fs.rm(poster, { force: true })
      }
    } catch {
      /* ignore individual file errors */
    }
  }

  await refreshChatAggregates(id)

  return NextResponse.json({ deleted: victims.length })
}
