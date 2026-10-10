import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

// Emoji detection: Extended_Pictographic ranges (explicit set keeps it safe
// across runtimes and matches ZWJ sequences on their leading code point).
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}]/gu

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

  const typeCount: Record<string, number> = {}
  const weekdays = [0, 0, 0, 0, 0, 0, 0]
  const monthCount: Record<string, number> = {}
  const participantCount: Record<string, number> = {}
  const perChatMessages = new Map<string, number>()
  const perChatWords = new Map<string, number>()
  const dayCount = new Map<string, number>()

  let outgoing = 0
  let media = 0
  let words = 0
  let chars = 0
  let emojis = 0

  let firstAt: string | null = null
  let lastAt: string | null = null

  for (const chat of chats) {
    perChatMessages.set(chat.id, 0)
    if (chat.firstAt && (!firstAt || chat.firstAt < firstAt)) firstAt = chat.firstAt.toISOString()
    if (chat.lastAt && (!lastAt || chat.lastAt > lastAt)) lastAt = chat.lastAt.toISOString()
  }

  for (const m of messages) {
    typeCount[m.type] = (typeCount[m.type] ?? 0) + 1
    if (m.type !== 'text' && m.type !== 'system' && m.type !== 'deleted') {
      media++
    }
    if (m.sender === 'You') outgoing++

    if (m.type === 'text' || m.type === 'image' || m.type === 'video') {
      const w = m.body.split(/\s+/).filter(Boolean).length
      words += w
      chars += m.body.length
      perChatWords.set(m.chatId, (perChatWords.get(m.chatId) ?? 0) + w)
      const found = m.body.match(EMOJI_RE)
      if (found) emojis += found.length
    }

    if (m.sender && m.sender !== 'You' && m.type !== 'system') {
      participantCount[m.sender] = (participantCount[m.sender] ?? 0) + 1
    }

    const d = new Date(m.ts)
    if (!Number.isNaN(d.getTime())) {
      weekdays[d.getDay()]++
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
    range: { firstAt, lastAt, busiestDay },
    types: Object.entries(typeCount)
      .sort(([, a], [, b]) => b - a)
      .map(([type, count]) => ({ type, count })),
    weekdays: weekdays.map((count, i) => ({ weekday: WEEKDAYS[i], count })),
    months: Object.entries(monthCount)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, count]) => ({ month, count })),
    participants: Object.entries(participantCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([sender, count]) => ({ sender, count })),
    perChat,
  })
}
