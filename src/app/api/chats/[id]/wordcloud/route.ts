import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { STOPWORDS, URL_RE } from '@/lib/chat-analytics'

export const runtime = 'nodejs'

const TOP_N = 60
const MAX_SCAN = 20_000

/** Extra glue words dropped from the word cloud: common English fillers
 *  from the task spec (some overlap with STOPWORDS is harmless) plus
 *  common Hinglish fillers and chat laughter. Kept in sync with the
 *  global word cloud in /api/stats. */
const EXTRA_STOPWORDS: ReadonlySet<string> = new Set([
  // English glue
  'the', 'and', 'you', 'i', 'a', 'to', 'is', 'it', 'that', 'this', 'of', 'in',
  'on', 'for', 'was', 'he', 'she', 'they', 'we', 'but', 'with', 'my', 'not',
  'have', 'do', 'at', 'so', 'if', 'be', 'me', 'just',
  // Hinglish glue
  'ya', 'nahi', 'hai', 'ho', 'kar', 'ke', 'ka', 'ki', 'ko', 'se', 'aur',
  'main', 'bhi', 'ek', 'par', 'tha', 'hun', 'abhi',
  // smalltalk / laughter
  'ok', 'okay', 'haha', 'hahaha', 'lol',
])

const CLOUD_STOPWORDS: ReadonlySet<string> = new Set([
  ...STOPWORDS,
  ...EXTRA_STOPWORDS,
])

/** Extract lowercase, punctuation-stripped, URL-free, number-free,
 *  stopword-filtered tokens (same tokenizer shape as countWords, but with
 *  the extended cloud stopword list). */
function countCloudWords(body: string, into: Map<string, number>): void {
  const cleaned = body.replace(URL_RE, ' ').toLowerCase()
  const tokens = cleaned.match(/[a-z][a-z'’]{2,}/g)
  if (!tokens) return
  for (const raw of tokens) {
    const t = raw.replace(/[’']/g, '')
    if (CLOUD_STOPWORDS.has(t)) continue
    into.set(t, (into.get(t) ?? 0) + 1)
  }
}

/** Top 60 meaningful words for ONE chat (most recent 20k messages scanned). */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
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

  const counts = new Map<string, number>()
  for (const r of rows) {
    if (r.type === 'text' || r.type === 'image' || r.type === 'video') {
      countCloudWords(r.body ?? '', counts)
    }
  }

  const words = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([word, count]) => ({ word, count }))

  return NextResponse.json({ ok: true, words })
}
