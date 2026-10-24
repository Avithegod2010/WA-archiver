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
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpToLine,
  Bot,
  BarChart3,
  BookOpenText,
  Bookmark,
  Braces,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  FileArchive,
  FileCode2,
  FileText,
  FileUp,
  FileType2,
  HeartHandshake,
  Forward,
  Hash,
  History,
  Images,
  Languages,
  ListChecks,
  Loader2,
  Lock,
  MoreVertical,
  Palette,
  PartyPopper,
  Pin,
  PinOff,
  Printer,
  Regex,
  Search,
  ShieldCheck,
  Sheet,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
  Info,
} from 'lucide-react'
import { Avatar, SavedAvatar, useChatAvatar } from './Avatar'
import { MessageBubble } from './MessageBubble'
import { ChatInfo } from './ChatInfo'
import { MediaGallery } from './MediaGallery'
import { StarredMessages } from './StarredMessages'
import { BookmarksDialog } from './BookmarksDialog'
import { YearInReviewDialog } from './YearInReviewDialog'
import { Composer } from './Composer'
import { ForwardDialog } from './ForwardDialog'
import { PollDialog } from './PollDialog'
import { WallpaperPicker } from './WallpaperPicker'
import { AIToolsDialog } from './AIToolsDialog'
import { MovieMode } from './MovieMode'
import { ReadingMode } from './ReadingMode'
import { RelationshipPanel } from './RelationshipPanel'
import { TimelineScrubber, type ScrubMonth } from './TimelineScrubber'
import { WordCloudDialog } from './WordCloudDialog'
import { TldrDialog } from './TldrDialog'
import { CHAT_THEME_EVENT, readChatAccent } from './chat-theme'
import { DoodleBackground } from './icons'
import {
  GLOBAL_WALLPAPER_KEY,
  presetByKey,
  readWallpaper,
  subscribeWallpaper,
  type WallpaperConfig,
} from './wallpaper'
import { SAVED_CHAT_ID, type ChatDetail, type ChatMessage } from './types'
import {
  AI_REPLY_TIMEOUT_MS,
  derivePersona,
  fetchAiReply,
  isDemoSource,
  pickPersonaReply,
  readAutoReplyEnabled,
  writeAutoReplyEnabled,
} from '@/lib/persona-engine'
import { runDeviceAi } from '@/lib/device-ai'
import { suggestReplies } from '@/lib/smart-replies'
import { chatCsvBlob } from '@/lib/export-csv'
import { exportChatPdf, pdfT } from '@/lib/export-pdf'
import { useT } from '@/lib/i18n'
import {
  buildWhatsAppText,
  safeFileTitle,
  type ExportMessage,
} from '@/lib/export-text'
import { verifyRoundTrip, type RoundTripReport } from '@/lib/export-verify'
import { recordMsgChange } from '@/lib/msg-changes'
import { ChangesPanelDialog } from './ChangesPanelDialog'
import { downloadBlob } from '@/lib/wordcloud-png'
import { useData, useMessageNormalizer } from './data-provider'

type SchedItem = {
  id: string
  body: string
  sender: string
  deliverAt: string
}
import { cn } from '@/lib/utils'
import {
  bookmarkFor,
  getBookmarksSnapshot,
  removeBookmark,
  saveBookmark,
  subscribeBookmarks,
  type BookmarkEntry,
} from '@/lib/bookmarks'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Calendar, CalendarDayButton } from '@/components/ui/calendar'
import type { DateRange } from 'react-day-picker'
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
  DropdownMenuLabel,
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
import { formatChatTime } from './display'

const PAGE_SIZE = 300
/** Must match the transports' MAX_MESSAGES cap (server route + local client). */
const MAX_RENDER_MESSAGES = 12000

/* ---------- 14-f: unread boundary (pre-open seen capture) ---------- */

/**
 * `wa-viewer:seen-chats` = Record<chatId, { lastAt: string; count: number }>
 * (chat-folders.ts contract): lastAt is the chat summary's lastAt — a FULL
 * ISO datetime (the ts of the newest message known to the chat list when the
 * chat was marked seen), count is chat.messageCount at that moment. Full
 * timestamp granularity, so the unread test is a millisecond comparison; no
 * date-only fallback is needed.
 */
const SEEN_STORAGE_KEY = 'wa-viewer:seen-chats'

/**
 * Raw snapshot of the seen map taken BEFORE the current chat-open write.
 *
 * WhatsAppApp.openChat() marks the chat seen (markChatSeen) in the same
 * synchronous block as the setDetail() that first renders the transcript.
 * React commits that render before ChatView's capture effect gets a chance
 * to read localStorage, so a naive read at capture time would already see
 * the POST-write value. To recover the pre-open watermark we snapshot the
 * raw string on every pointerdown/keydown in the CAPTURE phase (fires
 * before the click/keyboard handler that triggers openChat, while
 * markChatSeen itself only writes after the open fetch resolves), plus once
 * at module evaluation, which covers the restore-last-chat auto-open that
 * happens with no user input at all.
 */
let preOpenSeenRaw: string | null = null
if (typeof window !== 'undefined') {
  const snapshotSeen = () => {
    try {
      preOpenSeenRaw = window.localStorage.getItem(SEEN_STORAGE_KEY)
    } catch {
      /* storage unavailable — keep the previous snapshot */
    }
  }
  snapshotSeen()
  window.addEventListener('pointerdown', snapshotSeen, true)
  window.addEventListener('keydown', snapshotSeen, true)
}

type SeenEntryLike = { lastAt: string; count: number } | null

/** Parse the pre-open seen entry for one chat (never throws). */
function readPreOpenSeenEntry(chatId: string): SeenEntryLike {
  let raw = preOpenSeenRaw
  if (raw == null && typeof window !== 'undefined') {
    try {
      raw = window.localStorage.getItem(SEEN_STORAGE_KEY)
    } catch {
      raw = null
    }
  }
  if (!raw) return null
  try {
    const map = JSON.parse(raw) as Record<string, unknown> | null
    const e = map ? map[chatId] : null
    if (!e || typeof e !== 'object') return null
    const o = e as Record<string, unknown>
    const lastAt = typeof o.lastAt === 'string' ? o.lastAt : ''
    const count =
      typeof o.count === 'number' && Number.isFinite(o.count)
        ? Math.floor(o.count)
        : -1
    if (!lastAt && count < 0) return null
    return { lastAt, count }
  } catch {
    return null
  }
}

/**
 * First unread incoming message for a chat, given its PRE-OPEN seen entry.
 * A message is unread when its sender is not "You" (outgoing never counts),
 * it is not a system row, and it sits after the seen watermark:
 *  - primary rule: ts > entry.lastAt (both ISO datetimes from the same
 *    server clock — messages equal to or older than the watermark were seen);
 *  - when lastAt is ''/unparseable (chat was marked seen while empty) fall
 *    back to the ordinal rule: index >= entry.count (rows beyond the count
 *    that existed when it was last seen).
 * No seen entry at all (first-ever open of an imported chat) → no unread.
 */
function computeUnreadBoundary(
  entry: SeenEntryLike,
  messages: { id: string; ts: string; sender: string | null; type: string }[]
): { id: string } | null {
  if (!entry) return null
  const lastAtMs = Date.parse(entry.lastAt)
  const useTs = !Number.isNaN(lastAtMs)
  if (!useTs && entry.count < 0) return null
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (!m.sender || m.sender === 'You' || m.type === 'system') continue
    if (useTs) {
      const tsMs = Date.parse(m.ts)
      if (Number.isNaN(tsMs) || tsMs <= lastAtMs) continue
    } else if (i < entry.count) {
      continue
    }
    return { id: m.id }
  }
  return null
}

/**
 * Per-session record of how many messages each chat's transcript had when it
 * was last on screen. This is what makes RE-opens work: markChatSeen() writes
 * the chat LIST's lastAt, which stays stale until the next list refresh — so
 * on a second open within the same session the persisted seen entry cannot
 * distinguish "already displayed" from "arrived since". Anything beyond the
 * recorded count is new-to-me; the first incoming one anchors the divider.
 * (First open of a session falls back to the persisted seen entry instead.)
 */
const sessionDisplayedCount = new Map<string, number>()

/* ---------------- 10-i: link preview orchestration ---------------- */

type LinkPreviewData = NonNullable<ChatMessage['linkPreview']>

/** Robust URL finder for message bodies (same shape as the gallery extractor). */
const MESSAGE_URL_RE = /https?:\/\/[^\s<>"'`{}|\\^\[\]]+/i

/** First http(s) URL in a text body, with trailing punctuation trimmed. */
function firstUrlIn(text: string): string | null {
  const m = MESSAGE_URL_RE.exec(text)
  if (!m) return null
  let url = m[0].replace(/[.,;:!?'"”’)\]»>]+$/, '')
  // Balance trailing parentheses: keep them only when they open inside
  const opens = (url.match(/\(/g) ?? []).length
  const closes = (url.match(/\)/g) ?? []).length
  if (closes > opens) {
    const cut = url.lastIndexOf('(')
    if (cut > 0) url = url.slice(0, cut)
  }
  return url || null
}

/** Module-level per-URL cache so chat switches render previews instantly. */
const linkPreviewCache = new Map<string, LinkPreviewData | null>()
/** Cap on the module cache (evict oldest — Map keeps insertion order). */
const LINK_PREVIEW_CACHE_MAX = 300
/** In-flight fetches per URL (dedupes concurrent workers). */
const linkPreviewInflight = new Map<string, Promise<LinkPreviewData | null>>()
/** Max messages per chat that get a link preview lookup (document order). */
const LINK_PREVIEW_CAP = 24

function cachePreview(url: string, preview: LinkPreviewData | null) {
  linkPreviewCache.set(url, preview)
  if (linkPreviewCache.size > LINK_PREVIEW_CACHE_MAX) {
    const oldest = linkPreviewCache.keys().next().value
    if (oldest !== undefined) linkPreviewCache.delete(oldest)
  }
}

/** Defensive parse of the /api/link-preview payload (never throws). */
function parsePreviewPayload(data: unknown): LinkPreviewData | null {
  const preview = (data as { ok?: unknown; preview?: unknown } | null)?.preview
  if (!preview || typeof preview !== 'object') return null
  const p = preview as Record<string, unknown>
  if (typeof p.url !== 'string' || typeof p.title !== 'string' || !p.title) {
    return null
  }
  return {
    url: p.url,
    title: p.title,
    description: typeof p.description === 'string' ? p.description : undefined,
    siteName: typeof p.siteName === 'string' ? p.siteName : undefined,
    image: typeof p.image === 'string' ? p.image : undefined,
  }
}

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

/** Local-timezone YYYY-MM-DD (matches <input type="date"> filter values). */
function ymdLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Compact "8 Oct" label for the range footer. */
function fmtShortDay(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
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
  return formatChatTime(d)
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

/* ---------- 2-a: device-mode AI context + reply fetch ---------- */

/**
 * Chronological "Sender: text" transcript lines (oldest first) from the
 * messages already loaded in this chat — what POST /api/ai accepts as
 * `context` when the active transport is the on-device one (the route then
 * never touches the server DB). System rows are skipped, the most recent
 * ~60 lines win, media-only bodies become a short type placeholder.
 */
function buildAiContextLines(messages: ChatMessage[]): string[] {
  return messages
    .filter((m) => m.type !== 'system')
    .slice(-60)
    .map((m) => {
      const sender = m.sender || 'Unknown'
      const text = (m.body ?? '').trim()
      return `${sender}: ${text ? text.slice(0, 400) : `[${m.type}]`}`
    })
}

/** Strip a wrapping pair of straight/curly quotes some models add. */
function unwrapQuoted(text: string): string {
  const t = text.trim()
  if (t.length >= 2) {
    const first = t[0]
    const last = t[t.length - 1]
    const pairs: Record<string, string> = { '"': '"', "'": "'", '“': '”' }
    if (pairs[first] && last === pairs[first]) return t.slice(1, -1).trim()
  }
  return t
}

/**
 * Day-cell factory: per-day message count as a native tooltip + a heat dot
 * whose size/opacity scale with how busy that day was relative to the chat's
 * peak day — the calendar doubles as an activity heatmap at a glance.
 */
function makeDayButton(counts: Map<string, number>, maxCount: number) {
  return function CountedDayButton(props: React.ComponentProps<typeof CalendarDayButton>) {
    const d = props.day.date
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const count = counts.get(key)
    const ratio = count && maxCount > 0 ? count / maxCount : 0
    const size = count ? 3 + Math.round(ratio * 3) : 0 // dot grows 3px → 6px
    return (
      <CalendarDayButton
        {...props}
        title={count ? `${count} message${count === 1 ? '' : 's'}` : undefined}
        className={cn('relative', props.className)}
      >
        {props.children}
        {count && !props.modifiers.selected ? (
          <span
            aria-hidden
            style={{ width: size, height: size, opacity: 0.5 + 0.5 * ratio }}
            className="pointer-events-none absolute bottom-[3px] left-1/2 -translate-x-1/2 rounded-full bg-(--wa-accent)"
          />
        ) : null}
      </CalendarDayButton>
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
  hasChats,
  onOpenDemo,
  onOpenImport,
  onOpenMediaHub,
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
  /** False on a truly fresh install — drives the first-run welcome CTAs. */
  hasChats?: boolean
  onOpenDemo?: () => void
  onOpenImport?: () => void
  /** Open the global Media Hub (albums + date range); omit to use the legacy per-chat gallery. */
  onOpenMediaHub?: () => void
}) {
  // Active transport (Phase 2): 'server' = REST /api/*, 'device' = on-device
  // SQLite-WASM. Every data flow below goes through `data`.
  const { mode, data } = useData()
  const t = useT()
  const normalizeMessages = useMessageNormalizer()
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
  const [bookmarksOpen, setBookmarksOpen] = useState(false)
  /** Message being named for a bookmark (null = naming dialog closed). */
  const [bookmarkDraft, setBookmarkDraft] = useState<ChatMessage | null>(null)
  const [bookmarkLabel, setBookmarkLabel] = useState('')
  const [rewindOpen, setRewindOpen] = useState(false)
  /** Jump calendar mode — single-day jump or date-range explorer (idea #2). */
  const [jumpMode, setJumpMode] = useState<'day' | 'range'>('day')
  const [jumpRange, setJumpRange] = useState<DateRange>({ from: undefined })
  const [showFab, setShowFab] = useState(false)
  const [jumpedId, setJumpedId] = useState<string | null>(null)
  const [jumpDate, setJumpDate] = useState<Date | undefined>(undefined)
  const [jumpOpen, setJumpOpen] = useState(false)
  const [wallpaperOpen, setWallpaperOpen] = useState(false)
  // Invisible Popover anchor for the wallpaper picker (opened from the More
  // menu — see the Customize section of the chat menu).
  const wallpaperAnchorRef = useRef<HTMLSpanElement>(null)
  // Set when the wallpaper entry is picked from the More menu so
  // onCloseAutoFocus knows to open the popover instead of restoring focus.
  const wallpaperFromMenu = useRef(false)
  // Same race-guard as above but for the jump-to-date popover: the More menu
  // item flips this flag, and onCloseAutoFocus opens the popover in a rAF
  // after the menu has fully torn down (a direct setJumpOpen(true) during
  // close races Radix's focus restore and gets dismissed).
  const jumpFromMenu = useRef(false)
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

  /* ---- 10-b: simulated "other participant is typing" ---- */
  const [typingName, setTypingName] = useState<string | null>(null)
  const typingTimersRef = useRef<number[]>([])

  /* ---- 14-b: simulated persona replies (demo chats only) ----
     One pending reply at a time; timers + in-flight fetch are aborted on
     chat switch/unmount via personaAbortRef + the cleanup effect below. */
  const [autoReplyOn, setAutoReplyOn] = useState(true)
  const personaTimersRef = useRef<number[]>([])
  const personaPendingRef = useRef(false)
  const personaAbortRef = useRef<AbortController | null>(null)

  /* ----- Interaction model (Task 10-b): editing is the DEFAULT in every
         chat (incl. Saved Messages); the pencil toggles a read-only VIEWING
         mode. Multi-select is a separate transient mode. ----- */
  const [readOnly, setReadOnly] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [forwardState, setForwardState] = useState<{
    messages: ChatMessage[]
  } | null>(null)
  const [pollOpen, setPollOpen] = useState(false)
  const [pollCreating, setPollCreating] = useState(false)
  const [editing, setEditing] = useState<ChatMessage | null>(null)
  const [editBody, setEditBody] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  /** Message pending an unsend confirmation (tombstone flow). */
  const [unsendTarget, setUnsendTarget] = useState<ChatMessage | null>(null)
  const [unsendBusy, setUnsendBusy] = useState(false)
  /** Per-chat edit/unsend history ("Message changes" panel). */
  const [changesOpen, setChangesOpen] = useState(false)
  /** Round-trip export self-test ("Verify my export"). */
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [verifyBusy, setVerifyBusy] = useState(false)
  const [verifyReport, setVerifyReport] = useState<RoundTripReport | null>(null)

  /* ---- 10-i: word cloud / movie mode / accent theme / link previews ---- */
  const [wordCloudOpen, setWordCloudOpen] = useState(false)
  const [movieMode, setMovieMode] = useState(false)
  /** Idea #18 — distraction-free reading mode overlay. */
  const [readingOpen, setReadingOpen] = useState(false)
  const [insightsOpen, setInsightsOpen] = useState(false)
  /** Per-chat accent override — null = app default (vars cascade everywhere). */
  const [accentVars, setAccentVars] = useState<React.CSSProperties | null>(null)
  /** messageId → fetched preview (null = fetched, none found). */
  const [linkPreviews, setLinkPreviews] = useState<
    Map<string, LinkPreviewData | null>
  >(new Map())
  const linkPreviewsRef = useRef<Map<string, LinkPreviewData | null>>(
    linkPreviews
  )

  const chatId = detail?.chat.id ?? ''

  // Live bookmark list for the open chat (localStorage-backed store, idea #3).
  const bookmarks = useSyncExternalStore(
    subscribeBookmarks,
    () => getBookmarksSnapshot(chatId),
    () => getBookmarksSnapshot('')
  )
  const [tldrOpen, setTldrOpen] = useState(false)
  const [schedItems, setSchedItems] = useState<SchedItem[]>([])
  const [schedExpanded, setSchedExpanded] = useState(false)

  // --- Scheduled messages (Task 12-c): pending chip + refresh on delivery ---
  const loadSched = useCallback(async () => {
    if (!chatId) return
    try {
      const items = await data.listScheduled(chatId)
      setSchedItems(items)
    } catch {
      /* offline — keep the last known list */
    }
  }, [chatId, data])
  useEffect(() => {
    loadSched()
  }, [loadSched])
  useEffect(() => {
    const onChange = () => loadSched()
    window.addEventListener('wa-scheduled-check', onChange)
    window.addEventListener('wa-scheduled-delivered', onChange)
    return () => {
      window.removeEventListener('wa-scheduled-check', onChange)
      window.removeEventListener('wa-scheduled-delivered', onChange)
    }
  }, [loadSched])
  // A delivery touched this chat → pull the fresh transcript from the active
  // transport (device mode resolves media blob URLs while merging).
  useEffect(() => {
    const onDelivered = (e: Event) => {
      const ids = (e as CustomEvent<{ chatIds?: string[] }>).detail?.chatIds
      if (!Array.isArray(ids) || !ids.includes(chatId)) return
      void (async () => {
        try {
          const fresh = await data.getChatDetail(chatId)
          const messages = await normalizeMessages(chatId, fresh.messages)
          setDetail((d) =>
            d && d.chat.id === chatId ? { ...d, messages } : d
          )
        } catch {
          /* offline — the poller fires again later */
        }
      })()
    }
    window.addEventListener('wa-scheduled-delivered', onDelivered)
    return () => window.removeEventListener('wa-scheduled-delivered', onDelivered)
  }, [chatId, setDetail, data, normalizeMessages])
  async function cancelScheduled(id: string) {
    setSchedItems((s) => s.filter((x) => x.id !== id))
    try {
      await data.cancelScheduled(id)
    } catch {
      toast.error('Could not cancel the scheduled message')
      loadSched()
    }
  }
  function schedTime(iso: string): string {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleString([], {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  const schedBar =
    schedItems.length > 0 ? (
      <div className="relative z-10 mx-2 mb-1.5 rounded-lg border border-black/5 bg-(--wa-panel-2) px-3 py-2 text-[13px] shadow-sm dark:border-white/10 dark:bg-(--wa-panel-2)">
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left"
          onClick={() => setSchedExpanded((v) => !v)}
          aria-expanded={schedExpanded}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--wa-accent)/15 text-(--wa-accent)">
            <CalendarClock className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1 truncate text-(--wa-text)">
            {schedItems.length} scheduled message
            {schedItems.length > 1 ? 's' : ''}
            {schedItems[0]?.deliverAt &&
              ` · next ${schedTime(schedItems[0].deliverAt)}`}
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-(--wa-text-2) transition-transform',
              schedExpanded && 'rotate-180'
            )}
          />
        </button>
        {schedExpanded && (
          <ul className="mt-2 space-y-1" aria-label="Scheduled messages">
            {schedItems.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-md bg-black/[0.03] px-2 py-1.5 dark:bg-white/[0.05]"
              >
                <span className="min-w-0 flex-1 truncate text-(--wa-text)">
                  {s.body}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-(--wa-text-2)">
                  {schedTime(s.deliverAt)}
                </span>
                <button
                  type="button"
                  onClick={() => cancelScheduled(s.id)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-black/10 hover:text-rose-600 dark:hover:bg-white/10"
                  aria-label="Cancel scheduled message"
                  title="Cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    ) : null
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

  /* ---- Smart reply chips (idea #1) — deterministic per anchor message,
          salt rotates the pool via the shuffle button / after each send. ---- */
  const [replySalt, setReplySalt] = useState(0)
  const smartReplies = useMemo(
    () => suggestReplies(messages, replySalt),
    [messages, replySalt]
  )

  /* ---- 14-f: unread divider + jump-to-first-unread state ----
     unreadFirstId anchors the divider (id-based so deletes shift safely);
     unreadAnchorRef mirrors it synchronously for the scroll-to-bottom guard
     below (state updates from effects land one commit too late for it). */
  const [unreadFirstId, setUnreadFirstId] = useState<string | null>(null)
  const [showUnreadPill, setShowUnreadPill] = useState(false)
  const unreadAnchorRef = useRef<string | null>(null)
  const unreadFirstIdRef = useRef<string | null>(null)
  /** Auto-scroll to the divider runs exactly once per open. */
  const unreadAutoDoneRef = useRef(false)
  /** Set on pill click — the pill stays hidden for the rest of the open. */
  const unreadDismissedRef = useRef(false)
  /** The open auto-scroll could not reach the 25% placement (clamped). */
  const unreadClampedRef = useRef(false)
  /** True once the user scrolls on their own (not our auto-scroll settle). */
  const userScrolledRef = useRef(false)
  const autoScrollTargetRef = useRef<number | null>(null)
  const autoScrollSettlingRef = useRef(false)

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

  // Read-only preference persists per app ('1' = read-only). Editing is the
  // default, so the flag is only ever written when the user switches to
  // read-only viewing. Applied after mount (hydration-safe).
  useEffect(() => {
    try {
      setReadOnly(localStorage.getItem('wa-viewer:read-only') === '1')
    } catch {
      /* private mode — stay on the editing default */
    }
  }, [])

  /* ---- 10-i: per-chat accent theme (chat-theme.ts) ----
     Read on chat open + re-read when 'wa-theme-changed' fires for this chat.
     Default accent → no override; otherwise the CSS vars are set on the chat
     root wrapper so header, bubbles, pills and bars all inherit them. */
  useEffect(() => {
    if (!chatId) return
    const apply = () => {
      const pair = readChatAccent(chatId)
      setAccentVars(
        pair.name === 'Default'
          ? null
          : ({
              '--wa-accent': pair.accent,
              '--wa-accent-strong': pair.accentStrong,
            } as React.CSSProperties)
      )
    }
    apply()
    const onThemeChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { chatId?: string } | undefined
      if (!detail || detail.chatId === chatId) apply()
    }
    window.addEventListener(CHAT_THEME_EVENT, onThemeChanged)
    return () => window.removeEventListener(CHAT_THEME_EVENT, onThemeChanged)
  }, [chatId])

  /* ---- 10-i: link preview orchestration ----
     After messages load/refresh: scan text messages in document order for
     their first http(s) URL, cap 24 per chat, fetch /api/link-preview with
     concurrency 3 (failures → null). Results are stored per message id; URLs
     are cached module-level so switching chats back is instant. Only messages
     missing from the map are (re)processed. */
  useEffect(() => {
    if (!chatId) return
    const candidates: { id: string; url: string }[] = []
    for (const m of messages) {
      if (candidates.length >= LINK_PREVIEW_CAP) break
      if (m.type !== 'text' || !m.body) continue
      if (linkPreviewsRef.current.has(m.id)) continue
      const url = firstUrlIn(m.body)
      if (!url) continue
      candidates.push({ id: m.id, url })
    }
    if (candidates.length === 0) return
    let alive = true
    let next = 0
    const worker = async () => {
      while (alive && next < candidates.length) {
        const c = candidates[next++]
        let preview = linkPreviewCache.get(c.url)
        if (preview === undefined) {
          const inflight = linkPreviewInflight.get(c.url)
          if (inflight) {
            preview = await inflight
          } else {
            const job: Promise<LinkPreviewData | null> = fetch(
              `/api/link-preview?url=${encodeURIComponent(c.url)}`
            )
              .then((r) => r.json())
              .then((d: unknown) => parsePreviewPayload(d))
              .catch(() => null)
            linkPreviewInflight.set(c.url, job)
            preview = await job
            linkPreviewInflight.delete(c.url)
            cachePreview(c.url, preview)
          }
        }
        if (!alive) return
        const nextMap = new Map(linkPreviewsRef.current)
        nextMap.set(c.id, preview)
        linkPreviewsRef.current = nextMap
        setLinkPreviews(nextMap)
      }
    }
    for (let i = 0; i < 3; i++) void worker()
    return () => {
      alive = false
    }
  }, [messages, chatId])

  /** Pencil toggle: flip between the editing default and read-only viewing. */
  function toggleReadOnly() {
    setReadOnly((v) => {
      const next = !v
      try {
        if (next) localStorage.setItem('wa-viewer:read-only', '1')
        else localStorage.removeItem('wa-viewer:read-only')
      } catch {
        /* ignore storage failures */
      }
      return next
    })
  }

  /* -------------- 10-b: simulated "participant is typing" -------------- */

  const clearTypingTimers = useCallback(() => {
    for (const t of typingTimersRef.current) window.clearTimeout(t)
    typingTimersRef.current = []
  }, [])

  // Stop any running simulation when switching chats or unmounting.
  useEffect(() => {
    setTypingName(null)
    return clearTypingTimers
  }, [chatId, clearTypingTimers])

  /* ---- 14-b: persona-reply scheduling cleanup ---- chat switch/unmount
     clears the pending timers + aborts the in-flight AI/POST fetch (typing
     off is owned by the 10-b cleanup above, same triggers). */
  useEffect(() => {
    return () => {
      for (const t of personaTimersRef.current) window.clearTimeout(t)
      personaTimersRef.current = []
      personaPendingRef.current = false
      personaAbortRef.current?.abort()
      personaAbortRef.current = null
    }
  }, [chatId])

  // 14-b: hydrate the auto-reply toggle from localStorage (default ON for
  // demo chats when the key is absent; re-read per chat — the write path
  // keeps the stored value in sync, so this never fights the user).
  useEffect(() => {
    setAutoReplyOn(readAutoReplyEnabled())
  }, [chatId])

  // When the dots appear, scroll the typing bubble into view — but only when
  // the user is already near the bottom (never yank them out of history).
  useEffect(() => {
    if (!typingName) return
    const raf = requestAnimationFrame(() => {
      const wrap = scrollRef.current
      const el = wrap?.querySelector('[data-typing-bubble]')
      if (!wrap || !el) return
      const distance = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight
      if (distance < 400) {
        el.scrollIntoView({
          block: 'end',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        })
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [typingName])

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

  /* ---- 14-f: capture the PRE-OPEN seen state and derive the unread
     boundary — once per mount (ChatView is remounted per chat via
     key={activeId}, so one capture per open). Declared BEFORE the scroll-to-
     bottom effect so the synchronous unreadAnchorRef write lands first and
     open-with-unread skips the default bottom scroll; the displayed-count
     tracker below is declared AFTER so an open first reads the previous
     session count and only then records the fresh length.

     Re-arming: openChat() also re-fetches WITHOUT changing activeId when the
     clicked chat is already the open one (list-row re-click, AudioDock
     re-focus). detail is dropped to null first, so on the loading commit we
     reset the capture guard + per-open scroll refs — the fresh transcript
     recaptures the boundary (the session count tracker skips empty arrays,
     so the previous length survives the gap and anchors the re-open). ---- */
  const capturedUnreadRef = useRef(false)
  /** The pre-open seen entry the current anchor was derived from — reused
      to re-derive the boundary if the anchor message itself gets deleted. */
  const capturedSeenEntryRef = useRef<SeenEntryLike>(null)
  useEffect(() => {
    if (!chatId) {
      capturedUnreadRef.current = false
      unreadAutoDoneRef.current = false
      unreadDismissedRef.current = false
      unreadClampedRef.current = false
      userScrolledRef.current = false
      autoScrollTargetRef.current = null
      autoScrollSettlingRef.current = false
      return
    }
    if (capturedUnreadRef.current) return
    capturedUnreadRef.current = true
    let id: string | null = null
    const prevCount = sessionDisplayedCount.get(chatId)
    if (prevCount === undefined) {
      // First open of this chat in this browser session — use the pre-open
      // seen entry (no entry at all = first-ever open = nothing is unread).
      const entry = readPreOpenSeenEntry(chatId)
      capturedSeenEntryRef.current = entry
      id = computeUnreadBoundary(entry, messages)?.id ?? null
    } else {
      // Re-open within this session: rows beyond what was already displayed
      // are new-to-me; the first incoming one anchors the divider.
      capturedSeenEntryRef.current = null
      for (let i = Math.max(0, prevCount); i < messages.length; i++) {
        const m = messages[i]
        if (m.sender && m.sender !== 'You' && m.type !== 'system') {
          id = m.id
          break
        }
      }
    }
    unreadAnchorRef.current = id
    unreadFirstIdRef.current = id
    setUnreadFirstId(id)
  }, [chatId, messages])

  // 14-f: remember how much of this transcript has been displayed, so a
  // later re-open can tell arrived messages apart from displayed ones.
  useEffect(() => {
    if (!chatId || messages.length === 0) return
    sessionDisplayedCount.set(chatId, messages.length)
  }, [chatId, messages])

  // 14-f: if the anchor message itself is deleted while the divider is up,
  // re-derive the boundary from the SAME pre-open seen watermark (monotonic:
  // the next incoming message after it becomes the anchor). The ordinal
  // session rule can't survive index shifts, so it simply drops the divider.
  useEffect(() => {
    if (!unreadFirstId) return
    // An empty transcript is the openChat loading gap, not a mass deletion —
    // keep the anchor until the fresh messages arrive.
    if (messages.length === 0) return
    if (messages.some((m) => m.id === unreadFirstId)) return
    const next =
      computeUnreadBoundary(capturedSeenEntryRef.current, messages)?.id ?? null
    unreadAnchorRef.current = next
    unreadFirstIdRef.current = next
    setUnreadFirstId(next)
  }, [messages, unreadFirstId])

  // Scroll to bottom on open / chat change — unless a jump is queued
  // (e.g. arriving from a global-search hit), which wins instead, or the
  // chat opened with unread messages (the unread auto-scroll below positions
  // the list at the divider instead).
  useEffect(() => {
    if (pendingJumpRef.current) return
    if (unreadAnchorRef.current) return
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
      el.scrollIntoView({
        block: 'center',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      })
      setJumpedId(id)
      const t = setTimeout(() => setJumpedId(null), 2000)
      pendingJumpRef.current = null
      // 14-f: a completed jump (esp. the queued initial one from a global-
      // search hit) wins over the unread auto-scroll — without this, the
      // visibleCount expansion such a jump may trigger would re-run the
      // auto-scroll effect after pendingJumpRef cleared and yank the view
      // to the divider.
      unreadAutoDoneRef.current = true
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
  }, [visibleCount, messages.length, initialJumpMessageId, messages, filtered])

  /* ---- 14-f: auto-scroll once so the unread divider sits ~25% from the top
     of the viewport (clamped to the bottom when too few messages sit below
     the boundary — e.g. a single new message at the end of the chat), with
     the existing flash treatment on the first unread message. A queued
     initial jump (initialJumpMessageId) always wins; the divider stays. ---- */
  useEffect(() => {
    const firstId = unreadFirstId
    if (!firstId || unreadAutoDoneRef.current) return
    // Skip renders whose state still carries the PREVIOUS open's anchor —
    // the capture effect has already derived the fresh one (mirrored in
    // unreadFirstIdRef synchronously); waiting for the next commit keeps the
    // auto-scroll from fighting the re-derivation on a same-chat re-open.
    if (unreadFirstIdRef.current !== firstId) return
    if (pendingJumpRef.current) return
    const idx = messages.findIndex((m) => m.id === firstId)
    if (idx === -1) return
    const needed = messages.length - idx
    if (needed > visibleCountRef.current) {
      const raf = requestAnimationFrame(() => {
        visibleCountRef.current = needed
        setVisibleCount(needed)
      })
      return () => cancelAnimationFrame(raf)
    }
    const wrap = scrollRef.current
    const el = wrap?.querySelector('[data-unread-divider]') as HTMLElement | null
    if (!wrap || !el) return
    const target = Math.max(0, el.offsetTop - wrap.clientHeight * 0.25)
    const max = wrap.scrollHeight - wrap.clientHeight
    const clamped = target > max + 1
    unreadClampedRef.current = clamped
    const raf = requestAnimationFrame(() => {
      const w = scrollRef.current
      if (!w) return
      unreadAutoDoneRef.current = true
      const t = Math.min(target, w.scrollHeight - w.clientHeight)
      autoScrollTargetRef.current = t
      autoScrollSettlingRef.current = true
      w.scrollTop = t
      if (clamped) setShowUnreadPill(true)
      setJumpedId(firstId)
      window.setTimeout(() => setJumpedId(null), 2000)
    })
    return () => cancelAnimationFrame(raf)
  }, [unreadFirstId, visibleCount, messages])

  const shown = useMemo(() => {
    if (filtered) return filtered
    return messages.slice(Math.max(0, messages.length - visibleCount))
  }, [messages, visibleCount, filtered])

  const grouped = useMemo(() => {
    const out: Array<
      | { kind: 'date'; key: string; label: string }
      | { kind: 'system'; key: string; id: string; body: string; ts: string }
      | { kind: 'unread-divider'; key: string }
      | { kind: 'msg'; key: string; msg: ChatMessage; showTail: boolean; showAvatar: boolean }
    > = []
    let prev: ChatMessage | null = null
    let prevDay = ''
    let dividerPlaced = false
    for (const m of shown) {
      const dk = dayKey(m.ts)
      if (dk !== prevDay) {
        // Append the row count: with non-monotonic imports the same day can
        // legitimately appear twice, and React keys must stay unique.
        out.push({ kind: 'date', key: `d-${dk}-${out.length}`, label: formatDayLabel(new Date(m.ts)) })
        prevDay = dk
        prev = null
      }
      if (m.type === 'system' || !m.sender) {
        out.push({ kind: 'system', key: `s-${m.id}`, id: m.id, body: m.body, ts: m.ts })
        prev = null
        continue
      }
      // 14-f: WhatsApp-style unread divider — a normal list row rendered
      // right before the first unread message (transcript view only; search/
      // filter results are a different lens and never show it).
      if (!filtered && !dividerPlaced && m.id === unreadFirstId) {
        out.push({ kind: 'unread-divider', key: 'unread-divider' })
        dividerPlaced = true
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
  }, [shown, filtered, unreadFirstId])

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

  // Escape: exit selection -> cancel reply -> clear filters -> close search -> back
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Never intercept Escape while a dialog/alert/context menu is open
      // (Radix handles those Escapes itself)
      if (document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"]')) return
      if (jumpOpen) return
      if (selecting) {
        exitSelection()
      } else if (replyTo) {
        setReplyTo(null)
      } else if (query) {
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
  }, [jumpOpen, selecting, replyTo, query, hasDateFilter, starredOnly, searchOpen, onBack])

  function handleScrollToBottom() {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  function handleExport() {
    if (!detail) return
    // Device mode (static APK bundle) has no /api routes — build the SAME
    // WhatsApp-format .txt client-side from the DataClient transcript
    // (messages + pending scheduled sends, exactly like the server route).
    if (mode === 'device') {
      void (async () => {
        try {
          const rows = await data.getChatTranscript(detail.chat.id)
          if (!rows || rows.length === 0) {
            toast.error('No messages to export')
            return
          }
          const text = buildWhatsAppText(
            rows.map(
              (r): ExportMessage => ({
                ts: new Date(r.ts),
                sender: r.sender,
                body: r.body,
                type: r.type,
                mediaName: r.mediaName,
                edited: r.edited,
                scheduledFor: r.scheduledFor ? new Date(r.scheduledFor) : null,
              })
            )
          )
          downloadBlob(
            new Blob([text], { type: 'text/plain;charset=utf-8' }),
            `WhatsApp Chat - ${safeFileTitle(detail.chat.title)}.txt`
          )
          toast.success('Chat exported as .txt — check your downloads')
        } catch {
          toast.error('Could not export this chat')
        }
      })()
      return
    }
    const a = document.createElement('a')
    a.href = `/api/chats/${detail.chat.id}/export`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast.success('Chat exported as .txt — check your downloads')
  }

  /** Round-trip self-test: rebuild + re-parse the export, report fidelity. */
  async function handleVerifyExport() {
    if (!detail || verifyBusy) return
    setVerifyBusy(true)
    try {
      const rows = await data.getChatTranscript(detail.chat.id)
      const msgs: ExportMessage[] = rows.map((r) => ({
        ts: new Date(r.ts),
        sender: r.sender,
        body: r.body,
        type: r.type,
        mediaName: r.mediaName,
        edited: r.edited,
        scheduledFor: r.scheduledFor ? new Date(r.scheduledFor) : null,
        reactions: r.reactions ?? null,
        replyTo: r.replyTo ?? null,
      }))
      if (msgs.length === 0) {
        toast.error('No messages to verify')
        return
      }
      setVerifyReport(verifyRoundTrip(msgs))
      setVerifyOpen(true)
    } catch {
      toast.error('Could not verify the export')
    } finally {
      setVerifyBusy(false)
    }
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
      // Persist the absolute toggled map (both transports take it — the UI
      // computed `next` locally so they behave identically) and re-sync the
      // authoritative reactions when a message comes back.
      const updated = await data.setReactions(msgId, nextIsEmpty ? null : next)
      const server = updated?.reactions
      if (server && typeof server === 'object') {
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
      await data.setMessagePinned(msg.id, next)
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

  function handleExportHtml() {
    if (!detail) return
    const a = document.createElement('a')
    a.href = `/api/chats/${detail.chat.id}/export?format=html`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast.success('Exporting .html — a standalone page of this chat')
  }

  /** JSON (raw data) / CSV (spreadsheet) exports — mirrors handleExportZip. */
  async function handleExportFormat(format: 'json' | 'csv') {
    if (!detail) return
    // Device mode (static APK bundle) has no /api routes — build the file
    // client-side from the DataClient with the same schema as the server
    // route (see src/lib/export-csv.ts and /api/chats/[id]/export).
    if (mode === 'device') {
      try {
        const full = await data.getChatDetail(detail.chat.id)
        const rows = full.messages
        if (!rows || rows.length === 0) {
          toast.error('No messages to export')
          return
        }
        const name = `WhatsApp Chat - ${safeFileTitle(detail.chat.title)}`
        if (format === 'csv') {
          downloadBlob(chatCsvBlob(rows), `${name}.csv`)
        } else {
          downloadBlob(
            new Blob([JSON.stringify({ chat: detail.chat, count: rows.length, messages: rows }, null, 2)], {
              type: 'application/json',
            }),
            `${name}.json`
          )
        }
        toast.success(
          format === 'csv'
            ? 'Chat exported as .csv (spreadsheet) — check your downloads'
            : 'Chat exported as .json (raw data) — check your downloads'
        )
      } catch {
        toast.error('Could not export this chat')
      }
      return
    }
    const a = document.createElement('a')
    a.href = `/api/chats/${detail.chat.id}/export?format=${format}`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast.success(
      format === 'json'
        ? 'Exporting .json (raw data) — check your downloads'
        : 'Exporting .csv (spreadsheet) — check your downloads'
    )
  }

  /** PDF transcript — same transcript rows as the .txt export, rendered as
   *  a print-ready document and sent to the platform print pipeline
   *  (Android "Save as PDF" / desktop print dialog). Works in BOTH modes:
   *  the print happens client-side, so we always use the DataClient
   *  transcript (the same source the device-mode .txt export builds from). */
  function handleExportPdf() {
    if (!detail) return
    void (async () => {
      try {
        const rows = await data.getChatTranscript(detail.chat.id)
        if (!rows || rows.length === 0) {
          toast.error('No messages to export')
          return
        }
        exportChatPdf({
          title: detail.chat.title,
          isGroup: detail.chat.isGroup,
          messages: rows.map((r) => ({
            ts: r.ts,
            sender: r.sender,
            body: r.body,
            type: r.type,
            mediaName: r.mediaName,
            edited: r.edited,
            scheduledFor: r.scheduledFor,
            reactions: r.reactions ?? null,
            replyTo: r.replyTo ?? null,
          })),
          labels: {
            docTitle: pdfT(t, 'pdf.docTitle', 'Chat transcript'),
            exportedOn: pdfT(t, 'pdf.exportedOn', 'Exported on {date}'),
            messageCount: pdfT(t, 'pdf.messageCount', '{count} messages'),
            dateRange: pdfT(t, 'pdf.dateRange', 'Date range: {range}'),
            generatedBy: pdfT(t, 'pdf.generatedBy', 'Generated by WA Archiver'),
            page: pdfT(t, 'pdf.page', 'Page'),
            groupChat: pdfT(t, 'pdf.groupChat', 'Group chat'),
            starred: pdfT(t, 'pdf.starred', 'Starred'),
            edited: pdfT(t, 'pdf.edited', 'edited'),
            deleted: pdfT(t, 'pdf.deleted', 'This message was deleted'),
            repliedTo: pdfT(t, 'pdf.repliedTo', 'Replied to {sender}'),
            scheduled: pdfT(t, 'pdf.scheduled', 'Scheduled for {date}'),
            poll: pdfT(t, 'pdf.poll', 'Poll'),
            mediaPhoto: pdfT(t, 'pdf.mediaPhoto', 'photo'),
            mediaVideo: pdfT(t, 'pdf.mediaVideo', 'video'),
            mediaAudio: pdfT(t, 'pdf.mediaAudio', 'voice note'),
            mediaDocument: pdfT(t, 'pdf.mediaDocument', 'document'),
            mediaSticker: pdfT(t, 'pdf.mediaSticker', 'sticker'),
            mediaGif: pdfT(t, 'pdf.mediaGif', 'GIF'),
            mediaLocation: pdfT(t, 'pdf.mediaLocation', 'location'),
            mediaContact: pdfT(t, 'pdf.mediaContact', 'contact'),
          },
        })
        toast.success('Opening print dialog — choose "Save as PDF"')
      } catch {
        toast.error('Could not export this chat')
      }
    })()
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

  /* ------------ Multi-select + reply + forward dialog (10-b) ------------ */

  const isSavedChat = detail?.chat.id === SAVED_CHAT_ID
  const customAvatar = useChatAvatar(isSavedChat ? '' : (detail?.chat.id ?? ''))
  /* ---- 14-b: demo-chat marker — persona auto-replies only ever run here
     (sourceFile is `demo://<id>@v2` for demo chats; imports keep their file
     name and Saved Messages is `local`). */
  const isDemoChat = isDemoSource(detail?.chat.sourceFile)
  const selectedCount = selectedIds.size
  const selectedMessages = useMemo(
    () => messages.filter((m) => selectedIds.has(m.id)),
    [messages, selectedIds]
  )

  /** Reset transient modes whenever the chat changes. */
  useEffect(() => {
    setSelecting(false)
    setSelectedIds(new Set())
    setReplyTo(null)
    setForwardState(null)
    setMovieMode(false)
    // Link previews are per chat — clear the state map (module URL cache stays)
    const empty = new Map<string, LinkPreviewData | null>()
    linkPreviewsRef.current = empty
    setLinkPreviews(empty)
  }, [chatId])

  function enterSelection() {
    setSelecting(true)
  }

  function exitSelection() {
    setSelecting(false)
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

  /** Select every selectable message in the chat. */
  function selectAll() {
    setSelectedIds(
      new Set(messages.filter((m) => m.sender || m.type === 'poll').map((m) => m.id))
    )
  }

  /**
   * The action sheet's "Select message" enters selection mode with that
   * message preselected; while selecting, rows toggle instead.
   */
  function handleToggleSelect(id: string) {
    if (!selecting) {
      setSelecting(true)
      setSelectedIds(new Set([id]))
      return
    }
    toggleSelect(id)
  }

  /** Quote a message in the composer (reply flow). */
  function handleReplyTo(msg: ChatMessage) {
    setReplyTo(msg)
  }

  /** Tap the reply quote preview — jump to + briefly highlight the original. */
  function handleJumpToReply() {
    if (replyTo) jumpToMessageId(replyTo.id)
  }

  /** Open the multi-target forward dialog for the given messages. */
  function openForwardDialog(msgs: ChatMessage[]) {
    if (msgs.length === 0) return
    setForwardState({ messages: msgs })
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
        await data.forwardMessage(t.id, SAVED_CHAT_ID)
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
    exitSelection()
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

  /** Batch delete: sequential DELETE per message (await all), then refresh. */
  async function executeDelete() {
    if (selectedCount === 0) return
    setDeleteBusy(true)
    const ids = [...selectedIds]
    const okIds: string[] = []
    try {
      for (const id of ids) {
        try {
          await data.deleteMessage(id)
          okIds.push(id)
        } catch {
          /* keep going — report the partial result at the end */
        }
      }
      if (okIds.length > 0) {
        const okSet = new Set(okIds)
        setDetail((d) =>
          d
            ? { ...d, messages: d.messages.filter((m) => !okSet.has(m.id)) }
            : d
        )
        if (replyTo && okSet.has(replyTo.id)) setReplyTo(null)
        toast.success(
          okIds.length === 1
            ? 'Deleted 1 message'
            : `Deleted ${okIds.length} messages`
        )
        onChatChanged?.()
      } else {
        toast.error('Could not delete messages')
      }
      exitSelection()
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
    const trimmed = editBody.trim()
    try {
      const updated = await data.markMessageEdited(editing.id, trimmed)
      const newBody = updated?.body ?? trimmed
      recordMsgChange({
        chatId,
        messageId: editing.id,
        kind: 'edited',
        sender: editing.sender,
        before: editing.body,
        after: newBody,
      })
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

  /**
   * Inline edit persistence for MessageBubble (`onEditSave` contract):
   * persist the new body through the DataClient, then update local state.
   * Returns success so the bubble can keep or revert its inline editor.
   */
  async function saveEditApi(id: string, body: string): Promise<boolean> {
    const trimmed = body.trim()
    if (!trimmed) return false
    try {
      const prev = messages.find((m) => m.id === id)
      const updated = await data.markMessageEdited(id, trimmed)
      const newBody = updated?.body ?? trimmed
      if (prev) {
        recordMsgChange({
          chatId,
          messageId: id,
          kind: 'edited',
          sender: prev.sender,
          before: prev.body,
          after: newBody,
        })
      }
      setDetail((d) =>
        d
          ? {
              ...d,
              messages: d.messages.map((m) =>
                m.id === id ? { ...m, body: newBody, edited: true } : m
              ),
            }
          : d
      )
      toast.success('Message edited')
      onChatChanged?.()
      return true
    } catch {
      toast.error('Could not edit message')
      return false
    }
  }

  /**
   * Unsend → WhatsApp-style tombstone ("This message was deleted").
   * The row is NOT hard-deleted: the transcript keeps the audit trail and
   * re-exports cleanly through the parser's deleted-message round-trip.
   */
  async function executeUnsend() {
    const target = unsendTarget
    if (!target || unsendBusy) return
    setUnsendBusy(true)
    try {
      const updated = await data.unsendMessage(target.id)
      if (updated) {
        recordMsgChange({
          chatId,
          messageId: target.id,
          kind: 'unsent',
          sender: target.sender,
          before: target.body,
          after: null,
        })
        setDetail((d) =>
          d
            ? {
                ...d,
                messages: d.messages.map((m) =>
                  m.id === target.id ? { ...m, ...updated, id: m.id } : m
                ),
              }
            : d
        )
        if (replyTo?.id === target.id) setReplyTo(null)
        toast.success('Message unsent — now shows as deleted')
        onChatChanged?.()
      } else {
        toast.error('Message not found')
      }
    } catch {
      toast.error('Could not unsend message')
    } finally {
      setUnsendBusy(false)
      setUnsendTarget(null)
    }
  }

  /**
   * Simulated typing (10-b): shortly after you send, a random OTHER
   * participant "types" for a few seconds. Purely client-side; skipped in
   * Saved Messages and chats where nobody but 'You' ever sent anything.
   */
  function scheduleTypingSimulation() {
    if (!detail || isSavedChat) return
    const others = detail.chat.isGroup
      ? [
          ...new Set(
            messages
              .filter((m) => m.sender && m.sender !== 'You')
              .map((m) => m.sender as string)
          ),
        ]
      : [detail.chat.title]
    if (others.length === 0) return
    const name = others[Math.floor(Math.random() * others.length)]
    clearTypingTimers()
    setTypingName(null)
    const showDelay = 1200 + Math.random() * 1300 // 1.2–2.5s after send
    const showFor = 2500 + Math.random() * 2000 // visible for 2.5–4.5s
    typingTimersRef.current.push(
      window.setTimeout(() => {
        setTypingName(name)
        typingTimersRef.current.push(
          window.setTimeout(() => setTypingName(null), showFor)
        )
      }, showDelay)
    )
  }

  /* ---- 14-b: simulated persona replies (demo chats only) ---- */

  /* ---- 2-a: device-mode AI persona reply ---- the shared fetchAiReply
     works on the server transport (the route derives persona + context from
     its own DB). On-device there is no server DB, so the persona (already
     derived above) and the transcript lines travel with the request. Same
     4s race + silent fallback contract as fetchAiReply.
     Phase 3: the device path calls Gemini DIRECTLY with the user's own key
     (runDeviceAi) — no /api/ai hop, so it also works in the standalone APK. */
  async function fetchDeviceAiReply(
    persona: string,
    context: string[],
    signal?: AbortSignal
  ): Promise<string | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), AI_REPLY_TIMEOUT_MS)
    const onOuterAbort = () => controller.abort()
    signal?.addEventListener('abort', onOuterAbort, { once: true })
    try {
      const payload = await runDeviceAi(
        { mode: 'reply', persona, context },
        { signal: controller.signal }
      )
      const text =
        typeof payload.result === 'string' ? payload.result.trim() : ''
      if (!text) return null
      return unwrapQuoted(text).slice(0, 500)
    } catch {
      // Timeout, outer abort (chat switch) or network error → silent fallback.
      return null
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onOuterAbort)
    }
  }

  /**
   * Decide whether the just-sent message earns a persona reply and schedule
   * one. Returns true when scheduled — handleSent then skips the random 10-b
   * typing decoration (the real reply replaces it). Guards: demo chat only,
   * auto-reply enabled, plain TEXT from 'You', nothing already pending,
   * and a persona must exist in the transcript. Media/audio/poll/etc. sends
   * never trigger a reply (type filter below).
   */
  function schedulePersonaReply(msg: ChatMessage): boolean {
    if (!detail || !isDemoChat || !autoReplyOn) return false
    if (personaPendingRef.current) return false // exactly ONE pending reply
    if (msg.type !== 'text' || !msg.body.trim()) return false
    if (msg.sender && msg.sender !== 'You') return false
    const persona = derivePersona(detail.messages)
    if (!persona) return false

    const chatIdAtSend = chatId
    const controller = new AbortController()
    personaPendingRef.current = true
    personaAbortRef.current = controller

    // Recent outgoing texts (newest first) — keyword source for the offline
    // builder. `detail` still holds the pre-append snapshot here, so the
    // just-sent body leads the list.
    const recentUserTexts = [
      msg.body,
      ...detail.messages
        .filter((m) => m.sender === 'You' && m.type === 'text' && m.body.trim())
        .slice(-3)
        .reverse()
        .map((m) => m.body),
    ]
    const seedCount = detail.messages.length + 1

    // AI reply starts immediately — it has 4s from the send to settle.
    // Server mode: the route picks persona + context from its own DB (the
    // just-sent message is already persisted). Device mode: the transcript is
    // local, so the context lines (with the just-sent message last) travel
    // with the request instead.
    const aiPromise =
      mode === 'device'
        ? fetchDeviceAiReply(
            persona,
            buildAiContextLines([...detail.messages, msg]),
            controller.signal
          )
        : fetchAiReply(chatIdAtSend, { signal: controller.signal })

    // Typing dots ~700ms after the send...
    personaTimersRef.current.push(
      window.setTimeout(() => {
        if (!personaPendingRef.current) return
        setTypingName(persona)
      }, 700)
    )
    // ...the reply lands 1.5–4s after the send (total, randomized).
    const delay = 1500 + Math.random() * 2500
    personaTimersRef.current.push(
      window.setTimeout(() => {
        void deliverPersonaReply(
          chatIdAtSend,
          persona,
          seedCount,
          recentUserTexts,
          aiPromise,
          controller
        )
      }, delay)
    )
    return true
  }

  /**
   * Generate + send the persona reply. AI text wins when it settled within
   * its 4s window; otherwise the deterministic offline line is used. The
   * reply is sent through the DataClient as an ordinary incoming message and
   * appended with the SAME mechanism as scheduled-message deliveries
   * (refetch-free setDetail append). No toast — the message just appears.
   * Failures only switch the typing indicator off and log; they never break
   * the chat.
   */
  async function deliverPersonaReply(
    chatIdAtSend: string,
    persona: string,
    seedCount: number,
    recentUserTexts: string[],
    aiPromise: Promise<string | null>,
    controller: AbortController
  ) {
    try {
      let text = pickPersonaReply({
        chatId: chatIdAtSend,
        messageCount: seedCount,
        recentUserMessages: recentUserTexts,
      })
      try {
        const ai = await aiPromise // resolves ≤4s after the send, or null
        if (ai && ai.trim()) text = ai.trim()
      } catch {
        /* offline line — silent */
      }
      if (controller.signal.aborted) return // chat switched — cleanup owns state
      const reply = await data.sendMessage(chatIdAtSend, {
        type: 'text',
        sender: persona,
        body: text,
      })
      if (controller.signal.aborted) return // superseded while sending
      // Device transport: resolve media paths (a text reply is a no-op there;
      // server mode is a passthrough).
      const [resolved] = await normalizeMessages(chatIdAtSend, [reply])
      personaPendingRef.current = false
      personaAbortRef.current = null
      personaTimersRef.current = [] // both timers already fired
      setTypingName(null)
      setDetail((d) =>
        d && d.chat.id === chatIdAtSend
          ? { ...d, messages: [...d.messages, resolved] }
          : d
      )
    } catch (err) {
      if (controller.signal.aborted) return // chat switch — nothing to reset
      personaPendingRef.current = false
      personaAbortRef.current = null
      setTypingName(null)
      console.error('Persona reply failed:', err)
    }
  }

  /** 14-b: flip the persisted auto-reply toggle (⋮ menu, demo chats only). */
  function toggleAutoReply() {
    setAutoReplyOn((v) => {
      const next = !v
      writeAutoReplyEnabled(next)
      return next
    })
  }

  function handleSent(msg: ChatMessage) {
    // Stale-send guard: an upload started in chat A but finishing after the
    // user switched to chat B must not append to B's transcript.
    if (msg.chatId && msg.chatId !== chatId) return
    setDetail((d) => (d ? { ...d, messages: [...d.messages, msg] } : d))
    setReplySalt((s) => s + 1) // fresh chips after every send
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    })
    // 14-b: in demo chats a persona reply replaces the random 10-b typing
    // decoration — the dots now lead to a real incoming message. Extra sends
    // while a reply is pending are ignored for scheduling (no stacking) and
    // also skip the 10-b decoration so its auto-clear timer can't kill the
    // persona's typing indicator mid-flight.
    if (!schedulePersonaReply(msg) && !personaPendingRef.current) {
      scheduleTypingSimulation()
    }
    onChatChanged?.()
  }

  async function createPoll(
    question: string,
    options: string[]
  ): Promise<boolean> {
    setPollCreating(true)
    try {
      const msg = await data.sendMessage(chatId, {
        type: 'poll',
        body: question,
        pollOptions: options,
      })
      // Device transport: resolve media paths before the bubble renders
      // (server mode is a passthrough).
      const [resolved] = await normalizeMessages(chatId, [msg])
      handleSent(resolved)
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
        el.scrollIntoView({
          block: 'center',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        })
        setJumpedId(id)
        setTimeout(() => setJumpedId(null), 2000)
        pendingJumpRef.current = null
      }
    })
  }

  /** Timeline scrubber pick (10-i) → jump to the first message of a month. */
  function handleScrubPick(key: string) {
    const [ys, ms] = key.split('-').map(Number)
    const hit = messages.find((m) => {
      const d = new Date(m.ts)
      return d.getFullYear() === ys && d.getMonth() === ms - 1
    })
    if (hit) jumpToMessageId(hit.id)
  }

  /* ---- 14-f: unread pill — live count, scroll tracking, click-to-jump ---- */

  /** Anchor position + live unread count, recomputed as messages change
     (deletes shift the anchor safely; the anchor disappearing kills it). */
  const unreadInfo = useMemo(() => {
    if (!unreadFirstId) return null
    const idx = messages.findIndex((m) => m.id === unreadFirstId)
    if (idx === -1) return null
    let count = 0
    for (let i = idx; i < messages.length; i++) {
      const m = messages[i]
      if (m.sender && m.sender !== 'You' && m.type !== 'system') count++
    }
    return { idx, count }
  }, [messages, unreadFirstId])

  /**
   * Pill visibility, driven by the container's scroll events:
   *  - hidden when dismissed (pill click) or no unread anchor;
   *  - visible while the first unread message is out of view (above the
   *    viewport top after scrolling past it, below it after scrolling up,
   *    or windowed out entirely);
   *  - when on screen: hidden — except right after an open whose auto-scroll
   *    was clamped (the 25% divider placement was impossible), where the
   *    pill stays visible until the user actually scrolls on their own.
   */
  const updateUnreadPill = useCallback((wrap: HTMLDivElement) => {
    const firstId = unreadFirstIdRef.current
    if (!firstId || unreadDismissedRef.current) {
      setShowUnreadPill(false)
      return
    }
    const msgEl = wrap.querySelector(`[data-mid="${firstId}"]`)
    const wr = wrap.getBoundingClientRect()
    let out = true
    if (msgEl) {
      const r = msgEl.getBoundingClientRect()
      out = r.bottom <= wr.top + 1 || r.top >= wr.bottom - 1
    }
    if (out) {
      setShowUnreadPill(true)
      return
    }
    if (!unreadClampedRef.current || userScrolledRef.current) {
      setShowUnreadPill(false)
    }
  }, [])

  /** Pill click: dismiss the pill, then reuse the standard jump machinery —
      it expands the render window if needed, smooth-scrolls to the first
      unread message and applies the flash treatment. */
  function handleUnreadPillClick() {
    unreadDismissedRef.current = true
    setShowUnreadPill(false)
    const firstId = unreadFirstIdRef.current
    if (firstId) jumpToMessageId(firstId)
  }

  /**
   * Word-cloud pick (10-i): close the dialog, seed the in-chat search with
   * the word (same path the search input drives — `query` state), open the
   * search bar and jump to the first matching message.
   */
  function handlePickWord(word: string) {
    setWordCloudOpen(false)
    setSearchOpen(true)
    setStarredOnly(false)
    setRegexMode(false)
    setFromDate('')
    setToDate('')
    setQuery(word)
    const q = word.toLowerCase()
    const hit = messages.find((m) =>
      `${m.body ?? ''}\n${m.sender ?? ''}`.toLowerCase().includes(q)
    )
    if (hit) jumpToMessageId(hit.id)
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

  /* --------------------------- Bookmarks (idea #3) -------------------------- */

  /** Body preview used as the default bookmark name. */
  function bookmarkPreview(msg: ChatMessage): string {
    const t = (msg.body ?? '').trim()
    return (t || `[${msg.type}]`).slice(0, 80)
  }

  /** Open the naming dialog for a new (or existing) bookmark on `msg`. */
  function openBookmarkDraft(msg: ChatMessage) {
    setBookmarkDraft(msg)
    setBookmarkLabel(bookmarkFor(chatId, msg.id)?.label ?? bookmarkPreview(msg))
  }

  /** Upsert the draft bookmark and close the naming dialog. */
  function commitBookmark() {
    if (!bookmarkDraft) return
    const existed = !!bookmarkFor(chatId, bookmarkDraft.id)
    saveBookmark(chatId, {
      messageId: bookmarkDraft.id,
      label: bookmarkLabel.trim() || bookmarkPreview(bookmarkDraft),
      excerpt: ((bookmarkDraft.body ?? '').trim() || `[${bookmarkDraft.type}]`).slice(
        0,
        140
      ),
      ts: bookmarkDraft.ts,
    })
    toast.success(
      existed ? 'Bookmark updated' : 'Bookmark added — More ▸ Bookmarks'
    )
    setBookmarkDraft(null)
  }

  /** Jump to a bookmark; lifts any active filter hiding the target. */
  function jumpToBookmark(b: BookmarkEntry) {
    setBookmarksOpen(false)
    if (filtered && !filtered.some((m) => m.id === b.messageId)) {
      setQuery('')
      setFromDate('')
      setToDate('')
      setStarredOnly(false)
    }
    jumpToMessageId(b.messageId)
  }

  /* --------------------- Date-range explorer (idea #2) ---------------------- */

  /** Message count inside the drafted jump range (live footer stat). */
  const rangeMsgCount = useMemo(() => {
    if (!jumpRange?.from || !jumpRange?.to) return 0
    const from = new Date(`${ymdLocal(jumpRange.from)}T00:00:00`).getTime()
    const to = new Date(`${ymdLocal(jumpRange.to)}T23:59:59.999`).getTime()
    let n = 0
    for (const m of messages) {
      const t = new Date(m.ts).getTime()
      if (t >= from && t <= to) n++
    }
    return n
  }, [messages, jumpRange])

  /** Apply the drafted range to the chat's date filter and jump to its start. */
  function applyJumpRange() {
    if (!jumpRange?.from || !jumpRange?.to) return
    setFromDate(ymdLocal(jumpRange.from))
    setToDate(ymdLocal(jumpRange.to))
    // Reveal the search bar so the result count, the from/to inputs and the
    // clear affordance are all visible — the explorer reads as one surface.
    setSearchOpen(true)
    setDateFilterOpen(true)
    setJumpOpen(false)
    jumpToDate(jumpRange.from)
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
  const countedDayButton = useMemo(
    () => makeDayButton(chatDayCounts, chatPeakDay?.count ?? 0),
    [chatDayCounts, chatPeakDay]
  )

  const chatDaySet = useMemo(() => {
    const s = new Set<string>()
    for (const m of messages) s.add(dayKey(m.ts))
    return s
  }, [messages])
  const todayHasMsg = useMemo(
    () => chatDaySet.has(dayKey(new Date().toISOString())),
    [chatDaySet]
  )

  /* -------- 10-i: month buckets for the timeline scrubber -------- */
  const scrubMonths = useMemo<ScrubMonth[]>(() => {
    const map = new Map<string, { count: number; label: string }>()
    for (const m of messages) {
      const d = new Date(m.ts)
      if (Number.isNaN(d.getTime())) continue
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const entry = map.get(key)
      if (entry) {
        entry.count++
      } else {
        map.set(key, {
          count: 1,
          label: d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
        })
      }
    }
    return [...map.entries()].map(([key, v]) => ({
      key,
      label: v.label,
      count: v.count,
    }))
  }, [messages])
  const firstMsgDay = messages.length ? new Date(messages[0].ts) : null
  const lastMsgDay = messages.length
    ? new Date(messages[messages.length - 1].ts)
    : null

  /** Shared calendar body for the jump-to-date popovers (desktop + mobile). */
  const jumpPopoverBody = (
    <div className="flex flex-col items-center">
      {/* Mode toggle — single-day jump vs date-range explorer (idea #2) */}
      <div
        role="tablist"
        aria-label="Calendar mode"
        className="flex w-[272px] gap-1 px-2 pt-2"
      >
        <Button
          variant="ghost"
          size="sm"
          role="tab"
          aria-selected={jumpMode === 'day'}
          className={cn(
            'h-7 flex-1 gap-1 rounded-full text-[12px]',
            jumpMode === 'day'
              ? 'bg-(--wa-accent)/10 font-medium text-(--wa-accent)'
              : 'text-(--wa-text-2)'
          )}
          onClick={() => setJumpMode('day')}
        >
          <CalendarDays className="h-3.5 w-3.5" /> Single day
        </Button>
        <Button
          variant="ghost"
          size="sm"
          role="tab"
          aria-selected={jumpMode === 'range'}
          className={cn(
            'h-7 flex-1 gap-1 rounded-full text-[12px]',
            jumpMode === 'range'
              ? 'bg-(--wa-accent)/10 font-medium text-(--wa-accent)'
              : 'text-(--wa-text-2)'
          )}
          onClick={() => {
            setJumpMode('range')
            // Prefill from the active date filter (once) so refining is quick.
            if (!jumpRange?.from && (fromDate || toDate)) {
              setJumpRange({
                from: fromDate ? new Date(`${fromDate}T00:00:00`) : undefined,
                to: toDate ? new Date(`${toDate}T00:00:00`) : undefined,
              })
            }
          }}
        >
          <CalendarRange className="h-3.5 w-3.5" /> Date range
        </Button>
      </div>
      <p className="w-full px-3 pb-1 pt-1.5 text-center text-[11px] leading-snug text-(--wa-text-2)">
        {jumpMode === 'day'
          ? 'Tap a highlighted date to jump there — bigger dots mean busier days.'
          : 'Pick two dates to explore just that stretch of the chat.'}
      </p>
      {jumpMode === 'day' ? (
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
        className="w-[272px] rounded-xl p-2 pb-1.5 [&_[data-selected-single=true]]:bg-(--wa-accent) [&_[data-selected-single=true]]:text-white"
      />
      ) : (
        <Calendar
          mode="range"
          selected={jumpRange}
          onSelect={(r) => setJumpRange(r ?? { from: undefined })}
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
          className="w-[272px] rounded-xl p-2 pb-1.5"
        />
      )}
      {jumpMode === 'day' ? (
        <>
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
        {todayHasMsg && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 flex-1 gap-1 rounded-full text-[12px] font-medium text-(--wa-accent)"
            onClick={() => jumpToDate(new Date())}
          >
            <CalendarDays className="h-3.5 w-3.5" /> Today
          </Button>
        )}
      </div>
        </>
      ) : (
        <div className="w-full border-t px-3 pb-2 pt-2">
          <p className="text-center text-[11px] leading-snug text-(--wa-text-2)">
            {jumpRange?.from && jumpRange?.to
              ? `${fmtShortDay(jumpRange.from)} – ${fmtShortDay(jumpRange.to)} · ${rangeMsgCount.toLocaleString()} message${rangeMsgCount === 1 ? '' : 's'}`
              : jumpRange?.from
                ? `From ${fmtShortDay(jumpRange.from)} — pick an end date`
                : 'Pick a start date'}
          </p>
          <div className="mt-1.5 flex gap-1.5">
            {hasDateFilter && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 rounded-full px-2.5 text-[12px] text-(--wa-text-2)"
                onClick={() => {
                  setFromDate('')
                  setToDate('')
                  setJumpRange({ from: undefined })
                }}
              >
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            )}
            <Button
              size="sm"
              className="h-7 flex-1 gap-1 rounded-full text-[12px] font-medium"
              disabled={!jumpRange?.from || !jumpRange?.to}
              onClick={applyJumpRange}
            >
              <CalendarRange className="h-3.5 w-3.5" /> Explore range
            </Button>
          </div>
        </div>
      )}
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
          <h2 className="text-[32px] font-light text-(--wa-text)">WA Archiver</h2>
          <p className="mt-4 text-sm leading-relaxed text-(--wa-text-2)">
            Import a WhatsApp chat export (.zip or .txt) to read your conversations
            here. Everything is stored locally in your own database — nothing leaves
            this device.
          </p>

          {hasChats === false && (onOpenDemo || onOpenImport) ? (
            <div className="anim-fade-up mt-7 flex flex-col items-center gap-3" style={{ animationDelay: '120ms' }}>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                {onOpenDemo && (
                  <Button
                    size="lg"
                    className="h-11 gap-2 rounded-full bg-(--wa-accent) px-6 text-[14px] font-medium text-white shadow-lg shadow-(--wa-accent)/25 hover:bg-(--wa-accent-strong)"
                    onClick={onOpenDemo}
                  >
                    <Sparkles className="h-4.5 w-4.5" aria-hidden />
                    Try demo chats
                  </Button>
                )}
                {onOpenImport && (
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-11 gap-2 rounded-full border-white/25 px-6 text-[14px] font-medium text-(--wa-text) hover:bg-white/10"
                    onClick={onOpenImport}
                  >
                    <FileUp className="h-4.5 w-4.5" aria-hidden />
                    Import a file
                  </Button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[12px] text-(--wa-text-2)">
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
                  100% offline
                </span>
                <span className="inline-flex items-center gap-1">
                  <Palette className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
                  17 themes
                </span>
                <span className="inline-flex items-center gap-1">
                  <BarChart3 className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
                  Stats &amp; rewind
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-6 text-[12px] uppercase tracking-wide text-(--wa-text-2)">
              Select a chat on the left to start reading
            </p>
          )}
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
    <div
      className="anim-fade-up relative flex min-h-0 flex-1 flex-col"
      style={accentVars ?? undefined}
    >
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
            <Avatar name={chat.title} size={40} src={customAvatar} />
          )}
          <div className="min-w-0">
            <h2 className="truncate text-[16px] font-medium leading-tight text-(--wa-text)">
              {chat.title}
            </h2>
            <p
              className="truncate text-[12.5px] text-(--wa-text-2)"
              title={
                typingName
                  ? undefined
                  : presence
                    ? "Simulated presence — exports don't carry live status"
                    : undefined
              }
            >
              {typingName ? (
                <span className="inline-flex items-center text-(--wa-accent-strong) dark:text-(--wa-accent)">
                  {typingName} is typing
                  <span className="wa-ellipsis-dots" aria-hidden>
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
              ) : (
                <>
                  {presence?.online && (
                    <span className="relative mr-1.5 inline-flex h-2 w-2 align-middle" aria-hidden>
                      <span className="absolute inline-flex h-full w-full rounded-full bg-[#25d366] opacity-60 motion-safe:animate-ping" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-[#25d366]" />
                    </span>
                  )}
                  {subtitle}
                </>
              )}
            </p>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
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
          {/* Jump to date — visible at every width now (was ≥sm only) */}
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
          {/* Wallpaper dialog is controlled from the More menu now. The picker
              renders a Radix Popover that needs a trigger anchor to position
              against, so we give it an invisible 1px sliver in the icon row
              and click it programmatically from the menu. */}
          <WallpaperPicker
            chatId={chatId}
            chatTitle={chat.title}
            open={wallpaperOpen}
            onOpenChange={setWallpaperOpen}
          >
            <span
              ref={wallpaperAnchorRef}
              aria-hidden
              tabIndex={-1}
              className="h-9 w-px shrink-0"
            />
          </WallpaperPicker>
          {/* Export / print menu (#10): .txt, .zip, .html, .json, .csv, print/PDF */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="wa-iconbtn h-9 w-9"
                aria-label="Export or print chat"
                title="Export / print — .txt, .zip, .html, .json, .csv, PDF"
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
              <DropdownMenuItem onClick={handleExportHtml} className="gap-2">
                <FileCode2 className="h-4 w-4 text-(--wa-text-2)" />
                Export .html (viewable page)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExportFormat('json')}
                className="gap-2"
              >
                <Braces className="h-4 w-4 text-(--wa-text-2)" />
                Export .json (raw data)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleExportFormat('csv')}
                className="gap-2"
              >
                <Sheet className="h-4 w-4 text-(--wa-text-2)" />
                Export .csv (spreadsheet)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPdf} className="gap-2">
                <FileType2 className="h-4 w-4 text-(--wa-text-2)" />
                {pdfT(t, 'pdf.menu', 'PDF document')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => void handleVerifyExport()}
                disabled={verifyBusy}
                className="gap-2"
              >
                {verifyBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-(--wa-text-2)" />
                ) : (
                  <ShieldCheck className="h-4 w-4 text-(--wa-text-2)" />
                )}
                Verify round-trip (self-test)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openPrint} className="gap-2">
                <Printer className="h-4 w-4 text-(--wa-text-2)" />
                Print / Save as PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Consolidated chat menu — the tools that used to crowd the header
              live here as labelled sections (Modes / Browse / Tools /
              Customize). Rendered at every width so desktop and mobile share
              one predictable layout. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="wa-iconbtn h-9 w-9"
                aria-label="More chat tools"
                title="More"
              >
                <MoreVertical className="h-5 w-5 text-(--wa-text-2)" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-56"
              onCloseAutoFocus={(e) => {
                if (wallpaperFromMenu.current) {
                  e.preventDefault()
                  wallpaperFromMenu.current = false
                  requestAnimationFrame(() =>
                    wallpaperAnchorRef.current?.click()
                  )
                } else if (jumpFromMenu.current) {
                  e.preventDefault()
                  jumpFromMenu.current = false
                  requestAnimationFrame(() => setJumpOpen(true))
                }
              }}
            >
              {/* Modes */}
              <DropdownMenuItem
                onClick={() => (selecting ? exitSelection() : enterSelection())}
                className="gap-2"
              >
                <ListChecks
                  className={cn(
                    'h-4 w-4',
                    selecting ? 'text-(--wa-accent)' : 'text-(--wa-text-2)'
                  )}
                />
                {selecting ? 'Exit selection' : 'Select messages'}
                {selecting && (
                  <span
                    className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-(--wa-accent)"
                    aria-hidden
                  />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleReadOnly} className="gap-2">
                <Eye
                  className={cn(
                    'h-4 w-4',
                    readOnly ? 'text-(--wa-accent)' : 'text-(--wa-text-2)'
                  )}
                />
                {readOnly ? 'Editing view' : 'Read-only view'}
                {readOnly && (
                  <span
                    className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-(--wa-accent)"
                    aria-hidden
                  />
                )}
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-(--wa-text-2)">
                Browse
              </DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => {
                  if (onOpenMediaHub) onOpenMediaHub()
                  else setGalleryOpen(true)
                }}
                className="gap-2"
              >
                <Images className="h-4 w-4 text-(--wa-text-2)" />
                Media gallery
              </DropdownMenuItem>
              {/* Calendar (#4): second, discoverable entry point — opens the
                  same jump-to-date popover as the header button. */}
              <DropdownMenuItem
                onClick={() => {
                  jumpFromMenu.current = true
                }}
                className="gap-2"
              >
                <CalendarDays className="h-4 w-4 text-(--wa-text-2)" />
                Jump to date
              </DropdownMenuItem>
              {/* Bookmarks (idea #3): named message shortcuts with a live count. */}
              <DropdownMenuItem
                onClick={() => setBookmarksOpen(true)}
                className="gap-2"
              >
                <Bookmark className="h-4 w-4 text-(--wa-text-2)" />
                Bookmarks
                {bookmarks.length > 0 && (
                  <span className="ml-auto rounded-full bg-(--wa-accent) px-1.5 text-[10px] font-bold leading-4 text-white">
                    {bookmarks.length}
                  </span>
                )}
              </DropdownMenuItem>

              <DropdownMenuLabel className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-(--wa-text-2)">
                Tools
              </DropdownMenuLabel>
              {/* Idea #18 — distraction-free reading mode */}
              <DropdownMenuItem
                onClick={() => setReadingOpen(true)}
                className="gap-2"
              >
                <BookOpenText className="h-4 w-4 text-(--wa-text-2)" />
                Reading mode
              </DropdownMenuItem>
              {/* Idea #2 — relationship insights (1:1 chats; groups get a variant) */}
              <DropdownMenuItem
                onClick={() => setInsightsOpen(true)}
                className="gap-2"
              >
                <HeartHandshake className="h-4 w-4 text-(--wa-text-2)" />
                Relationship insights
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setWordCloudOpen(true)}
                className="gap-2"
              >
                <Hash className="h-4 w-4 text-(--wa-text-2)" />
                Word cloud
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setTldrOpen(true)}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4 text-(--wa-text-2)" />
                Summarize with AI
              </DropdownMenuItem>
              {/* Idea #1 — wrapped-style per-chat rewind. */}
              <DropdownMenuItem
                onClick={() => setRewindOpen(true)}
                className="gap-2"
              >
                <PartyPopper className="h-4 w-4 text-(--wa-text-2)" />
                Year in review
              </DropdownMenuItem>
              {/* Unsend + edit history log (v1.8.1). */}
              <DropdownMenuItem
                onClick={() => setChangesOpen(true)}
                className="gap-2"
              >
                <History className="h-4 w-4 text-(--wa-text-2)" />
                Message changes
              </DropdownMenuItem>

              <DropdownMenuLabel className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-(--wa-text-2)">
                Customize
              </DropdownMenuLabel>
              {/* Opening a Radix Popover from a DropdownMenu item races the
                  menu's own close: the post-close focus restore lands outside
                  the freshly-mounted popover and Radix dismisses it. So we
                  flag the item, block the focus restore just for it, and
                  click the hidden wallpaper anchor in onCloseAutoFocus (after
                  the menu has fully finished tearing down). */}
              <DropdownMenuItem
                onClick={() => {
                  wallpaperFromMenu.current = true
                }}
                className="gap-2"
              >
                <Palette className="h-4 w-4 text-(--wa-text-2)" />
                Chat wallpaper
              </DropdownMenuItem>

              {/* 14-b: demo-only toggle — personas answer your texts here.
                  onSelect preventDefault keeps the menu open so the Switch
                  visibly flips; onClick does the actual toggling (exactly
                  once — Radix fires select after click). */}
              {isDemoChat && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={toggleAutoReply}
                    onSelect={(e) => e.preventDefault()}
                    className="gap-2"
                    aria-label={`Simulated replies — ${
                      autoReplyOn ? 'on' : 'off'
                    }`}
                  >
                    <Bot className="h-4 w-4 text-(--wa-text-2)" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-tight">
                        Simulated replies
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] leading-tight text-(--wa-text-2)">
                        {autoReplyOn
                          ? 'On — personas answer your texts'
                          : 'Off'}
                      </span>
                    </span>
                    <Switch
                      checked={autoReplyOn}
                      tabIndex={-1}
                      aria-hidden
                      className="pointer-events-none"
                    />
                  </DropdownMenuItem>
                </>
              )}

              {/* Chat info button is ≥lg only — keep it reachable below lg. */}
              <DropdownMenuItem
                onClick={() => setInfoOpen(true)}
                className="gap-2 lg:hidden"
              >
                <Info className="h-4 w-4 text-(--wa-text-2)" />
                Chat info
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

      {/* Messages (+ timeline scrubber overlay, 10-i). The wrapper hosts the
          scrubber so it stays fixed over the list viewport while the inner
          div scrolls. */}
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          setShowFab(el.scrollHeight - el.scrollTop - el.clientHeight > 400)
          // 14-f: classify the scroll — a deviation from our own auto-scroll
          // target (or any scroll once it settled) is the user's own, which
          // ends the clamped-open pill exception.
          if (autoScrollSettlingRef.current) {
            const t = autoScrollTargetRef.current
            if (t == null || Math.abs(el.scrollTop - t) > 4) {
              autoScrollSettlingRef.current = false
              userScrolledRef.current = true
            }
          } else {
            userScrolledRef.current = true
          }
          updateUnreadPill(el)
        }}
        style={{ '--wa-msg-size': `${msgFontPx}px` } as React.CSSProperties}
        className="wa-scroll relative flex-1 overflow-y-auto overflow-x-hidden py-3"
        role="log"
        aria-label={`Messages in ${chat.title}`}
      >
        {chat.messageCount > messages.length && (
          <div className="mx-auto mb-3 flex max-w-fit items-center gap-1.5 rounded-full bg-(--wa-in) px-3.5 py-1.5 text-[11.5px] font-medium text-(--wa-text-2) shadow-sm dark:bg-(--wa-panel-2)">
            <Info className="h-3.5 w-3.5 shrink-0 text-(--wa-accent)" />
            <span>
              Showing the latest {messages.length.toLocaleString()} of{' '}
              {chat.messageCount.toLocaleString()} messages — older history is
              beyond the viewer's {MAX_RENDER_MESSAGES.toLocaleString()}-
              message window.
            </span>
          </div>
        )}
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
          if (item.kind === 'unread-divider') {
            return (
              <div
                key={item.key}
                data-unread-divider
                className="my-3 flex items-center gap-2 px-2"
              >
                <span
                  aria-hidden
                  className="min-w-6 flex-1 border-t-2 border-emerald-500/70"
                />
                <span
                  aria-hidden
                  className="rounded-full bg-(--wa-in)/95 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-emerald-600 shadow-[0_1px_1px_rgba(11,20,26,0.12)] backdrop-blur-sm dark:bg-(--wa-panel-2)/95 dark:text-emerald-400"
                >
                  Unread messages
                </span>
                <span
                  aria-hidden
                  className="min-w-6 flex-1 border-t-2 border-emerald-500/70"
                />
                <span className="sr-only">Unread messages start here</span>
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
              data-msg-id={item.msg.id}
              className={cn(
                'animate-in fade-in slide-in-from-bottom-1 mt-(--wa-gap,2px) rounded-lg duration-300 transition-colors',
                item.showTail && 'mt-(--wa-gap-tail,10px)',
                jumpedId === item.msg.id &&
                  'bg-amber-200/50 ring-1 ring-amber-400/60 dark:bg-amber-500/20',
                selecting &&
                  selectedIds.has(item.msg.id) &&
                  'bg-(--wa-accent)/[0.06]'
              )}
            >
              <MessageBubble
                msg={item.msg}
                chatId={chatId}
                chatTitle={chat.title}
                isGroup={chat.isGroup}
                showTail={item.showTail}
                showAvatar={item.showAvatar}
                onToggleStar={readOnly || selecting ? undefined : handleToggleStar}
                onReact={readOnly || selecting ? undefined : handleReact}
                onPinMessage={readOnly || selecting ? undefined : handlePinMessage}
                onTranslate={readOnly || selecting ? undefined : handleTranslate}
                onReply={readOnly || selecting ? undefined : handleReplyTo}
                onForwardSaved={readOnly || selecting ? undefined : forwardOne}
                onBookmark={
                  readOnly || selecting ? undefined : openBookmarkDraft
                }
                onEditMessage={readOnly || selecting ? undefined : openEdit}
                onEditSave={readOnly || selecting ? undefined : saveEditApi}
                onUnsend={
                  readOnly || selecting ? undefined : (m) => setUnsendTarget(m)
                }
                highlight={query.trim() || undefined}
                highlightRegex={regexMode && !!query.trim()}
                selectMode={selecting}
                selectionMode={selecting}
                selected={selecting && selectedIds.has(item.msg.id)}
                anySelected={selectedCount > 0}
                onToggleSelect={readOnly ? undefined : handleToggleSelect}
                linkPreview={linkPreviews.get(item.msg.id)}
              />
            </div>
          )
        })}

        {/* Simulated typing bubble (10-b) — three WhatsApp-style dots */}
        {typingName && !filtered && (
          <div
            data-typing-bubble
            className="wa-typing-bubble mt-0.5 flex items-end gap-2 px-2 sm:px-4"
          >
            {chat.isGroup && (
              <Avatar name={typingName} size={28} className="mb-0.5" />
            )}
            <div
              className="flex items-center rounded-[7.5px] bg-(--wa-in) px-3 py-2.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] dark:bg-(--wa-panel-2)"
              role="status"
              aria-label={`${typingName} is typing`}
            >
              <span className="wa-typing-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
      </div>

        {/* Timeline scrubber (10-i) — month ticks, drag/wheel/keyboard jumps */}
        <TimelineScrubber
          months={scrubMonths}
          onPick={handleScrubPick}
          containerRef={scrollRef}
        />

        {/* Scroll-to-bottom FAB (WhatsApp style) — springs in/out of view.
            Anchored INSIDE the message wrapper so its bottom edge always sits
            just above the composer, whatever the composer's current height
            (bare input vs input + smart-reply chips) — no overlap possible. */}
        <button
          onClick={handleScrollToBottom}
          aria-label="Scroll to latest messages"
          aria-hidden={!showFab || searchOpen}
          tabIndex={showFab && !searchOpen ? 0 : -1}
          className={cn(
            'absolute bottom-3 right-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-(--wa-in) text-(--wa-text-2) shadow-[0_1px_3px_rgba(11,20,26,0.3)] transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] hover:scale-110 active:scale-90 dark:bg-(--wa-panel-2) dark:text-(--wa-text-2)',
            showFab && !searchOpen
              ? 'translate-y-0 scale-100 opacity-100'
              : 'pointer-events-none translate-y-4 scale-50 opacity-0'
          )}
        >
          <ChevronDown className="h-6 w-6" />
        </button>

        {/* Unread pill (14-f) — WhatsApp-style "N new messages" (emerald).
            Stacked above the movie-mode FAB (bottom-[60px] + h-11), which is
            stacked above the scroll-to-bottom chevron (bottom-3 + h-10) — a
            clean 12px-gapped column with zero overlap between the three. */}
        {unreadInfo && unreadInfo.count > 0 && (
          <button
            type="button"
            onClick={handleUnreadPillClick}
            aria-label="Jump to unread messages"
            aria-hidden={!showUnreadPill || selecting || searchOpen}
            tabIndex={showUnreadPill && !selecting && !searchOpen ? 0 : -1}
            className={cn(
              'absolute bottom-[116px] right-4 z-20 flex h-9 items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 text-[12.5px] font-medium text-white shadow-lg transition-all duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] hover:bg-emerald-500 active:scale-95 dark:bg-emerald-600 dark:hover:bg-emerald-500',
              showUnreadPill && !selecting && !searchOpen
                ? 'translate-y-0 scale-100 opacity-100'
                : 'pointer-events-none translate-y-4 scale-50 opacity-0'
            )}
          >
            <ArrowDown className="h-4 w-4 shrink-0" aria-hidden />
            <span className="whitespace-nowrap tabular-nums">
              {unreadInfo.count} new message{unreadInfo.count === 1 ? '' : 's'}
            </span>
          </button>
        )}

        {/* Movie mode (10-i) — entry FAB + playback bar (auto-scroll the chat) */}
        <MovieMode
          containerRef={scrollRef}
          enabled={movieMode}
          onEnabledChange={setMovieMode}
        />
      </div>

      {/* Reading mode (idea #18) — full-screen clean transcript overlay */}
      {readingOpen && (
        <ReadingMode
          onClose={() => setReadingOpen(false)}
          chatTitle={chat.title}
          isGroup={chat.isGroup}
          messages={messages}
        />
      )}

      {/* Relationship insights (idea #2) — on-device friendship dashboard */}
      <RelationshipPanel
        open={insightsOpen}
        onOpenChange={setInsightsOpen}
        chatTitle={chat.title}
        isGroup={chat.isGroup}
        messages={messages}
      />

      {/* Multi-select floating action bar (10-b) — slides up over the composer
          slot, safe-area aware; all buttons ≥44px. */}
      {selecting && selectedCount > 0 ? (
        <div
          className="wa-select-bar absolute inset-x-0 bottom-0 z-30 border-t border-black/5 bg-(--wa-panel-2) px-2 pt-2 shadow-[0_-6px_20px_rgba(11,20,26,0.14)] dark:border-white/5 dark:bg-(--wa-panel-2)"
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
          role="toolbar"
          aria-label="Selected message actions"
        >
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={exitSelection}
              aria-label="Cancel selection"
              title="Cancel"
            >
              <X className="h-5 w-5 text-(--wa-text-2)" />
            </Button>
            <span className="min-w-0 flex-1 truncate px-1 text-[13.5px] font-medium text-(--wa-text)">
              {selectedCount} selected
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={starSelected}
              aria-label="Star selected"
              title="Star selected"
            >
              <Star className="h-5 w-5 text-[#f2a33c]" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={() => openForwardDialog(selectedMessages)}
              aria-label="Forward selected"
              title="Forward to another chat"
            >
              <Forward className="h-5 w-5 text-(--wa-accent)" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hidden h-11 w-11 shrink-0 sm:inline-flex"
              onClick={copySelected}
              aria-label="Copy selected"
              title="Copy selected messages"
            >
              <Copy className="h-5 w-5 text-(--wa-text-2)" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hidden h-11 w-11 shrink-0 sm:inline-flex"
              onClick={selectAll}
              aria-label="Select all messages"
              title="Select all"
            >
              <ListChecks className="h-5 w-5 text-(--wa-text-2)" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0 hover:bg-rose-500/10"
              onClick={() => setDeleteConfirm(true)}
              aria-label="Delete selected"
              title="Delete for everyone"
            >
              <Trash2 className="h-5 w-5 text-rose-500/90" />
            </Button>
          </div>
        </div>
      ) : readOnly ? (
        <>
          {schedBar}
          {/* Read-only viewing strip — editing is the default (10-b), so this
           only appears after the user deliberately switches to viewing mode. */}
          <div className="relative z-10 bg-(--wa-panel-2) px-3 py-2.5 dark:bg-(--wa-panel-2)">
            <div className="flex items-center justify-center gap-2 rounded-lg bg-(--wa-text-2)/10 px-4 py-2.5 text-[13px] text-(--wa-text-2) dark:bg-white/5 dark:text-(--wa-text-2)">
              <Lock className="h-3.5 w-3.5" />
              Read-only view — tap the pencil to interact
            </div>
          </div>
        </>
      ) : (
        <>
          {schedBar}
          {/* Composer — ACTIVE by default in every chat, incl. Saved Messages */}
          <Composer
            chatId={chatId}
            onSent={handleSent}
            onOpenPoll={() => setPollOpen(true)}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onJumpToReply={handleJumpToReply}
            suggestions={smartReplies}
            onShuffleReplies={() => setReplySalt((s) => s + 1)}
          />
        </>
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

      {/* Bookmarks list (idea #3) */}
      <BookmarksDialog
        open={bookmarksOpen}
        onOpenChange={setBookmarksOpen}
        bookmarks={bookmarks}
        onJump={jumpToBookmark}
        onDelete={(b) => {
          removeBookmark(chatId, b.id)
          toast.success('Bookmark removed')
        }}
      />

      {/* Year in review (idea #1) — wrapped-style rewind */}
      <YearInReviewDialog
        open={rewindOpen}
        onOpenChange={setRewindOpen}
        chatTitle={chat.title}
        isGroup={chat.isGroup}
        messages={messages}
      />

      {/* Bookmark naming (add/edit) */}
      <Dialog
        open={!!bookmarkDraft}
        onOpenChange={(o) => {
          if (!o) setBookmarkDraft(null)
        }}
      >
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[16px]">
              <Bookmark className="h-4 w-4 text-(--wa-accent)" />
              Bookmark message
            </DialogTitle>
            <DialogDescription className="text-[12.5px]">
              Name it so you can find it later under More ▸ Bookmarks.
            </DialogDescription>
          </DialogHeader>
          {bookmarkDraft && (
            <p className="max-h-20 overflow-y-auto rounded-lg bg-(--wa-in) px-3 py-2 text-[12.5px] leading-snug text-(--wa-text-2)">
              {(bookmarkDraft.body ?? '').trim().slice(0, 200) ||
                `[${bookmarkDraft.type}]`}
            </p>
          )}
          <Input
            value={bookmarkLabel}
            onChange={(e) => setBookmarkLabel(e.target.value)}
            placeholder="Bookmark name"
            maxLength={80}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitBookmark()
              }
            }}
          />
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full"
              onClick={() => setBookmarkDraft(null)}
            >
              Cancel
            </Button>
            <Button size="sm" className="rounded-full" onClick={commitBookmark}>
              Save bookmark
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* Unsend confirmation — tombstone, keeps the archive audit trail */}
      <AlertDialog
        open={unsendTarget !== null}
        onOpenChange={(o) => {
          if (!o) setUnsendTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsend this message?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be replaced with “This message was deleted” in this
              transcript — attached media is removed too. The entry itself
              stays in the archive as a record that a message was unsent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={(e) => {
                e.preventDefault()
                void executeUnsend()
              }}
              disabled={unsendBusy}
            >
              {unsendBusy ? 'Unsending…' : 'Unsend'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Forward to other chats (10-b) — searchable multi-target dialog */}
      <ForwardDialog
        open={!!forwardState}
        onOpenChange={(v) => {
          if (!v) setForwardState(null)
        }}
        messages={forwardState?.messages ?? []}
        sourceChatId={chatId}
        sourceChatTitle={chat.title}
        onForwarded={() => exitSelection()}
      />

      {/* AI message tools (translate / explain / ask-about-this-chat) — #13.
          onBuildContext feeds the device transport's inline transcript (the
          server transport is ignored — the route reads its own DB). */}
      <AIToolsDialog
        open={!!aiMsg}
        message={aiMsg}
        chatId={chatId}
        onBuildContext={() => buildAiContextLines(messages)}
        onOpenChange={(v) => {
          if (!v) setAiMsg(null)
        }}
      />

      {/* Per-chat edit / unsend history log (v1.8.1) */}
      <ChangesPanelDialog
        open={changesOpen}
        onOpenChange={setChangesOpen}
        chatId={chatId}
        chatTitle={chat.title}
      />

      {/* Round-trip export self-test result (v1.8.1) */}
      <Dialog open={verifyOpen} onOpenChange={setVerifyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-(--wa-accent)" aria-hidden />
              Export round-trip report
            </DialogTitle>
            <DialogDescription>
              The .txt export was rebuilt and re-parsed through the standard
              WhatsApp parser — here is how faithfully every message type
              survives the export → import cycle.
            </DialogDescription>
          </DialogHeader>
          {verifyReport && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 rounded-md bg-(--wa-accent)/10 p-3">
                <span className="text-2xl font-bold text-(--wa-accent-strong) dark:text-(--wa-accent)">
                  {verifyReport.fidelityPct}%
                </span>
                <span className="text-[12px] leading-snug text-(--wa-text-2)">
                  type fidelity · {verifyReport.typeMatched}/
                  {verifyReport.total} messages re-parsed as the same type (
                  {verifyReport.reparsed} rows recovered)
                </span>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {verifyReport.byType.map((t) => (
                  <li
                    key={t.type}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      t.matched === t.count
                        ? 'bg-(--wa-accent)/10 text-(--wa-accent-strong) dark:text-(--wa-accent)'
                        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    }`}
                    title={`${t.matched}/${t.count} round-tripped`}
                  >
                    {t.type} {t.matched}/{t.count}
                  </li>
                ))}
              </ul>
              {(verifyReport.reactionsTotal > 0 ||
                verifyReport.repliesTotal > 0) && (
                <div className="grid grid-cols-2 gap-2 text-[11.5px]">
                  {verifyReport.reactionsTotal > 0 && (
                    <div className="rounded-md bg-black/[0.03] p-2 dark:bg-white/[0.05]">
                      <p className="font-semibold text-(--wa-text)">
                        Reactions{' '}
                        <span
                          className={
                            verifyReport.reactionsMatched ===
                            verifyReport.reactionsTotal
                              ? 'text-(--wa-accent-strong) dark:text-(--wa-accent)'
                              : 'text-amber-600 dark:text-amber-400'
                          }
                        >
                          {verifyReport.reactionsMatched}/
                          {verifyReport.reactionsTotal}
                        </span>
                      </p>
                      <p className="text-[10.5px] leading-snug text-(--wa-text-2)">
                        folded back onto their messages
                      </p>
                    </div>
                  )}
                  {verifyReport.repliesTotal > 0 && (
                    <div className="rounded-md bg-black/[0.03] p-2 dark:bg-white/[0.05]">
                      <p className="font-semibold text-(--wa-text)">
                        Reply threads{' '}
                        <span
                          className={
                            verifyReport.repliesMatched ===
                            verifyReport.repliesTotal
                              ? 'text-(--wa-accent-strong) dark:text-(--wa-accent)'
                              : 'text-amber-600 dark:text-amber-400'
                          }
                        >
                          {verifyReport.repliesMatched}/
                          {verifyReport.repliesTotal}
                        </span>
                      </p>
                      <p className="text-[10.5px] leading-snug text-(--wa-text-2)">
                        quotes re-detected on import
                      </p>
                    </div>
                  )}
                </div>
              )}
              {verifyReport.losses.length > 0 && (
                <div className="rounded-md border border-black/[0.06] p-2 text-[11.5px] leading-snug text-(--wa-text-2) dark:border-white/10">
                  <p className="mb-1 font-semibold text-(--wa-text)">
                    Known / detected losses
                  </p>
                  <ul className="list-inside list-disc">
                    {verifyReport.losses.map((l) => (
                      <li key={l.idx}>
                        #{l.idx} · {l.type} → {l.became}
                        {l.note ? ` — ${l.note}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[10.5px] leading-snug text-(--wa-text-2)">
                The same transcript builder that produced your .txt download
                was re-parsed, so this is exactly what a re-import of the file
                would restore.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Word cloud (10-i) — most used words; picking seeds in-chat search */}
      <WordCloudDialog
        open={wordCloudOpen}
        onOpenChange={setWordCloudOpen}
        chatId={chatId}
        chatTitle={chat.title}
        onPickWord={handlePickWord}
      />

      {/* AI chat summary (Task 12-c) — ⋮ menu + desktop Sparkles button.
          onBuildContext feeds the device transport's inline transcript. */}
      <TldrDialog
        chatId={chatId}
        open={tldrOpen}
        onOpenChange={setTldrOpen}
        onBuildContext={() => buildAiContextLines(messages)}
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
                  className="print-row flex gap-2 border-b border-neutral-200 py-1 text-[12.5px] leading-snug"
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
          {/* Repeats on every printed page via position:fixed in @media print
              (chat-extras.css). Chromium can't render counter(page), so this
              carries the chat title + export date instead (honest footer). */}
          <footer className="print-page-footer" aria-hidden>
            {chat.title} · Exported {new Date().toLocaleString('en-GB')}
          </footer>
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
