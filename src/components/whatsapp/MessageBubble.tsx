'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Ban,
  BarChart3,
  Copy,
  Download,
  FileText,
  MapPin,
  Mic,
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
            : 'text-[#667781] dark:text-[#8696a0]'
          : onMedia
            ? 'text-white/80'
            : 'text-[#667781] dark:text-[#8696a0]'
      )}
    >
      <span className="whitespace-nowrap">{formatTime(msg.ts)}</span>
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
        <p className="truncate text-[13px] font-medium text-[#3b4a54] dark:text-[#d1d7db]">
          {label}
        </p>
        <p className="text-[11px] text-[#667781] dark:text-[#8696a0]">
          Media not included in this export
        </p>
      </div>
    </div>
  )
}

function DocumentChip({ name, src }: { name: string; src: string | null }) {
  const inner = (
    <div className="flex items-center gap-2.5 rounded-md bg-black/5 px-3 py-2.5 transition-colors dark:bg-white/5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[#008069]/10 text-[#008069] dark:bg-[#00a884]/20 dark:text-[#00a884]">
        <FileText className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="max-w-[200px] truncate text-[13.5px] font-medium text-[#111b21] dark:text-[#e9edef]">
          {name}
        </p>
        <p className="text-[11px] text-[#667781] dark:text-[#8696a0]">
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
function ImageContent({ msg, src }: { msg: ChatMessage; src: string | null }) {
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
          <figcaption className="mt-1 whitespace-pre-wrap">{msg.body}</figcaption>
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
}

/** WhatsApp-style message context menu (right-click / long-press). */
function BubbleMenu({ msg, src, onToggleStar }: BubbleMenuProps) {
  return (
    <ContextMenuContent className="min-w-[180px]">
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
}

function HoverActions({ msg, onToggleStar }: HoverActionsProps) {
  const cls = cn(
    'mb-1 hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-[#54656f] shadow-md transition-opacity sm:flex',
    'opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100 dark:bg-[#233138] dark:text-[#aebac1]'
  )
  return (
    <>
      {onToggleStar && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleStar(msg.id, !msg.starred)
          }}
          aria-label={msg.starred ? 'Unstar message' : 'Star message'}
          title={msg.starred ? 'Unstar message' : 'Star message'}
          className={cls}
        >
          <Star
            className={cn(
              'h-3.5 w-3.5 transition-colors',
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
        className={cls}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </>
  )
}

export function MessageBubble({
  msg,
  chatId,
  isGroup,
  showTail,
  showAvatar,
  onToggleStar,
}: {
  msg: ChatMessage
  chatId: string
  isGroup: boolean
  showTail: boolean
  showAvatar: boolean
  onToggleStar?: (id: string, starred: boolean) => void
}) {
  const outgoing = msg.sender === 'You'
  const senderColor = useMemo(
    () => colorForName(msg.sender ?? ''),
    [msg.sender]
  )
  const src = mediaSrc(chatId, msg)
  const press = usePressFeedback()

  if (outgoing) {
    return <OutgoingBubble msg={msg} chatId={chatId} showTail={showTail} src={src} onToggleStar={onToggleStar} />
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
          <div className="relative min-w-0 max-w-[78%] sm:max-w-[65%]">
            {showTail && (
              <BubbleTail
                side="left"
                className="absolute -left-[7px] top-0 fill-white dark:fill-[#202c33]"
              />
            )}
            <div
              {...press.handlers}
              className={cn(
                'relative rounded-[7.5px] px-2.5 py-1.5 text-[14.2px] leading-[19px] transition-[transform,box-shadow] duration-150',
                'bg-white text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] dark:bg-[#202c33] dark:text-[#e9edef] dark:shadow-[0_1px_0.5px_rgba(0,0,0,0.25)]',
                !showTail && 'rounded-tl-none',
                press.pressing && 'scale-[0.98]'
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
              <Content msg={msg} chatId={chatId} src={src} outgoing={false} />
              <Meta msg={msg} outgoing={false} onMedia={false} />
            </div>
          </div>
        </ContextMenuTrigger>
        <BubbleMenu msg={msg} src={src} onToggleStar={onToggleStar} />
      </ContextMenu>
      <HoverActions msg={msg} onToggleStar={onToggleStar} />
    </div>
  )
}

function OutgoingBubble({
  msg,
  chatId,
  showTail,
  src,
  onToggleStar,
}: {
  msg: ChatMessage
  chatId: string
  showTail: boolean
  src: string | null
  onToggleStar?: (id: string, starred: boolean) => void
}) {
  const press = usePressFeedback()
  return (
    <div className="group/msg flex justify-end gap-1.5 px-2 sm:px-4">
      <HoverActions msg={msg} onToggleStar={onToggleStar} />
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="relative min-w-0 max-w-[78%] sm:max-w-[65%]">
            {showTail && (
              <BubbleTail
                side="right"
                className="absolute -right-[7px] top-0 fill-[#d9fdd3] dark:fill-[#005c4b]"
              />
            )}
            <div
              {...press.handlers}
              className={cn(
                'relative rounded-[7.5px] px-2.5 py-1.5 text-[14.2px] leading-[19px] transition-[transform,box-shadow] duration-150',
                'bg-[#d9fdd3] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] dark:bg-[#005c4b] dark:text-[#e9edef] dark:shadow-[0_1px_0.5px_rgba(0,0,0,0.25)]',
                !showTail && 'rounded-tr-none',
                press.pressing && 'scale-[0.98]'
              )}
            >
              <Content msg={msg} chatId={chatId} src={src} outgoing />
              <Meta msg={msg} outgoing onMedia={false} />
            </div>
          </div>
        </ContextMenuTrigger>
        <BubbleMenu msg={msg} src={src} onToggleStar={onToggleStar} />
      </ContextMenu>
    </div>
  )
}

function Content({
  msg,
  chatId,
  src,
  outgoing,
}: {
  msg: ChatMessage
  chatId: string
  src: string | null
  outgoing: boolean
}) {
  switch (msg.type) {
    case 'deleted':
      return (
        <p className="flex items-center gap-1.5 italic text-[#667781] dark:text-[#8696a0]">
          <Ban className="h-3.5 w-3.5 shrink-0" />
          {msg.body || 'This message was deleted'}
        </p>
      )
    case 'call':
      return (
        <p className="flex items-center gap-1.5 text-[#667781] dark:text-[#8696a0]">
          <PhoneMissed className="h-4 w-4 shrink-0 text-rose-500" />
          {msg.body || 'Missed call'}
        </p>
      )
    case 'poll':
      return (
        <div className="min-w-[200px]">
          <p className="flex items-center gap-1.5 font-medium text-[#111b21] dark:text-[#e9edef]">
            <BarChart3 className="h-4 w-4 shrink-0" />
            POLL: {msg.body}
          </p>
          <p className="mt-1 text-[12px] text-[#667781] dark:text-[#8696a0]">
            Poll options are not included in exports
          </p>
        </div>
      )
    case 'location': {
      const url = extractUrl(msg.body)
      return (
        <div className="min-w-[180px]">
          <p className="flex items-center gap-1.5 font-medium">
            <MapPin className="h-4 w-4 shrink-0 text-[#00a884]" />
            Location
          </p>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 block truncate text-[13px] text-[#027eb5] hover:underline dark:text-[#53bdeb]"
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
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#008069]/10 text-[#008069] dark:bg-[#00a884]/20 dark:text-[#00a884]">
            <UserRound className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-medium">
              {msg.mediaName ?? 'Contact card'}
            </p>
            <p className="text-[11px] text-[#667781] dark:text-[#8696a0]">
              Contact card (vCard)
            </p>
          </div>
        </div>
      )
    case 'image':
      return <ImageContent msg={msg} src={src} />
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
        <div className="min-w-[230px]">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#00a884]/15 text-[#00a884]">
              <Mic className="h-4 w-4" />
            </span>
            {src ? (
              <audio controls preload="metadata" src={src} className="h-8 max-w-[220px]" />
            ) : (
              <span className="text-[13px] text-[#667781] dark:text-[#8696a0]">
                Voice message
              </span>
            )}
          </div>
          {msg.mediaName && !src && (
            <p className="mt-1 truncate text-[11px] text-[#667781] dark:text-[#8696a0]">
              {msg.mediaName} · not in export
            </p>
          )}
          {msg.body && <p className="mt-1 whitespace-pre-wrap">{msg.body}</p>}
        </div>
      )
    case 'document':
      return (
        <div>
          <DocumentChip name={msg.mediaName ?? 'Document'} src={src} />
          {msg.body && <p className="mt-1 whitespace-pre-wrap">{msg.body}</p>}
        </div>
      )
    case 'media':
      return (
        <MediaPlaceholder
          icon={<i className="flex h-8 w-8 items-center justify-center rounded bg-black/10 text-[11px] font-semibold dark:bg-white/10">MED</i>}
          label={msg.mediaName ?? 'Media'}
        />
      )
    default:
      return <p className="whitespace-pre-wrap break-words">{msg.body}</p>
  }
}
