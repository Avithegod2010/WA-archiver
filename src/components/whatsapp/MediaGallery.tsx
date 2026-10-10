'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  Archive,
  CornerDownLeft,
  FileText,
  Film,
  ImageIcon,
  Loader2,
  Mic,
  Play,
} from 'lucide-react'
import { toast } from 'sonner'
import { Lightbox } from './Lightbox'
import { Avatar } from './Avatar'
import { cn } from '@/lib/utils'

interface MediaItem {
  id: string
  idx: number
  ts: string
  sender: string | null
  body: string
  type: string
  mediaPath: string | null
  mediaName: string | null
  bytes: number | null
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatBytes(n: number | null): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function kindOf(type: string): 'image' | 'video' | 'audio' | 'doc' {
  if (type === 'video' || type === 'gif') return 'video'
  if (type === 'audio') return 'audio'
  if (type === 'document') return 'doc'
  return 'image' // image, sticker, media
}

/**
 * Full-screen gallery of every media item in the active chat.
 * Rendered through a body portal so it overlays the whole app.
 */
export function MediaGallery({
  chatId,
  chatTitle,
  isGroup,
  open,
  onClose,
  onJumpToMessage,
}: {
  chatId: string
  chatTitle: string
  isGroup: boolean
  open: boolean
  onClose: () => void
  onJumpToMessage?: (messageId: string) => void
}) {
  const [items, setItems] = useState<MediaItem[] | null | undefined>(undefined)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'image' | 'video' | 'audio' | 'doc'>('all')
  const [zipping, setZipping] = useState(false)
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  useEffect(() => {
    if (!open) return
    let alive = true
    fetch(`/api/chats/${chatId}/media`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d) => {
        if (alive) setItems(d.items as MediaItem[])
      })
      .catch(() => {
        if (alive) {
          setItems(null)
          toast.error('Could not load media gallery')
        }
      })
    return () => {
      alive = false
    }
  }, [open, chatId])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && viewerIndex == null) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, viewerIndex, onClose])

  const shown = useMemo(() => {
    if (!items) return []
    if (filter === 'all') return items
    return items.filter((m) => kindOf(m.type) === filter)
  }, [items, filter])

  const counts = useMemo(() => {
    const c = { all: 0, image: 0, video: 0, audio: 0, doc: 0 }
    for (const m of items ?? []) c[kindOf(m.type)]++
    if (items) c.all = items.length
    return c
  }, [items])

  const totalBytes = useMemo(
    () => (items ?? []).reduce((s, m) => s + (m.bytes ?? 0), 0),
    [items]
  )

  const availableCount = useMemo(
    () => (items ?? []).filter((m) => m.mediaPath).length,
    [items]
  )

  function handleDownloadZip() {
    if (zipping) return
    setZipping(true)
    const a = document.createElement('a')
    a.href = `/api/chats/${chatId}/media-zip`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Give the browser a moment to start the download
    setTimeout(() => setZipping(false), 1500)
    toast.success('Preparing media .zip — check your downloads')
  }

  if (!open || !mounted) return null

  const tabs: Array<{ key: typeof filter; label: string; icon: React.ReactNode }> = [
    { key: 'all', label: 'All', icon: <ImageIcon className="h-3.5 w-3.5" /> },
    { key: 'image', label: 'Photos', icon: <ImageIcon className="h-3.5 w-3.5" /> },
    { key: 'video', label: 'Videos', icon: <Film className="h-3.5 w-3.5" /> },
    { key: 'audio', label: 'Voice', icon: <Mic className="h-3.5 w-3.5" /> },
    { key: 'doc', label: 'Docs', icon: <FileText className="h-3.5 w-3.5" /> },
  ]

  const canJump = !!onJumpToMessage

  return createPortal(
    <div
      className="animate-in fade-in fixed inset-0 z-[90] flex flex-col bg-[#0b141a]/95 backdrop-blur-sm duration-150"
      role="dialog"
      aria-modal="true"
      aria-label={`Media gallery for ${chatTitle}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* Gallery header */}
      <div className="flex items-center gap-3 border-b border-white/10 bg-[#111b21] px-4 py-3">
        <Avatar name={chatTitle} size={36} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold text-[#e9edef]">
            {chatTitle} · media
          </h2>
          <p className="text-[11.5px] text-[#8696a0]">
            {items == null
              ? 'Loading…'
              : `${counts.all} item${counts.all === 1 ? '' : 's'}${
                  totalBytes > 0 ? ` · ${formatBytes(totalBytes)}` : ''
                } · click to view`}
          </p>
        </div>
        {items != null && availableCount > 0 && (
          <button
            onClick={handleDownloadZip}
            disabled={zipping}
            aria-label="Download all media as zip"
            title="Download all media (.zip with transcript)"
            className="flex h-9 items-center gap-1.5 rounded-full bg-[#00a884] px-3.5 text-[12.5px] font-medium text-white transition-colors hover:bg-[#029374] disabled:opacity-60"
          >
            {zipping ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
            Download all
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Close gallery"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Type filter tabs */}
      {items && items.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none]">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors',
                filter === t.key
                  ? 'bg-[#00a884] text-white'
                  : 'bg-white/10 text-[#aebac1] hover:bg-white/20'
              )}
            >
              {t.icon}
              {t.label}
              {counts[t.key] > 0 && (
                <span
                  className={cn(
                    'rounded-full px-1.5 text-[10.5px] tabular-nums',
                    filter === t.key ? 'bg-white/25' : 'bg-white/10'
                  )}
                >
                  {counts[t.key]}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Grid body */}
      <div className="wa-scroll flex-1 overflow-y-auto p-4">
        {items === undefined && (
          <div className="flex h-40 items-center justify-center gap-2 text-[13.5px] text-[#8696a0]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading media…
          </div>
        )}
        {items !== undefined && shown.length === 0 && (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
              <ImageIcon className="h-7 w-7 text-[#8696a0]" />
            </div>
            <p className="text-[14px] font-medium text-[#e9edef]">
              {items.length === 0 ? 'No media in this chat' : `No ${filter === 'doc' ? 'documents' : filter + 's'} here`}
            </p>
            <p className="max-w-[280px] text-[12.5px] leading-relaxed text-[#8696a0]">
              Media appears here when the chat was exported <b>with media</b>.
            </p>
          </div>
        )}
        {items !== undefined && shown.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {shown.map((m, i) => (
              <MediaTile
                key={m.id}
                item={m}
                chatId={chatId}
                isGroup={isGroup}
                canJump={canJump}
                onOpen={() => setViewerIndex(i)}
                onJump={
                  canJump
                    ? () => {
                        setViewerIndex(null)
                        onClose() // reveal the chat underneath
                        onJumpToMessage?.(m.id)
                      }
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Media viewer overlay with ← → navigation across `shown` */}
      {viewerIndex != null && shown[viewerIndex] && (
        <GalleryViewer
          items={shown}
          index={viewerIndex}
          chatId={chatId}
          onClose={() => setViewerIndex(null)}
          onNavigate={(next) =>
            setViewerIndex((cur) => {
              if (cur == null) return cur
              const n = (next + shown.length) % shown.length
              return n
            })
          }
        />
      )}
    </div>,
    document.body
  )
}

function MediaTile({
  item,
  chatId,
  isGroup,
  canJump,
  onOpen,
  onJump,
}: {
  item: MediaItem
  chatId: string
  isGroup: boolean
  canJump: boolean
  onOpen: () => void
  onJump?: () => void
}) {
  const kind = kindOf(item.type)
  const src = item.mediaPath
    ? `/api/media/${chatId}/${encodeURIComponent(item.mediaPath)}`
    : null

  return (
    <div
      className={cn(
        'group relative aspect-square overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10 transition-all duration-200',
        src ? 'cursor-pointer hover:ring-2 hover:ring-[#00a884] hover:brightness-110' : 'cursor-default opacity-70'
      )}
      role={src ? 'button' : undefined}
      aria-label={item.mediaName ?? item.type}
      title={
        item.mediaName
          ? `${item.mediaName}${item.bytes != null ? ` · ${formatBytes(item.bytes)}` : ''}`
          : undefined
      }
      onClick={() => src && onOpen()}
    >
      {src && kind === 'image' && (
        <img
          src={src}
          alt={item.mediaName ?? 'Chat media'}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
        />
      )}
      {src && kind === 'video' && (
        <>
          <video
            src={`${src}#t=0.1`}
            poster={`${src}?poster=1`}
            preload="metadata"
            muted
            playsInline
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[9.5px] font-medium text-white backdrop-blur-sm">
            <Film className="h-3 w-3" /> Video
          </span>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-transform duration-200 group-hover:scale-110">
              <Play className="ml-0.5 h-5 w-5 fill-current" />
            </span>
          </span>
        </>
      )}
      {src && kind === 'audio' && (
        <span className="flex h-full w-full flex-col items-center justify-center gap-2 text-[#00a884]">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#00a884]/15">
            <Mic className="h-6 w-6" />
          </span>
          <span className="max-w-[85%] truncate px-2 text-[11px] text-[#aebac1]">
            {item.mediaName ?? 'Voice message'}
          </span>
        </span>
      )}
      {src && kind === 'doc' && (
        <span className="flex h-full w-full flex-col items-center justify-center gap-2 text-[#f2a33c]">
          <FileText className="h-10 w-10" />
          <span className="max-w-[85%] truncate px-2 text-[11px] text-[#aebac1]">
            {item.mediaName ?? 'Document'}
          </span>
        </span>
      )}
      {!src && (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 text-center">
          <i className="flex h-9 w-9 items-center justify-center rounded bg-white/10 text-[10px] font-bold tracking-wide text-[#8696a0]">
            {kind === 'image' ? 'IMG' : kind === 'video' ? 'VID' : kind === 'audio' ? 'AUD' : 'DOC'}
          </i>
          <span className="line-clamp-2 text-[10.5px] leading-tight text-[#8696a0]">
            {item.mediaName ?? 'Not in export'}
          </span>
        </span>
      )}

      {/* Hover overlay: sender + date + jump-to-message */}
      {src && (
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-2 pb-1.5 pt-6 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          {isGroup && item.sender && item.sender !== 'You' && (
            <Avatar name={item.sender} size={16} />
          )}
          <span className="min-w-0 flex-1 truncate text-left text-[10.5px] font-medium text-white/95">
            {item.sender === 'You' ? 'You' : item.sender ?? item.type}
          </span>
          <span className="shrink-0 text-[9.5px] text-white/70">
            {formatTime(item.ts)}
          </span>
        </span>
      )}

      {/* Jump to message in chat */}
      {src && onJump && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onJump()
          }}
          aria-label="Show in chat"
          title="Show in chat"
          className="absolute right-1.5 top-1.5 flex h-7 w-7 translate-y-1 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-[#00a884] focus-visible:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
        >
          <CornerDownLeft className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

function GalleryViewer({
  items,
  index,
  chatId,
  onClose,
  onNavigate,
}: {
  items: MediaItem[]
  index: number
  chatId: string
  onClose: () => void
  onNavigate: (nextIndex: number) => void
}) {
  const item = items[index]
  const kind = kindOf(item.type)
  const src = item.mediaPath
    ? `/api/media/${chatId}/${encodeURIComponent(item.mediaPath)}`
    : null
  if (!src) return null
  return (
    <Lightbox
      src={src}
      caption={item.body || item.mediaName}
      downloadName={item.mediaName}
      kind={kind === 'doc' ? 'image' : kind}
      onClose={onClose}
      onPrev={() => onNavigate(index - 1)}
      onNext={() => onNavigate(index + 1)}
      position={index + 1}
      total={items.length}
    />
  )
}
