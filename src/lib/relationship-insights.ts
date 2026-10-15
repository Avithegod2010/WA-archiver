/**
 * Idea #2 — Relationship insights (per 1:1 chat).
 *
 * Pure on-device computation over the chat's messages: who initiates,
 * how fast each side replies, unanswered tails ("left on read"), the
 * longest silence, monologue records and the chat's busiest hour.
 *
 * Everything is heuristic and transparent — no AI, no network, and the
 * definitions are documented next to each metric so the UI can show a
 * short "how this is measured" note.
 */

import { EMOJI_RE } from './chat-analytics'

const SELF = 'You'

/** A gap longer than this counts as "someone started the chat again". */
const INITIATION_GAP_MS = 4 * 60 * 60 * 1000
/** Reply deltas beyond this aren't "responses", they're fresh initiations. */
const RESPONSE_CAP_MS = 24 * 60 * 60 * 1000
/** Silences at least this long are surfaced by the ghosting detector. */
const GHOST_MIN_MS = 3 * 24 * 60 * 60 * 1000
/** Tails younger than this are "just waiting", not "left on read". */
const READ_TAIL_MIN_MS = 30 * 60 * 60 * 1000

export type Side = 'you' | 'them'

export interface SideTiming {
  /** Median reply time in ms (null when the side never replied). */
  medianMs: number | null
  /** Mean reply time in ms. */
  avgMs: number | null
  /** How many reply samples the numbers are based on. */
  samples: number
}

export interface EmojiCount {
  emoji: string
  count: number
}

export interface RelationshipInsights {
  ok: boolean
  /** null when the chat has no datable user messages. */
  firstAt: string | null
  lastAt: string | null
  daysKnown: number
  total: number
  /** Messages per side (share of `total`). */
  messages: { you: number; them: number; youShare: number }
  /** Words typed per side. */
  words: { you: number; them: number; youShare: number }
  /** "Started the conversation" counts (first message + >4h gaps). */
  initiations: { you: number; them: number }
  /** Reply speed per side (median/avg, capped at 24h). */
  reply: { you: SideTiming; them: SideTiming }
  /**
   * The unanswered tail at the end of the chat: `holder` sent the last
   * `count` messages and the other side never replied. `waitingMs` is the
   * age of the newest unanswered message.
   */
  leftOnRead: { holder: Side; count: number; waitingMs: number | null } | null
  /** Longest silence (>=3 days) — `after` had the last word before it. */
  ghost: {
    days: number
    after: Side
    preview: string
    /** Whether the silence still holds (nothing sent after the gap). */
    ongoing: boolean
  } | null
  /** Longest consecutive-message run per side ("monologue record"). */
  runs: { you: number; them: number }
  /** Busiest hour of day for this chat (0–23) with its message count. */
  busiestHour: { hour: number; count: number } | null
  /** 24 message-count buckets for a small hour sparkline. */
  hours: number[]
  topEmojis: { you: EmojiCount[]; them: EmojiCount[] }
}

interface InputMessage {
  sender: string | null
  ts: string
  type: string
  body: string
}

function sideOf(sender: string): Side {
  return sender === SELF ? 'you' : 'them'
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length)
}

function topEmojis(body: string, into: Map<string, number>): void {
  for (const match of body.matchAll(EMOJI_RE)) {
    const emoji = match[0]
    into.set(emoji, (into.get(emoji) ?? 0) + 1)
  }
}

function top3(map: Map<string, number>): EmojiCount[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([emoji, count]) => ({ emoji, count }))
}

/**
 * Compute relationship insights from a chat's messages (any order in,
 * they are sorted internally by `idx` when present).
 */
export function computeRelationshipInsights(
  input: readonly InputMessage[],
  nowMs: number = Date.now()
): RelationshipInsights {
  const empty: RelationshipInsights = {
    ok: false,
    firstAt: null,
    lastAt: null,
    daysKnown: 0,
    total: 0,
    messages: { you: 0, them: 0, youShare: 0 },
    words: { you: 0, them: 0, youShare: 0 },
    initiations: { you: 0, them: 0 },
    reply: {
      you: { medianMs: null, avgMs: null, samples: 0 },
      them: { medianMs: null, avgMs: null, samples: 0 },
    },
    leftOnRead: null,
    ghost: null,
    runs: { you: 0, them: 0 },
    busiestHour: null,
    hours: new Array(24).fill(0),
    topEmojis: { you: [], them: [] },
  }

  // Keep only datable user messages, oldest first.
  const msgs = input
    .filter(
      (m) =>
        m.sender !== null &&
        m.type !== 'system' &&
        m.type !== 'deleted'
    )
    .map((m) => ({ ...m, at: Date.parse(m.ts) }))
    .filter((m) => Number.isFinite(m.at))
    .sort((a, b) => a.at - b.at)

  if (msgs.length === 0) return empty

  const you = { msgs: 0, words: 0, emojis: new Map<string, number>() }
  const them = { msgs: 0, words: 0, emojis: new Map<string, number>() }
  const replyTimes: Record<Side, number[]> = { you: [], them: [] }
  const hours = new Array(24).fill(0)
  const initiations = { you: 0, them: 0 }
  const runs = { you: 0, them: 0 }

  let runLen = 0
  let runSide: Side | null = null
  let lastAt = msgs[0].at
  // Ghosting tracker — primitives so TS narrowing stays sound across the
  // forEach closure (an object here gets narrowed to `null` after the loop).
  let ghostMs = 0
  let ghostAfter: Side | null = null
  let ghostPreview = ''
  let lastBody = ''
  let lastSide: Side | null = null

  const flushRun = () => {
    if (runSide && runLen > runs[runSide]) runs[runSide] = runLen
  }

  msgs.forEach((m, i) => {
    const side = sideOf(m.sender as string)
    const words = m.body.trim() ? m.body.trim().split(/\s+/).length : 0
    const bucket = side === 'you' ? you : them

    bucket.msgs += 1
    bucket.words += words
    if (m.type === 'text') topEmojis(m.body, bucket.emojis)

    const d = new Date(m.at)
    const hour = d.getHours()
    hours[hour] += 1

    // Initiations: the very first message, then any message after a >4h gap.
    if (i === 0 || m.at - lastAt > INITIATION_GAP_MS) initiations[side] += 1

    // Reply timing: whenever the turn changes A→B, B's delta is a reply
    // sample (capped at 24h — slower messages count as initiations above).
    const delta = m.at - lastAt
    if (i > 0 && lastSide !== null && lastSide !== side && delta <= RESPONSE_CAP_MS) {
      replyTimes[side].push(Math.max(delta, 0))
    }

    // Ghosting: track the longest mid-chat (and tail) silence.
    if (i > 0 && delta >= GHOST_MIN_MS && delta > ghostMs) {
      ghostMs = delta
      ghostAfter = lastSide ?? side
      ghostPreview = lastBody || m.body
    }

    // Monologue runs.
    if (runSide === side) {
      runLen += 1
    } else {
      flushRun()
      runSide = side
      runLen = 1
    }

    lastAt = m.at
    lastSide = side
    lastBody = m.body
  })
  flushRun()

  // Left-on-read: the trailing run belongs to `holder`; the other side has
  // been silent ever since. Only surface it once it's actually been a while.
  const waitingMs = nowMs - lastAt
  let leftOnRead: RelationshipInsights['leftOnRead'] = null
  if (runSide && runLen > 0 && waitingMs >= READ_TAIL_MIN_MS) {
    leftOnRead = { holder: runSide, count: runLen, waitingMs }
  }

  // Ghosting: only surface silences of >= GHOST_MIN_MS; mark ongoing when
  // that silence is also the end of the chat.
  const ghost: RelationshipInsights['ghost'] =
    ghostAfter && ghostMs >= GHOST_MIN_MS
      ? {
          days: Math.floor(ghostMs / (24 * 60 * 60 * 1000)),
          after: ghostAfter,
          preview: ghostPreview,
          ongoing: waitingMs >= GHOST_MIN_MS,
        }
      : null

  const total = you.msgs + them.msgs
  const totalWords = you.words + them.words
  const busiest = hours.reduce(
    (best, count, hour) => (count > best.count ? { hour, count } : best),
    { hour: 0, count: -1 }
  )

  const mkTiming = (side: Side): SideTiming => ({
    medianMs: median(replyTimes[side]),
    avgMs: mean(replyTimes[side]),
    samples: replyTimes[side].length,
  })

  return {
    ok: true,
    firstAt: new Date(msgs[0].at).toISOString(),
    lastAt: new Date(lastAt).toISOString(),
    daysKnown: Math.max(
      1,
      Math.round((lastAt - msgs[0].at) / (24 * 60 * 60 * 1000))
    ),
    total,
    messages: {
      you: you.msgs,
      them: them.msgs,
      youShare: total ? you.msgs / total : 0,
    },
    words: {
      you: you.words,
      them: them.words,
      youShare: totalWords ? you.words / totalWords : 0,
    },
    initiations,
    reply: { you: mkTiming('you'), them: mkTiming('them') },
    leftOnRead,
    ghost,
    runs,
    busiestHour: busiest.count > 0 ? busiest : null,
    hours,
    topEmojis: { you: top3(you.emojis), them: top3(them.emojis) },
  }
}

/** "3h 12m" / "2d 4h" / "45s" — compact duration for the insight cards. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  const abs = Math.max(0, Math.round(ms / 1000))
  const days = Math.floor(abs / 86400)
  const hours = Math.floor((abs % 86400) / 3600)
  const mins = Math.floor((abs % 3600) / 60)
  const secs = abs % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  if (mins > 0) return `${mins}m`
  return `${secs}s`
}

/** Hour-of-day label like "2 PM". */
export function hourLabel(hour: number): string {
  const h = ((hour % 12) + 12) % 12
  return `${h === 0 ? 12 : h} ${hour < 12 ? 'AM' : 'PM'}`
}
