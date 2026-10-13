import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeChatWordCloud } from '@/lib/wordcloud'
import { assertAppUnlocked } from '@/lib/server-lock'

export const runtime = 'nodejs'

const MAX_SCAN = 20_000

/** Top 60 meaningful words for ONE chat (most recent 20k messages scanned).
 *  Tokenizing/stopwords live in the shared isomorphic module
 *  src/lib/wordcloud.ts so the device-mode dialog computes the identical
 *  cloud on-device. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const denied = await assertAppUnlocked(_req)
  if (denied) return denied

  const { id } = await ctx.params

  const chat = await db.chat.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!chat) {
    return NextResponse.json(
      { ok: false, error: 'Chat not found' },
      { status: 404 }
    )
  }

  const rows = await db.message.findMany({
    where: { chatId: id },
    select: { body: true, type: true },
    orderBy: { ts: 'desc' },
    take: MAX_SCAN,
  })

  return NextResponse.json({ ok: true, words: computeChatWordCloud(rows) })
}
