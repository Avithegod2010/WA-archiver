export interface ChatSummary {
  id: string
  title: string
  isGroup: boolean
  messageCount: number
  mediaCount: number
  firstAt: string | null
  lastAt: string | null
  lastPreview: string
  lastSender: string | null
  lastType: string
  sourceFile: string
  pinned: boolean
}

export interface ChatMessage {
  id: string
  idx: number
  ts: string
  sender: string | null
  body: string
  type: string
  mediaPath: string | null
  mediaName: string | null
}

export interface ChatDetailChat {
  id: string
  title: string
  isGroup: boolean
  messageCount: number
  mediaCount: number
  firstAt: string | null
  lastAt: string | null
  sourceFile: string
}

export interface ChatDetail {
  chat: ChatDetailChat
  messages: ChatMessage[]
}

export interface StatsData {
  totals: {
    chats: number
    groupChats: number
    messages: number
    outgoing: number
    media: number
    words: number
    chars: number
    emojis: number
  }
  range: {
    firstAt: string | null
    lastAt: string | null
    busiestDay: { date: string; count: number } | null
  }
  types: { type: string; count: number }[]
  weekdays: { weekday: string; count: number }[]
  months: { month: string; count: number }[]
  participants: { sender: string; count: number }[]
  perChat: {
    id: string
    title: string
    isGroup: boolean
    count: number
    media: number
    words: number
  }[]
}

export const AVATAR_COLORS = [
  '#e542a3',
  '#f2a33c',
  '#12b886',
  '#0ea5a4',
  '#b06ad4',
  '#ef6c6c',
  '#5f9b3f',
  '#c27a3f',
  '#8f6ed5',
  '#d4699b',
]

export function colorForName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
