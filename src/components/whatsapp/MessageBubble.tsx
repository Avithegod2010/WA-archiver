'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Ban,
  BarChart3,
  BookmarkPlus,
  Check,
  Copy,
  Download,
  FileText,
  Forward,
  MapPin,
  Mic,
  Pencil,
  PhoneMissed,
  Star,
  StarOff,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Avatar } from './Avatar'
import { BubbleTail, TicksDouble } from './icons'
import { Lightbox } from './Lightbox'
import { VoicePlayer } from './VoicePlayer'
import { PollBubble } from './PollBubble'
import { colorForName, type ChatMessage } from './types'
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

const COPY_LABEL: Record<string, string> = {
  image: '[Photo]',
  video: '[Video]',
  gif: '[GIF]',
  audio: '[Voice message]',
  sticker: '[Sticker]',
  document: '[Document]',
  contact: '[Contact card]',
  location: '[Location]',
  poll: '[Poll]',
  media: '[Media omitted]',
}

function copyTextFor(msg: ChatMessage): string {
  const prefix = msg.sender && msg.sender !== 'You' ? `${msg.sender}: ` : ''
  const body =
    msg.body || COPY_LABEL[msg.type] || (msg.mediaName ? `[${msg.mediaName}]` : '')
  return prefix + body
}

async function copyMessage(msg: ChatMessage) {
  try {
    await navigator.clipboard.writeText(copyTextFor(msg))
    toast.success('Message copied')
  } catch {
    toast.error('Could not copy')
  }
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

function mediaSrc(chatId: string, msg: ChatMessage): string | null {
  if (!msg.mediaPath) return null
  return `/api/media/${chatId}/${encodeURIComponent(msg.mediaPath)}`
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
}

function Meta({ msg, outgoing, onMedia }: MetaProps) {
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
            : 'text-(--wa-text-2)'
      )}
    >
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
  onEditMessage?: (msg: ChatMessage) => void
}

/** WhatsApp-style message context menu (right-click / long-press). */
function BubbleMenu({
  msg,
  src,
  onToggleStar,
  onForwardSaved,
  onEditMessage,
}: BubbleMenuProps) {
  const editable =
    !!onEditMessage &&
    msg.sender === 'You' &&
    (msg.type === 'text' || msg.type === 'poll')
  return (
    <ContextMenuContent className="min-w-[200px]">
      {onForwardSaved && (
        <ContextMenuItem
          onClick={() => onForwardSaved(msg)}
          className="gap-2"
        >
          <BookmarkPlus className="h-4 w-4 text-(--wa-accent)" /> Forward to
          Saved Messages
        </ContextMenuItem>
      )}
      {editable && (
        <ContextMenuItem onClick={() => onEditMessage(msg)} className="gap-2">
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
  /** Which side of the bubble the actions sit on — drives slide direction. */
  side: 'in' | 'out'
}

const ACTION_STAGGER = [
  'group-hover/msg:delay-1000',
  'group-hover/msg:delay-[1.08s]',
  'group-hover/msg:delay-[1.16s]',
]

function HoverActions({
  msg,
  onToggleStar,
  onForwardSaved,
  side,
}: HoverActionsProps) {
  const btn = (stagger: string) =>
    cn(
      'mb-1 hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--wa-in) text-(--wa-text-2) shadow-md sm:flex',
      'opacity-0 scale-75 will-change-transform',
      side === 'in' ? '-translate-x-2' : 'translate-x-2',
      'transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none',
      '[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]',
      // 1s deliberate pause before the actions pop out (instant on leave)
      'group-hover/msg:translate-x-0 group-hover/msg:scale-100 group-hover/msg:opacity-100',
      'focus-visible:translate-x-0 focus-visible:scale-100 focus-visible:opacity-100 focus-visible:delay-0',
      stagger
    )
  return (
    <>
      {onForwardSaved && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onForwardSaved(msg)
          }}
          aria-label="Forward to Saved Messages"
          title="Forward to Saved Messages"
          className={btn(ACTION_STAGGER[0])}
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
          className={btn(ACTION_STAGGER[1])}
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
      <button
        onClick={(e) => {
          e.stopPropagation()
          copyMessage(msg)
        }}
        aria-label="Copy message"
        title="Copy message"
        className={btn(ACTION_STAGGER[2])}
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
  isGroup,
  showTail,
  showAvatar,
  onToggleStar,
  highlight,
  highlightRegex,
  selectMode,
  selected,
  anySelected,
  onToggleSelect,
  onForwardSaved,
  onEditMessage,
}: {
  msg: ChatMessage
  chatId: string
  isGroup: boolean
  showTail: boolean
  showAvatar: boolean
  onToggleStar?: (id: string, starred: boolean) => void
  highlight?: string
  highlightRegex?: boolean
  selectMode?: boolean
  selected?: boolean
  anySelected?: boolean
  onToggleSelect?: (id: string) => void
  onForwardSaved?: (msg: ChatMessage) => void
  onEditMessage?: (msg: ChatMessage) => void
}) {
  const outgoing = msg.sender === 'You'
  const senderColor = useMemo(
    () => colorForName(msg.sender ?? ''),
    [msg.sender]
  )
  const src = mediaSrc(chatId, msg)
  const press = usePressFeedback()

  if (outgoing) {
    return (
      <OutgoingBubble
        msg={msg}
        chatId={chatId}
        showTail={showTail}
        src={src}
        onToggleStar={onToggleStar}
        highlight={highlight}
        highlightRegex={highlightRegex}
        selectMode={selectMode}
        selected={selected}
        anySelected={anySelected}
        onToggleSelect={onToggleSelect}
        onForwardSaved={onForwardSaved}
        onEditMessage={onEditMessage}
      />
    )
  }

  if (selectMode) {
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
          {showTail && (
            <BubbleTail
              side="left"
              className="absolute -left-[7px] top-0 fill-(--wa-in)"
            />
          )}
          <div
            className={cn(
              'relative rounded-[7.5px] px-2.5 py-1.5 text-(length:--wa-msg-size,14.2px) leading-[1.34]',
              'bg-(--wa-in) text-(--wa-text)',
              // Sharp corner where the tail attaches — merges seamlessly
              showTail && 'rounded-tl-none',
              selected && 'ring-2 ring-(--wa-accent)'
            )}
          >
            {isGroup && msg.sender && (
              <p
                className="mb-0.5 text-[12.5px] font-semibold leading-tight"
                style={{ color: senderColor }}
              >
                {msg.sender}
              </p>
            )}
            <Content
              msg={msg}
              chatId={chatId}
              src={src}
              outgoing={false}
              highlight={highlight}
              highlightRegex={highlightRegex}
            />
            <Meta msg={msg} outgoing={false} onMedia={false} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group/msg flex items-end gap-1.5 px-2 sm:px-4">
      {isGroup ? (
        showAvatar ? (
          <Avatar name={msg.sender ?? '?'} size={28} className="mb-0.5" />
        ) : (
          <div className="w-7 shrink-0" />
        )
      ) : null}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="relative min-w-0 max-w-[78%] drop-shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] dark:drop-shadow-[0_1px_0.5px_rgba(0,0,0,0.25)] sm:max-w-[65%]">
            {showTail && (
              <BubbleTail
                side="left"
                className="absolute -left-[7px] top-0 fill-(--wa-in)"
              />
            )}
            <div
              {...press.handlers}
              data-bubble
              className={cn(
                'relative rounded-[7.5px] px-2.5 py-1.5 text-(length:--wa-msg-size,14.2px) leading-[1.34] transition-transform duration-150',
                'bg-(--wa-in) text-(--wa-text)',
                // Sharp corner where the tail attaches — merges seamlessly
                showTail && 'rounded-tl-none',
                press.pressing && 'scale-[0.98]'
              )}
            >
              {isGroup && msg.sender && (
                <p
                  className="mb-0.5 text-[12.5px] font-semibold leading-tight"
                  style={{ color: senderColor }}
                >
                  <Highlight text={msg.sender} query={highlight} regex={highlightRegex} />
                </p>
              )}
              <Content
                msg={msg}
                chatId={chatId}
                src={src}
                outgoing={false}
                highlight={highlight}
                highlightRegex={highlightRegex}
              />
              <Meta msg={msg} outgoing={false} onMedia={false} />
            </div>
          </div>
        </ContextMenuTrigger>
        <BubbleMenu
          msg={msg}
          src={src}
          onToggleStar={onToggleStar}
          onForwardSaved={onForwardSaved}
          onEditMessage={onEditMessage}
        />
      </ContextMenu>
      <HoverActions
        msg={msg}
        side="in"
        onToggleStar={onToggleStar}
        onForwardSaved={onForwardSaved}
      />
    </div>
  )
}

function OutgoingBubble({
  msg,
  chatId,
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
  onEditMessage,
}: {
  msg: ChatMessage
  chatId: string
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
  onEditMessage?: (msg: ChatMessage) => void
}) {
  const press = usePressFeedback()

  const bubble = (
    <div className="relative min-w-0 max-w-[78%] drop-shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] dark:drop-shadow-[0_1px_0.5px_rgba(0,0,0,0.25)] sm:max-w-[65%]">
      {showTail && (
        <BubbleTail
          side="right"
          className="absolute -right-[7px] top-0 fill-(--wa-out)"
        />
      )}
      <div
        {...(selectMode ? {} : press.handlers)}
        data-bubble
        className={cn(
          'relative rounded-[7.5px] px-2.5 py-1.5 text-(length:--wa-msg-size,14.2px) leading-[1.34] transition-transform duration-150',
          'bg-(--wa-out) text-(--wa-text) dark:text-(--wa-text)',
          // Sharp corner where the tail attaches — merges seamlessly
          showTail && 'rounded-tr-none',
          !selectMode && press.pressing && 'scale-[0.98]',
          selectMode && selected && 'ring-2 ring-(--wa-accent)'
        )}
      >
        {msg.forwardedFrom && <ForwardedChip from={msg.forwardedFrom} />}
        <Content
          msg={msg}
          chatId={chatId}
          src={src}
          outgoing
          highlight={highlight}
          highlightRegex={highlightRegex}
        />
        <Meta msg={msg} outgoing onMedia={false} />
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
        {bubble}
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
      />
      <ContextMenu>
        <ContextMenuTrigger asChild>{bubble}</ContextMenuTrigger>
        <BubbleMenu
          msg={msg}
          src={src}
          onToggleStar={onToggleStar}
          onForwardSaved={onForwardSaved}
          onEditMessage={onEditMessage}
        />
      </ContextMenu>
    </div>
  )
}

function Content({
  msg,
  chatId,
  src,
  outgoing,
  highlight,
  highlightRegex,
}: {
  msg: ChatMessage
  chatId: string
  src: string | null
  outgoing: boolean
  highlight?: string
  highlightRegex?: boolean
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
      return (
        <p className="flex items-center gap-1.5 text-(--wa-text-2)">
          <PhoneMissed className="h-4 w-4 shrink-0 text-rose-500" />
          {msg.body || 'Missed call'}
        </p>
      )
    case 'poll':
      return <PollBubble msg={msg} outgoing={outgoing} />
    case 'location': {
      const url = extractUrl(msg.body)
      return (
        <div className="min-w-[180px]">
          <p className="flex items-center gap-1.5 font-medium">
            <MapPin className="h-4 w-4 shrink-0 text-(--wa-accent)" />
            Location
          </p>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block truncate text-[13px] text-(--wa-link) hover:underline"
            >
              {url}
            </a>
          )}
        </div>
      )
    }
    case 'contact':
      return (
        <div className="flex items-center gap-2.5 rounded-md bg-black/5 px-3 py-2.5 dark:bg-white/5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--wa-accent)/10 text-(--wa-accent)">
            <UserRound className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-medium">
              {msg.mediaName ?? 'Contact card'}
            </p>
            <p className="text-[11px] text-(--wa-text-2)">
              Contact card (vCard)
            </p>
          </div>
        </div>
      )
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
          className="max-h-[180px] w-[180px] object-contain"
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
        <video
          controls
          preload="metadata"
          src={src}
          poster={`${src}?poster=1`}
          className="min-w-0 max-h-[320px] max-w-[280px] rounded-md"
        />
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
            <VoicePlayer src={src} seed={msg.id} />
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
        <p
          className={cn(
            'whitespace-pre-wrap break-words',
            emojiOnly && 'text-[2.4em] leading-[1.2]'
          )}
        >
          <LinkifiedText text={body} query={highlight} regex={highlightRegex} />
        </p>
      )
    }
  }
}
