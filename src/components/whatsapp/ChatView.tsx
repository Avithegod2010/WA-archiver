'use client'

import './chat-extras.css'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { toast } from 'sonner'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpToLine,
  BookmarkPlus,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileArchive,
  FileText,
  Images,
  Languages,
  ListChecks,
  Loader2,
  Lock,
  Palette,
  Pencil,
  Pin,
  PinOff,
  Printer,
  Regex,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
  Info,
} from 'lucide-react'
import { Avatar, SavedAvatar } from './Avatar'
import { MessageBubble } from './MessageBubble'
import { ChatInfo } from './ChatInfo'
import { MediaGallery } from './MediaGallery'
import { StarredMessages } from './StarredMessages'
import { Composer } from './Composer'
import { PollDialog } from './PollDialog'
import { WallpaperPicker } from './WallpaperPicker'
import { AIToolsDialog } from './AIToolsDialog'
import { DoodleBackground } from './icons'
import {
  GLOBAL_WALLPAPER_KEY,
  presetByKey,
  readWallpaper,
  subscribeWallpaper,
  type WallpaperConfig,
} from './wallpaper'
import { SAVED_CHAT_ID, type ChatDetail, type ChatMessage } from './types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Calendar, CalendarDayButton } from '@/components/ui/calendar'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  TEXT_SIZES,
  getTextSize,
  subscribeTextSize,
  type TextSizeKey,
} from './text-size'

const PAGE_SIZE = 300

/* ------------------------- Chat wallpaper (v2) ------------------------- */

/** Reactive wallpaper config: per-chat override → app default → classic. */
function useWallpaperConfig(chatId: string): WallpaperConfig {
  const getSnapshot = useCallback(() => {
    try {
      return (
        localStorage.getItem(`wa-viewer:wallpaper:${chatId}`) ??
        localStorage.getItem(GLOBAL_WALLPAPER_KEY) ??
        ''
      )
    } catch {
      return ''
    }
  }, [chatId])
  const raw = useSyncExternalStore(subscribeWallpaper, getSnapshot, () => '')
  return useMemo(() => readWallpaper(chatId), [chatId, raw])
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Telegram-style save animation: clone the bubble in place and fly it into
 * the Saved Messages row (or the app logo on mobile), shrinking + fading,
 * then pulse the destination avatar.
 */
function flyBubbleToSaved(msgId: string, staggerIdx: number) {
  if (typeof document === 'undefined' || prefersReducedMotion()) return
  const bubble = document.querySelector(
    `[data-mid="${msgId}"] [data-bubble]`
  ) as HTMLElement | null
  if (!bubble) return
  const target =
    (document.querySelector('[data-saved-avatar]') as HTMLElement | null) ??
    (document.querySelector('[data-app-logo]') as HTMLElement | null)
  if (!target) return

  const from = bubble.getBoundingClientRect()
  const to = target.getBoundingClientRect()
  if (!from.width || !to.width) return

  const ghost = bubble.cloneNode(true) as HTMLElement
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.cssText = `position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;min-height:${from.height}px;margin:0;max-width:none;z-index:80;pointer-events:none;border-radius:7.5px;box-shadow:0 12px 32px rgba(0,0,0,0.28);will-change:transform,opacity;`
  document.body.appendChild(ghost)

  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)
  const anim = ghost.animate(
    [
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      {
        transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 36}px) scale(0.72)`,
        opacity: 0.96,
        offset: 0.42,
      },
      { transform: `translate(${dx}px, ${dy}px) scale(0.06)`, opacity: 0 },
    ],
    {
      duration: 640,
      delay: staggerIdx * 85,
      easing: 'cubic-bezier(0.3, 0.72, 0.4, 1)',
      fill: 'forwards',
    }
  )
  anim.onfinish = () => {
    ghost.remove()
    // Heartbeat pulse on the destination avatar (retriggerable)
    target.classList.remove('wa-pulse-ring')
    void target.offsetWidth
    target.classList.add('wa-pulse-ring')
    window.setTimeout(() => target.classList.remove('wa-pulse-ring'), 950)
  }
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

/* ------------------- 7-d helpers (pins / print / AI) ------------------- */

/** Deterministic string hash (same recipe as colorForName in types.ts). */
function hashStr(s: string): number {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0
  }
  return hash
}

/** Reactions map shape on ChatMessage (7-a). */
type ReactionMap = Record<string, string[]>

const MEDIA_LABELS: Record<string, string> = {
  image: 'Photo',
  video: 'Video',
  gif: 'GIF',
  audio: 'Voice message',
  sticker: 'Sticker',
  document: 'Document',
  contact: 'Contact card',
  location: 'Location',
  poll: 'Poll',
  media: 'Media omitted',
}

/** Short one-line preview for the pinned-messages bar. */
function msgPreviewText(m: ChatMessage): string {
  const body = (m.body ?? '').trim()
  if (body) return body
  if (m.type === 'deleted') return 'This message was deleted'
  const label = MEDIA_LABELS[m.type]
  return label ? `[${label}]` : '[Message]'
}

/** Transcript body for the print overlay — media types become [Label] tags. */
function printBody(m: ChatMessage): string {
  if (m.type === 'poll') return `[Poll] ${m.body || 'Poll'}`
  if (m.type === 'deleted') return m.body || 'This message was deleted'
  const label = MEDIA_LABELS[m.type]
  if (label) {
    const parts = [`[${label}]`]
    if (m.mediaName) parts.push(m.mediaName)
    const caption = (m.body ?? '').trim()
    if (caption) parts.push(caption)
    return parts.join(' ')
  }
  return m.body || '[Message]'
}

function hhmm(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--'
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function dmy(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function labelFromDayKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  if (!y || m === undefined || d === undefined) return key
  return new Date(y, m, d).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Day-cell factory: shows "N messages" as the native tooltip per day. */
function makeDayButton(counts: Map<string, number>) {
  return function CountedDayButton(props: React.ComponentProps<typeof CalendarDayButton>) {
    const d = props.day.date
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const count = counts.get(key)
    return (
      <CalendarDayButton
        {...props}
        title={count ? `${count} message${count === 1 ? '' : 's'}` : undefined}
      />
    )
  }
}

export function ChatView({
  detail,
  setDetail,
  loading,
  onBack,
  onDelete,
  deleting,
  onStarMessage,
  initialJumpMessageId,
  onChatChanged,
}: {
  detail: ChatDetail | null
  setDetail: React.Dispatch<React.SetStateAction<ChatDetail | null>>
  loading: boolean
  onBack: () => void
  onDelete: (id: string) => void
  deleting: boolean
  onStarMessage?: (messageId: string, starred: boolean) => void
  initialJumpMessageId?: string | null
  onChatChanged?: () => void
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
  const [starredOpen, setStarredOpen] = useState(false)
  const [showFab, setShowFab] = useState(false)
  const [jumpedId, setJumpedId] = useState<string | null>(null)
  const [jumpDate, setJumpDate] = useState<Date | undefined>(undefined)
  const [jumpOpen, setJumpOpen] = useState(false)
  const [wallpaperOpen, setWallpaperOpen] = useState(false)
  const [starredOnly, setStarredOnly] = useState(false)
  const [regexMode, setRegexMode] = useState(false)
  const [matchIdx, setMatchIdx] = useState(0)
  const [filterKey, setFilterKey] = useState('')
  const [isNarrow, setIsNarrow] = useState(false)

  /* ---- 7-d: pins bar, presence tick, print preview, AI dialog ---- */
  const [pinsCollapsed, setPinsCollapsed] = useState(false)
  const [pinIdx, setPinIdx] = useState(0)
  const [printReady, setPrintReady] = useState(false)
  const [aiMsg, setAiMsg] = useState<ChatMessage | null>(null)
  /** null until mounted — keeps the presence subtitle hydration-safe. */
  const [nowMs, setNowMs] = useState<number | null>(null)

  /* ----- Local edit mode (pencil): selection, edit, delete, compose ----- */
  const [editMode, setEditMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [pollOpen, setPollOpen] = useState(false)
  const [pollCreating, setPollCreating] = useState(false)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [editBody, setEditBody] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const chatId = detail?.chat.id ?? ''
  const wallpaperCfg = useWallpaperConfig(chatId)
  const wpIsPreset = wallpaperCfg.k === 'preset'
  const wallpaperPreset = presetByKey(wpIsPreset ? wallpaperCfg.preset : 'doodle')
  const wallpaperIsPhoto = wallpaperCfg.k === 'custom' && !!wallpaperCfg.photo
  /** Inline vars for the user-chosen base color (light + optional dark). */
  const wallpaperBaseStyle = {
    '--wp-base': wallpaperCfg.color ?? undefined,
    '--wp-base-dark': wallpaperCfg.colorDark ?? undefined,
  } as React.CSSProperties
  /** CSS filter for the wallpaper stack — contrast/brightness/saturation tuning. */
  const wallpaperFilter = useMemo(() => {
    const parts: string[] = []
    if (Math.abs(wallpaperCfg.contrast - 1) > 0.001)
      parts.push(`contrast(${wallpaperCfg.contrast})`)
    if (Math.abs(wallpaperCfg.brightness - 1) > 0.001)
      parts.push(`brightness(${wallpaperCfg.brightness})`)
    if (Math.abs(wallpaperCfg.saturation - 1) > 0.001)
      parts.push(`saturate(${wallpaperCfg.saturation})`)
    return parts.length > 0 ? parts.join(' ') : undefined
  }, [wallpaperCfg.contrast, wallpaperCfg.brightness, wallpaperCfg.saturation])
  const textSizeKey: TextSizeKey = useSyncExternalStore(
    subscribeTextSize,
    getTextSize,
    () => 'md'
  )
  const msgFontPx = TEXT_SIZES[textSizeKey]?.px ?? 14.2

  const messages = detail?.messages ?? []

  // Track the md breakpoint so only ONE jump-to-date popover is ever mounted
  // (desktop header trigger vs the mobile one inside the search panel)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setIsNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  // Simulated presence tick — recompute the online window every 60s.
  // nowMs stays null during SSR + first paint (hydration-safe), then flips.
  useEffect(() => {
    setNowMs(Date.now())
    const t = window.setInterval(() => setNowMs(Date.now()), 60000)
    return () => window.clearInterval(t)
  }, [])

  // Pinned-bar state is per chat — reset when switching conversations
  useEffect(() => {
    setPinsCollapsed(false)
    setPinIdx(0)
  }, [chatId])

  const compiledRegex = useMemo<{ re: RegExp } | 'invalid' | null>(() => {
    const q = query.trim()
    if (!q || !regexMode) return null
    try {
      return { re: new RegExp(q, 'i') }
    } catch {
      return 'invalid'
    }
  }, [query, regexMode])
  const regexInvalid = compiledRegex === 'invalid'

  const filtered = useMemo(() => {
    const q = query.trim()
    const from = fromDate ? new Date(fromDate + 'T00:00:00').getTime() : null
    const to = toDate ? new Date(toDate + 'T23:59:59.999').getTime() : null
    if (!q && from == null && to == null && !starredOnly) return null
    return messages.filter((m) => {
      if (starredOnly && !m.starred) return false
      if (q) {
        const hay = `${m.body ?? ''}\n${m.sender ?? ''}`
        if (compiledRegex === 'invalid') return false
        if (compiledRegex) {
          if (!compiledRegex.re.test(hay)) return false
        } else if (!hay.toLowerCase().includes(q.toLowerCase())) {
          return false
        }
      }
      const t = new Date(m.ts).getTime()
      if (from != null && t < from) return false
      if (to != null && t > to) return false
      return true
    })
  }, [messages, query, fromDate, toDate, starredOnly, compiledRegex])

  const hasDateFilter = !!(fromDate || toDate)

  // Reset the match cursor whenever the active filters change
  // (adjust-state-during-render, no effect needed)
  const matchCount = filtered?.length ?? 0
  const safeMatchIdx = matchCount > 0 ? Math.min(matchIdx, matchCount - 1) : 0
  const activeFilterKey = `${query}|${fromDate}|${toDate}|${starredOnly}|${regexMode}`
  if (activeFilterKey !== filterKey) {
    setFilterKey(activeFilterKey)
    setMatchIdx(0)
  }

  // Scroll to bottom on open / chat change — unless a jump is queued
  // (e.g. arriving from a global-search hit), which wins instead.
  useEffect(() => {
    if (pendingJumpRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chatId, loading])

  // Queue an incoming jump target (e.g. arriving from a global-search hit).
  // Ref-only effect — the executor below performs the scroll when rendered.
  useEffect(() => {
    if (initialJumpMessageId) pendingJumpRef.current = initialJumpMessageId
  }, [initialJumpMessageId])

  // Execute pending jumps (jump-to-date, search hits, starred dialog, and the
  // queued initial jump from global search) once the target has rendered.
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
    // Not rendered yet — if it exists further up, expand the window and this
    // effect re-runs (visibleCount changed) to perform the actual scroll.
    const idx = messages.findIndex((m) => m.id === id)
    if (idx === -1) return
    const needed = messages.length - idx
    if (needed > visibleCountRef.current) {
      const raf = requestAnimationFrame(() => {
        visibleCountRef.current = needed
        setVisibleCount(needed)
      })
      return () => cancelAnimationFrame(raf)
    }
  }, [visibleCount, messages.length, initialJumpMessageId, messages])

  const shown = useMemo(() => {
    if (filtered) return filtered
    return messages.slice(Math.max(0, messages.length - visibleCount))
  }, [messages, visibleCount, filtered])

  const grouped = useMemo(() => {
    const out: Array<
      | { kind: 'date'; key: string; label: string }
      | { kind: 'system'; key: string; id: string; body: string; ts: string }
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
        out.push({ kind: 'system', key: `s-${m.id}`, id: m.id, body: m.body, ts: m.ts })
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
      // Never intercept Escape while a dialog/alert/context menu is open
      // (Radix handles those Escapes itself)
      if (document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]')) return
      if (jumpOpen) return
      if (query) {
        setQuery('')
      } else if (hasDateFilter) {
        setFromDate('')
        setToDate('')
      } else if (starredOnly) {
        setStarredOnly(false)
      } else if (searchOpen) {
        setSearchOpen(false)
      } else {
        onBack()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [jumpOpen, query, hasDateFilter, starredOnly, searchOpen, onBack])

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

  function handleToggleStar(id: string, starred: boolean) {
    onStarMessage?.(id, starred)
    toast.success(starred ? 'Message starred' : 'Message unstarred')
  }

  /* ----------------- Reactions / pin / translate (7-d) ----------------- */

  /** Optimistically toggle 'You' on an emoji, then persist; revert on failure. */
  async function handleReact(msgId: string, emoji: string) {
    const target = messages.find((m) => m.id === msgId)
    if (!target) return
    const prev = target.reactions ?? null
    const next: ReactionMap = { ...(prev ?? {}) }
    const list = next[emoji] ?? []
    const hasYou = list.includes('You')
    const nextList = hasYou ? list.filter((u) => u !== 'You') : [...list, 'You']
    if (nextList.length > 0) next[emoji] = nextList
    else delete next[emoji]
    const nextIsEmpty = Object.keys(next).length === 0
    setDetail((d) =>
      d
        ? {
            ...d,
            messages: d.messages.map((m) =>
              m.id === msgId ? { ...m, reactions: nextIsEmpty ? null : next } : m
            ),
          }
        : d
    )
    try {
      const res = await fetch(`/api/messages/${msgId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      })
      const data = (await res.json().catch(() => null)) as {
        reactions?: ReactionMap | null
        error?: string
      } | null
      if (!res.ok) throw new Error(data?.error ?? 'Reaction failed')
      // Sync the server's authoritative map when it provides one
      if (data && data.reactions && typeof data.reactions === 'object') {
        const server = data.reactions
        setDetail((d) =>
          d
            ? {
                ...d,
                messages: d.messages.map((m) =>
                  m.id === msgId ? { ...m, reactions: server } : m
                ),
              }
            : d
        )
      }
    } catch {
      setDetail((d) =>
        d
          ? {
              ...d,
              messages: d.messages.map((m) =>
                m.id === msgId ? { ...m, reactions: prev } : m
              ),
            }
          : d
      )
      toast.error('Could not save reaction')
    }
  }

  /** Optimistically toggle the pin flag, then PATCH; revert on failure. */
  async function handlePinMessage(msg: ChatMessage) {
    const current = msg.pinned ?? false
    const next = !current
    setDetail((d) =>
      d
        ? {
            ...d,
            messages: d.messages.map((m) =>
              m.id === msg.id ? { ...m, pinned: next } : m
            ),
          }
        : d
    )
    try {
      const res = await fetch(`/api/messages/${msg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: next }),
      })
      if (!res.ok) throw new Error('Pin failed')
      toast.success(next ? 'Message pinned' : 'Message unpinned')
    } catch {
      setDetail((d) =>
        d
          ? {
              ...d,
              messages: d.messages.map((m) =>
                m.id === msg.id ? { ...m, pinned: current } : m
              ),
            }
          : d
      )
      toast.error('Could not update pin')
    }
  }

  /** Open the AI tools dialog prefilled with this message. */
  function handleTranslate(msg: ChatMessage) {
    setAiMsg(msg)
  }

  /* --------------------- Export / print (7-d) --------------------- */

  function handleExportZip() {
    if (!detail) return
    const a = document.createElement('a')
    a.href = `/api/chats/${detail.chat.id}/export?format=zip`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast.success('Exporting .zip with text + media — check your downloads')
  }

  function openPrint() {
    setPrintReady(true)
  }

  // Print flow: render the transcript overlay → give it a frame → window.print()
  // → close the preview on afterprint (or a fallback timeout).
  useEffect(() => {
    if (!printReady) return
    const onAfterPrint = () => setPrintReady(false)
    window.addEventListener('afterprint', onAfterPrint)
    let fallback = 0
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        try {
          window.print()
        } catch {
          /* print unavailable — the on-screen preview stays usable */
        }
        fallback = window.setTimeout(() => setPrintReady(false), 500)
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      window.clearTimeout(fallback)
      window.removeEventListener('afterprint', onAfterPrint)
    }
  }, [printReady])

  /* ---------------------- Local edit mode (pencil) ---------------------- */

  const isSavedChat = detail?.chat.id === SAVED_CHAT_ID
  const selectedCount = selectedIds.size
  const selectedMessages = useMemo(
    () => messages.filter((m) => selectedIds.has(m.id)),
    [messages, selectedIds]
  )
  const singleSelected =
    selectedCount === 1 && selectedMessages[0]?.type !== 'system'
      ? selectedMessages[0]
      : null
  const singleEditable =
    !!singleSelected &&
    singleSelected.sender === 'You' &&
    (singleSelected.type === 'text' || singleSelected.type === 'poll')

  /** Leave select mode whenever the chat changes. */
  useEffect(() => {
    setEditMode(false)
    setSelectedIds(new Set())
  }, [chatId])

  function exitEditMode() {
    setEditMode(false)
    setSelectedIds(new Set())
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Select every selectable message in the chat (edit mode). */
  function selectAll() {
    setSelectedIds(
      new Set(messages.filter((m) => m.sender || m.type === 'poll').map((m) => m.id))
    )
  }

  /** Forward one or many messages into Saved Messages. */
  async function forwardToSaved(targets: ChatMessage[]) {
    // Telegram-style fly animation (skipped inside Saved itself)
    if (!isSavedChat) {
      targets.forEach((t, i) => flyBubbleToSaved(t.id, i))
    }
    let ok = 0
    const toastId = toast.loading(
      targets.length > 1 ? `Saving 1 of ${targets.length}…` : 'Saving to Saved Messages…'
    )
    for (const t of targets) {
      try {
        const res = await fetch(`/api/messages/${t.id}/forward`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetChatId: SAVED_CHAT_ID }),
        })
        if (!res.ok) throw new Error('failed')
        ok++
      } catch {
        /* keep going */
      }
    }
    if (ok > 0) {
      toast.success(
        ok === 1
          ? `Saved to Saved Messages${isSavedChat ? '' : ''}`
          : `Saved ${ok} messages`,
        { id: toastId }
      )
      onChatChanged?.()
    } else {
      toast.error('Could not save to Saved Messages', { id: toastId })
    }
  }

  function forwardOne(msg: ChatMessage) {
    void forwardToSaved([msg])
  }

  async function starSelected() {
    const unstarred = selectedMessages.filter((m) => !m.starred)
    if (unstarred.length === 0) {
      toast.info('Selected messages are already starred')
      return
    }
    for (const m of unstarred) {
      onStarMessage?.(m.id, true)
    }
    toast.success(`Starred ${unstarred.length} message${unstarred.length === 1 ? '' : 's'}`)
  }

  async function copySelected() {
    const texts = selectedMessages.map((m) => {
      const prefix = m.sender && m.sender !== 'You' ? `${m.sender}: ` : ''
      return prefix + (m.body || '')
    })
    try {
      await navigator.clipboard.writeText(texts.join('\n'))
      toast.success(`${selectedMessages.length} messages copied`)
    } catch {
      toast.error('Could not copy')
    }
  }

  async function executeDelete() {
    if (selectedCount === 0) return
    setDeleteBusy(true)
    try {
      const res = await fetch(`/api/chats/${chatId}/messages/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Delete failed')
      setDetail((d) =>
        d
          ? { ...d, messages: d.messages.filter((m) => !selectedIds.has(m.id)) }
          : d
      )
      toast.success(
        data.deleted === 1
          ? 'Message deleted for everyone'
          : `${data.deleted} messages deleted`
      )
      setSelectedIds(new Set())
      onChatChanged?.()
    } catch {
      toast.error('Could not delete messages')
    } finally {
      setDeleteBusy(false)
      setDeleteConfirm(false)
    }
  }

  function openEdit(msg: ChatMessage) {
    setEditing(msg)
    setEditBody(msg.body)
  }

  async function saveEdit() {
    if (!editing || !editBody.trim() || editSaving) return
    setEditSaving(true)
    try {
      const res = await fetch(`/api/messages/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: editBody.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      const newBody = data.message.body as string
      setDetail((d) =>
        d
          ? {
              ...d,
              messages: d.messages.map((m) =>
                m.id === editing.id ? { ...m, body: newBody, edited: true } : m
              ),
            }
          : d
      )
      toast.success('Message edited')
      setEditing(null)
      setSelectedIds(new Set())
      onChatChanged?.()
    } catch {
      toast.error('Could not edit message')
    } finally {
      setEditSaving(false)
    }
  }

  function handleSent(msg: ChatMessage) {
    setDetail((d) => (d ? { ...d, messages: [...d.messages, msg] } : d))
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    })
    onChatChanged?.()
  }

  async function createPoll(
    question: string,
    options: string[]
  ): Promise<boolean> {
    setPollCreating(true)
    try {
      const res = await fetch(`/api/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'poll', body: question, pollOptions: options }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      handleSent(data.message as ChatMessage)
      toast.success('Poll created — tap an option to vote')
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create poll')
      return false
    } finally {
      setPollCreating(false)
    }
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

  /** Smooth-scroll to the first message of `d` (expanding the window if needed). */
  function jumpToDate(d: Date) {
    const targetKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const idx = messages.findIndex((m) => dayKey(m.ts) === targetKey)
    if (idx === -1) {
      toast.info(
        `No messages on ${d.toLocaleDateString('en-GB', {
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

  const starredCount = useMemo(
    () => messages.reduce((s, m) => s + (m.starred ? 1 : 0), 0),
    [messages]
  )

  /* -------------------------- Pinned messages (#11) -------------------------- */
  const pinnedMessages = useMemo(
    () => messages.filter((m) => m.pinned),
    [messages]
  )
  const safePinIdx =
    pinnedMessages.length > 0 ? Math.min(pinIdx, pinnedMessages.length - 1) : 0
  const currentPinned = pinnedMessages[safePinIdx] ?? null

  /* ------------------- Simulated presence (#9, non-group) ------------------- */
  const presence = useMemo(() => {
    if (!detail || isSavedChat || detail.chat.isGroup || nowMs === null) return null
    // Deterministic online windows: minute-of-epoch + chat id hash
    const online = ((Math.floor(nowMs / 60000) * 31 + hashStr(detail.chat.id)) % 97) < 18
    if (online) return { online: true, text: 'online' }
    const last = detail.chat.lastAt ? new Date(detail.chat.lastAt) : null
    let text = 'last seen recently'
    if (last && !Number.isNaN(last.getTime())) {
      const now = new Date(nowMs)
      const sameDay =
        last.getFullYear() === now.getFullYear() &&
        last.getMonth() === now.getMonth() &&
        last.getDate() === now.getDate()
      text = sameDay
        ? `last seen today at ${hhmm(detail.chat.lastAt as string)}`
        : `last seen ${dmy(detail.chat.lastAt as string)}`
    }
    return { online: false, text }
  }, [detail, isSavedChat, nowMs])

  /* --------------------- Jump-to-date day counts (#4) ---------------------- */
  const chatDayCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of messages) {
      const k = dayKey(m.ts)
      map.set(k, (map.get(k) ?? 0) + 1)
    }
    return map
  }, [messages])
  const chatPeakDay = useMemo(() => {
    let best: { key: string; count: number } | null = null
    for (const [key, count] of chatDayCounts) {
      if (!best || count > best.count) best = { key, count }
    }
    return best
  }, [chatDayCounts])
  const countedDayButton = useMemo(() => makeDayButton(chatDayCounts), [chatDayCounts])

  const chatDaySet = useMemo(() => {
    const s = new Set<string>()
    for (const m of messages) s.add(dayKey(m.ts))
    return s
  }, [messages])
  const firstMsgDay = messages.length ? new Date(messages[0].ts) : null
  const lastMsgDay = messages.length
    ? new Date(messages[messages.length - 1].ts)
    : null

  /** Shared calendar body for the jump-to-date popovers (desktop + mobile). */
  const jumpPopoverBody = (
    <div className="flex flex-col items-center">
      <Calendar
        mode="single"
        selected={jumpDate}
        onSelect={(d) => {
          if (!d) return
          setJumpDate(d)
          jumpToDate(d)
        }}
        defaultMonth={
          lastMsgDay
            ? new Date(lastMsgDay.getFullYear(), lastMsgDay.getMonth(), 1)
            : undefined
        }
        startMonth={
          firstMsgDay
            ? new Date(firstMsgDay.getFullYear(), firstMsgDay.getMonth(), 1)
            : undefined
        }
        endMonth={
          lastMsgDay
            ? new Date(lastMsgDay.getFullYear(), lastMsgDay.getMonth(), 1)
            : undefined
        }
        disabled={
          firstMsgDay && lastMsgDay
            ? [
                { before: firstMsgDay, after: lastMsgDay },
                (date: Date) =>
                  !chatDaySet.has(
                    `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
                  ),
              ]
            : undefined
        }
        modifiers={{
          hasMsg: (date: Date) =>
            chatDaySet.has(
              `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
            ),
        }}
        components={{ DayButton: countedDayButton }}
        modifiersClassNames={{
          hasMsg:
            'relative after:absolute after:bottom-[3px] after:left-1/2 after:h-[3px] after:w-[3px] after:-translate-x-1/2 after:rounded-full after:bg-(--wa-accent) after:content-[""]',
        }}
        className="w-[272px] rounded-xl p-2 [&_[data-selected-single=true]]:bg-(--wa-accent) [&_[data-selected-single=true]]:text-white"
      />
      {/* Per-day activity footer (#4): active days + busiest day */}
      {chatPeakDay && chatDayCounts.size > 0 && (
        <p className="w-full px-3 pb-1.5 text-center text-[11px] leading-snug text-(--wa-text-2)">
          {chatDayCounts.size} active day{chatDayCounts.size === 1 ? '' : 's'} ·{' '}
          {chatPeakDay.count} message{chatPeakDay.count === 1 ? '' : 's'} on the
          busiest day ({labelFromDayKey(chatPeakDay.key)})
        </p>
      )}
      <div className="flex w-full gap-1.5 border-t px-2 pb-1.5 pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 flex-1 gap-1 rounded-full text-[12px] text-(--wa-text-2)"
          disabled={!messages.length}
          onClick={() => {
            jumpToMessageId(messages[0].id)
            setJumpOpen(false)
          }}
        >
          <ArrowUpToLine className="h-3.5 w-3.5" /> Oldest
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 flex-1 gap-1 rounded-full text-[12px] text-(--wa-text-2)"
          disabled={!messages.length}
          onClick={() => {
            jumpToMessageId(messages[messages.length - 1].id)
            setJumpOpen(false)
          }}
        >
          <ArrowDownToLine className="h-3.5 w-3.5" /> Latest
        </Button>
      </div>
    </div>
  )

  /** Cycle the search-match cursor (1 = next, -1 = previous) and jump. */
  function goToMatch(dir: 1 | -1) {
    if (!filtered || filtered.length === 0) return
    const next = (safeMatchIdx + dir + filtered.length) % filtered.length
    setMatchIdx(next)
    jumpToMessageId(filtered[next].id)
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-(--wa-chat-bg)">
        <Loader2 className="h-8 w-8 animate-spin text-(--wa-accent)" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="relative hidden flex-1 flex-col items-center justify-center bg-(--wa-deep) px-6 text-center text-white/[0.08] md:flex">
        <DoodleBackground />
        <div className="anim-fade-up relative z-10 mx-auto max-w-md">
          <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-white/10">
            <svg viewBox="0 0 24 24" className="h-12 w-12 text-white/60" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="2" y="4" width="20" height="13" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          </div>
          <h2 className="text-[32px] font-light text-(--wa-text)">WhatsApp Viewer</h2>
          <p className="mt-4 text-sm leading-relaxed text-(--wa-text-2)">
            Import a WhatsApp chat export (.zip or .txt) to read your conversations
            here. Everything is stored locally in your own database — nothing leaves
            this device.
          </p>
          <p className="mt-6 text-[12px] uppercase tracking-wide text-(--wa-text-2)">
            Select a chat on the left to start reading
          </p>
        </div>
      </div>
    )
  }

  const { chat } = detail
  const subtitle = isSavedChat
    ? 'Your personal space — notes, links & media'
    : chat.isGroup
      ? `${countParticipants(messages)} participants`
      : presence
        ? presence.text
        : 'click here for chat info'

  return (
    <div className="anim-fade-up relative flex min-h-0 flex-1 flex-col">
      {/* Wallpaper stack (base color/gradient → photo → doodles → dim overlay).
          The whole stack gets the contrast/brightness/saturation filter so
          bubbles and text stay untouched. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={wallpaperFilter ? { filter: wallpaperFilter } : undefined}
      >
        {/* Base color (user pick or default) + optional pattern overlay */}
        {!wpIsPreset && (
          <div className="wp-base absolute inset-0" style={wallpaperBaseStyle} />
        )}
        {!wpIsPreset && wallpaperCfg.pattern && (
          <div
            className={cn('wpat-bg absolute inset-0', `wpat-${wallpaperCfg.pattern}`)}
          />
        )}
        {/* Pre-built design (complete look) */}
        {wpIsPreset && (
          <div
            className={cn(
              'absolute inset-0 transition-[background-color,background-image] duration-300',
              wallpaperPreset.bg
            )}
          />
        )}
        {wallpaperIsPhoto && wallpaperCfg.photo && (
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url("${wallpaperCfg.photo}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter:
                wallpaperCfg.blur > 0 ? `blur(${wallpaperCfg.blur}px)` : undefined,
              transform: wallpaperCfg.blur > 0 ? 'scale(1.08)' : undefined,
            }}
          />
        )}
        {wpIsPreset && !wallpaperIsPhoto && wallpaperPreset.doodle && (
          <div className={cn('absolute inset-0', wallpaperPreset.doodle)}>
            <DoodleBackground />
          </div>
        )}
        {wallpaperCfg.dim > 0 && (
          <div
            className="absolute inset-0 bg-black transition-opacity duration-300"
            style={{ opacity: wallpaperCfg.dim }}
          />
        )}
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center gap-3 border-l border-(--wa-line) bg-(--wa-panel-2) px-3 py-2 dark:bg-(--wa-panel-2)">
        <Button
          variant="ghost"
          size="icon"
          className="wa-iconbtn h-8 w-8 md:hidden"
          onClick={onBack}
          aria-label="Back to chats"
        >
          <ArrowLeft className="h-5 w-5 text-(--wa-text-2)" />
        </Button>
        <button
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          onClick={() => setInfoOpen(true)}
        >
          {isSavedChat ? (
            <SavedAvatar size={40} />
          ) : (
            <Avatar name={chat.title} size={40} />
          )}
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-medium leading-tight text-(--wa-text)">
              {chat.title}
            </h2>
            <p
              className="truncate text-[12.5px] text-(--wa-text-2)"
              title={
                presence
                  ? "Simulated presence — exports don't carry live status"
                  : undefined
              }
            >
              {presence?.online && (
                <span className="relative mr-1.5 inline-flex h-2 w-2 align-middle" aria-hidden>
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[#25d366] opacity-60 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#25d366]" />
                </span>
              )}
              {subtitle}
            </p>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'wa-iconbtn h-9 w-9',
              editMode &&
                'bg-(--wa-accent)/15 text-(--wa-accent-strong) dark:text-(--wa-accent)'
            )}
            onClick={() => {
              if (editMode) {
                exitEditMode()
              } else {
                setEditMode(true)
                toast.info(
                  'Local editing on — tap messages to select, or send new ones below',
                  { duration: 3500 }
                )
              }
            }}
            aria-label="Edit messages"
            aria-pressed={editMode}
            title={editMode ? 'Turn off editing' : 'Edit messages (select, delete, edit, send)'}
          >
            <Pencil className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="wa-iconbtn h-9 w-9"
            onClick={() => setGalleryOpen(true)}
            aria-label="Media gallery"
            title="Media gallery"
          >
            <Images className="h-5 w-5 text-(--wa-text-2)" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="wa-iconbtn h-9 w-9"
            onClick={() => setSearchOpen((v) => !v)}
            aria-label="Search in chat"
            title="Search in chat"
          >
            <Search className="h-5 w-5 text-(--wa-text-2)" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="wa-iconbtn relative h-9 w-9"
            onClick={() => setStarredOpen(true)}
            aria-label="Starred messages"
            title="Starred messages"
          >
            <Star
              className={cn(
                'h-5 w-5',
                starredCount > 0
                  ? 'fill-[#f2a33c] text-[#f2a33c]'
                  : 'text-(--wa-text-2)'
              )}
            />
            {starredCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#f2a33c] px-1 text-[9px] font-bold leading-none text-white shadow">
                {starredCount > 99 ? '99+' : starredCount}
              </span>
            )}
          </Button>
          {!isNarrow && (
            <Popover open={jumpOpen} onOpenChange={setJumpOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="wa-iconbtn h-9 w-9"
                  aria-label="Jump to date"
                  title="Jump to date"
                >
                  <CalendarDays className="h-5 w-5 text-(--wa-text-2)" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-auto p-0">
                {jumpPopoverBody}
              </PopoverContent>
            </Popover>
          )}
          <WallpaperPicker
            chatId={chatId}
            chatTitle={chat.title}
            open={wallpaperOpen}
            onOpenChange={setWallpaperOpen}
          >
            <Button
              variant="ghost"
              size="icon"
              className="wa-iconbtn h-9 w-9"
              aria-label="Chat wallpaper"
              title="Chat wallpaper & photo"
            >
              <Palette className="h-5 w-5 text-(--wa-text-2)" />
            </Button>
          </WallpaperPicker>
          {/* Export / print menu (#10): .txt, .zip (text + media), print/PDF */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="wa-iconbtn hidden h-9 w-9 lg:inline-flex"
                aria-label="Export or print chat"
                title="Export / print"
              >
                <Download className="h-5 w-5 text-(--wa-text-2)" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onClick={handleExport} className="gap-2">
                <FileText className="h-4 w-4 text-(--wa-text-2)" />
                Export as .txt
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportZip} className="gap-2">
                <FileArchive className="h-4 w-4 text-(--wa-text-2)" />
                Export .zip (text + media)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={openPrint} className="gap-2">
                <Printer className="h-4 w-4 text-(--wa-text-2)" />
                Print / Save as PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            className="wa-iconbtn hidden h-9 w-9 lg:inline-flex"
            onClick={() => setInfoOpen(true)}
            aria-label="Chat info"
            title="Chat info"
          >
            <Info className="h-5 w-5 text-(--wa-text-2)" />
          </Button>
          {!isSavedChat && (
            <Button
              variant="ghost"
              size="icon"
              className="wa-iconbtn h-9 w-9 shrink-0 hover:bg-rose-500/10"
              onClick={() => onDelete(chat.id)}
              disabled={deleting}
              aria-label="Delete chat"
            >
              <Trash2 className="h-5 w-5 text-rose-500/80" />
            </Button>
          )}
        </div>
      </header>

      {/* Pinned messages bar (#11) — WhatsApp-style strip under the header.
          Click jumps to the current pin; chevrons cycle when several are
          pinned; PinOff unpins the current one; X collapses the bar. */}
      {!pinsCollapsed && currentPinned && (
        <div className="wa-pins-bar relative z-10 flex items-center gap-1.5 border-t border-black/5 bg-(--wa-panel-2) px-3 py-1.5 dark:border-white/5 dark:bg-(--wa-panel-2)">
          <Pin className="h-4 w-4 shrink-0 text-(--wa-accent)" aria-hidden />
          <button
            type="button"
            onClick={() => jumpToMessageId(currentPinned.id)}
            className="flex min-w-0 flex-1 items-center rounded-md py-0.5 text-left"
            title="Jump to pinned message"
          >
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-semibold leading-tight text-(--wa-text)">
                {currentPinned.sender ?? 'WhatsApp'}
              </span>
              <span className="block truncate text-[12px] leading-tight text-(--wa-text-2)">
                {msgPreviewText(currentPinned)}
              </span>
            </span>
          </button>
          {pinnedMessages.length > 1 && (
            <span className="flex shrink-0 items-center gap-0.5">
              <span className="px-0.5 text-[11px] font-medium tabular-nums text-(--wa-text-2)">
                {safePinIdx + 1}/{pinnedMessages.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  setPinIdx((i) => (i - 1 + pinnedMessages.length) % pinnedMessages.length)
                }
                aria-label="Previous pinned message"
                title="Previous pinned message"
                className="flex h-6 w-6 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-black/10 hover:text-(--wa-text) dark:hover:bg-white/10"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPinIdx((i) => (i + 1) % pinnedMessages.length)}
                aria-label="Next pinned message"
                title="Next pinned message"
                className="flex h-6 w-6 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-black/10 hover:text-(--wa-text) dark:hover:bg-white/10"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={() => handlePinMessage(currentPinned)}
            aria-label="Unpin message"
            title="Unpin"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-black/10 hover:text-(--wa-text) dark:hover:bg-white/10"
          >
            <PinOff className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPinsCollapsed(true)}
            aria-label="Hide pinned messages bar"
            title="Hide pinned messages"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-black/10 hover:text-(--wa-text) dark:hover:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* In-chat search (text + optional date range) */}
      {searchOpen && (
        <div className="relative z-10 border-b border-black/10 bg-(--wa-panel-2) px-3 py-2 dark:bg-(--wa-panel-2)">
          <div className="flex items-center gap-2">
            <Input
              suppressHydrationWarning
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  goToMatch(e.shiftKey ? -1 : 1)
                }
              }}
              placeholder={
                regexMode ? 'Regular expression...' : `Search in ${chat.title}...`
              }
              className={cn(
                'h-9 min-w-0 flex-1 rounded-lg bg-(--wa-in) text-[14px] dark:bg-(--wa-row-active) dark:text-(--wa-text) dark:placeholder:text-(--wa-text-2)',
                regexInvalid && 'ring-1 ring-rose-400 dark:ring-rose-500/60'
              )}
            />
            {/* Match navigation (query only) */}
            {query.trim() && matchCount > 0 && (
              <span className="flex h-9 shrink-0 items-center gap-0.5 rounded-full bg-black/5 px-1 dark:bg-white/10">
                <span className="px-1.5 text-[11.5px] font-medium tabular-nums text-(--wa-text-2)">
                  {safeMatchIdx + 1}/{matchCount}
                </span>
                <button
                  type="button"
                  onClick={() => goToMatch(-1)}
                  aria-label="Previous match"
                  title="Previous match (Shift+Enter)"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-black/10 hover:text-(--wa-text) dark:text-(--wa-text-2) dark:hover:bg-white/10 dark:hover:text-(--wa-text)"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => goToMatch(1)}
                  aria-label="Next match"
                  title="Next match (Enter)"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-black/10 hover:text-(--wa-text) dark:text-(--wa-text-2) dark:hover:bg-white/10 dark:hover:text-(--wa-text)"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
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
                setStarredOnly(false)
                setRegexMode(false)
              }}
              aria-label="Close search"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {/* Filter chips row (wraps on narrow screens) */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setStarredOnly((v) => !v)}
              aria-pressed={starredOnly}
              title="Show starred messages only"
              className={cn(
                'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors',
                starredOnly
                  ? 'bg-[#f2a33c]/20 text-[#a16a08] ring-1 ring-[#f2a33c]/50 dark:bg-[#f2a33c]/25 dark:text-[#f5c877]'
                  : 'bg-black/5 text-(--wa-text-2) hover:bg-black/10 dark:bg-white/5 dark:text-(--wa-text-2) dark:hover:bg-white/10'
              )}
            >
              <Star
                className={cn(
                  'h-3.5 w-3.5 transition-colors',
                  starredOnly && 'fill-current'
                )}
              />
              Starred
            </button>
            <button
              type="button"
              onClick={() => setRegexMode((v) => !v)}
              aria-pressed={regexMode}
              title="Treat the query as a regular expression"
              className={cn(
                'flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium transition-colors',
                regexMode
                  ? 'bg-(--wa-accent)/15 text-(--wa-accent-strong) ring-1 ring-(--wa-accent)/40 dark:bg-(--wa-accent)/25 dark:text-(--wa-accent)'
                  : 'bg-black/5 text-(--wa-text-2) hover:bg-black/10 dark:bg-white/5 dark:text-(--wa-text-2) dark:hover:bg-white/10'
              )}
            >
              <Regex className="h-3.5 w-3.5" />
              .*
            </button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-9 w-9 shrink-0',
                hasDateFilter &&
                  'bg-(--wa-accent)/15 text-(--wa-accent-strong) dark:bg-(--wa-accent)/25 dark:text-(--wa-accent)'
              )}
              onClick={() => setDateFilterOpen((v) => !v)}
              aria-label="Toggle date range filter"
              title="Filter by date range"
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
            {isNarrow && (
              <Popover open={jumpOpen} onOpenChange={setJumpOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    aria-label="Jump to date"
                    title="Jump to date"
                  >
                    <CalendarDays className="h-4 w-4 text-(--wa-text-2)" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-auto p-0">
                  {jumpPopoverBody}
                </PopoverContent>
              </Popover>
            )}
            {(query || hasDateFilter || starredOnly) && (
              <span className="ml-auto shrink-0 text-[12px] text-(--wa-text-2)">
                {filtered?.length ?? 0} result{(filtered?.length ?? 0) === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {regexInvalid && (
            <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-medium text-rose-600 dark:text-rose-400">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              Invalid regular expression — fix the pattern to search again
            </p>
          )}
          {dateFilterOpen && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] font-medium uppercase tracking-wide text-(--wa-text-2)">
                From
              </span>
              <Input
                suppressHydrationWarning
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-8 w-[150px] rounded-lg bg-(--wa-in) text-[13px] [color-scheme:light] dark:bg-(--wa-row-active) dark:text-(--wa-text) dark:[color-scheme:dark]"
              />
              <span className="text-[11.5px] font-medium uppercase tracking-wide text-(--wa-text-2)">
                To
              </span>
              <Input
                suppressHydrationWarning
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
                className="h-8 w-[150px] rounded-lg bg-(--wa-in) text-[13px] [color-scheme:light] dark:bg-(--wa-row-active) dark:text-(--wa-text) dark:[color-scheme:dark]"
              />
              {hasDateFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 rounded-full px-2.5 text-[12px] text-(--wa-text-2) hover:text-rose-500 dark:text-(--wa-text-2)"
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
        style={{ '--wa-msg-size': `${msgFontPx}px` } as React.CSSProperties}
        className="wa-scroll relative z-[1] flex-1 overflow-y-auto overflow-x-hidden py-3"
        role="log"
        aria-label={`Messages in ${chat.title}`}
      >
        {!filtered && messages.length > visibleCount && (
          <div className="mb-3 flex justify-center">
            <Button
              size="sm"
              variant="secondary"
              className="rounded-full bg-(--wa-in) text-[12.5px] font-medium shadow-md hover:bg-(--wa-in) dark:bg-(--wa-panel-2) dark:text-(--wa-text)"
              onClick={handleLoadEarlier}
            >
              Load earlier messages
            </Button>
          </div>
        )}

        {filtered && filtered.length === 0 && (
          <div className="mt-10 text-center text-[13px] text-(--wa-text-2)">
            {query ? (
              regexInvalid ? (
                'Invalid regular expression — fix the pattern in the search bar'
              ) : (
                <>
                  No messages match &quot;{query}&quot;
                  {hasDateFilter ? ' in the selected date range' : ''}
                  {starredOnly ? ' among starred' : ''}
                </>
              )
            ) : starredOnly ? (
              hasDateFilter ? (
                'No starred messages in the selected date range'
              ) : (
                'No starred messages here yet'
              )
            ) : (
              'No messages in the selected date range'
            )}
          </div>
        )}

        {grouped.map((item) => {
          if (item.kind === 'date') {
            return (
              <div key={item.key} className="my-3 flex justify-center">
                <span className="anim-pop rounded-lg bg-(--wa-in)/95 px-3 py-1 text-[12.2px] font-medium uppercase tracking-wide text-(--wa-text-2) shadow-[0_1px_1px_rgba(11,20,26,0.12)] backdrop-blur-sm dark:bg-(--wa-panel-2)/95 dark:text-(--wa-text-2)">
                  {item.label}
                </span>
              </div>
            )
          }
          if (item.kind === 'system') {
            return (
              <div
                key={item.key}
                data-mid={item.id}
                className={cn(
                  'my-2 flex justify-center rounded-lg px-8 transition-colors',
                  jumpedId === item.id &&
                    'bg-amber-200/50 ring-1 ring-amber-400/60 dark:bg-amber-500/20'
                )}
              >
                <span className="flex max-w-lg items-center justify-center gap-1.5 rounded-md bg-[#ffeecd] px-3 py-1.5 text-center text-[12.5px] leading-snug text-(--wa-text-2) shadow-sm dark:bg-(--wa-panel-2) dark:text-[#ffd279]">
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
                'animate-in fade-in slide-in-from-bottom-1 mt-0.5 rounded-lg duration-300 transition-colors',
                item.showTail && 'mt-2.5',
                jumpedId === item.msg.id &&
                  'bg-amber-200/50 ring-1 ring-amber-400/60 dark:bg-amber-500/20',
                editMode &&
                  selectedIds.has(item.msg.id) &&
                  'bg-(--wa-accent)/[0.06]'
              )}
            >
              <MessageBubble
                msg={item.msg}
                chatId={chatId}
                isGroup={chat.isGroup}
                showTail={item.showTail}
                showAvatar={item.showAvatar}
                onToggleStar={editMode ? undefined : handleToggleStar}
                onReact={editMode ? undefined : handleReact}
                onPinMessage={editMode ? undefined : handlePinMessage}
                onTranslate={editMode ? undefined : handleTranslate}
                highlight={query.trim() || undefined}
                highlightRegex={regexMode && !!query.trim()}
                selectMode={editMode}
                selected={selectedIds.has(item.msg.id)}
                anySelected={selectedCount > 0}
                onToggleSelect={toggleSelect}
                onForwardSaved={editMode ? undefined : forwardOne}
                onEditMessage={editMode ? undefined : openEdit}
              />
            </div>
          )
        })}
      </div>

      {/* Scroll-to-bottom FAB (WhatsApp style) — springs in/out of view */}
      <button
        onClick={handleScrollToBottom}
        aria-label="Scroll to latest messages"
        aria-hidden={!showFab || searchOpen}
        tabIndex={showFab && !searchOpen ? 0 : -1}
        className={cn(
          'absolute bottom-[68px] right-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-(--wa-in) text-(--wa-text-2) shadow-[0_1px_3px_rgba(11,20,26,0.3)] transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] hover:scale-110 active:scale-90 dark:bg-(--wa-panel-2) dark:text-(--wa-text-2)',
          showFab && !searchOpen
            ? 'translate-y-0 scale-100 opacity-100'
            : 'pointer-events-none translate-y-4 scale-50 opacity-0'
        )}
      >
        <ChevronDown className="h-6 w-6" />
      </button>

      {/* Selection toolbar (edit mode with active selection) */}
      {editMode && selectedCount > 0 ? (
        <div className="animate-in fade-in slide-in-from-bottom-2 relative z-10 flex items-center gap-1 border-t border-black/5 bg-(--wa-panel-2) px-3 py-2 duration-200 dark:bg-(--wa-panel-2)">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => setSelectedIds(new Set())}
            aria-label="Clear selection"
            title="Clear selection"
          >
            <X className="h-5 w-5 text-(--wa-text-2)" />
          </Button>
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-(--wa-text)">
            {selectedCount} selected
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={selectAll}
            aria-label="Select all messages"
            title="Select all messages"
          >
            <ListChecks className="h-5 w-5 text-(--wa-text-2)" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-9 w-9 shrink-0 sm:inline-flex"
            onClick={copySelected}
            aria-label="Copy selected"
            title="Copy selected messages"
          >
            <Copy className="h-5 w-5 text-(--wa-text-2)" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => void forwardToSaved(selectedMessages)}
            aria-label="Forward to Saved Messages"
            title="Forward to Saved Messages"
          >
            <BookmarkPlus className="h-5 w-5 text-(--wa-accent)" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={starSelected}
            aria-label="Star selected"
            title="Star selected"
          >
            <Star className="h-5 w-5 text-[#f2a33c]" />
          </Button>
          {singleEditable && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={() => singleSelected && openEdit(singleSelected)}
              aria-label="Edit message"
              title="Edit message"
            >
              <Pencil className="h-5 w-5 text-(--wa-text-2)" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 hover:bg-rose-500/10"
            onClick={() => setDeleteConfirm(true)}
            aria-label="Delete selected"
            title="Delete for everyone"
          >
            <Trash2 className="h-5 w-5 text-rose-500/90" />
          </Button>
        </div>
      ) : editMode ? (
        /* Full local composer (edit mode, nothing selected) */
        <Composer
          chatId={chatId}
          onSent={handleSent}
          onOpenPoll={() => setPollOpen(true)}
        />
      ) : (
        /* Read-only notice (mimics the WhatsApp composer) */
        <div className="relative z-10 bg-(--wa-panel-2) px-3 py-2.5 dark:bg-(--wa-panel-2)">
          <div className="flex items-center justify-center gap-2 rounded-lg bg-(--wa-text-2)/10 px-4 py-2.5 text-[13px] text-(--wa-text-2) dark:bg-white/5 dark:text-(--wa-text-2)">
            <Lock className="h-3.5 w-3.5" />
            Read-only — tap the pencil to edit, select &amp; send
          </div>
        </div>
      )}

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

      {/* Starred messages list */}
      <StarredMessages
        open={starredOpen}
        onOpenChange={setStarredOpen}
        chatId={chatId}
        chatTitle={chat.title}
        isGroup={chat.isGroup}
        onJumpToMessage={jumpToMessageId}
        onUnstar={(id) => onStarMessage?.(id, false)}
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

      {/* Create poll (local editing) */}
      <PollDialog
        open={pollOpen}
        onOpenChange={setPollOpen}
        onCreate={createPoll}
        creating={pollCreating}
      />

      {/* Edit message text (local editing) */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit message</DialogTitle>
            <DialogDescription>
              Only the text can be changed locally — the message will show an
              “edited” mark.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            suppressHydrationWarning
            autoFocus
            value={editBody}
            rows={4}
            maxLength={8000}
            onChange={(e) => setEditBody(e.target.value)}
            className="resize-none text-[14px]"
            aria-label="Message text"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void saveEdit()
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              className="rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
              disabled={editSaving || !editBody.trim()}
              onClick={() => void saveEdit()}
            >
              {editSaving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete selected confirmation */}
      <AlertDialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedCount === 1 ? 'message' : `${selectedCount} messages`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will be removed from this viewer for everyone, including any
              attached media. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={(e) => {
                e.preventDefault()
                void executeDelete()
              }}
              disabled={deleteBusy}
            >
              {deleteBusy ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AI message tools (translate / explain) — #13 */}
      <AIToolsDialog
        open={!!aiMsg}
        message={aiMsg}
        onOpenChange={(v) => {
          if (!v) setAiMsg(null)
        }}
      />

      {/* Print / Save-as-PDF preview (#10) — plain black-on-white transcript,
          ignores wallpaper + dark mode. Screen = preview sheet; @media print
          rules in chat-extras.css isolate this subtree for printing. */}
      {printReady && (
        <div className="print-overlay" role="dialog" aria-label="Print preview">
          <div className="mx-auto max-w-[820px] px-8 py-10">
            <header className="mb-5 border-b-2 border-black pb-4">
              <h1 className="text-[22px] font-bold leading-tight">{chat.title}</h1>
              <p className="mt-1 text-[12px] text-neutral-600">
                {chat.isGroup ? 'Group chat' : 'Direct chat'} · {messages.length}{' '}
                message{messages.length === 1 ? '' : 's'}
                {chat.firstAt ? ` · ${dmy(chat.firstAt)}` : ''}
                {chat.lastAt ? ` – ${dmy(chat.lastAt)}` : ''}
              </p>
              <p className="mt-0.5 text-[11px] text-neutral-500">
                Exported {new Date().toLocaleString('en-GB')}
              </p>
            </header>
            {messages.map((m) => {
              const isSystem = m.type === 'system' || !m.sender
              return (
                <div
                  key={m.id}
                  className="flex gap-2 border-b border-neutral-200 py-1 text-[12.5px] leading-snug"
                >
                  <span className="w-[54px] shrink-0 tabular-nums text-neutral-500">
                    [{hhmm(m.ts)}]
                  </span>
                  {isSystem ? (
                    <span className="italic text-neutral-600">
                      {m.body || '[system]'}
                    </span>
                  ) : (
                    <span className="min-w-0 break-words">
                      <span className="font-semibold">{m.sender}:</span>{' '}
                      {printBody(m)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <button
            type="button"
            className="print-close-btn"
            onClick={() => setPrintReady(false)}
          >
            Close preview
          </button>
        </div>
      )}
    </div>
  )
}

function countParticipants(messages: ChatMessage[]): number {
  const set = new Set<string>()
  for (const m of messages) if (m.sender) set.add(m.sender)
  return set.size
}
