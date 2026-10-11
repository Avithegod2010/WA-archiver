/**
 * Shared text-analytics primitives used by both the global /api/stats route
 * (server) and the per-chat ChatInfo insights (client). Keep this module
 * dependency-free so it works in both runtimes.
 */

/** Extended-pictographic emoji matcher (leading code point of ZWJ sequences). */
export const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}]/gu

export const URL_RE = /(https?:\/\/\S+|www\.\S+)/gi
/** Non-global link presence test (safe for .test() — no lastIndex carryover). */
export const URL_TEST_RE = /https?:\/\/|www\./i

/**
 * Lowercased words that carry little insight on their own:
 * English glue words, chat smalltalk and WhatsApp export artifacts.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  // core English glue
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how',
  'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'its', 'did', 'yes',
  'too', 'very', 'she', 'they', 'them', 'then', 'than', 'that', 'this',
  'with', 'have', 'just', 'will', 'what', 'when', 'were', 'been', 'your',
  'from', 'about', 'after', 'before', 'because', 'there', 'their', 'would',
  'could', 'should', 'into', 'over', 'only', 'where', 'which', 'while',
  'some', 'more', 'still', 'even', 'much', 'many', 'also', 'let',
  // chat smalltalk
  'okay', 'ok', 'haha', 'hahaha', 'lol', 'hmm', 'hey', 'hi', 'hello', 'yeah',
  'yep', 'nope', 'thanks', 'thank', 'please', 'good', 'great', 'well', 'nice',
  'want', 'need', 'know', 'think', 'like', 'make', 'time', 'today', 'tomorrow',
  'back', 'got', 'gonna', 'wanna', 'really', 'right', 'sure', 'fine', 'works',
  'everyone',
  // WhatsApp export artifacts
  'dont', "don't", 'didnt', "didn't", 'cant', "can't", 'wont', "won't",
  'isnt', "isn't", 'im', "i'm", 'ive', "i've", 'ill', "i'll", 'id', "i'd",
  'youre', "you're", 'thats', "that's", 'omitted', 'image', 'video',
  'sticker', 'audio', 'document', 'gif', 'message', 'messages', 'deleted',
  'missed', 'voice', 'call', 'calls', 'poll', 'location', 'live', 'awaiting',
  'encryption', 'www', 'com', 'jpg', 'png', 'pdf',
])

export type WordCount = { word: string; count: number }

/** Extract stopword-filtered word tokens from a message body. */
export function countWords(body: string, into: Map<string, number>): void {
  const cleaned = body.replace(URL_RE, ' ').toLowerCase()
  const tokens = cleaned.match(/[a-z][a-z'’]{2,}/g)
  if (!tokens) return
  for (const raw of tokens) {
    const t = raw.replace(/[’']/g, '')
    if (t.length < 3 || STOPWORDS.has(t)) continue
    into.set(t, (into.get(t) ?? 0) + 1)
  }
}

export function topEntries<T>(
  map: Map<string, number>,
  mapFn: ([k, count]: [string, number]) => T,
  limit: number
): T[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(mapFn)
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

/** Humanize a median reply time (ms) — "under a min", "4 min", "2.3 h", "3 d". */
export function fmtReply(ms: number): string {
  if (ms < 60_000) return 'under a min'
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min} min`
  const hr = ms / 3_600_000
  return hr < 24 ? `${hr.toFixed(1)} h` : `${Math.round(hr / 24)} d`
}

export function hourLabel(h: number): string {
  const suffix = h < 12 ? 'am' : 'pm'
  const base = h % 12 === 0 ? 12 : h % 12
  return `${base}${suffix}`
}
