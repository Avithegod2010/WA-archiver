'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  Images,
  Loader2,
  Lock,
  Palette,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
  Info,
} from 'lucide-react'
import { Avatar } from './Avatar'
import { MessageBubble } from './MessageBubble'
import { ChatInfo } from './ChatInfo'
import { MediaGallery } from './MediaGallery'
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

/* ---------- Chat wallpaper (persisted per device) ---------- */

const WALLPAPERS = {
  doodle: {
    label: 'Classic',
    bg: 'bg-[#efeae2] dark:bg-[#0b141a]',
    doodle: 'text-black/[0.05] dark:text-white/[0.05]',
    swatch: 'bg-[#efeae2] dark:bg-[#0b141a]',
    swatchDot: 'bg-black/20 dark:bg-white/20',
  },
  plain: {
    label: 'Plain',
    bg: 'bg-[#efeae2] dark:bg-[#0b141a]',
    doodle: null,
    swatch: 'bg-[#efeae2] dark:bg-[#0b141a]',
    swatchDot: null,
  },
  sage: {
    label: 'Sage',
    bg: 'bg-[#e3ecdd] dark:bg-[#0c1710]',
    doodle: 'text-[#4a7c59]/[0.08] dark:text-[#8fc7a5]/[0.05]',
    swatch: 'bg-[#e3ecdd] dark:bg-[#0c1710]',
    swatchDot: 'bg-[#4a7c59]/30 dark:bg-[#8fc7a5]/30',
  },
  sepia: {
    label: 'Sepia',
    bg: 'bg-[#f2e9d8] dark:bg-[#16120d]',
    doodle: 'text-[#8a6d3b]/[0.09] dark:text-[#d9b878]/[0.05]',
    swatch: 'bg-[#f2e9d8] dark:bg-[#16120d]',
    swatchDot: 'bg-[#8a6d3b]/30 dark:bg-[#d9b878]/30',
  },
} as const

type WallpaperKey = keyof typeof WALLPAPERS

function subscribeWallpaper(cb: () => void) {
  window.addEventListener('wa-wallpaper', cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener('wa-wallpaper', cb)
    window.removeEventListener('storage', cb)
  }
}

function getWallpaper(): string {
  try {
    return localStorage.getItem('wa-viewer:wallpaper') ?? 'doodle'
  } catch {
    return 'doodle'
  }
}

function setStoredWallpaper(w: string) {
  try {
    localStorage.setItem('wa-viewer:wallpaper', w)
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event('wa-wallpaper'))
}

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
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [dateFilterOpen, setDateFilterOpen] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [showFab, setShowFab] = useState(false)
  const [jumpedId, setJumpedId] = useState<string | null>(null)
  const [jumpDate, setJumpDate] = useState('')
  const [jumpOpen, setJumpOpen] = useState(false)
  const [wallpaperOpen, setWallpaperOpen] = useState(false)
  const wallpaperKey = useSyncExternalStore(
    subscribeWallpaper,
    getWallpaper,
    () => 'doodle'
  ) as WallpaperKey
  const wallpaper = WALLPAPERS[wallpaperKey] ?? WALLPAPERS.doodle
  const chatId = detail?.chat.id ?? ''

  const messages = detail?.messages ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const from = fromDate ? new Date(fromDate + 'T00:00:00').getTime() : null
    const to = toDate ? new Date(toDate + 'T23:59:59.999').getTime() : null
    if (!q && from == null && to == null) return null
    return messages.filter((m) => {
      if (q) {
        const hay = `${m.body ?? ''}\n${m.sender ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      const t = new Date(m.ts).getTime()
      if (from != null && t < from) return false
      if (to != null && t > to) return false
      return true
    })
  }, [messages, query, fromDate, toDate])

  const hasDateFilter = !!(fromDate || toDate)

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

  // Escape: clear filters -> close search -> go back to list
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Never intercept Escape while a dialog/alert is open (Radix handles it)
      if (document.querySelector('[role="dialog"],[role="alertdialog"]')) return
      if (jumpOpen) return
      if (query) {
        setQuery('')
      } else if (hasDateFilter) {
        setFromDate('')
        setToDate('')
      } else if (searchOpen) {
        setSearchOpen(false)
      } else {
        onBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [jumpOpen, query, hasDateFilter, searchOpen, onBack])

  function handleScrollToBottom() {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  function handleExport() {
    if (!detail) return
    const a = document.createElement('a')
    a.href = `/api/chats/${detail.chat.id}/export`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast.success('Chat exported as .txt — check your downloads')
  }

  /** Expand the render window and smooth-scroll to a message with a flash. */
  function jumpToMessageId(id: string) {
    const idx = messages.findIndex((m) => m.id === id)
    if (idx === -1) {
      toast.info('Message not found in this chat')
      return
    }
    const needed = messages.length - idx
    if (needed > visibleCountRef.current) {
      visibleCountRef.current = needed
      setVisibleCount(needed)
    }
    pendingJumpRef.current = id
    // If already rendered, the effect fires via visibleCount change; force check
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector(`[data-mid="${id}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setJumpedId(id)
        setTimeout(() => setJumpedId(null), 2000)
        pendingJumpRef.current = null
      }
    })
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
    jumpToMessageId(messages[idx].id)
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
    <div
      className={cn(
        'relative flex min-h-0 flex-1 flex-col transition-colors duration-300',
        wallpaper.bg,
        wallpaper.doodle ?? 'text-transparent'
      )}
    >
      {wallpaper.doodle && <DoodleBackground />}

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
            onClick={() => setGalleryOpen(true)}
            aria-label="Media gallery"
            title="Media gallery"
          >
            <Images className="h-5 w-5 text-[#54656f] dark:text-[#aebac1]" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setSearchOpen((v) => !v)}
            aria-label="Search in chat"
            title="Search in chat"
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
          <Popover open={wallpaperOpen} onOpenChange={setWallpaperOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hidden h-9 w-9 md:inline-flex"
                aria-label="Chat wallpaper"
                title="Chat wallpaper"
              >
                <Palette className="h-5 w-5 text-[#54656f] dark:text-[#aebac1]" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-3">
              <p className="mb-2 text-[13px] font-medium text-[#111b21] dark:text-[#e9edef]">
                Chat wallpaper
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(WALLPAPERS) as WallpaperKey[]).map((key) => {
                  const w = WALLPAPERS[key]
                  const active = wallpaperKey === key
                  return (
                    <button
                      key={key}
                      onClick={() => setStoredWallpaper(key)}
                      aria-pressed={active}
                      className={cn(
                        'group flex flex-col items-center gap-1.5 rounded-lg p-2 transition-colors',
                        active
                          ? 'bg-[#00a884]/10 ring-1 ring-[#00a884]'
                          : 'hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      <span
                        className={cn(
                          'relative flex h-12 w-full items-center justify-center rounded-md ring-1 ring-black/10 dark:ring-white/10',
                          w.swatch
                        )}
                      >
                        {w.swatchDot && (
                          <span className="flex gap-1">
                            <i className={cn('block h-1.5 w-1.5 rounded-full', w.swatchDot)} />
                            <i className={cn('block h-1.5 w-1.5 rounded-full', w.swatchDot)} />
                            <i className={cn('block h-1.5 w-1.5 rounded-full', w.swatchDot)} />
                          </span>
                        )}
                        {active && (
                          <span className="absolute inset-0 flex items-center justify-center">
                            <Check className="h-4 w-4 text-[#00a884] drop-shadow" />
                          </span>
                        )}
                      </span>
                      <span className="text-[11.5px] font-medium text-[#3b4a54] dark:text-[#d1d7db]">
                        {w.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-9 w-9 md:inline-flex"
            onClick={handleExport}
            aria-label="Export chat as text"
            title="Export chat as .txt"
          >
            <Download className="h-5 w-5 text-[#54656f] dark:text-[#aebac1]" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-9 w-9 md:inline-flex"
            onClick={() => setInfoOpen(true)}
            aria-label="Chat info"
            title="Chat info"
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

      {/* In-chat search (text + optional date range) */}
      {searchOpen && (
        <div className="relative z-10 border-b border-black/10 bg-[#f0f2f5] px-3 py-2 dark:border-black/30 dark:bg-[#202c33]">
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search in ${chat.title}...`}
              className="h-9 rounded-lg bg-white text-[14px] dark:bg-[#2a3942] dark:text-[#e9edef] dark:placeholder:text-[#8696a0]"
            />
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-9 w-9 shrink-0',
                hasDateFilter &&
                  'bg-[#00a884]/15 text-[#008069] dark:bg-[#00a884]/25 dark:text-[#6fd3b6]'
              )}
              onClick={() => setDateFilterOpen((v) => !v)}
              aria-label="Toggle date range filter"
              title="Filter by date range"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
            {(query || hasDateFilter) && (
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
                setFromDate('')
                setToDate('')
                setDateFilterOpen(false)
              }}
              aria-label="Close search"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {dateFilterOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] font-medium uppercase tracking-wide text-[#667781] dark:text-[#8696a0]">
                From
              </span>
              <Input
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-8 w-[150px] rounded-lg bg-white text-[13px] [color-scheme:light] dark:bg-[#2a3942] dark:text-[#e9edef] dark:[color-scheme:dark]"
              />
              <span className="text-[11.5px] font-medium uppercase tracking-wide text-[#667781] dark:text-[#8696a0]">
                To
              </span>
              <Input
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
                className="h-8 w-[150px] rounded-lg bg-white text-[13px] [color-scheme:light] dark:bg-[#2a3942] dark:text-[#e9edef] dark:[color-scheme:dark]"
              />
              {hasDateFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 rounded-full px-2.5 text-[12px] text-[#667781] hover:text-rose-500 dark:text-[#8696a0]"
                  onClick={() => {
                    setFromDate('')
                    setToDate('')
                  }}
                >
                  <X className="h-3.5 w-3.5" /> Clear dates
                </Button>
              )}
            </div>
          )}
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
            {query ? (
              <>
                No messages match &quot;{query}&quot;
                {hasDateFilter ? ' in the selected date range' : ''}
              </>
            ) : (
              'No messages in the selected date range'
            )}
          </div>
        )}

        {grouped.map((item) => {
          if (item.kind === 'date') {
            return (
              <div key={item.key} className="animate-in fade-in my-3 flex justify-center duration-300">
                <span className="rounded-lg bg-white/95 px-3 py-1 text-[12.2px] font-medium uppercase tracking-wide text-[#54656f] shadow-[0_1px_1px_rgba(11,20,26,0.12)] backdrop-blur-sm dark:bg-[#182229]/95 dark:text-[#8696a0]">
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
                'animate-in fade-in mt-0.5 rounded-lg duration-300 transition-colors',
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

      {/* Full media gallery (mounted per open for fresh state) */}
      {galleryOpen && (
        <MediaGallery
          chatId={chatId}
          chatTitle={chat.title}
          isGroup={chat.isGroup}
          open
          onClose={() => setGalleryOpen(false)}
          onJumpToMessage={jumpToMessageId}
        />
      )}
    </div>
  )
}

function countParticipants(messages: ChatMessage[]): number {
  const set = new Set<string>()
  for (const m of messages) if (m.sender) set.add(m.sender)
  return set.size
}
