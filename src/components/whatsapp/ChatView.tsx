'use client'

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
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Images,
  ListChecks,
  Loader2,
  Lock,
  Palette,
  Pencil,
  Regex,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  TriangleAlert,
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
import { DoodleBackground } from './icons'
import { SAVED_CHAT_ID, type ChatDetail, type ChatMessage } from './types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Calendar } from '@/components/ui/calendar'
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

/* ---------- Chat wallpaper (per chat, falls back to the app default) ---------- */

const WALLPAPERS = {
  doodle: {
    label: 'Classic',
    bg: 'bg-(--wa-chat-bg)',
    doodle: 'text-(--wa-doodle)',
    swatch: 'bg-(--wa-chat-bg)',
    swatchDot: 'bg-black/20 dark:bg-white/20',
  },
  plain: {
    label: 'Plain',
    bg: 'bg-(--wa-chat-bg)',
    doodle: null,
    swatch: 'bg-(--wa-chat-bg)',
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

const GLOBAL_WALLPAPER_KEY = 'wa-viewer:wallpaper'

function subscribeWallpaper(cb: () => void) {
  window.addEventListener('wa-wallpaper', cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener('wa-wallpaper', cb)
    window.removeEventListener('storage', cb)
  }
}

/** Per-chat override first, then the app-wide default. */
function wallpaperKeyFor(chatId: string): string {
  try {
    return (
      localStorage.getItem(`wa-viewer:wallpaper:${chatId}`) ??
      localStorage.getItem(GLOBAL_WALLPAPER_KEY) ??
      'doodle'
    )
  } catch {
    return 'doodle'
  }
}

function hasWallpaperOverride(chatId: string): boolean {
  try {
    return !!localStorage.getItem(`wa-viewer:wallpaper:${chatId}`)
  } catch {
    return false
  }
}

/** `chatId` empty = set the app-wide default. */
function setStoredWallpaper(chatId: string, w: string) {
  try {
    localStorage.setItem(
      chatId ? `wa-viewer:wallpaper:${chatId}` : GLOBAL_WALLPAPER_KEY,
      w
    )
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event('wa-wallpaper'))
}

function resetStoredWallpaper(chatId: string) {
  try {
    localStorage.removeItem(`wa-viewer:wallpaper:${chatId}`)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('wa-wallpaper'))
}

function useWallpaper(chatId: string): {
  key: WallpaperKey
  isCustom: boolean
} {
  const getSnapshot = useCallback(() => wallpaperKeyFor(chatId), [chatId])
  const getCustom = useCallback(() => hasWallpaperOverride(chatId), [chatId])
  const key = useSyncExternalStore(
    subscribeWallpaper,
    getSnapshot,
    () => 'doodle'
  ) as WallpaperKey
  const isCustom = useSyncExternalStore(subscribeWallpaper, getCustom, () => false)
  return { key, isCustom }
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
  const { key: wallpaperKey, isCustom: wallpaperIsCustom } = useWallpaper(chatId)
  const wallpaper = WALLPAPERS[wallpaperKey] ?? WALLPAPERS.doodle
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

  function selectAllVisible() {
    setSelectedIds(
      new Set(messages.filter((m) => m.sender || m.type === 'poll').map((m) => m.id))
    )
  }

  /** Forward one or many messages into Saved Messages. */
  async function forwardToSaved(targets: ChatMessage[]) {
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
        modifiersClassNames={{
          hasMsg:
            'relative after:absolute after:bottom-[3px] after:left-1/2 after:h-[3px] after:w-[3px] after:-translate-x-1/2 after:rounded-full after:bg-(--wa-accent) after:content-[""]',
        }}
        className="w-[272px] rounded-xl p-2 [&_[data-selected-single=true]]:bg-(--wa-accent) [&_[data-selected-single=true]]:text-white"
      />
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
        <div className="relative z-10 max-w-md">
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
      <header className="relative z-10 flex items-center gap-3 border-l border-(--wa-line) bg-(--wa-panel-2) px-3 py-2 dark:bg-(--wa-panel-2)">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 md:hidden"
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
            <p className="truncate text-[12.5px] text-(--wa-text-2)">
              {subtitle}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-9 w-9',
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
            className="h-9 w-9"
            onClick={() => setGalleryOpen(true)}
            aria-label="Media gallery"
            title="Media gallery"
          >
            <Images className="h-5 w-5 text-(--wa-text-2)" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setSearchOpen((v) => !v)}
            aria-label="Search in chat"
            title="Search in chat"
          >
            <Search className="h-5 w-5 text-(--wa-text-2)" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9"
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
                  className="h-9 w-9"
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
          <Popover open={wallpaperOpen} onOpenChange={setWallpaperOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hidden h-9 w-9 md:inline-flex"
                aria-label="Chat wallpaper"
                title="Chat wallpaper"
              >
                <Palette className="h-5 w-5 text-(--wa-text-2)" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-3">
              <div className="mb-0.5 flex items-center justify-between">
                <p className="text-[13px] font-medium text-(--wa-text)">
                  Wallpaper for this chat
                </p>
                {wallpaperIsCustom && (
                  <span className="rounded-full bg-(--wa-accent)/15 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-(--wa-accent-strong)">
                    Custom
                  </span>
                )}
              </div>
              <p className="mb-2 text-[11px] leading-snug text-(--wa-text-2)">
                Applies only to {chat.title} — other chats keep the default.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(WALLPAPERS) as WallpaperKey[]).map((key) => {
                  const w = WALLPAPERS[key]
                  const active = wallpaperKey === key
                  return (
                    <button
                      key={key}
                      onClick={() => setStoredWallpaper(chatId, key)}
                      aria-pressed={active}
                      className={cn(
                        'group flex flex-col items-center gap-1.5 rounded-lg p-2 transition-colors',
                        active
                          ? 'bg-(--wa-accent)/10 ring-1 ring-(--wa-accent)'
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
                            <Check className="h-4 w-4 text-(--wa-accent) drop-shadow" />
                          </span>
                        )}
                      </span>
                      <span className="text-[11.5px] font-medium text-(--wa-text)">
                        {w.label}
                      </span>
                    </button>
                  )
                })}
              </div>
              {wallpaperIsCustom && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-7 w-full gap-1 rounded-full text-[12px] text-(--wa-text-2) hover:text-rose-500 dark:text-(--wa-text-2)"
                  onClick={() => resetStoredWallpaper(chatId)}
                >
                  <RotateCcw className="h-3 w-3" /> Use app default
                </Button>
              )}
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
            <Download className="h-5 w-5 text-(--wa-text-2)" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-9 w-9 md:inline-flex"
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
              className="h-9 w-9 hover:bg-rose-500/10"
              onClick={() => onDelete(chat.id)}
              disabled={deleting}
              aria-label="Delete chat"
            >
              <Trash2 className="h-5 w-5 text-rose-500/80" />
            </Button>
          )}
        </div>
      </header>

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
        className="wa-scroll relative z-[1] flex-1 overflow-y-auto py-3"
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
              <div key={item.key} className="animate-in fade-in my-3 flex justify-center duration-300">
                <span className="rounded-lg bg-(--wa-in)/95 px-3 py-1 text-[12.2px] font-medium uppercase tracking-wide text-(--wa-text-2) shadow-[0_1px_1px_rgba(11,20,26,0.12)] backdrop-blur-sm dark:bg-(--wa-panel-2)/95 dark:text-(--wa-text-2)">
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
                'animate-in fade-in mt-0.5 rounded-lg duration-300 transition-colors',
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

      {/* Scroll-to-bottom FAB (WhatsApp style) */}
      {showFab && !searchOpen && (
        <button
          onClick={handleScrollToBottom}
          aria-label="Scroll to latest messages"
          className="absolute bottom-[68px] right-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-(--wa-in) text-(--wa-text-2) shadow-[0_1px_3px_rgba(11,20,26,0.3)] transition-transform hover:scale-105 active:scale-95 dark:bg-(--wa-panel-2) dark:text-(--wa-text-2)"
        >
          <ChevronDown className="h-6 w-6" />
        </button>
      )}

      {/* Selection toolbar (edit mode with active selection) */}
      {editMode && selectedCount > 0 ? (
        <div className="relative z-10 flex items-center gap-1 border-t border-black/5 bg-(--wa-panel-2) px-3 py-2 dark:bg-(--wa-panel-2)">
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
    </div>
  )
}

function countParticipants(messages: ChatMessage[]): number {
  const set = new Set<string>()
  for (const m of messages) if (m.sender) set.add(m.sender)
  return set.size
}
