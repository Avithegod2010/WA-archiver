import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { promises as fs } from 'fs'
import path from 'path'
import {
  EMOJI_RE,
  URL_TEST_RE,
  countWords,
} from '@/lib/chat-analytics'

export const runtime = 'nodejs'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Walk db/media/<chatId>/ to compute on-disk media storage per chat. */
async function computeStorage(): Promise<{
  totalBytes: number
  files: number
  perChat: { chatId: string; bytes: number; files: number }[]
}> {
  const root = path.join(process.cwd(), 'db', 'media')
  const perChat: { chatId: string; bytes: number; files: number }[] = []
  let totalBytes = 0
  let files = 0
  try {
    const chatDirs = await fs.readdir(root, { withFileTypes: true })
    for (const d of chatDirs) {
      if (!d.isDirectory()) continue
      let bytes = 0
      let count = 0
      try {
        const names = await fs.readdir(path.join(root, d.name))
        for (const name of names) {
          try {
            const st = await fs.stat(path.join(root, d.name, name))
            if (st.isFile()) {
              bytes += st.size
              count++
            }
          } catch {
            /* file vanished between readdir and stat */
          }
        }
      } catch {
        /* unreadable dir */
      }
      if (count > 0) {
        perChat.push({ chatId: d.name, bytes, files: count })
        totalBytes += bytes
        files += count
      }
    }
  } catch {
    /* media root missing — zero storage */
  }
  perChat.sort((a, b) => b.bytes - a.bytes)
  return { totalBytes, files, perChat }
}

export async function GET() {
  const [chats, messages] = await Promise.all([
    db.chat.findMany({
      select: {
        id: true,
        title: true,
        isGroup: true,
        messageCount: true,
        mediaCount: true,
        firstAt: true,
        lastAt: true,
      },
      orderBy: { messageCount: 'desc' },
    }),
    db.message.findMany({
      select: { chatId: true, ts: true, sender: true, type: true, body: true },
    }),
  ])

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
  const wordCount = new Map<string, number>()
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
        for (const e of found) emojiCount.set(e, (emojiCount.get(e) ?? 0) + 1)
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

  const storage = await computeStorage()
  const chatTitles = new Map(chats.map((c) => [c.id, { title: c.title, isGroup: c.isGroup }]))
  const storagePerChat = storage.perChat
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

  return NextResponse.json({
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
  })
}
