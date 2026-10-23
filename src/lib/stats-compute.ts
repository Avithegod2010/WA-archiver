/**
 * Global stats computation — the pure, isomorphic core of GET /api/stats.
 *
 * Phase 3 port: the route handler only fetches (Prisma rows + the on-disk
 * media scan) and delegates here; the device-mode StatsDashboard feeds the
 * exact same plain shapes gathered from the on-device DataClient
 * (listChats / getChatDetail / listChatMedia) and gets the identical
 * payload. No server imports, no DOM — safe in both runtimes.
 *
 * Timestamps accept Date (Prisma) or ISO strings (device DTOs); week/hour
 * bucketing uses the runtime's local timezone on both sides, exactly as the
 * route always did.
 */

import {
  EMOJI_RE,
  URL_TEST_RE,
  countWords,
  median,
} from '@/lib/chat-analytics'
import { countCloudWords } from '@/lib/wordcloud'
import type { StatsData } from '@/components/whatsapp/types'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/* ------------------------------ Input shapes ------------------------------ */

/** Chat row (Prisma chat row or the ChatSummary DTO — both fit). */
export interface StatsChatInput {
  id: string
  title: string
  isGroup: boolean
  messageCount: number
  mediaCount: number
  firstAt: string | Date | null
  lastAt: string | Date | null
}

/** Message row (Prisma row or a projected ChatMessage). */
export interface StatsMessageInput {
  chatId: string
  ts: string | Date
  sender: string | null
  type: string
  body: string | null
}

/** On-disk / on-device media storage per chat (sorted bytes-desc upstream). */
export interface StatsStorageInput {
  totalBytes: number
  files: number
  perChat: { chatId: string; bytes: number; files: number }[]
}

/* ------------------------- Payload (route JSON) --------------------------- */

export interface StatsWordEntry {
  word: string
  count: number
}

export interface StatsEmojiLeaderEntry {
  emoji: string
  count: number
  topUser: string
}

export interface StatsIgnorePair {
  chatId: string
  chatTitle: string
  aName: string
  bName: string
  aCount: number
  bReplies: number
  leftOnReadPct: number
}

/** One "Fastest repliers" leaderboard row: how quickly this person replies
 *  TO YOU (median of turn-switch deltas across every chat they share). */
export interface StatsReplySpeedRow {
  /** Stable key for list rendering (currently the sender display name). */
  senderKey: string
  /** Display name (same string as senderKey today). */
  name: string
  /** Median reply time to you, in milliseconds. */
  medianMs: number
  /** How many reply deltas the median is computed over (always ≥ 3). */
  count: number
}

export interface StatsReplySpeeds {
  rows: StatsReplySpeedRow[]
  /** Inverse metric — your own median reply time to others (summary number).
   *  Absent when you have no qualifying turn-switches. */
  myMedianMs?: number
}

/** One "Activity timeline" bucket: a calendar day (or a 7-day bucket, see
 *  timelineUnit) and how many messages landed inside it. */
export interface StatsTimelinePoint {
  /** Day key 'yyyy-mm-dd' — for weeks, the bucket's first day. */
  date: string
  count: number
}

/** Everything GET /api/stats returns: the shared StatsData shape plus the
 *  defensive "extras" sections the dashboard renders (global word cloud,
 *  emoji leaderboard, "left on read" pairs, reply-speed leaderboard). */
export interface StatsPayload extends StatsData {
  topWordsGlobal: StatsWordEntry[]
  emojiLeaderboard: StatsEmojiLeaderEntry[]
  ignoreGraph: StatsIgnorePair[]
  replySpeeds: StatsReplySpeeds
  /** Message-frequency timeline (bounded day/week buckets for the Insights
   *  "Activity timeline" chart). */
  timeline: StatsTimelinePoint[]
  timelineUnit: 'day' | 'week'
}

/* --------------------- "Left on read" pair helpers ---------------------- */

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000
const MIN_PAIR_MESSAGES = 8
const MAX_SENDERS_PER_CHAT = 15
const IGNORE_GRAPH_LIMIT = 8

/** First index in a sorted array whose value is >= target (lower bound). */
function lowerBound(arr: number[], target: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Compute playful "left on read" ordered pairs across every chat.
 *  For A's each message, a reply is ANY later message from B within 24h. */
function computeIgnoreGraph(
  messages: readonly {
    chatId: string
    ts: string | Date
    sender: string | null
    type: string
  }[],
  chatMeta: Map<string, { title: string; isGroup: boolean }>
): StatsIgnorePair[] {
  // Per-chat timeline of real (non-system) sender messages
  const timelines = new Map<string, { t: number; s: string }[]>()
  for (const m of messages) {
    if (!m.sender || m.type === 'system') continue
    const t = new Date(m.ts).getTime()
    if (Number.isNaN(t)) continue
    let arr = timelines.get(m.chatId)
    if (!arr) {
      arr = []
      timelines.set(m.chatId, arr)
    }
    arr.push({ t, s: m.sender })
  }

  const candidates: StatsIgnorePair[] = []
  for (const [chatId, timeline] of timelines) {
    timeline.sort((a, b) => a.t - b.t)
    const perSender = new Map<string, number[]>()
    for (const { t, s } of timeline) {
      let arr = perSender.get(s)
      if (!arr) {
        arr = []
        perSender.set(s, arr)
      }
      arr.push(t)
    }
    const senders = [...perSender.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, MAX_SENDERS_PER_CHAT)
    if (senders.length < 2) continue
    const chatTitle = chatMeta.get(chatId)?.title ?? 'Deleted chat'
    for (const [aName, aTimes] of senders) {
      const aCount = aTimes.length
      if (aCount < MIN_PAIR_MESSAGES) continue
      for (const [bName, bTimes] of senders) {
        if (bName === aName) continue
        let bReplies = 0
        for (const t of aTimes) {
          const i = lowerBound(bTimes, t)
          if (i < bTimes.length && bTimes[i] - t <= REPLY_WINDOW_MS) bReplies++
        }
        const leftOnReadPct = Math.round(((aCount - bReplies) / aCount) * 100)
        if (leftOnReadPct > 0) {
          candidates.push({
            chatId,
            chatTitle,
            aName,
            bName,
            aCount,
            bReplies,
            leftOnReadPct,
          })
        }
      }
    }
  }

  return candidates
    .sort(
      (a, b) =>
        b.leftOnReadPct - a.leftOnReadPct || b.aCount - a.aCount
    )
    .slice(0, IGNORE_GRAPH_LIMIT)
}

/* ----------------------- "Fastest repliers" speeds ----------------------- */

/** Reply window + sampling floor — same turn-switch convention ChatInfo.tsx
 *  uses for its per-chat median reply stat (positive delta, capped at 6h). */
const REPLY_SPEED_WINDOW_MS = 6 * 3_600_000
const MIN_REPLY_SAMPLES = 3
const REPLY_SPEEDS_LIMIT = 12

/** Per-person median reply time TO YOU, aggregated across every chat.
 *
 *  For each chat, messages are walked as a sorted timeline; a reply is a
 *  turn-switch where the previous real message is yours and the next one is
 *  from someone else: delta = their.ts - yours.ts (0 < delta < 6h, the
 *  ChatInfo convention). Group chats attribute by sender; multiple chats
 *  pool deltas per sender name. Senders with fewer than 3 samples are
 *  dropped (tiny-sample medians are noise). The inverse "your median reply
 *  time" is computed the same way with the roles swapped.
 *
 *  System messages are excluded at ingest (computeIgnoreGraph's convention):
 *  they are not conversation turns, so a system line between two messages
 *  does not break the reply chain. */
export function computeReplySpeeds(
  messages: readonly {
    chatId: string
    ts: string | Date
    sender: string | null
    type: string
  }[],
  mySenders: readonly string[] = ['You']
): StatsReplySpeeds {
  const mine = new Set(mySenders)

  // Per-chat timeline of real (non-system) sender messages
  const timelines = new Map<string, { t: number; s: string }[]>()
  for (const m of messages) {
    if (!m.sender || m.type === 'system') continue
    const t = new Date(m.ts).getTime()
    if (Number.isNaN(t)) continue
    let arr = timelines.get(m.chatId)
    if (!arr) {
      arr = []
      timelines.set(m.chatId, arr)
    }
    arr.push({ t, s: m.sender })
  }

  const theirDeltas = new Map<string, number[]>()
  const myDeltas: number[] = []
  for (const timeline of timelines.values()) {
    timeline.sort((a, b) => a.t - b.t)
    for (let i = 1; i < timeline.length; i++) {
      const cur = timeline[i]
      const prev = timeline[i - 1]
      if (prev.s === cur.s) continue // not a turn switch
      const bothMine = mine.has(prev.s) && mine.has(cur.s)
      if (bothMine) continue // replying to yourself is not a reply
      const delta = cur.t - prev.t
      if (delta <= 0 || delta >= REPLY_SPEED_WINDOW_MS) continue
      if (mine.has(cur.s)) {
        // You replied to someone → inverse summary number
        myDeltas.push(delta)
      } else if (mine.has(prev.s)) {
        // They replied to you → leaderboard sample
        let arr = theirDeltas.get(cur.s)
        if (!arr) {
          arr = []
          theirDeltas.set(cur.s, arr)
        }
        arr.push(delta)
      }
    }
  }

  const rows: StatsReplySpeedRow[] = []
  for (const [senderKey, deltas] of theirDeltas) {
    if (deltas.length < MIN_REPLY_SAMPLES) continue
    rows.push({
      senderKey,
      name: senderKey,
      medianMs: median(deltas),
      count: deltas.length,
    })
  }
  // Fastest first; ties broken by sample count (more = more reliable),
  // then name for a deterministic order.
  rows.sort(
    (a, b) =>
      a.medianMs - b.medianMs ||
      b.count - a.count ||
      a.name.localeCompare(b.name)
  )

  const result: StatsReplySpeeds = { rows: rows.slice(0, REPLY_SPEEDS_LIMIT) }
  if (myDeltas.length > 0) result.myMedianMs = median(myDeltas)
  return result
}

/* --------------------------- Activity timeline ---------------------------- */

const TIMELINE_WEEK_SPAN_DAYS = 366
const TIMELINE_MAX_POINTS = 250
const DAY_MS = 86_400_000

/** Day key 'yyyy-mm-dd' → local-noon timestamp (noon never straddles DST). */
function dayKeyToTs(key: string): number {
  return new Date(key + 'T12:00:00').getTime()
}

/** Local timestamp → day key 'yyyy-mm-dd' (runtime's local timezone). */
function tsToDayKey(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Message-frequency timeline for the Insights "Activity timeline" chart.
 *
 * Built purely from the per-day counts the main loop already gathered (plus
 * the sorted day keys the streak math needs anyway) — O(active days), no
 * extra passes over messages.
 *
 * ≤ 366 days of history → one point per active day ('day' unit). Longer
 * histories → consecutive 7-day buckets anchored on the first active day
 * ('week'; date = bucket start, count = sum of its days). A final safety
 * pass keeps the array within ~TIMELINE_MAX_POINTS either way: a chatty
 * sub-year collapses to weeks, and decade-long weekly buckets fold k-wise
 * (date stays each fold's first day).
 */
function buildTimeline(
  dayCount: Map<string, number>,
  sortedDays: string[]
): { timeline: StatsTimelinePoint[]; timelineUnit: 'day' | 'week' } {
  if (sortedDays.length === 0) {
    return { timeline: [], timelineUnit: 'day' }
  }

  const t0 = dayKeyToTs(sortedDays[0])
  const spanDays =
    Math.round((dayKeyToTs(sortedDays[sortedDays.length - 1]) - t0) / DAY_MS) +
    1

  let unit: 'day' | 'week' =
    spanDays > TIMELINE_WEEK_SPAN_DAYS ? 'week' : 'day'

  const foldWeeks = (): StatsTimelinePoint[] => {
    const buckets = new Map<number, number>()
    for (const day of sortedDays) {
      const idx = Math.floor((dayKeyToTs(day) - t0) / (7 * DAY_MS))
      buckets.set(idx, (buckets.get(idx) ?? 0) + (dayCount.get(day) ?? 0))
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([idx, count]) => ({
        date: tsToDayKey(t0 + idx * 7 * DAY_MS),
        count,
      }))
  }

  let points: StatsTimelinePoint[] =
    unit === 'day'
      ? sortedDays.map((date) => ({ date, count: dayCount.get(date) ?? 0 }))
      : foldWeeks()

  // Sub-year history that is still denser than the point budget (e.g. 300
  // active days inside one year) collapses to weeks after all.
  if (unit === 'day' && points.length > TIMELINE_MAX_POINTS) {
    unit = 'week'
    points = foldWeeks()
  }

  // Week buckets themselves over budget (very long history) → fold k-wise.
  if (unit === 'week' && points.length > TIMELINE_MAX_POINTS) {
    const factor = Math.ceil(points.length / TIMELINE_MAX_POINTS)
    const merged: StatsTimelinePoint[] = []
    for (let i = 0; i < points.length; i += factor) {
      const end = Math.min(i + factor, points.length)
      let count = 0
      for (let j = i; j < end; j++) count += points[j].count
      merged.push({ date: points[i].date, count })
    }
    points = merged
  }

  return { timeline: points, timelineUnit: unit }
}

/* ------------------------------ Main entry ------------------------------- */

/**
 * Produce the exact payload GET /api/stats returns today from plain rows.
 * `storage.perChat` is re-sorted bytes-desc defensively (the server's disk
 * scan already provides that order; sorting a sorted array is a no-op, so
 * the route's output is unchanged).
 */
export function computeStats(input: {
  chats: readonly StatsChatInput[]
  messages: readonly StatsMessageInput[]
  storage: StatsStorageInput
}): StatsPayload {
  const { chats, messages } = input

  const chatMeta = new Map(
    chats.map((c) => [c.id, { title: c.title, isGroup: c.isGroup }])
  )

  const typeCount: Record<string, number> = {}
  const weekdays = [0, 0, 0, 0, 0, 0, 0]
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }))
  const heatmap: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0)
  )
  const monthCount: Record<string, number> = {}
  const participantCount: Record<string, number> = {}
  const participantWords = new Map<string, number>()
  const participantEmojis = new Map<string, number>()
  const emojiCount = new Map<string, number>()
  const emojiUserCount = new Map<string, Map<string, number>>()
  const wordCount = new Map<string, number>()
  const globalWordCount = new Map<string, number>()
  const perChatMessages = new Map<string, number>()
  const perChatWords = new Map<string, number>()
  const dayCount = new Map<string, number>()

  let outgoing = 0
  let media = 0
  let words = 0
  let chars = 0
  let emojis = 0
  let links = 0
  let questions = 0
  let longest: {
    sender: string
    chatTitle: string
    chars: number
    preview: string
  } | null = null

  let firstAt: number | null = null
  let lastAt: number | null = null

  for (const chat of chats) {
    perChatMessages.set(chat.id, 0)
    if (chat.firstAt) {
      const t = new Date(chat.firstAt).getTime()
      if (!firstAt || t < firstAt) firstAt = t
    }
    if (chat.lastAt) {
      const t = new Date(chat.lastAt).getTime()
      if (!lastAt || t > lastAt) lastAt = t
    }
  }

  for (const m of messages) {
    typeCount[m.type] = (typeCount[m.type] ?? 0) + 1
    if (m.type !== 'text' && m.type !== 'system' && m.type !== 'deleted') {
      media++
    }
    if (m.sender === 'You') outgoing++

    const body = m.body ?? ''
    if (m.type === 'text' || m.type === 'image' || m.type === 'video') {
      const w = body.split(/\s+/).filter(Boolean).length
      words += w
      chars += body.length
      perChatWords.set(m.chatId, (perChatWords.get(m.chatId) ?? 0) + w)

      if (m.sender && m.sender !== 'You') {
        participantWords.set(m.sender, (participantWords.get(m.sender) ?? 0) + w)
      }

      // Emojis: total + per-emoji leaderboard
      const found = body.match(EMOJI_RE)
      if (found) {
        emojis += found.length
        if (m.sender && m.sender !== 'You') {
          participantEmojis.set(
            m.sender,
            (participantEmojis.get(m.sender) ?? 0) + found.length
          )
        }
        for (const e of found) {
          emojiCount.set(e, (emojiCount.get(e) ?? 0) + 1)
          if (m.sender) {
            let users = emojiUserCount.get(e)
            if (!users) {
              users = new Map()
              emojiUserCount.set(e, users)
            }
            users.set(m.sender, (users.get(m.sender) ?? 0) + 1)
          }
        }
      }

      // Words: strip URLs, then count meaningful tokens
      countWords(body, wordCount)

      // Links & questions
      if (URL_TEST_RE.test(body)) links++
      if (body.trimEnd().endsWith('?')) questions++

      // Longest single message
      if (!longest || body.length > longest.chars) {
        longest = {
          sender: m.sender ?? 'Unknown',
          chatTitle: chatMeta.get(m.chatId)?.title ?? 'Deleted chat',
          chars: body.length,
          preview: body.slice(0, 90) + (body.length > 90 ? '…' : ''),
        }
      }
    }

    if (m.sender && m.sender !== 'You' && m.type !== 'system') {
      participantCount[m.sender] = (participantCount[m.sender] ?? 0) + 1
    }

    const d = new Date(m.ts)
    if (!Number.isNaN(d.getTime())) {
      const wd = d.getDay()
      const hr = d.getHours()
      weekdays[wd]++
      hours[hr].count++
      heatmap[wd][hr]++
      const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      dayCount.set(dayKey, (dayCount.get(dayKey) ?? 0) + 1)
      const monthKey = dayKey.slice(0, 7)
      monthCount[monthKey] = (monthCount[monthKey] ?? 0) + 1
    }

    perChatMessages.set(m.chatId, (perChatMessages.get(m.chatId) ?? 0) + 1)
  }

  /* ------------------------- Global word cloud -------------------------
     Body scan capped to the most recent 20k messages to bound CPU on
     very large imports; the rest of the stats stay uncapped. */
  {
    const scan =
      messages.length > 20_000
        ? [...messages]
            .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
            .slice(0, 20_000)
        : messages
    for (const m of scan) {
      if (m.type === 'text' || m.type === 'image' || m.type === 'video') {
        countCloudWords(m.body ?? '', globalWordCount)
      }
    }
  }

  /* -------------------- "Left on read" ordered pairs --------------------
     Playful metric: for each ordered pair (A → B) in a chat, how many of
     A's messages get NO message from B within the next 24 hours. */
  const ignoreGraph = computeIgnoreGraph(messages, chatMeta)

  // "Fastest repliers" leaderboard — per-person median reply time TO YOU,
  // plus the inverse "your median reply time" summary number.
  const replySpeeds = computeReplySpeeds(messages, ['You'])

  let busiestDay: { date: string; count: number } | null = null
  for (const [date, count] of dayCount) {
    if (!busiestDay || count > busiestDay.count) busiestDay = { date, count }
  }

  // Active-day streaks (consecutive days with at least one message)
  const sortedDays = [...dayCount.keys()].sort()
  let longestStreak = 0
  let longestStreakEnd: string | null = null
  let run = 0
  let prev: number | null = null
  for (const day of sortedDays) {
    const t = new Date(day + 'T12:00:00').getTime()
    if (prev != null && t - prev === 86_400_000) run++
    else run = 1
    if (run > longestStreak) {
      longestStreak = run
      longestStreakEnd = day
    }
    prev = t
  }
  // Current streak: walk back from today (or yesterday) through active days
  let currentStreak = 0
  {
    const today = new Date()
    const key = (dt: Date) =>
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    if (!dayCount.has(key(cursor))) cursor.setDate(cursor.getDate() - 1)
    while (dayCount.has(key(cursor))) {
      currentStreak++
      cursor.setDate(cursor.getDate() - 1)
    }
  }

  // Message-frequency timeline — reuses the sorted day keys gathered for
  // the streak math above; O(active days), no extra passes over messages.
  const { timeline, timelineUnit } = buildTimeline(dayCount, sortedDays)

  const daysSpanned =
    firstAt != null && lastAt != null
      ? Math.max(1, Math.round((lastAt - firstAt) / 86_400_000) + 1)
      : 0

  const storage = input.storage
  const chatTitles = new Map(chats.map((c) => [c.id, { title: c.title, isGroup: c.isGroup }]))
  const storagePerChat = [...storage.perChat]
    .sort((a, b) => b.bytes - a.bytes)
    .map((s) => ({
      chatId: s.chatId,
      title: chatTitles.get(s.chatId)?.title ?? 'Deleted chat',
      isGroup: chatTitles.get(s.chatId)?.isGroup ?? false,
      bytes: s.bytes,
      files: s.files,
    }))
    .slice(0, 6)

  const perChat = chats
    .map((c) => ({
      id: c.id,
      title: c.title,
      isGroup: c.isGroup,
      count: perChatMessages.get(c.id) ?? c.messageCount,
      media: c.mediaCount,
      words: perChatWords.get(c.id) ?? 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  const topWords = [...wordCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([word, count]) => ({ word, count }))

  const topEmojis = [...emojiCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([emoji, count]) => ({ emoji, count }))

  return {
    totals: {
      chats: chats.length,
      groupChats: chats.filter((c) => c.isGroup).length,
      messages: messages.length,
      outgoing,
      media,
      words,
      chars,
      emojis,
    },
    range: {
      firstAt: firstAt != null ? new Date(firstAt).toISOString() : null,
      lastAt: lastAt != null ? new Date(lastAt).toISOString() : null,
      busiestDay,
      activeDays: dayCount.size,
      daysSpanned,
      avgPerDay: dayCount.size > 0 ? Math.round(messages.length / dayCount.size) : 0,
    },
    streak: { longest: longestStreak, longestEnd: longestStreakEnd, current: currentStreak },
    timeline,
    timelineUnit,
    fun: { links, questions, longest },
    types: Object.entries(typeCount)
      .sort(([, a], [, b]) => b - a)
      .map(([type, count]) => ({ type, count })),
    weekdays: weekdays.map((count, i) => ({ weekday: WEEKDAYS[i], count })),
    hours,
    heatmap,
    months: Object.entries(monthCount)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, count]) => ({ month, count })),
    topWords,
    topEmojis,
    topWordsGlobal: [...globalWordCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([word, count]) => ({ word, count })),
    emojiLeaderboard: [...emojiCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([emoji, count]) => {
        let topUser = ''
        let topUserCount = 0
        const users = emojiUserCount.get(emoji)
        if (users) {
          for (const [user, uses] of users) {
            if (uses > topUserCount) {
              topUser = user
              topUserCount = uses
            }
          }
        }
        return { emoji, count, topUser }
      }),
    ignoreGraph,
    replySpeeds,
    participants: Object.entries(participantCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([sender, count]) => ({
        sender,
        count,
        words: participantWords.get(sender) ?? 0,
        emojis: participantEmojis.get(sender) ?? 0,
      })),
    perChat,
    storage: {
      totalBytes: storage.totalBytes,
      files: storage.files,
      perChat: storagePerChat,
    },
  }
}
