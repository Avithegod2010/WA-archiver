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

/** Everything GET /api/stats returns: the shared StatsData shape plus the
 *  defensive "extras" sections the dashboard renders (global word cloud,
 *  emoji leaderboard, "left on read" pairs). */
export interface StatsPayload extends StatsData {
  topWordsGlobal: StatsWordEntry[]
  emojiLeaderboard: StatsEmojiLeaderEntry[]
  ignoreGraph: StatsIgnorePair[]
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
