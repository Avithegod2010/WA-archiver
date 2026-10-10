'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  Loader2,
  Lock,
  Search,
  Trash2,
  X,
  Info,
} from 'lucide-react'
import { Avatar } from './Avatar'
import { MessageBubble } from './MessageBubble'
import { ChatInfo } from './ChatInfo'
import { DoodleBackground } from './icons'
import type { ChatDetail, ChatMessage } from './types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

const PAGE_SIZE = 300

function formatDayLabel(d: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000)
  if (diffDays === 0) return 'TODAY'
  if (diffDays === 1) return 'YESTERDAY'
  return target
    .toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    .toUpperCase()
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function ChatView({
  detail,
  loading,
  onBack,
  onDelete,
  deleting,
}: {
  detail: ChatDetail | null
  loading: boolean
  onBack: () => void
  onDelete: (id: string) => void
  deleting: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const visibleCountRef = useRef(PAGE_SIZE)
  const pendingJumpRef = useRef<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [infoOpen, setInfoOpen] = useState(false)
  const [showFab, setShowFab] = useState(false)
  const [jumpedId, setJumpedId] = useState<string | null>(null)
  const [jumpDate, setJumpDate] = useState('')
  const [jumpOpen, setJumpOpen] = useState(false)
  const chatId = detail?.chat.id ?? ''

  const messages = detail?.messages ?? []

  const filtered = useMemo(() => {
    if (!query.trim()) return null
    const q = query.toLowerCase()
    return messages.filter(
      (m) =>
        (m.body ?? '').toLowerCase().includes(q) ||
        (m.sender ?? '').toLowerCase().includes(q)
    )
  }, [messages, query])

  // Scroll to bottom on open / chat change
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chatId, loading])

  // Execute pending jump-to-date after the expanded window has rendered
  useEffect(() => {
    const id = pendingJumpRef.current
    if (!id) return
    const el = scrollRef.current?.querySelector(`[data-mid="${id}"]`)
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setJumpedId(id)
      const t = setTimeout(() => setJumpedId(null), 2000)
      pendingJumpRef.current = null
      return () => clearTimeout(t)
    }
  }, [visibleCount, messages.length])

  const shown = useMemo(() => {
    if (filtered) return filtered
    return messages.slice(Math.max(0, messages.length - visibleCount))
  }, [messages, visibleCount, filtered])

  const grouped = useMemo(() => {
    const out: Array<
      | { kind: 'date'; key: string; label: string }
      | { kind: 'system'; key: string; body: string; ts: string }
      | { kind: 'msg'; key: string; msg: ChatMessage; showTail: boolean; showAvatar: boolean }
    > = []
    let prev: ChatMessage | null = null
    let prevDay = ''
    for (const m of shown) {
      const dk = dayKey(m.ts)
      if (dk !== prevDay) {
        out.push({ kind: 'date', key: `d-${dk}`, label: formatDayLabel(new Date(m.ts)) })
        prevDay = dk
        prev = null
      }
      if (m.type === 'system' || !m.sender) {
        out.push({ kind: 'system', key: `s-${m.id}`, body: m.body, ts: m.ts })
        prev = null
        continue
      }
      const showTail =
        !prev ||
        prev.sender !== m.sender ||
        prev.type === 'system' ||
        new Date(m.ts).getTime() - new Date(prev.ts).getTime() > 5 * 60 * 1000
      out.push({ kind: 'msg', key: m.id, msg: m, showTail, showAvatar: showTail })
      prev = m
    }
    return out
  }, [shown])

  function handleLoadEarlier() {
    const el = scrollRef.current
    if (!el) return
    const oldHeight = el.scrollHeight
    visibleCountRef.current += PAGE_SIZE
    setVisibleCount(visibleCountRef.current)
    requestAnimationFrame(() => {
      const newHeight = el.scrollHeight
      el.scrollTop = newHeight - oldHeight + el.scrollTop
    })
  }

  // Escape: close search first, then go back to list
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (infoOpen || jumpOpen) return
      if (query) {
        setQuery('')
      } else if (searchOpen) {
        setSearchOpen(false)
      } else {
        onBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [infoOpen, jumpOpen, query, searchOpen, onBack])

  function handleScrollToBottom() {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  function handleJumpToDate() {
    if (!jumpDate) return
    const target = new Date(jumpDate + 'T00:00:00')
    const targetKey = `${target.getFullYear()}-${target.getMonth()}-${target.getDate()}`
    const idx = messages.findIndex((m) => dayKey(m.ts) === targetKey)
    if (idx === -1) {
      toast.info(
        `No messages on ${target.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}`
      )
      return
    }
    const needed = messages.length - idx
    if (needed > visibleCountRef.current) {
      visibleCountRef.current = needed
      setVisibleCount(needed)
    }
    pendingJumpRef.current = messages[idx].id
    // If already rendered, the effect fires via visibleCount change; force check
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(
        `[data-mid="${messages[idx].id}"]`
      )
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setJumpedId(messages[idx].id)
        setTimeout(() => setJumpedId(null), 2000)
        pendingJumpRef.current = null
      }
    })
    setJumpOpen(false)
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#efeae2] dark:bg-[#0b141a]">
        <Loader2 className="h-8 w-8 animate-spin text-[#00a884]" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="relative hidden flex-1 flex-col items-center justify-center bg-[#222e35] px-6 text-center text-white/[0.08] md:flex">
        <DoodleBackground />
        <div className="relative z-10 max-w-md">
          <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-white/10">
            <svg viewBox="0 0 24 24" className="h-12 w-12 text-white/60" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="2" y="4" width="20" height="13" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          </div>
          <h2 className="text-[32px] font-light text-[#e9edef]">WhatsApp Viewer</h2>
          <p className="mt-4 text-sm leading-relaxed text-[#8696a0]">
            Import a WhatsApp chat export (.zip or .txt) to read your conversations
            here. Everything is stored locally in your own database — nothing leaves
            this device.
          </p>
          <p className="mt-6 text-[12px] uppercase tracking-wide text-[#8696a0]">
            Select a chat on the left to start reading
          </p>
        </div>
      </div>
    )
  }

  const { chat } = detail
  const subtitle = chat.isGroup
    ? `${countParticipants(messages)} participants`
    : 'click here for chat info'

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#efeae2] text-black/[0.05] dark:bg-[#0b141a] dark:text-white/[0.05]">
      <DoodleBackground />

      {/* Header */}
      <header className="relative z-10 flex items-center gap-3 border-l border-black/10 bg-[#f0f2f5] px-3 py-2 dark:border-black/30 dark:bg-[#202c33]">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 md:hidden"
          onClick={onBack}
          aria-label="Back to chats"
        >
          <ArrowLeft className="h-5 w-5 text-[#54656f] dark:text-[#aebac1]" />
        </Button>
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => setInfoOpen(true)}
        >
          <Avatar name={chat.title} size={40} />
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-medium leading-tight text-[#111b21] dark:text-[#e9edef]">
              {chat.title}
            </h2>
            <p className="truncate text-[12.5px] text-[#667781] dark:text-[#8696a0]">
              {subtitle}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setSearchOpen((v) => !v)}
            aria-label="Search in chat"
          >
            <Search className="h-5 w-5 text-[#54656f] dark:text-[#aebac1]" />
          </Button>
          <Popover open={jumpOpen} onOpenChange={setJumpOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                aria-label="Jump to date"
              >
                <CalendarDays className="h-5 w-5 text-[#54656f] dark:text-[#aebac1]" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
              <p className="mb-2 text-[13px] font-medium text-[#111b21] dark:text-[#e9edef]">
                Jump to date
              </p>
              <Input
                type="date"
                value={jumpDate}
                onChange={(e) => setJumpDate(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleJumpToDate()
                }}
                className="h-9 text-[13px] [color-scheme:light] dark:[color-scheme:dark]"
              />
              <Button
                size="sm"
                className="mt-2 w-full rounded-full bg-[#00a884] text-white hover:bg-[#029374]"
                onClick={handleJumpToDate}
                disabled={!jumpDate}
              >
                Go to date
              </Button>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setInfoOpen(true)}
            aria-label="Chat info"
          >
            <Info className="h-5 w-5 text-[#54656f] dark:text-[#aebac1]" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 hover:bg-rose-500/10"
            onClick={() => onDelete(chat.id)}
            disabled={deleting}
            aria-label="Delete chat"
          >
            <Trash2 className="h-5 w-5 text-rose-500/80" />
          </Button>
        </div>
      </header>

      {/* In-chat search */}
      {searchOpen && (
        <div className="relative z-10 flex items-center gap-2 border-b border-black/10 bg-[#f0f2f5] px-3 py-2 dark:border-black/30 dark:bg-[#202c33]">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search in ${chat.title}...`}
            className="h-9 rounded-lg bg-white text-[14px] dark:bg-[#2a3942] dark:text-[#e9edef] dark:placeholder:text-[#8696a0]"
          />
          {query && (
            <span className="shrink-0 text-[12px] text-[#667781] dark:text-[#8696a0]">
              {filtered?.length ?? 0} result{(filtered?.length ?? 0) === 1 ? '' : 's'}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => {
              setSearchOpen(false)
              setQuery('')
            }}
            aria-label="Close search"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          setShowFab(el.scrollHeight - el.scrollTop - el.clientHeight > 400)
        }}
        className="wa-scroll relative z-[1] flex-1 overflow-y-auto py-3"
        role="log"
        aria-label={`Messages in ${chat.title}`}
      >
        {!filtered && messages.length > visibleCount && (
          <div className="mb-3 flex justify-center">
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full bg-white text-[12.5px] font-medium shadow-md hover:bg-white dark:bg-[#233138] dark:text-[#e9edef]"
              onClick={handleLoadEarlier}
            >
              Load earlier messages
            </Button>
          </div>
        )}

        {filtered && filtered.length === 0 && (
          <div className="mt-10 text-center text-[13px] text-[#667781] dark:text-[#8696a0]">
            No messages match &quot;{query}&quot;
          </div>
        )}

        {grouped.map((item) => {
          if (item.kind === 'date') {
            return (
              <div key={item.key} className="my-3 flex justify-center">
                <span className="rounded-md bg-white px-3 py-1 text-[12.2px] font-medium text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#8696a0]">
                  {item.label}
                </span>
              </div>
            )
          }
          if (item.kind === 'system') {
            return (
              <div key={item.key} className="my-2 flex justify-center px-8">
                <span className="flex max-w-lg items-center justify-center gap-1.5 rounded-md bg-[#ffeecd] px-3 py-1.5 text-center text-[12.5px] leading-snug text-[#54656f] shadow-sm dark:bg-[#182229] dark:text-[#ffd279]">
                  {/encrypted/i.test(item.body) && <Lock className="h-3 w-3 shrink-0" />}
                  {item.body}
                </span>
              </div>
            )
          }
          return (
            <div
              key={item.key}
              data-mid={item.msg.id}
              className={cn(
                'mt-0.5 rounded-lg transition-colors duration-700',
                item.showTail && 'mt-2.5',
                jumpedId === item.msg.id &&
                  'bg-amber-200/50 ring-1 ring-amber-400/60 dark:bg-amber-500/20'
              )}
            >
              <MessageBubble
                msg={item.msg}
                chatId={chatId}
                isGroup={chat.isGroup}
                showTail={item.showTail}
                showAvatar={item.showAvatar}
              />
            </div>
          )
        })}
      </div>

      {/* Scroll-to-bottom FAB (WhatsApp style) */}
      {showFab && !searchOpen && (
        <button
          onClick={handleScrollToBottom}
          aria-label="Scroll to latest messages"
          className="absolute bottom-[68px] right-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#54656f] shadow-[0_1px_3px_rgba(11,20,26,0.3)] transition-transform hover:scale-105 active:scale-95 dark:bg-[#233138] dark:text-[#aebac1]"
        >
          <ChevronDown className="h-6 w-6" />
        </button>
      )}

      {/* Read-only notice (mimics the WhatsApp composer) */}
      <div className="relative z-10 bg-[#f0f2f5] px-3 py-2.5 dark:bg-[#202c33]">
        <div className="flex items-center justify-center gap-2 rounded-lg bg-[#8696a0]/10 px-4 py-2.5 text-[13px] text-[#667781] dark:bg-white/5 dark:text-[#8696a0]">
          <Lock className="h-3.5 w-3.5" />
          Read-only viewer — replies are disabled
        </div>
      </div>

      <ChatInfo
        open={infoOpen}
        onOpenChange={setInfoOpen}
        chat={chat}
        messages={messages}
        onJumpToMessage={() => {
          const el = scrollRef.current
          if (el) el.scrollTo({ top: el.scrollHeight })
        }}
      />
    </div>
  )
}

function countParticipants(messages: ChatMessage[]): number {
  const set = new Set<string>()
  for (const m of messages) if (m.sender) set.add(m.sender)
  return set.size
}
