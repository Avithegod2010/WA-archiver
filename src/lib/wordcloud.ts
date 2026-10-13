/**
 * Per-chat word-cloud computation — shared by GET /api/chats/:id/wordcloud
 * (server) and the device-mode WordCloudDialog (on-device port, Phase 3).
 *
 * Isomorphic and dependency-free (only reuses the primitive regex/stopword
 * set from chat-analytics.ts), so it runs in the Node route handler and in
 * the browser against on-device rows alike.
 *
 * Callers pass messages NEWEST-FIRST (the server route queries
 * `orderBy: { ts: 'desc' }`; the device port reverses the idx-ASC rows) so
 * the scan cap keeps the most recent slice and cloud ties resolve the same
 * way they always did on the server.
 */

import { STOPWORDS, URL_RE, type WordCount } from '@/lib/chat-analytics'

/** Scan/slice caps — same values the routes always used. */
export const CLOUD_TOP_N = 60
export const CLOUD_MAX_SCAN = 20_000

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

export const CLOUD_STOPWORDS: ReadonlySet<string> = new Set([
  ...STOPWORDS,
  ...EXTRA_STOPWORDS,
])

/** Extract lowercase, punctuation-stripped, URL-free, number-free,
 *  stopword-filtered tokens (same tokenizer shape as countWords, but with
 *  the extended cloud stopword list). */
export function countCloudWords(body: string, into: Map<string, number>): void {
  const cleaned = body.replace(URL_RE, ' ').toLowerCase()
  const tokens = cleaned.match(/[a-z][a-z'’]{2,}/g)
  if (!tokens) return
  for (const raw of tokens) {
    const t = raw.replace(/[’']/g, '')
    if (CLOUD_STOPWORDS.has(t)) continue
    into.set(t, (into.get(t) ?? 0) + 1)
  }
}

/** Minimal message shape both transports can feed (Prisma rows and the
 *  ChatMessage DTO both satisfy it structurally). */
export interface CloudMessageInput {
  body: string | null
  type: string
}

export interface CloudOptions {
  /** How many words to return (default 60). */
  topN?: number
  /** Cap on scanned messages (default 20000, newest first). */
  maxScan?: number
}

/** Top meaningful words for ONE chat. `messages` must be ordered newest
 *  first; at most the most recent `maxScan` messages are scanned and only
 *  text/image/video bodies are tokenized. */
export function computeChatWordCloud(
  messages: readonly CloudMessageInput[],
  opts?: CloudOptions
): WordCount[] {
  const topN = opts?.topN ?? CLOUD_TOP_N
  const maxScan = opts?.maxScan ?? CLOUD_MAX_SCAN
  const scan =
    messages.length > maxScan ? messages.slice(0, maxScan) : messages

  const counts = new Map<string, number>()
  for (const m of scan) {
    if (m.type === 'text' || m.type === 'image' || m.type === 'video') {
      countCloudWords(m.body ?? '', counts)
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }))
}
