'use client'

import './bubble-extras.css'

import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  Ban,
  BarChart3,
  Bookmark,
  BookmarkPlus,
  Check,
  Copy,
  Download,
  FileText,
  Forward,
  Languages,
  MapPin,
  Mic,
  Pencil,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Pin,
  PinOff,
  Reply,
  SmilePlus,
  Star,
  StarOff,
  UserRound,
  Video,
  X,
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Avatar } from './Avatar'
import { BubbleTail, TicksDouble } from './icons'
import { Lightbox } from './Lightbox'
import { VoicePlayer } from './VoicePlayer'
import { PollBubble } from './PollBubble'
import {
  copyMessage,
  getReactions,
  iReacted,
  isPinned,
  MENU_REACTIONS,
  MessageActionSheet,
  QUICK_REACTIONS,
} from './MessageActionSheet'
import { displayMediaSrc } from './media-src'
import { colorForName, initialsForName, type ChatMessage } from './types'
import { cn } from '@/lib/utils'

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]+/)
  return m ? m[0] : null
}

/* ------------------------------------------------------------------ */
/* Reply quotes (task 10-a)                                            */
/* ------------------------------------------------------------------ */

/** Short label for media-ish quoted messages with no caption. */
const QUOTE_MEDIA_LABEL: Record<string, string> = {
  image: 'Photo',
  video: 'Video',
  gif: 'GIF',
  audio: 'Voice message',
  sticker: 'Sticker',
  document: 'Document',
  contact: 'Contact card',
  location: 'Location',
  poll: 'Poll',
  media: 'Media',
  call: 'Missed call',
  deleted: 'Deleted message',
}

/**
 * Scroll the original quoted message into view and flash it. No-op when the
 * target is not rendered (it may sit outside the visible window) or was
 * deleted from the DOM.
 */
function jumpToQuotedMessage(id: string) {
  if (typeof document === 'undefined') return
  let target: HTMLElement | null = null
  try {
    target = document.querySelector(`[data-mid="${CSS.escape(id)}"]`) as
      | HTMLElement
      | null
  } catch {
    return
  }
  if (!target) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  // Restart the flash even if the class is still attached from a prior jump.
  target.classList.remove('wa-quote-flash')
  void target.offsetWidth
  target.classList.add('wa-quote-flash')
  window.setTimeout(() => target?.classList.remove('wa-quote-flash'), 1700)
}

/**
 * WhatsApp-style quoted block rendered inside the bubble: colored sender
 * name over a 2-line-truncated body, click jumps to the original message.
 */
function ReplyQuote({
  replyTo,
  interactive,
}: {
  replyTo: NonNullable<ChatMessage['replyTo']>
  interactive: boolean
}) {
  const mine = replyTo.sender === 'You'
  const name = replyTo.sender || 'Unknown'
  const color = mine ? 'var(--wa-accent-strong)' : colorForName(name)
  let body = (replyTo.body ?? '').trim()
  if (replyTo.type === 'deleted') {
    body = 'This message was deleted'
  } else {
    const label = QUOTE_MEDIA_LABEL[replyTo.type]
    if (label) body = body ? `${label} · ${body}` : label
    if (!body) body = 'Message'
  }
  const shared = (
    <>
      <span
        className="wa-quote-bar"
        style={{ background: mine ? 'var(--wa-accent)' : color }}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="wa-quote-name" style={{ color }}>
          {mine ? 'You' : name}
        </span>
        <span
          className={cn(
            'wa-quote-body',
            replyTo.type === 'deleted' && 'italic'
          )}
        >
          {body}
        </span>
      </span>
    </>
  )
  if (!interactive) {
    return <span className="wa-quote wa-quote-static">{shared}</span>
  }
  return (
    <button
      type="button"
      className="wa-quote"
      onClick={(e) => {
        e.stopPropagation()
        jumpToQuotedMessage(replyTo.id)
      }}
      aria-label={`Jump to quoted message from ${mine ? 'You' : name}`}
    >
      {shared}
    </button>
  )
}

/**
 * WhatsApp-style link preview card (client-injected via the linkPreview prop,
 * text messages only). The whole card links out; a broken image hides itself.
 */
function LinkPreviewCard({
  preview,
}: {
  preview: NonNullable<ChatMessage['linkPreview']>
}) {
  let host = preview.siteName ?? ''
  try {
    host = new URL(preview.url).hostname.replace(/^www\./, '')
  } catch {
    /* keep siteName fallback */
  }
  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      className="wa-linkprev"
      aria-label={preview.title || preview.url}
    >
      {preview.image && (
        <img
          src={preview.image}
          alt=""
          loading="lazy"
          className="wa-linkprev-img"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      )}
      <span className="wa-linkprev-body">
        <span className="wa-linkprev-host">{host || preview.url}</span>
        {preview.title && (
          <span className="wa-linkprev-title">{preview.title}</span>
        )}
        {preview.description && (
          <span className="wa-linkprev-desc">{preview.description}</span>
        )}
      </span>
    </a>
  )
}

/** Visual press feedback while long-pressing (Radix opens the context menu). */
function usePressFeedback() {
  const startXY = useRef<{ x: number; y: number } | null>(null)
  const [pressing, setPressing] = useState(false)

  function clear() {
    startXY.current = null
    setPressing(false)
  }

  return {
    pressing,
    handlers: {
      onPointerDown(e: React.PointerEvent) {
        if (e.pointerType === 'mouse') return
        startXY.current = { x: e.clientX, y: e.clientY }
        setPressing(true)
      },
      onPointerMove(e: React.PointerEvent) {
        if (!startXY.current) return
        const dx = e.clientX - startXY.current.x
        const dy = e.clientY - startXY.current.y
        if (dx * dx + dy * dy > 64) clear() // scrolled/dragged — cancel
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
    },
  }
}

const COARSE_POINTER_QUERY = '(pointer: coarse)'

function subscribeCoarsePointer(onChange: () => void) {
  const mq = window.matchMedia(COARSE_POINTER_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

const serverCoarsePointer = () => false

/** SSR-safe coarse-pointer detection (touch phones / tablets), live-updating. */
function useCoarsePointer(): boolean {
  const getSnapshot = useCallback(
    () => window.matchMedia(COARSE_POINTER_QUERY).matches,
    []
  )
  return useSyncExternalStore(
    subscribeCoarsePointer,
    getSnapshot,
    serverCoarsePointer
  )
}

/**
 * Custom long-press for coarse pointers — fires after 450ms unless the finger
 * moves >10px (scroll) or lifts/cancels. On touch devices the Radix
 * ContextMenu is skipped entirely to avoid double long-press menus.
 */
function useLongPress(onFire: () => void, enabled: boolean) {
  const timer = useRef<number | null>(null)
  const startXY = useRef<{ x: number; y: number } | null>(null)
  const [pressing, setPressing] = useState(false)

  function clear() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    startXY.current = null
    setPressing(false)
  }

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  return {
    pressing,
    handlers: {
      onPointerDown(e: React.PointerEvent) {
        if (!enabled || timer.current !== null) return
        startXY.current = { x: e.clientX, y: e.clientY }
        setPressing(true)
        timer.current = window.setTimeout(() => {
          timer.current = null
          navigator.vibrate?.(15)
          onFire()
        }, 450)
      },
      onPointerMove(e: React.PointerEvent) {
        if (!startXY.current) return
        const dx = e.clientX - startXY.current.x
        const dy = e.clientY - startXY.current.y
        if (dx * dx + dy * dy > 100) clear() // moved >10px — it's a scroll
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
    },
  }
}

/** Floating ❤️ burst spawned at the cursor on double-click. */
function useHeartBurst() {
  const [hearts, setHearts] = useState<{ id: number; x: number; y: number }[]>([])
  const seq = useRef(0)

  const spawnHeart = (x: number, y: number) => {
    const id = ++seq.current
    setHearts((list) => [...list, { id, x, y }])
    window.setTimeout(() => {
      setHearts((list) => list.filter((h) => h.id !== id))
    }, 750)
  }

  const heartsNode =
    hearts.length > 0 ? (
      <div className="pointer-events-none fixed inset-0 z-[80]" aria-hidden="true">
        {hearts.map((h) => (
          <span
            key={h.id}
            className="wa-heart-float"
            style={{ left: h.x, top: h.y }}
            onAnimationEnd={() =>
              setHearts((list) => list.filter((t) => t.id !== h.id))
            }
          >
            ❤️
          </span>
        ))}
      </div>
    ) : null

  return { spawnHeart, heartsNode }
}

/** Per-bubble extras: coarse long-press → action sheet, double-click → ❤️. */
function useMessageExtras(
  msg: ChatMessage,
  opts: {
    selectMode?: boolean
    onReact?: (msgId: string, emoji: string) => void
  }
) {
  const coarse = useCoarsePointer()
  const [sheetOpen, setSheetOpen] = useState(false)
  const longPress = useLongPress(
    () => setSheetOpen(true),
    coarse && !opts.selectMode
  )
  const { spawnHeart, heartsNode } = useHeartBurst()

  const onBubbleDoubleClick = (e: React.MouseEvent) => {
    if (opts.selectMode || !opts.onReact) return
    const target = e.target as HTMLElement | null
    if (
      target?.closest(
        'a, button, img, video, audio, input, textarea, [role="button"]'
      )
    )
      return
    spawnHeart(e.clientX, e.clientY)
    opts.onReact(msg.id, '❤️')
  }

  return {
    coarse,
    sheetOpen,
    setSheetOpen,
    longPress,
    onBubbleDoubleClick,
    heartsNode,
  }
}

/* ------------------------------------------------------------------ */
/* Swipe-to-reply (task 10-a)                                          */
/* ------------------------------------------------------------------ */

const SWIPE_REPLY_MAX = 72
const SWIPE_REPLY_TRIGGER = 56
const SWIPE_REPLY_ENGAGE = 10

type PointerHandlerSet = Partial<
  Record<
    | 'onPointerDown'
    | 'onPointerMove'
    | 'onPointerUp'
    | 'onPointerCancel'
    | 'onPointerLeave',
    (e: React.PointerEvent) => void
  >
>

/**
 * Run several pointer-handler sets from a single element: every present
 * handler key is composed (all sets receive the event in order).
 */
function composePointerHandlers(...sets: PointerHandlerSet[]): PointerHandlerSet {
  const out: PointerHandlerSet = {}
  for (const key of [
    'onPointerDown',
    'onPointerMove',
    'onPointerUp',
    'onPointerCancel',
    'onPointerLeave',
  ] as const) {
    const fns = sets
      .map((s) => s[key])
      .filter((f): f is (e: React.PointerEvent) => void => typeof f === 'function')
    if (fns.length > 0) {
      out[key] = (e: React.PointerEvent) => {
        for (const f of fns) f(e)
      }
    }
  }
  return out
}

/**
 * WhatsApp-style swipe-to-reply on coarse pointers: the bubble follows the
 * finger up to 72px (incoming slides right, outgoing slides left) with a
 * reply icon fading in; releasing past 56px fires `onReply`. Mouse pointers
 * are ignored, vertical scrolling is untouched (touch-action: pan-y), and
 * prefers-reduced-motion skips the translate but keeps the trigger.
 */
function useSwipeToReply(
  msg: ChatMessage,
  onReply: ((m: ChatMessage) => void) | undefined,
  side: 'in' | 'out'
): {
  dx: number
  mode: 'idle' | 'drag' | 'settle'
  handlers: PointerHandlerSet
  /** End the settle phase after the spring-back transition finishes. */
  markIdle: () => void
} {
  const start = useRef<{ x: number; y: number } | null>(null)
  const engaged = useRef(false)
  const offset = useRef(0)
  const reduced = useRef(false)
  const [dx, setDx] = useState(0)
  const [mode, setMode] = useState<'idle' | 'drag' | 'settle'>('idle')
  const markIdle = useCallback(() => setMode('idle'), [])

  const settle = useCallback(() => {
    start.current = null
    engaged.current = false
    setMode('settle')
    setDx(0)
  }, [])

  const handlers = useMemo<PointerHandlerSet>(() => {
    if (!onReply) return {}
    return {
      onPointerDown(e) {
        if (e.pointerType === 'mouse' || start.current) return
        // Don't hijack gestures that start on interactive children.
        if (
          (e.target as HTMLElement | null)?.closest?.(
            'a, button, video, audio, input, textarea, img'
          )
        )
          return
        start.current = { x: e.clientX, y: e.clientY }
        reduced.current = window.matchMedia(
          '(prefers-reduced-motion: reduce)'
        ).matches
      },
      onPointerMove(e) {
        if (!start.current) return
        const raw = e.clientX - start.current.x
        const dy = e.clientY - start.current.y
        const signed = side === 'in' ? raw : -raw
        if (!engaged.current) {
          // Horizontal intent only — never fight vertical scrolling.
          if (signed > SWIPE_REPLY_ENGAGE && Math.abs(raw) > Math.abs(dy) * 1.2) {
            engaged.current = true
            setMode('drag')
          } else {
            return
          }
        }
        offset.current = Math.min(Math.max(signed, 0), SWIPE_REPLY_MAX)
        if (!reduced.current) setDx(offset.current)
      },
      onPointerUp() {
        if (!start.current) return
        const wasEngaged = engaged.current
        const hit = offset.current >= SWIPE_REPLY_TRIGGER
        if (wasEngaged) {
          settle()
          if (hit) {
            navigator.vibrate?.(12)
            onReply(msg)
          }
        } else {
          start.current = null
          setMode('idle')
          setDx(0)
        }
      },
      onPointerCancel: settle,
      onPointerLeave() {
        if (start.current) settle()
      },
    }
  }, [msg, onReply, side, settle])

  return { dx, mode, handlers, markIdle }
}

/** Timestamp pill overlaid on chromeless stickers. */
function StickerTime({ msg, outgoing }: { msg: ChatMessage; outgoing: boolean }) {
  return (
    <span className="wa-sticker-time" aria-hidden="true">
      <span className="whitespace-nowrap">{formatTime(msg.ts)}</span>
      {msg.edited && <span className="italic">edited</span>}
      {msg.starred && (
        <Star className="h-2.5 w-2.5 fill-[#f2a33c] text-[#f2a33c]" />
      )}
      {outgoing && <TicksDouble className="opacity-95" />}
    </span>
  )
}

/**
 * Inline edit composer shown inside a bubble (outgoing text only).
 * Enter saves, Escape cancels, textarea auto-grows to 160px; both buttons
 * keep a ≥44px touch target.
 */
function InlineEditBox({
  initial,
  saving,
  onCancel,
  onSave,
}: {
  initial: string
  saving: boolean
  onCancel: () => void
  onSave: (body: string) => void
}) {
  const [draft, setDraft] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)

  const autosize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    autosize(el)
  }, [])

  return (
    <div className="wa-edit-box">
      <textarea
        ref={ref}
        rows={1}
        value={draft}
        disabled={saving}
        aria-label="Edit message text"
        className="wa-edit-area"
        onChange={(e) => {
          setDraft(e.target.value)
          autosize(e.target)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (!saving && draft.trim()) onSave(draft.trim())
          }
        }}
      />
      <div className="mt-0.5 flex items-center justify-end gap-0.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          aria-label="Cancel editing"
          title="Cancel"
          className="wa-edit-btn"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => draft.trim() && onSave(draft.trim())}
          disabled={saving || !draft.trim()}
          aria-label="Save edit"
          title="Save"
          className="wa-edit-btn wa-edit-btn-save"
        >
          <Check className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/**
 * Telegram-style reaction pills — rendered INSIDE the bubble along its floor
 * (never floating outside it). My reaction sorts first with an accent tint;
 * the key includes the count so the pill re-pops whenever it changes.
 */
function ReactionPills({
  msg,
  side,
  onReact,
}: {
  msg: ChatMessage
  side: 'in' | 'out'
  onReact?: (msgId: string, emoji: string) => void
}) {
  const reactions = getReactions(msg)
  if (!reactions) return null
  const list = Object.entries(reactions)
    .map(([emoji, senders]) => ({
      emoji,
      senders,
      mine: senders.includes('You'),
    }))
    .sort(
      (a, b) =>
        Number(b.mine) - Number(a.mine) || b.senders.length - a.senders.length
    )
  if (list.length === 0) return null
  const who = (senders: string[]) =>
    senders.map((s) => (s === 'You' ? 'You' : s)).join(', ')
  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-1',
        side === 'out' ? 'justify-end' : 'justify-start'
      )}
    >
      {list.map(({ emoji, senders, mine }) => (
        <button
          key={`${emoji}:${senders.length}:${mine ? 'me' : 'x'}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onReact?.(msg.id, emoji)
          }}
          title={`${who(senders)} reacted ${emoji}`}
          aria-label={`${who(senders)} reacted ${emoji}. Tap to toggle your reaction.`}
          className={cn(
            'wa-chip-pop flex items-center gap-1 rounded-full px-2 py-[3px] shadow-sm transition-transform hover:scale-105 active:scale-90',
            mine
              ? 'bg-(--wa-accent)/[0.16] ring-1 ring-inset ring-(--wa-accent)/50 dark:bg-(--wa-accent)/30'
              : 'bg-black/[0.06] ring-1 ring-inset ring-black/[0.06] dark:bg-white/[0.14] dark:ring-white/[0.08]'
          )}
        >
          <span className="text-[13.5px] leading-none">{emoji}</span>
          <span
            className={cn(
              'text-[11.5px] font-semibold leading-none',
              mine
                ? 'text-(--wa-accent-strong) dark:text-(--wa-accent)'
                : 'text-(--wa-text-2)'
            )}
          >
            {senders.length}
          </span>
        </button>
      ))}
    </div>
  )
}

/**
 * Bubble floor: when reactions exist, Telegram lays the pills along the
 * bubble's inside floor with the timestamp pushed to the far edge — mirror
 * that. Without reactions, keep the classic inline meta untouched.
 */
function BubbleMetaRow({
  msg,
  outgoing,
  side,
  onReact,
}: {
  msg: ChatMessage
  outgoing: boolean
  side: 'in' | 'out'
  onReact?: (msgId: string, emoji: string) => void
}) {
  const reactions = getReactions(msg)
  const hasReactions = !!reactions && Object.keys(reactions).length > 0
  if (!hasReactions) {
    return <Meta msg={msg} outgoing={outgoing} onMedia={false} />
  }
  return (
    <div
      className="wa-pill-land mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <ReactionPills msg={msg} side={side} onReact={onReact} />
      <Meta
        msg={msg}
        outgoing={outgoing}
        onMedia={false}
        className="ml-auto translate-y-0"
      />
    </div>
  )
}

function mediaSrc(chatId: string, msg: ChatMessage): string | null {
  return displayMediaSrc(chatId, msg.mediaPath)
}

/**
 * Renders text with every case-insensitive occurrence of `query` wrapped in a
 * <mark> — used while the in-chat search is active. With `regex`, the query is
 * interpreted as a regular expression instead (invalid patterns render as-is).
 */
export function Highlight({
  text,
  query,
  regex,
}: {
  text: string
  query?: string
  regex?: boolean
}) {
  const q = query?.trim()
  if (!q) return <>{text}</>
  const parts: React.ReactNode[] = []
  if (regex) {
    let re: RegExp
    try {
      re = new RegExp(q, 'gi')
    } catch {
      return <>{text}</>
    }
    let i = 0
    let key = 0
    let guard = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1
        continue
      }
      if (++guard > 500) break // safety valve for pathological patterns
      if (m.index > i) parts.push(text.slice(i, m.index))
      parts.push(
        <mark
          key={key++}
          className="rounded-[3px] bg-[#ffe084] px-[1px] text-inherit dark:bg-[#937317]/70"
        >
          {m[0]}
        </mark>
      )
      i = m.index + m[0].length
    }
    if (i < text.length) parts.push(text.slice(i))
    return <>{parts}</>
  }
  const lower = text.toLowerCase()
  const ql = q.toLowerCase()
  let i = 0
  let pos = lower.indexOf(ql)
  let key = 0
  while (pos !== -1) {
    if (pos > i) parts.push(text.slice(i, pos))
    parts.push(
      <mark
        key={key++}
        className="rounded-[3px] bg-[#ffe084] px-[1px] text-inherit dark:bg-[#937317]/70"
      >
        {text.slice(pos, pos + ql.length)}
      </mark>
    )
    i = pos + ql.length
    pos = lower.indexOf(ql, i)
  }
  if (i < text.length) parts.push(text.slice(i))
  return <>{parts}</>
}

const EMOJI_PICTOGRAPHIC = new RegExp('\\p{Extended_Pictographic}', 'u')

/** True when a body is made purely of emoji — WhatsApp renders those ~2.4x. */
function isEmojiOnly(text: string): boolean {
  const t = text.replace(/\s+/g, '')
  if (!t || t.length > 12) return false
  let sawEmoji = false
  for (const ch of t) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp === 0xfe0f || cp === 0x200d || cp === 0x20e3) continue
    if (cp >= 0x1f3fb && cp <= 0x1f3ff) continue // skin-tone modifiers
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) continue // regional indicators (flags)
    if (EMOJI_PICTOGRAPHIC.test(ch)) {
      sawEmoji = true
      continue
    }
    return false
  }
  return sawEmoji
}

const URL_SPLIT_RE = /(https?:\/\/[^\s]+)/g
const URL_TRAILING_RE = /[.,;:!?)\]}'"…»>]+$/

/**
 * Text body with WhatsApp-style URL linkification, layered with search
 * highlighting (URLs themselves are never highlighted).
 */
function LinkifiedText({
  text,
  query,
  regex,
}: {
  text: string
  query?: string
  regex?: boolean
}) {
  const chunks = text.split(URL_SPLIT_RE)
  return (
    <>
      {chunks.map((chunk, i) => {
        if (i % 2 === 1) {
          const m = chunk.match(URL_TRAILING_RE)
          const tail = m ? m[0] : ''
          const url = tail ? chunk.slice(0, chunk.length - tail.length) : chunk
          return (
            <span key={i}>
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(e) => e.stopPropagation()}
                className="break-all text-(--wa-link) underline decoration-(--wa-link)/35 underline-offset-2 hover:decoration-(--wa-link)"
              >
                {url}
              </a>
              {tail}
            </span>
          )
        }
        return <Highlight key={i} text={chunk} query={query} regex={regex} />
      })}
    </>
  )
}

/** Forwarded header chip — marks a message that was saved/forwarded here. */
function ForwardedChip({ from }: { from: string }) {
  return (
    <p className="mb-0.5 flex items-center gap-1 text-[12.5px] font-medium italic text-(--wa-accent-strong)">
      <Forward className="h-3.5 w-3.5 shrink-0" />
      Forwarded from {from}
    </p>
  )
}

interface MetaProps {
  msg: ChatMessage
  outgoing: boolean
  onMedia: boolean
  className?: string
}

function Meta({ msg, outgoing, onMedia, className }: MetaProps) {
  return (
    <span
      className={cn(
        'ml-2 inline-flex translate-y-[3px] items-center gap-1 text-[11px] leading-none',
        outgoing
          ? onMedia
            ? 'text-white/80'
            : 'text-(--wa-text-2)'
          : onMedia
            ? 'text-white/80'
            : 'text-(--wa-text-2)',
        className
      )}
    >
      {isPinned(msg) && (
        <Pin
          className={cn(
            'h-3 w-3 shrink-0 rotate-45',
            onMedia ? 'text-white/80' : 'text-(--wa-text-2)'
          )}
          aria-hidden="true"
        />
      )}
      <span className="whitespace-nowrap">{formatTime(msg.ts)}</span>
      {msg.edited && (
        <span className="whitespace-nowrap italic opacity-80">edited</span>
      )}
      {msg.starred && (
        <Star className="h-3 w-3 fill-[#f2a33c] text-[#f2a33c] drop-shadow-sm" />
      )}
      {outgoing && <TicksDouble />}
    </span>
  )
}

function MediaPlaceholder({
  icon,
  label,
}: {
  icon: React.ReactNode
  label: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-black/5 px-3 py-2 dark:bg-white/5">
      {icon}
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-(--wa-text)">
          {label}
        </p>
        <p className="text-[11px] text-(--wa-text-2)">
          Media not included in this export
        </p>
      </div>
    </div>
  )
}

function DocumentChip({ name, src }: { name: string; src: string | null }) {
  const inner = (
    <div className="flex items-center gap-2.5 rounded-md bg-black/5 px-3 py-2.5 transition-colors dark:bg-white/5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-(--wa-accent)/10 text-(--wa-accent)">
        <FileText className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="max-w-[200px] truncate text-[13.5px] font-medium text-(--wa-text)">
          {name}
        </p>
        <p className="text-[11px] text-(--wa-text-2)">
          {src ? 'Tap to open' : 'Not included in this export'}
        </p>
      </div>
    </div>
  )
  return src ? (
    <a href={src} target="_blank" rel="noreferrer" className="block">
      {inner}
    </a>
  ) : (
    inner
  )
}

/** In-bubble photo with lightbox opening on click. */
function ImageContent({
  msg,
  src,
  highlight,
  highlightRegex,
}: {
  msg: ChatMessage
  src: string | null
  highlight?: string
  highlightRegex?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (!src) {
    return (
      <MediaPlaceholder
        icon={
          <i className="flex h-8 w-8 items-center justify-center rounded bg-black/10 text-[13px] font-semibold dark:bg-white/10">
            IMG
          </i>
        }
        label={msg.mediaName ?? 'Photo'}
      />
    )
  }
  return (
    <>
      <figure className="min-w-0 max-w-[280px]">
        <img
          src={src}
          alt={msg.mediaName ?? 'Shared image'}
          loading="lazy"
          className="min-w-0 max-h-[320px] w-full cursor-zoom-in rounded-md object-cover"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(true)
          }}
        />
        {msg.body && (
          <figcaption className="mt-1 whitespace-pre-wrap">
            <LinkifiedText text={msg.body} query={highlight} regex={highlightRegex} />
          </figcaption>
        )}
      </figure>
      {open && (
        <Lightbox
          src={src}
          caption={msg.body || msg.mediaName}
          downloadName={msg.mediaName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

interface BubbleMenuProps {
  msg: ChatMessage
  src: string | null
  onToggleStar?: (id: string, starred: boolean) => void
  onForwardSaved?: (msg: ChatMessage) => void
  onBookmark?: (msg: ChatMessage) => void
  onEditMessage?: (msg: ChatMessage) => void
  /** Inline-edit starter (bubble-local composer, outgoing text only). */
  onStartInlineEdit?: (msg: ChatMessage) => void
  onReply?: (msg: ChatMessage) => void
  onReact?: (msgId: string, emoji: string) => void
  onPinMessage?: (msg: ChatMessage) => void
  onTranslate?: (msg: ChatMessage) => void
}

/** WhatsApp-style message context menu (right-click / long-press). */
function BubbleMenu({
  msg,
  src,
  onToggleStar,
  onForwardSaved,
  onBookmark,
  onEditMessage,
  onStartInlineEdit,
  onReply,
  onReact,
  onPinMessage,
  onTranslate,
}: BubbleMenuProps) {
  const canInlineEdit =
    !!onStartInlineEdit && msg.sender === 'You' && msg.type === 'text'
  const canDialogEdit =
    !!onEditMessage &&
    msg.sender === 'You' &&
    (msg.type === 'text' || msg.type === 'poll')
  return (
    <ContextMenuContent className="min-w-[200px]">
      {onReply && (
        <ContextMenuItem onClick={() => onReply(msg)} className="gap-2">
          <Reply className="h-4 w-4 text-(--wa-accent)" /> Reply
        </ContextMenuItem>
      )}
      {onReact && (
        <ContextMenuItem
          onContextMenu={(e) => e.preventDefault()}
          className="gap-1"
        >
          <div className="flex items-center gap-0.5">
            {MENU_REACTIONS.map((em) => (
              <span
                key={em}
                role="button"
                aria-label={`React ${em}`}
                title={`React ${em}`}
                tabIndex={0}
                onClick={() => onReact(msg.id, em)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onReact(msg.id, em)
                  }
                }}
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-lg transition-transform hover:scale-125 focus-visible:outline-2 focus-visible:outline-(--wa-accent) motion-reduce:transition-none"
              >
                {em}
              </span>
            ))}
          </div>
        </ContextMenuItem>
      )}
      {(onReply || onReact) && <ContextMenuSeparator />}
      {onPinMessage && (
        <ContextMenuItem onClick={() => onPinMessage(msg)} className="gap-2">
          {isPinned(msg) ? (
            <>
              <PinOff className="h-4 w-4" /> Unpin message
            </>
          ) : (
            <>
              <Pin className="h-4 w-4" /> Pin message
            </>
          )}
        </ContextMenuItem>
      )}
      {onTranslate && (
        <ContextMenuItem onClick={() => onTranslate(msg)} className="gap-2">
          <Languages className="h-4 w-4 text-(--wa-accent)" /> Translate with AI
        </ContextMenuItem>
      )}
      {(onPinMessage || onTranslate) && <ContextMenuSeparator />}
      {onForwardSaved && (
        <ContextMenuItem
          onClick={() => onForwardSaved(msg)}
          className="gap-2"
        >
          <BookmarkPlus className="h-4 w-4 text-(--wa-accent)" /> Forward to
          Saved Messages
        </ContextMenuItem>
      )}
      {(canInlineEdit || canDialogEdit) && (
        <ContextMenuItem
          onClick={() => {
            if (canInlineEdit) onStartInlineEdit(msg)
            else onEditMessage?.(msg)
          }}
          className="gap-2"
        >
          <Pencil className="h-4 w-4" /> Edit message
        </ContextMenuItem>
      )}
      {onToggleStar && (
        <ContextMenuItem
          onClick={() => onToggleStar(msg.id, !msg.starred)}
          className="gap-2"
        >
          {msg.starred ? (
            <>
              <StarOff className="h-4 w-4 text-[#f2a33c]" /> Unstar message
            </>
          ) : (
            <>
              <Star className="h-4 w-4 text-[#f2a33c]" /> Star message
            </>
          )}
        </ContextMenuItem>
      )}
      {onBookmark && (
        <ContextMenuItem
          onClick={() => onBookmark(msg)}
          className="gap-2"
        >
          <Bookmark className="h-4 w-4 text-(--wa-accent)" /> Bookmark message
        </ContextMenuItem>
      )}
      <ContextMenuItem onClick={() => copyMessage(msg)} className="gap-2">
        <Copy className="h-4 w-4" /> Copy message
      </ContextMenuItem>
      {src && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem asChild className="gap-2">
            <a href={src} download={msg.mediaName ?? true}>
              <Download className="h-4 w-4" /> Download media
            </a>
          </ContextMenuItem>
        </>
      )}
    </ContextMenuContent>
  )
}

interface HoverActionsProps {
  msg: ChatMessage
  onToggleStar?: (id: string, starred: boolean) => void
  onForwardSaved?: (msg: ChatMessage) => void
  onBookmark?: (msg: ChatMessage) => void
  onReact?: (msgId: string, emoji: string) => void
  /** Which side of the bubble the actions sit on — drives slide direction. */
  side: 'in' | 'out'
}

const ACTION_STAGGER = [
  'group-hover/msg:delay-1000',
  'group-hover/msg:delay-[1.08s]',
  'group-hover/msg:delay-[1.16s]',
  'group-hover/msg:delay-[1.24s]',
]

function HoverActions({
  msg,
  onToggleStar,
  onForwardSaved,
  onBookmark,
  onReact,
  side,
}: HoverActionsProps) {
  const [reactOpen, setReactOpen] = useState(false)
  // Buttons take their stagger slot in render order — when the reaction button
  // is absent the remaining buttons keep the exact original 1s/1.08s/1.16s
  // delays (never write ms-suffixed arbitrary delays here: twMerge mangles them).
  let step = 0
  const nextStagger = () =>
    ACTION_STAGGER[Math.min(step++, ACTION_STAGGER.length - 1)]
  const btn = (stagger: string, extra?: string) =>
    cn(
      'mb-1 hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--wa-in) text-(--wa-text-2) shadow-md sm:flex',
      'opacity-0 scale-75 will-change-transform',
      side === 'in' ? '-translate-x-2' : 'translate-x-2',
      'transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none',
      '[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]',
      // 1s deliberate pause before the actions pop out (instant on leave)
      'group-hover/msg:translate-x-0 group-hover/msg:scale-100 group-hover/msg:opacity-100',
      'focus-visible:translate-x-0 focus-visible:scale-100 focus-visible:opacity-100 focus-visible:delay-0',
      stagger,
      extra
    )
  return (
    <>
      {onReact && (
        <Popover open={reactOpen} onOpenChange={setReactOpen}>
          <PopoverTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              aria-label="React to message"
              title="React to message"
              className={btn(
                nextStagger(),
                reactOpen
                  ? 'opacity-100 translate-x-0 scale-100 delay-0'
                  : undefined
              )}
            >
              <SmilePlus className="h-3.5 w-3.5 transition-[color,transform] duration-150 hover:scale-125 hover:text-(--wa-accent)" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side={side === 'in' ? 'right' : 'left'}
            align="end"
            onClick={(e) => e.stopPropagation()}
            className="w-auto rounded-2xl p-2"
          >
            <div className="grid grid-cols-4 gap-1">
              {QUICK_REACTIONS.map((em) => (
                <button
                  key={em}
                  onClick={() => {
                    onReact(msg.id, em)
                    setReactOpen(false)
                  }}
                  aria-label={`React ${em}`}
                  title={`React ${em}`}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full text-xl transition-transform hover:scale-125 motion-reduce:transition-none',
                    iReacted(msg, em) &&
                      'bg-(--wa-accent)/15 ring-2 ring-(--wa-accent)'
                  )}
                >
                  {em}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {onForwardSaved && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onForwardSaved(msg)
          }}
          aria-label="Forward to Saved Messages"
          title="Forward to Saved Messages"
          className={btn(nextStagger())}
        >
          <BookmarkPlus className="h-3.5 w-3.5 transition-[color,transform] duration-150 hover:scale-125 hover:text-(--wa-accent)" />
        </button>
      )}
      {onToggleStar && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleStar(msg.id, !msg.starred)
          }}
          aria-label={msg.starred ? 'Unstar message' : 'Star message'}
          title={msg.starred ? 'Unstar message' : 'Star message'}
          className={btn(nextStagger())}
        >
          <Star
            className={cn(
              'h-3.5 w-3.5 transition-[color,transform] duration-150 hover:scale-125',
              msg.starred
                ? 'fill-[#f2a33c] text-[#f2a33c]'
                : 'hover:fill-[#f2a33c]/40 hover:text-[#f2a33c]'
            )}
          />
        </button>
      )}
      {onBookmark && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onBookmark(msg)
          }}
          aria-label="Bookmark message"
          title="Bookmark message"
          className={btn(nextStagger())}
        >
          <Bookmark className="h-3.5 w-3.5 transition-[color,transform] duration-150 hover:scale-125 hover:text-(--wa-accent)" />
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation()
          copyMessage(msg)
        }}
        aria-label="Copy message"
        title="Copy message"
        className={btn(nextStagger())}
      >
        <Copy className="h-3.5 w-3.5 transition-transform duration-150 hover:scale-125" />
      </button>
    </>
  )
}

/** WhatsApp-style selection circle shown in select mode. */
function SelectCircle({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        selected
          ? 'border-(--wa-accent) bg-(--wa-accent)'
          : 'border-(--wa-text-2) bg-white/70 dark:bg-black/30'
      )}
      aria-hidden
    >
      {selected && <Check className="h-3.5 w-3.5 text-white" />}
    </span>
  )
}

export function MessageBubble({
  msg,
  chatId,
  chatTitle,
  isGroup,
  showTail,
  showAvatar,
  onToggleStar,
  highlight,
  highlightRegex,
  selectMode,
  selectionMode,
  selected,
  anySelected,
  onToggleSelect,
  onForwardSaved,
  onBookmark,
  onEditMessage,
  onEditSave,
  onReply,
  linkPreview,
  onReact,
  onPinMessage,
  onTranslate,
}: {
  msg: ChatMessage
  chatId: string
  /** Chat display name — feeds the floating audio dock metadata. */
  chatTitle?: string
  isGroup: boolean
  showTail: boolean
  showAvatar: boolean
  onToggleStar?: (id: string, starred: boolean) => void
  highlight?: string
  highlightRegex?: boolean
  selectMode?: boolean
  /** Alias for selectMode — merged (either turns selection on). */
  selectionMode?: boolean
  selected?: boolean
  anySelected?: boolean
  onToggleSelect?: (id: string) => void
  onForwardSaved?: (msg: ChatMessage) => void
  onBookmark?: (msg: ChatMessage) => void
  onEditMessage?: (msg: ChatMessage) => void
  /** Inline edit saver — resolves true when the edit was persisted. */
  onEditSave?: (id: string, body: string) => Promise<boolean>
  /** Reply starter (swipe-to-reply, context menu, action sheet). */
  onReply?: (m: ChatMessage) => void
  /** Client-injected link preview (text messages only). */
  linkPreview?: ChatMessage['linkPreview']
  onReact?: (msgId: string, emoji: string) => void
  onPinMessage?: (msg: ChatMessage) => void
  onTranslate?: (msg: ChatMessage) => void
}) {
  const outgoing = msg.sender === 'You'
  const senderColor = useMemo(
    () => colorForName(msg.sender ?? ''),
    [msg.sender]
  )
  const src = mediaSrc(chatId, msg)
  const selectActive = !!(selectMode || selectionMode)
  const press = usePressFeedback()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const extras = useMessageExtras(msg, {
    selectMode: selectActive || editing,
    onReact,
  })
  const canInlineEdit =
    !!onEditSave &&
    msg.sender === 'You' &&
    msg.type === 'text' &&
    !selectActive
  const startEdit = useCallback(() => {
    if (canInlineEdit) setEditing(true)
  }, [canInlineEdit])
  const saveEdit = useCallback(
    async (body: string) => {
      if (!onEditSave || saving) return
      setSaving(true)
      try {
        const ok = await onEditSave(msg.id, body)
        if (ok) setEditing(false)
      } finally {
        setSaving(false)
      }
    },
    [onEditSave, saving, msg.id]
  )
  const swipe = useSwipeToReply(
    msg,
    !selectActive && !editing ? onReply : undefined,
    'in'
  )
  const chromelessSticker = msg.type === 'sticker' && !!src
  const swipeEnabled = !!onReply && !selectActive && !editing
  const swipeStyle =
    swipe.mode === 'idle' && swipe.dx === 0
      ? undefined
      : ({
          transform: `translateX(${swipe.dx}px)`,
          transition:
            swipe.mode === 'drag'
              ? 'none'
              : 'transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        } as React.CSSProperties)
  const pointerHandlers = selectActive
    ? {}
    : composePointerHandlers(
        extras.coarse ? extras.longPress.handlers : press.handlers,
        swipe.handlers
      )

  if (outgoing) {
    return (
      <OutgoingBubble
        msg={msg}
        chatId={chatId}
        chatTitle={chatTitle}
        showTail={showTail}
        src={src}
        onToggleStar={onToggleStar}
        highlight={highlight}
        highlightRegex={highlightRegex}
        selectMode={selectActive}
        selected={selected}
        anySelected={anySelected}
        onToggleSelect={onToggleSelect}
        onForwardSaved={onForwardSaved}
        onBookmark={onBookmark}
        onEditMessage={onEditMessage}
        onEditSave={onEditSave}
        onReply={onReply}
        linkPreview={linkPreview}
        onReact={onReact}
        onPinMessage={onPinMessage}
        onTranslate={onTranslate}
      />
    )
  }

  if (selectActive) {
    return (
      <div
        className={cn(
          'group/msg flex items-center gap-2 px-2 transition-opacity sm:px-4',
          anySelected && !selected && 'opacity-50'
        )}
        onClick={() => onToggleSelect?.(msg.id)}
        role="checkbox"
        aria-checked={!!selected}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            onToggleSelect?.(msg.id)
          }
        }}
      >
        <SelectCircle selected={!!selected} />
        {isGroup ? (
          showAvatar ? (
            <Avatar name={msg.sender ?? '?'} size={28} className="mb-0.5" />
          ) : (
            <div className="w-7 shrink-0" />
          )
        ) : null}
        <div className="relative min-w-0 max-w-[78%] drop-shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] dark:drop-shadow-[0_1px_0.5px_rgba(0,0,0,0.25)] sm:max-w-[65%]">
          {showTail && !chromelessSticker && (
            <BubbleTail
              side="left"
              className="absolute -left-[7px] top-0 fill-(--wa-in)"
            />
          )}
          <div
            className={cn(
              'relative text-(length:--wa-msg-size,14.2px) leading-[1.34]',
              chromelessSticker
                ? 'wa-sticker-host'
                : cn(
                    'rounded-[7.5px] px-2.5 py-1.5',
                    'bg-(--wa-in) text-(--wa-text)',
                    // Sharp corner where the tail attaches — merges seamlessly
                    showTail && 'rounded-tl-none'
                  ),
              selected && 'ring-2 ring-(--wa-accent)'
            )}
          >
            {isGroup && msg.sender && !chromelessSticker && (
              <p
                className="mb-0.5 text-[12.5px] font-semibold leading-tight"
                style={{ color: senderColor }}
              >
                {msg.sender}
              </p>
            )}
            {msg.replyTo && (
              <ReplyQuote replyTo={msg.replyTo} interactive={false} />
            )}
            <Content
              msg={msg}
              chatId={chatId}
              chatTitle={chatTitle}
              src={src}
              outgoing={false}
              highlight={highlight}
              highlightRegex={highlightRegex}
              linkPreview={linkPreview}
            />
            {chromelessSticker ? (
              <StickerTime msg={msg} outgoing={false} />
            ) : (
              <BubbleMetaRow msg={msg} outgoing={false} side="in" />
            )}
          </div>
        </div>
      </div>
    )
  }

  const bubbleWithTail = (
    <div
      className={cn(
        'relative min-w-0 max-w-full',
        chromelessSticker
          ? 'drop-shadow-[0_2px_5px_rgba(11,20,26,0.22)]'
          : 'drop-shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] dark:drop-shadow-[0_1px_0.5px_rgba(0,0,0,0.25)]'
      )}
    >
      {showTail && !chromelessSticker && (
        <BubbleTail
          side="left"
          className="absolute -left-[7px] top-0 fill-(--wa-in)"
        />
      )}
      {swipeEnabled && (
        <span
          aria-hidden="true"
          className="wa-swipe-hint pointer-events-none absolute top-1/2 left-1 -translate-y-1/2 text-(--wa-accent)"
          style={{
            opacity: swipe.dx > 6 ? Math.min(swipe.dx / 44, 1) : 0,
          }}
        >
          <Reply className="h-4 w-4 -scale-x-100" />
        </span>
      )}
      <div
        {...pointerHandlers}
        data-bubble
        onDoubleClick={extras.onBubbleDoubleClick}
        onContextMenu={
          extras.coarse ? (e) => e.preventDefault() : undefined
        }
        onTransitionEnd={(e) => {
          if (
            e.target === e.currentTarget &&
            e.propertyName === 'transform' &&
            swipe.mode === 'settle'
          )
            swipe.markIdle()
        }}
        style={swipeStyle}
        className={cn(
          'relative text-(length:--wa-msg-size,14.2px) leading-[1.34] transition-transform duration-150',
          chromelessSticker
            ? 'wa-sticker-host'
            : cn(
                'rounded-[7.5px] px-2.5 py-1.5',
                'bg-(--wa-in) text-(--wa-text)',
                // Sharp corner where the tail attaches — merges seamlessly
                showTail && 'rounded-tl-none'
              ),
          swipeEnabled && 'touch-pan-y',
          extras.coarse
            ? extras.longPress.pressing && 'wa-pressing-bubble'
            : press.pressing && 'scale-[0.98]'
        )}
      >
        {isGroup && msg.sender && !chromelessSticker && (
          <p
            className="mb-0.5 text-[12.5px] font-semibold leading-tight"
            style={{ color: senderColor }}
          >
            <Highlight text={msg.sender} query={highlight} regex={highlightRegex} />
          </p>
        )}
        {msg.replyTo && <ReplyQuote replyTo={msg.replyTo} interactive />}
        {editing ? (
          <InlineEditBox
            initial={msg.body}
            saving={saving}
            onCancel={() => setEditing(false)}
            onSave={saveEdit}
          />
        ) : (
          <>
            <Content
              msg={msg}
              chatId={chatId}
              chatTitle={chatTitle}
              src={src}
              outgoing={false}
              highlight={highlight}
              highlightRegex={highlightRegex}
              linkPreview={linkPreview}
            />
            {chromelessSticker ? (
              <StickerTime msg={msg} outgoing={false} />
            ) : (
              <BubbleMetaRow msg={msg} outgoing={false} side="in" onReact={onReact} />
            )}
          </>
        )}
      </div>
    </div>
  )

  return (
    <div className="group/msg flex items-end gap-1.5 px-2 sm:px-4">
      {isGroup ? (
        showAvatar ? (
          <Avatar name={msg.sender ?? '?'} size={28} className="mb-0.5" />
        ) : (
          <div className="w-7 shrink-0" />
        )
      ) : null}
      <div className="flex min-w-0 max-w-[78%] flex-col items-start gap-1 sm:max-w-[65%]">
        {extras.coarse ? (
          bubbleWithTail
        ) : (
          <ContextMenu>
            <ContextMenuTrigger asChild>{bubbleWithTail}</ContextMenuTrigger>
            <BubbleMenu
              msg={msg}
              src={src}
              onToggleStar={onToggleStar}
              onForwardSaved={onForwardSaved}
              onBookmark={onBookmark}
              onEditMessage={onEditMessage}
              onStartInlineEdit={canInlineEdit ? startEdit : undefined}
              onReply={swipeEnabled ? onReply : undefined}
              onReact={onReact}
              onPinMessage={onPinMessage}
              onTranslate={onTranslate}
            />
          </ContextMenu>
        )}
      </div>
      <HoverActions
        msg={msg}
        side="in"
        onToggleStar={onToggleStar}
        onForwardSaved={onForwardSaved}
        onBookmark={onBookmark}
        onReact={onReact}
      />
      {extras.heartsNode}
      <MessageActionSheet
        msg={msg}
        open={extras.sheetOpen}
        onOpenChange={extras.setSheetOpen}
        src={src}
        onReply={swipeEnabled ? onReply : undefined}
        onEdit={
          canInlineEdit
            ? () => {
                extras.setSheetOpen(false)
                startEdit()
              }
            : undefined
        }
        onReact={onReact}
        onToggleStar={onToggleStar}
        onForwardSaved={onForwardSaved}
        onBookmark={onBookmark}
        onPinMessage={onPinMessage}
        onTranslate={onTranslate}
        onToggleSelect={onToggleSelect}
      />
    </div>
  )
}

function OutgoingBubble({
  msg,
  chatId,
  chatTitle,
  showTail,
  src,
  onToggleStar,
  highlight,
  highlightRegex,
  selectMode,
  selected,
  anySelected,
  onToggleSelect,
  onForwardSaved,
  onBookmark,
  onEditMessage,
  onEditSave,
  onReply,
  linkPreview,
  onReact,
  onPinMessage,
  onTranslate,
}: {
  msg: ChatMessage
  chatId: string
  chatTitle?: string
  showTail: boolean
  src: string | null
  onToggleStar?: (id: string, starred: boolean) => void
  highlight?: string
  highlightRegex?: boolean
  selectMode?: boolean
  selected?: boolean
  anySelected?: boolean
  onToggleSelect?: (id: string) => void
  onForwardSaved?: (msg: ChatMessage) => void
  onBookmark?: (msg: ChatMessage) => void
  onEditMessage?: (msg: ChatMessage) => void
  onEditSave?: (id: string, body: string) => Promise<boolean>
  onReply?: (m: ChatMessage) => void
  linkPreview?: ChatMessage['linkPreview']
  onReact?: (msgId: string, emoji: string) => void
  onPinMessage?: (msg: ChatMessage) => void
  onTranslate?: (msg: ChatMessage) => void
}) {
  const press = usePressFeedback()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const extras = useMessageExtras(msg, {
    selectMode: selectMode || editing,
    onReact,
  })
  const canInlineEdit =
    !!onEditSave &&
    msg.sender === 'You' &&
    msg.type === 'text' &&
    !selectMode
  const startEdit = useCallback(() => {
    if (canInlineEdit) setEditing(true)
  }, [canInlineEdit])
  const saveEdit = useCallback(
    async (body: string) => {
      if (!onEditSave || saving) return
      setSaving(true)
      try {
        const ok = await onEditSave(msg.id, body)
        if (ok) setEditing(false)
      } finally {
        setSaving(false)
      }
    },
    [onEditSave, saving, msg.id]
  )
  const swipe = useSwipeToReply(
    msg,
    !selectMode && !editing ? onReply : undefined,
    'out'
  )
  const chromelessSticker = msg.type === 'sticker' && !!src
  const swipeEnabled = !!onReply && !selectMode && !editing
  const swipeStyle =
    swipe.mode === 'idle' && swipe.dx === 0
      ? undefined
      : ({
          transform: `translateX(${swipe.dx}px)`,
          transition:
            swipe.mode === 'drag'
              ? 'none'
              : 'transform 260ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        } as React.CSSProperties)
  const pointerHandlers = selectMode
    ? {}
    : composePointerHandlers(
        extras.coarse ? extras.longPress.handlers : press.handlers,
        swipe.handlers
      )

  const bubbleWithTail = (
    <div
      className={cn(
        'relative min-w-0 max-w-full',
        chromelessSticker
          ? 'drop-shadow-[0_2px_5px_rgba(11,20,26,0.22)]'
          : 'drop-shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] dark:drop-shadow-[0_1px_0.5px_rgba(0,0,0,0.25)]'
      )}
    >
      {showTail && !chromelessSticker && (
        <BubbleTail
          side="right"
          className="absolute -right-[7px] top-0 fill-(--wa-out)"
        />
      )}
      {swipeEnabled && (
        <span
          aria-hidden="true"
          className="wa-swipe-hint pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 text-(--wa-accent)"
          style={{
            opacity: swipe.dx > 6 ? Math.min(swipe.dx / 44, 1) : 0,
          }}
        >
          <Reply className="h-4 w-4" />
        </span>
      )}
      <div
        {...pointerHandlers}
        data-bubble
        onDoubleClick={extras.onBubbleDoubleClick}
        onContextMenu={
          !selectMode && extras.coarse ? (e) => e.preventDefault() : undefined
        }
        onTransitionEnd={(e) => {
          if (
            e.target === e.currentTarget &&
            e.propertyName === 'transform' &&
            swipe.mode === 'settle'
          )
            swipe.markIdle()
        }}
        style={swipeStyle}
        className={cn(
          'relative text-(length:--wa-msg-size,14.2px) leading-[1.34] transition-transform duration-150',
          chromelessSticker
            ? 'wa-sticker-host'
            : cn(
                'rounded-[7.5px] px-2.5 py-1.5',
                'bg-(--wa-out) text-(--wa-text) dark:text-(--wa-text)',
                // Sharp corner where the tail attaches — merges seamlessly
                showTail && 'rounded-tr-none'
              ),
          swipeEnabled && 'touch-pan-y',
          !selectMode &&
            (extras.coarse
              ? extras.longPress.pressing && 'wa-pressing-bubble'
              : press.pressing && 'scale-[0.98]'),
          selectMode && selected && 'ring-2 ring-(--wa-accent)'
        )}
      >
        {msg.forwardedFrom && !editing && !chromelessSticker && (
          <ForwardedChip from={msg.forwardedFrom} />
        )}
        {msg.replyTo && (
          <ReplyQuote replyTo={msg.replyTo} interactive={!selectMode} />
        )}
        {editing ? (
          <InlineEditBox
            initial={msg.body}
            saving={saving}
            onCancel={() => setEditing(false)}
            onSave={saveEdit}
          />
        ) : (
          <>
            <Content
              msg={msg}
              chatId={chatId}
              chatTitle={chatTitle}
              src={src}
              outgoing
              highlight={highlight}
              highlightRegex={highlightRegex}
              linkPreview={linkPreview}
            />
            {chromelessSticker ? (
              <StickerTime msg={msg} outgoing />
            ) : (
              <BubbleMetaRow
                msg={msg}
                outgoing
                side="out"
                onReact={selectMode ? undefined : onReact}
              />
            )}
          </>
        )}
      </div>
    </div>
  )

  if (selectMode) {
    return (
      <div
        className={cn(
          'group/msg flex items-center justify-end gap-2 px-2 transition-opacity sm:px-4',
          anySelected && !selected && 'opacity-50'
        )}
        onClick={() => onToggleSelect?.(msg.id)}
        role="checkbox"
        aria-checked={!!selected}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault()
            onToggleSelect?.(msg.id)
          }
        }}
      >
        <div className="flex min-w-0 max-w-[78%] flex-col items-end sm:max-w-[65%]">
          {bubbleWithTail}
        </div>
        <SelectCircle selected={!!selected} />
      </div>
    )
  }

  return (
    <div className="group/msg flex justify-end gap-1.5 px-2 sm:px-4">
      <HoverActions
        msg={msg}
        side="out"
        onToggleStar={onToggleStar}
        onForwardSaved={onForwardSaved}
        onBookmark={onBookmark}
        onReact={onReact}
      />
      <div className="flex min-w-0 max-w-[78%] flex-col items-end gap-1 sm:max-w-[65%]">
        {extras.coarse ? (
          bubbleWithTail
        ) : (
          <ContextMenu>
            <ContextMenuTrigger asChild>{bubbleWithTail}</ContextMenuTrigger>
            <BubbleMenu
              msg={msg}
              src={src}
              onToggleStar={onToggleStar}
              onForwardSaved={onForwardSaved}
              onBookmark={onBookmark}
              onEditMessage={onEditMessage}
              onStartInlineEdit={canInlineEdit ? startEdit : undefined}
              onReply={swipeEnabled ? onReply : undefined}
              onReact={onReact}
              onPinMessage={onPinMessage}
              onTranslate={onTranslate}
            />
          </ContextMenu>
        )}
      </div>
      {extras.heartsNode}
      <MessageActionSheet
        msg={msg}
        open={extras.sheetOpen}
        onOpenChange={extras.setSheetOpen}
        src={src}
        onReply={swipeEnabled ? onReply : undefined}
        onEdit={
          canInlineEdit
            ? () => {
                extras.setSheetOpen(false)
                startEdit()
              }
            : undefined
        }
        onReact={onReact}
        onToggleStar={onToggleStar}
        onForwardSaved={onForwardSaved}
        onBookmark={onBookmark}
        onPinMessage={onPinMessage}
        onTranslate={onTranslate}
        onToggleSelect={onToggleSelect}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Location & contact cards (Task 12-d)                                */
/* ------------------------------------------------------------------ */

interface ParsedLocation {
  lat: number | null
  lng: number | null
  label: string | null
  url: string | null
  /** Raw body — used by the link-less legacy placeholder. */
  text: string
  /** Body was a JSON payload — always render the card for these. */
  json: boolean
}

/** Trim a coordinate to a compact display form (5 decimals, no zeros). */
function formatCoord(n: number): string {
  return String(Number(n.toFixed(5)))
}

/**
 * Defensively parse a location message body. New sends store
 * `{"lat":..,"lng":..,"label":"..","url":".."}` (JSON string); legacy
 * imports carry plain text like `location: <maps url>` or a bare maps
 * link, or link-less notes such as "Live location" (see parser).
 */
function parseLocationMessage(body: string): ParsedLocation {
  const text = (body ?? '').trim()
  if (text.startsWith('{')) {
    try {
      const o: unknown = JSON.parse(text)
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        const rec = o as Record<string, unknown>
        const num = (v: unknown): number | null => {
          if (typeof v === 'number' && Number.isFinite(v)) return v
          if (
            typeof v === 'string' &&
            v.trim() !== '' &&
            Number.isFinite(Number(v))
          ) {
            return Number(v)
          }
          return null
        }
        // Only http(s) URLs are safe to render as <a href> — drop anything
        // else (e.g. javascript:) from stored/imported payloads.
        const rawUrl =
          typeof rec.url === 'string' && rec.url.trim()
            ? rec.url.trim().slice(0, 500)
            : null
        return {
          lat: num(rec.lat),
          lng: num(rec.lng),
          label:
            typeof rec.label === 'string' && rec.label.trim()
              ? rec.label.trim().slice(0, 120)
              : null,
          url: rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : null,
          text,
          json: true,
        }
      }
    } catch {
      /* fall through to legacy parsing */
    }
  }
  const url = extractUrl(text)
  let label: string | null = null
  if (url) {
    // Legacy: strip a leading `location:` marker and the URL itself.
    const stripped = text
      .replace(/^location:\s*/i, '')
      .replace(url, '')
      .replace(/[\s·|,–—-]+$/g, '')
      .trim()
    label = stripped ? stripped.slice(0, 120) : null
  }
  return { lat: null, lng: null, label, url, text, json: false }
}

/** Decorative map-ish media area (CSS grid pattern + centered pin). */
function LocationMapArea() {
  return (
    <div
      aria-hidden
      className="relative h-[140px] w-full"
      style={{
        backgroundImage: [
          'repeating-linear-gradient(0deg, rgba(11,20,26,0.05) 0, rgba(11,20,26,0.05) 1px, transparent 1px, transparent 20px)',
          'repeating-linear-gradient(90deg, rgba(11,20,26,0.05) 0, rgba(11,20,26,0.05) 1px, transparent 1px, transparent 20px)',
          'linear-gradient(150deg, #e9f0e6, #dbe8dc 55%, #cfe2d4)',
        ].join(','),
      }}
    >
      {/* decorative roads + park blobs */}
      <span className="absolute top-[52px] -left-6 h-[7px] w-[130%] -rotate-6 rounded-full bg-white/80" />
      <span className="absolute -top-4 left-10 h-[5px] w-[140%] rotate-[24deg] rounded-full bg-white/60" />
      <span className="absolute right-4 bottom-2 h-9 w-14 rounded-[40%] bg-[#b8d6aa]/45" />
      <span className="absolute top-2 left-3 h-6 w-9 rounded-[40%] bg-[#b8d6aa]/35" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-md ring-2 ring-(--wa-accent)">
          <MapPin className="h-[18px] w-[18px] text-(--wa-accent)" />
        </span>
      </div>
    </div>
  )
}

/** WhatsApp-style location card: map area + white label strip. */
function LocationCard({ loc }: { loc: ParsedLocation }) {
  const hasCoords = loc.lat !== null && loc.lng !== null
  const label = loc.label ?? 'Location'
  const coordsLine = hasCoords
    ? `${formatCoord(loc.lat as number)}, ${formatCoord(loc.lng as number)}`
    : null
  const mapArea = <LocationMapArea />
  return (
    <div className="w-[260px] max-w-full overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
      {loc.url ? (
        <a
          href={loc.url}
          target="_blank"
          rel="noreferrer"
          title="Open in Maps"
          className="block"
        >
          {mapArea}
        </a>
      ) : (
        mapArea
      )}
      <div className="bg-white px-2.5 py-2 dark:bg-black/30">
        <p className="truncate text-[13.5px] font-semibold text-(--wa-text)">
          {label}
        </p>
        {coordsLine && (
          <p className="mt-0.5 text-[11.5px] tabular-nums text-(--wa-text-2)">
            {coordsLine}
          </p>
        )}
        {loc.url && (
          <a
            href={loc.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-0.5 text-[12.5px] font-medium text-(--wa-accent-strong) hover:underline dark:text-(--wa-accent)"
          >
            Open in Maps ↗
          </a>
        )}
      </div>
      <span className="sr-only">
        Shared location: {label}
        {coordsLine ? `, coordinates ${coordsLine}` : ''}
        {loc.url ? ', opens in Maps in a new tab' : ''}
      </span>
    </div>
  )
}

/**
 * Defensively parse a contact message body. New sends store
 * `{"name":"..","phone":".."}` (JSON string); legacy imports carry
 * "<name>.vcf" in mediaName with an optional caption in body (see parser).
 */
function parseContactMessage(
  body: string,
  mediaName: string | null
): { name: string; phone: string | null } {
  const text = (body ?? '').trim()
  if (text.startsWith('{')) {
    try {
      const o: unknown = JSON.parse(text)
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        const rec = o as Record<string, unknown>
        const name =
          typeof rec.name === 'string' && rec.name.trim()
            ? rec.name.trim().slice(0, 80)
            : ''
        const phone =
          typeof rec.phone === 'string' && rec.phone.trim()
            ? rec.phone.trim().slice(0, 32)
            : null
        if (name) return { name, phone }
      }
    } catch {
      /* fall through to legacy parsing */
    }
  }
  const legacyName = (mediaName ?? '').replace(/\.vcf$/i, '').trim()
  const phoneLike = /^[0-9()+\-\s]{4,32}$/.test(text) ? text : null
  return {
    name: (legacyName || text || 'Contact card').slice(0, 80),
    phone: phoneLike,
  }
}

/* ------------------------------------------------------------------ */
/* Call cards (Task 14-g)                                              */
/* ------------------------------------------------------------------ */

interface CallMeta {
  video: boolean
  state: 'missed' | 'incoming' | 'outgoing' | 'unknown'
  /** Canonical short duration, e.g. "5 min" / "2 hours" / "30 secs". */
  duration: string | null
  /** Human duration for aria labels, e.g. "5 minutes". */
  durationLong: string | null
}

const CALL_DURATION_RE = /(\d+)\s*(hours?|hrs?|min(?:ute)?s?|sec(?:ond)?s?)/i

/**
 * Classify a stored call body. The real parser only ever produces
 * "Missed [group ](voice|video) call" (see whatsapp-parser), but old
 * imports / synthetic rows can carry answered-call wording too, so
 * incoming/outgoing keywords and durations are recognized as well.
 * Mirrors callPreviewText() in chat-service.ts — keep both in sync.
 */
function classifyCallBody(body: string): CallMeta {
  const text = (body ?? '').trim()
  const lower = text.toLowerCase()
  const dur = text.match(CALL_DURATION_RE)
  let duration: string | null = null
  let durationLong: string | null = null
  if (dur) {
    const n = parseInt(dur[1], 10)
    const unit = dur[2].toLowerCase()
    if (unit.startsWith('h')) {
      duration = `${n} ${n === 1 ? 'hour' : 'hours'}`
      durationLong = duration
    } else if (unit.startsWith('min')) {
      duration = `${n} min`
      durationLong = `${n} ${n === 1 ? 'minute' : 'minutes'}`
    } else {
      duration = `${n} ${n === 1 ? 'sec' : 'secs'}`
      durationLong = `${n} ${n === 1 ? 'second' : 'seconds'}`
    }
  }
  const video = lower.includes('video')
  const state = /missed|no answer|cancel(?:l)?ed/.test(lower)
    ? 'missed'
    : lower.includes('incoming')
      ? 'incoming'
      : lower.includes('outgoing') || lower.includes('started a call')
        ? 'outgoing'
        : 'unknown'
  return { video, state, duration, durationLong }
}

/**
 * WhatsApp-style inline call card. Fully presentational — the viewer
 * never dials — so the card carries no interactive controls (role="img"
 * with a spoken summary; the trailing phone glyph is a decorative span).
 */
function CallCard({ body }: { body: string }) {
  const meta = classifyCallBody(body)
  const text = (body ?? '').trim()
  const missed = meta.state === 'missed'
  const Icon = meta.video
    ? Video
    : meta.state === 'incoming'
      ? PhoneIncoming
      : meta.state === 'outgoing'
        ? PhoneOutgoing
        : missed
          ? PhoneMissed
          : Phone
  const title = meta.video ? 'Video call' : 'Voice call'
  const stateSubtitle =
    meta.state === 'missed'
      ? meta.video
        ? 'Missed video call'
        : 'Missed'
      : meta.state === 'incoming'
        ? 'Incoming'
        : meta.state === 'outgoing'
          ? 'Outgoing'
          : null
  // Legacy fallback: unclassifiable bodies keep the raw text as subtitle
  // (duration stripped, separators tidied) so old imports never render a
  // bare chip.
  const legacySubtitle = text
    .replace(CALL_DURATION_RE, '')
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s·,–—|-]+|[\s·,–—|-]+$/g, '')
    .slice(0, 120)
  const subtitle = (stateSubtitle
    ? `${stateSubtitle}${meta.duration ? ` · ${meta.duration}` : ''}`
    : legacySubtitle || 'Call'
  ).trim()
  const spoken = `${meta.state === 'unknown' ? '' : `${meta.state === 'missed' ? 'Missed' : meta.state === 'incoming' ? 'Incoming' : 'Outgoing'} `}${meta.video ? 'video' : 'voice'} call${meta.durationLong ? `, ${meta.durationLong}` : ''}`
  return (
    <div
      role="img"
      aria-label={spoken}
      className="flex min-w-[210px] max-w-full items-center gap-3 rounded-xl bg-black/[0.04] p-3 dark:bg-white/[0.06]"
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          missed
            ? 'bg-rose-500/10 text-rose-500'
            : 'bg-emerald-500/10 text-emerald-500'
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1 leading-snug">
        <span className="block truncate text-[13.5px] font-semibold text-(--wa-text)">
          {title}
        </span>
        <span className="block truncate text-[12.5px] text-(--wa-text-2)">
          {subtitle}
        </span>
      </span>
      <span
        aria-hidden="true"
        title="Call details (viewer only)"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-(--wa-text-2)"
      >
        <Phone className="h-4 w-4" />
      </span>
    </div>
  )
}

function Content({
  msg,
  chatId,
  chatTitle,
  src,
  outgoing,
  highlight,
  highlightRegex,
  linkPreview,
}: {
  msg: ChatMessage
  chatId: string
  chatTitle?: string
  src: string | null
  outgoing: boolean
  highlight?: string
  highlightRegex?: boolean
  linkPreview?: ChatMessage['linkPreview']
}) {
  switch (msg.type) {
    case 'deleted':
      return (
        <p className="flex items-center gap-1.5 italic text-(--wa-text-2)">
          <Ban className="h-3.5 w-3.5 shrink-0" />
          {msg.body || 'This message was deleted'}
        </p>
      )
    case 'call':
      return <CallCard body={msg.body} />
    case 'poll':
      return <PollBubble msg={msg} outgoing={outgoing} />
    case 'location': {
      const loc = parseLocationMessage(msg.body)
      const hasCoords = loc.lat !== null && loc.lng !== null
      if (hasCoords || loc.url || loc.json) {
        return <LocationCard loc={loc} />
      }
      // Graceful placeholder for link-less legacy notes ("Live location…").
      const note = /^(live\s+)?location[:\s]/i.test(loc.text) ? '' : loc.text
      return (
        <div className="min-w-[180px]">
          <p className="flex items-center gap-1.5 font-medium">
            <MapPin className="h-4 w-4 shrink-0 text-(--wa-accent)" />
            Location
          </p>
          {note && (
            <p className="mt-0.5 line-clamp-2 text-[13px] text-(--wa-text-2)">
              {note}
            </p>
          )}
        </div>
      )
    }
    case 'contact': {
      const c = parseContactMessage(msg.body, msg.mediaName)
      return (
        <div className="flex min-w-[210px] items-center gap-2.5 rounded-md bg-black/5 px-3 py-2.5 dark:bg-white/5">
          <div className="relative shrink-0">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--wa-accent),var(--wa-accent-strong))] text-[15px] font-semibold text-white shadow-sm">
              {initialsForName(c.name)}
            </div>
            <span className="absolute -right-0.5 -bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-(--wa-accent) ring-1 ring-black/10 dark:bg-(--wa-panel) dark:ring-white/20">
              <UserRound className="h-2.5 w-2.5" aria-hidden />
            </span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-semibold text-(--wa-text)">
              {c.name}
            </p>
            {c.phone && (
              <p className="truncate text-[12.5px] text-(--wa-text-2)">
                {c.phone}
              </p>
            )}
            <p className="mt-0.5 text-[11px] text-(--wa-text-2)">Contact card</p>
          </div>
          <span className="sr-only">
            Contact card: {c.name}
            {c.phone ? `, phone ${c.phone}` : ''}
          </span>
        </div>
      )
    }
    case 'image':
      return (
        <ImageContent
          msg={msg}
          src={src}
          highlight={highlight}
          highlightRegex={highlightRegex}
        />
      )
    case 'sticker':
      return src ? (
        <img
          src={src}
          alt={msg.mediaName ?? 'Sticker'}
          loading="lazy"
          className="wa-sticker-img max-h-[192px] max-w-[192px] w-auto h-auto object-contain"
        />
      ) : (
        <MediaPlaceholder
          icon={<i className="flex h-8 w-8 items-center justify-center rounded bg-black/10 text-xs font-semibold dark:bg-white/10">STK</i>}
          label={msg.mediaName ?? 'Sticker'}
        />
      )
    case 'video':
    case 'gif':
      return src ? (
        <div className="relative min-w-0">
          <video
            controls
            preload="metadata"
            src={src}
            poster={`${src}?poster=1`}
            className="min-w-0 max-h-[320px] max-w-[280px] rounded-md"
          />
          {msg.type === 'gif' && <span className="wa-gif-badge">GIF</span>}
        </div>
      ) : (
        <MediaPlaceholder
          icon={<i className="flex h-8 w-8 items-center justify-center rounded bg-black/10 text-[11px] font-semibold dark:bg-white/10">VID</i>}
          label={msg.mediaName ?? 'Video'}
        />
      )
    case 'audio':
      return (
        <div className="min-w-0">
          {src ? (
            <VoicePlayer
              src={src}
              seed={msg.id}
              chatId={chatId}
              chatTitle={chatTitle ?? ''}
              sender={msg.sender ?? ''}
            />
          ) : (
            <div className="min-w-[230px]">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--wa-accent)/15 text-(--wa-accent)">
                  <Mic className="h-4 w-4" />
                </span>
                <span className="text-[13px] text-(--wa-text-2)">
                  Voice message
                </span>
              </div>
              {msg.mediaName && (
                <p className="mt-1 truncate text-[11px] text-(--wa-text-2)">
                  {msg.mediaName} · not in export
                </p>
              )}
            </div>
          )}
          {msg.body && (
            <p className="mt-1 whitespace-pre-wrap">
              <LinkifiedText text={msg.body} query={highlight} regex={highlightRegex} />
            </p>
          )}
        </div>
      )
    case 'document':
      return (
        <div>
          <DocumentChip name={msg.mediaName ?? 'Document'} src={src} />
          {msg.body && (
            <p className="mt-1 whitespace-pre-wrap">
              <LinkifiedText text={msg.body} query={highlight} regex={highlightRegex} />
            </p>
          )}
        </div>
      )
    case 'media':
      return (
        <MediaPlaceholder
          icon={<i className="flex h-8 w-8 items-center justify-center rounded bg-black/10 text-[11px] font-semibold dark:bg-white/10">MED</i>}
          label={msg.mediaName ?? 'Media'}
        />
      )
    default: {
      const body = msg.body ?? ''
      const emojiOnly = isEmojiOnly(body)
      return (
        <>
          {linkPreview && <LinkPreviewCard preview={linkPreview} />}
          <p
            className={cn(
              'whitespace-pre-wrap break-words',
              emojiOnly && 'text-[2.4em] leading-[1.2]'
            )}
          >
            <LinkifiedText text={body} query={highlight} regex={highlightRegex} />
          </p>
        </>
      )
    }
  }
}
