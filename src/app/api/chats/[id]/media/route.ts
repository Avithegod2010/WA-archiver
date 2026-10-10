import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { statSync } from 'fs'
import path from 'path'

export const runtime = 'nodejs'

const MEDIA_TYPES = [
  'image',
  'video',
  'gif',
  'audio',
  'sticker',
  'document',
  'media',
]

/** Media items in a chat (newest first), for the gallery grid. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const chat = await db.chat.findUnique({
    where: { id },
    select: { id: true, title: true, isGroup: true, mediaCount: true },
  })
  if (!chat) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const rows = await db.message.findMany({
    where: { chatId: id, type: { in: MEDIA_TYPES } },
    orderBy: [{ ts: 'desc' }, { idx: 'desc' }],
    select: {
      id: true,
      idx: true,
      ts: true,
      sender: true,
      body: true,
      type: true,
      mediaPath: true,
      mediaName: true,
    },
  })

  const items = rows.map((m) => {
    let bytes: number | null = null
    if (m.mediaPath) {
      try {
        bytes = statSync(
          path.join(process.cwd(), 'db', 'media', id, m.mediaPath)
        ).size
      } catch {
        bytes = null
      }
    }
    return { ...m, bytes }
  })

  return NextResponse.json({ chat, items })
}
