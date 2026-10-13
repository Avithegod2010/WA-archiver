/**
 * Persona reply engine for demo chats (Task 14-b).
 *
 * Demo chats (sourceFile starts with `demo://`) can feel alive: after the
 * user sends a text, ChatView schedules a reply from the chat's persona
 * (derived from the transcript). The reply text comes from the AI route's
 * `reply` mode when it lands within AI_REPLY_TIMEOUT_MS, with an offline
 * template pool as the instant, never-failing fallback.
 *
 * This module is client-side only (localStorage + fetch) — every export is
 * SSR-guarded or pure. It never throws.
 */

import { aiHeaders } from './ai-client'

/** localStorage key for the global auto-reply toggle ('1' / '0'). */
export const AUTO_REPLY_KEY = 'wa-viewer:auto-reply'

/** The AI 'reply' call must settle within this window or the offline line wins. */
export const AI_REPLY_TIMEOUT_MS = 4000

/** Marker shared with POST /api/demo — demo chats use `demo://<id>@v2` keys. */
export function isDemoSource(sourceFile: string | null | undefined): boolean {
  return typeof sourceFile === 'string' && sourceFile.startsWith('demo://')
}

/**
 * Read the auto-reply toggle. Absent key → default ON (demo chats only, the
 * caller guarantees the chat is a demo one before consulting this).
 */
export function readAutoReplyEnabled(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const raw = window.localStorage.getItem(AUTO_REPLY_KEY)
    if (raw === '0') return false
    return true // '1' or absent → on
  } catch {
    return true
  }
}

/** Persist the auto-reply toggle ('1' / '0'). */
export function writeAutoReplyEnabled(on: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AUTO_REPLY_KEY, on ? '1' : '0')
  } catch {
    // Storage unavailable (private mode etc.) — the in-memory toggle still works.
  }
}

/**
 * Persona for a chat = the most recent INCOMING sender (sender !== 'You'),
 * falling back to the most frequent incoming sender, then to nothing (no
 * incoming messages → nobody to reply as).
 */
export function derivePersona(
  messages: { sender: string | null }[]
): string | null {
  const incoming = messages.filter(
    (m) => m.sender && m.sender.trim() && m.sender !== 'You'
  )
  if (incoming.length === 0) return null
  // Most recent incoming sender wins.
  const recent = incoming[incoming.length - 1].sender?.trim()
  if (recent) return recent
  // Fallback: the most frequent incoming sender (defensive — the filter above
  // already guarantees non-empty names, so this rarely runs).
  const counts = new Map<string, number>()
  for (const m of incoming) {
    const name = m.sender!.trim()
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name
      bestCount = count
    }
  }
  return best
}

/* ------------------------------------------------------------------ */
/* Offline reply builder                                               */
/* ------------------------------------------------------------------ */

/** Words that never make good keywords (fillers, time words, greetings…). */
const STOPWORDS = new Set([
  'about', 'after', 'again', 'all', 'also', 'always', 'and', 'any', 'are',
  'back', 'because', 'been', 'before', 'being', 'both', 'but', 'call', 'came',
  'come', 'could', 'did', 'does', 'doing', 'done', 'down', 'even', 'ever',
  'every', 'feel', 'felt', 'few', 'first', 'for', 'from', 'get', 'give',
  'going', 'gone', 'good', 'got', 'great', 'had', 'has', 'have', 'having',
  'hello', 'help', 'her', 'here', 'hers', 'hey', 'him', 'his', 'how', 'into',
  'just', 'know', 'later', 'like', 'lol', 'look', 'looking', 'made', 'make',
  'many', 'maybe', 'more', 'most', 'much', 'must', 'need', 'never', 'next',
  'nice', 'nope', 'not', 'now', 'okay', 'only', 'other', 'our', 'out', 'over',
  'please', 'really', 'right', 'said', 'same', 'send', 'sent', 'shall',
  'should', 'since', 'some', 'soon', 'still', 'such', 'sure', 'take', 'tell',
  'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'thing',
  'things', 'this', 'those', 'through', 'time', 'today', 'together', 'tomorrow',
  'tonight', 'took', 'under', 'until', 'very', 'wait', 'want', 'was', 'way',
  'well', 'went', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
  'why', 'will', 'with', 'won', 'wont', 'would', 'yeah', 'yes', 'yet', 'you',
  'your', 'yours', 'haha', 'hahaha', 'gonna', 'wanna', 'cant', 'dont', 'didnt',
  'doesnt', 'isnt', 'wasnt', 'werent', 'wont', 'couldnt', 'shouldnt', 'wouldnt',
  'havent', 'hasnt', 'thanks', 'thank', 'sorry', 'please', 'message',
])

/**
 * Keyword candidates from the most recent outgoing texts (newest first):
 * lowercase words of 4+ letters that aren't stopwords, longest first within
 * each message. Returns up to `max` keywords.
 */
export function extractKeywords(texts: string[], max = 2): string[] {
  const out: string[] = []
  for (const text of texts) {
    if (out.length >= max) break
    const cleaned = text.toLowerCase().replace(/'s\b/g, '')
    const words = cleaned.match(/[a-z]{4,}/g) ?? []
    const candidates = [...new Set(words.filter((w) => !STOPWORDS.has(w)))].sort(
      (a, b) => b.length - a.length
    )
    for (const word of candidates) {
      if (!out.includes(word)) out.push(word)
      if (out.length >= max) break
    }
  }
  return out
}

/** Generic, WhatsApp-natural one-liners. */
const GENERIC_TEMPLATES = [
  'Haha yes',
  "Okay okay, I'll check and tell you",
  'Sounds good 👍',
  'Wait what time was that again?',
  'I saw your message, just a bit busy — one sec',
  'Send me a pic?',
  'Lol true',
  'Alright, noted 👍',
  'Hmm, let me get back to you on that',
  'Haha no way 😄',
  'Sure sure',
  "One sec, I'm on my way",
  'Yeah I was thinking the same!',
  'Ok 👍 will do',
  'Tell me more',
  'Wait really? 😳',
  'Hmm interesting…',
  'Got it, thanks for letting me know 👍',
]

/** Keyword-aware lines — used when a keyword was found in the recent texts. */
const KEYWORD_TEMPLATES = [
  'Oh {kw}, I was going to ask you about that!',
  'Wait, {kw}? Tell me everything 👀',
  'Haha {kw}, classic',
  'Okay but what about {kw}? 👀',
]

/** FNV-1a — small deterministic string hash for the reply seed. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 PRNG — deterministic, tiny, good enough for template picks. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface OfflineReplyInput {
  chatId: string
  /** Message count at send time — keeps the pick stable for a given state. */
  messageCount: number
  /** Recent outgoing text bodies, newest first. */
  recentUserMessages: string[]
}

/**
 * Offline persona reply: deterministic-seeded (chatId + message count) pick
 * from the template pool. Keyword-aware when the recent texts offer one.
 */
export function pickPersonaReply(input: OfflineReplyInput): string {
  const rng = mulberry32(fnv1a(`${input.chatId}:${input.messageCount}`))
  const keywords = extractKeywords(input.recentUserMessages)
  if (keywords.length > 0 && rng() < 0.45) {
    const kw = keywords[Math.floor(rng() * keywords.length)]
    const display = kw.charAt(0).toUpperCase() + kw.slice(1)
    const template = KEYWORD_TEMPLATES[Math.floor(rng() * KEYWORD_TEMPLATES.length)]
    return template.replace('{kw}', display)
  }
  return GENERIC_TEMPLATES[Math.floor(rng() * GENERIC_TEMPLATES.length)]
}

/* ------------------------------------------------------------------ */
/* AI reply path                                                       */
/* ------------------------------------------------------------------ */

/** Strip a wrapping pair of straight/curly quotes some models add. */
function unwrapQuotes(text: string): string {
  const t = text.trim()
  if (t.length >= 2) {
    const first = t[0]
    const last = t[t.length - 1]
    const pairs: Record<string, string> = { '"': '"', "'": "'", '“': '”' }
    if (pairs[first] && last === pairs[first]) return t.slice(1, -1).trim()
  }
  return t
}

/**
 * Ask POST /api/ai for a persona reply (`mode: 'reply'` — the route derives
 * the persona + context from the chat itself). Carries the user's Gemini key
 * when one is configured (aiHeaders). Resolves null on ANY failure, timeout
 * (AI_REPLY_TIMEOUT_MS) or abort — never throws, never breaks the flow.
 */
export async function fetchAiReply(
  chatId: string,
  opts?: { signal?: AbortSignal }
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_REPLY_TIMEOUT_MS)
  const onOuterAbort = () => controller.abort()
  opts?.signal?.addEventListener('abort', onOuterAbort, { once: true })
  // Offline (Phase 4): skip the doomed request — the suggestion chip simply
  // doesn't appear, exactly like a timeout would.
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...aiHeaders() },
      body: JSON.stringify({ mode: 'reply', chatId }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as {
      result?: unknown
    } | null
    const text = typeof data?.result === 'string' ? data.result.trim() : ''
    if (!text) return null
    return unwrapQuotes(text).slice(0, 500)
  } catch {
    // Timeout, outer abort (chat switch) or network error → silent fallback.
    return null
  } finally {
    clearTimeout(timer)
    opts?.signal?.removeEventListener('abort', onOuterAbort)
  }
}
