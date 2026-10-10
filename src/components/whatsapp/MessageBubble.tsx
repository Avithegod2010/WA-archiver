'use client'

import { useMemo } from 'react'
import {
  Ban,
  BarChart3,
  FileText,
  MapPin,
  Mic,
  PhoneMissed,
  UserRound,
} from 'lucide-react'
import { Avatar } from './Avatar'
import { BubbleTail, TicksDouble } from './icons'
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

export function MessageBubble({
  msg,
  chatId,
  isGroup,
  showTail,
  showAvatar,
}: {
  msg: ChatMessage
  chatId: string
  isGroup: boolean
  showTail: boolean
  showAvatar: boolean
}) {
  const outgoing = msg.sender === 'You'
  const senderColor = useMemo(
    () => colorForName(msg.sender ?? ''),
    [msg.sender]
  )
  const src = mediaSrc(chatId, msg)

  if (outgoing) {
    return <OutgoingBubble msg={msg} chatId={chatId} showTail={showTail} src={src} />
  }

  return (
    <div className="flex items-end gap-1.5 px-2 sm:px-4">
      {isGroup ? (
        showAvatar ? (
          <Avatar name={msg.sender ?? '?'} size={28} className="mb-0.5" />
        ) : (
          <div className="w-7 shrink-0" />
        )
      ) : null}
      <div className="relative max-w-[78%] sm:max-w-[65%]">
        {showTail && (
          <BubbleTail
            side="left"
            className="absolute -left-[7px] top-0 fill-white dark:fill-[#202c33]"
          />
        )}
        <div
          className={cn(
            'relative rounded-lg px-2.5 py-1.5 text-[14.2px] leading-[19px] shadow-sm',
            'bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]',
            !showTail && 'rounded-tl-none'
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
    </div>
  )
}

function OutgoingBubble({
  msg,
  chatId,
  showTail,
  src,
}: {
  msg: ChatMessage
  chatId: string
  showTail: boolean
  src: string | null
}) {
  return (
    <div className="flex justify-end px-2 sm:px-4">
      <div className="relative max-w-[78%] sm:max-w-[65%]">
        {showTail && (
          <BubbleTail
            side="right"
            className="absolute -right-[7px] top-0 fill-[#d9fdd3] dark:fill-[#005c4b]"
          />
        )}
        <div
          className={cn(
            'relative rounded-lg px-2.5 py-1.5 text-[14.2px] leading-[19px] shadow-sm',
            'bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]',
            !showTail && 'rounded-tr-none'
          )}
        >
          <Content msg={msg} chatId={chatId} src={src} outgoing />
          <Meta msg={msg} outgoing onMedia={false} />
        </div>
      </div>
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
      return src ? (
        <figure className="max-w-[280px]">
          <img
            src={src}
            alt={msg.mediaName ?? 'Shared image'}
            loading="lazy"
            className="max-h-[320px] w-full cursor-pointer rounded-md object-cover"
            onClick={() => window.open(src, '_blank')}
          />
          {msg.body && <figcaption className="mt-1 whitespace-pre-wrap">{msg.body}</figcaption>}
        </figure>
      ) : (
        <MediaPlaceholder
          icon={<i className="flex h-8 w-8 items-center justify-center rounded bg-black/10 text-[13px] font-semibold dark:bg-white/10">IMG</i>}
          label={msg.mediaName ?? 'Photo'}
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
          className="max-h-[320px] max-w-[280px] rounded-md"
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
