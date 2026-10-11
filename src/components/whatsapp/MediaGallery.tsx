'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  Archive,
  Check,
  CornerDownLeft,
  Download,
  FileText,
  Film,
  ImageIcon,
  LayoutGrid,
  Link2,
  ListChecks,
  Loader2,
  Mic,
  Play,
  Sticker as StickerIcon,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Lightbox } from './Lightbox'
import { VoicePlayer } from './VoicePlayer'
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

/** Minimal message shape used to mine text bodies for links. */
interface LinkSourceMsg {
  id: string
  ts: string
  sender: string | null
  body: string
  type: string
}

interface LinkRow {
  id: string
  messageId: string
  url: string
  host: string
  sender: string | null
  ts: string
}

type TabKey = 'all' | 'photos' | 'links' | 'docs' | 'voice' | 'stickers'

const URL_RE = /https?:\/\/[^\s<>"'`{}|\\^\[\]]+/gi

const DOC_EXT_RE =
  /\.(pdf|docx?|pptx?|xlsx?|csv|tsv|txt|rtf|odt|ods|odp|pages|numbers|key|epub|zip|rar|7z|tar|gz|bz2|xz|dmg|iso|apk|exe|msi|deb|rpm|jar|json|xml|sql|ics|vcf)$/i

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

function isDocName(name: string | null): boolean {
  return !!name && DOC_EXT_RE.test(name)
}

function mediaUrl(chatId: string, m: MediaItem): string | null {
  return m.mediaPath
    ? `/api/media/${chatId}/${encodeURIComponent(m.mediaPath)}`
    : null
}

/** Trim trailing punctuation / unbalanced brackets from a matched URL. */
function tidyUrl(raw: string): string | null {
  let u = raw
  const opens = (u.match(/\(/g) ?? []).length
  const closes = (u.match(/\)/g) ?? []).length
  if (closes > opens) u = u.replace(/\)+$/, '')
  u = u.replace(/[\].,;:!?'"`”’>}]+$/, '')
  try {
    const parsed = new URL(u)
    if (!parsed.hostname.includes('.')) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function extractLinks(body: string): string[] {
  const matches = body.match(URL_RE) ?? []
  const seen = new Set<string>()
  for (const raw of matches) {
    const url = tidyUrl(raw)
    if (url) seen.add(url)
  }
  return [...seen]
}

function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/**
 * Full-screen gallery of every media item in the active chat, organised in
 * All / Photos / Links / Docs / Voice (+ Stickers) tabs.
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
  const [msgs, setMsgs] = useState<LinkSourceMsg[] | null | undefined>(undefined)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [filter, setFilter] = useState<TabKey>('all')
  const [zipping, setZipping] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const msgsRequestedRef = useRef<string | null>(null)
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

  // Reset the lazily-loaded message source whenever the gallery (re)opens.
  useEffect(() => {
    if (!open) return
    msgsRequestedRef.current = null
    setMsgs(undefined)
  }, [open, chatId])

  // Text messages are only fetched when the Links tab is first opened.
  useEffect(() => {
    if (!open || filter !== 'links' || msgs !== undefined) return
    if (msgsRequestedRef.current === chatId) return
    msgsRequestedRef.current = chatId
    let alive = true
    fetch(`/api/chats/${chatId}/messages`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((d) => {
        if (alive) setMsgs(d.messages as LinkSourceMsg[])
      })
      .catch(() => {
        if (alive) setMsgs(null)
      })
    return () => {
      alive = false
    }
  }, [open, filter, chatId, msgs])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && viewerIndex == null) {
        // Selection mode exits first, then the gallery closes
        if (selectMode) {
          exitSelect()
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, viewerIndex, onClose, selectMode])

  const links = useMemo<LinkRow[]>(() => {
    if (!msgs) return []
    const rows: LinkRow[] = []
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.type !== 'text' || !m.body) continue
      let n = 0
      for (const url of extractLinks(m.body)) {
        n++
        let host = url
        try {
          host = new URL(url).hostname
        } catch {
          /* unreachable */
        }
        rows.push({
          id: `${m.id}:${n}`,
          messageId: m.id,
          url,
          host,
          sender: m.sender,
          ts: m.ts,
        })
      }
    }
    return rows
  }, [msgs])

  const shown = useMemo(() => {
    if (!items) return []
    switch (filter) {
      case 'all':
        return items
      case 'photos':
        return items.filter(
          (m) => m.type !== 'sticker' && ['image', 'video'].includes(kindOf(m.type))
        )
      case 'stickers':
        return items.filter((m) => m.type === 'sticker')
      case 'docs':
        return items.filter(
          (m) => kindOf(m.type) === 'doc' || (m.type === 'media' && isDocName(m.mediaName))
        )
      case 'voice':
        return items.filter((m) => kindOf(m.type) === 'audio')
      default:
        return []
    }
  }, [items, filter])

  const counts = useMemo(() => {
    const c = { all: 0, photos: 0, links: 0, docs: 0, voice: 0, stickers: 0 }
    for (const m of items ?? []) {
      if (m.type === 'sticker') {
        c.stickers++
        continue
      }
      const k = kindOf(m.type)
      if (k === 'image' || k === 'video') c.photos++
      else if (k === 'doc' || (m.type === 'media' && isDocName(m.mediaName))) c.docs++
      else if (k === 'audio') c.voice++
    }
    if (items) c.all = items.length
    if (msgs) c.links = links.length
    return c
  }, [items, msgs, links])

  const totalBytes = useMemo(
    () => (items ?? []).reduce((s, m) => s + (m.bytes ?? 0), 0),
    [items]
  )

  const availableCount = useMemo(
    () => (items ?? []).filter((m) => m.mediaPath).length,
    [items]
  )

  const isGridTab =
    filter === 'all' || filter === 'photos' || filter === 'stickers'
  const canJump = !!onJumpToMessage

  function exitSelect() {
    setSelectMode(false)
    setSelected(new Set())
  }

  function switchTab(tab: TabKey) {
    if (selectMode && !(tab === 'all' || tab === 'photos' || tab === 'stickers')) {
      exitSelect()
    }
    setFilter(tab)
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function jumpTo(messageId: string) {
    setViewerIndex(null)
    onClose() // reveal the chat underneath
    onJumpToMessage?.(messageId)
  }

  async function handleDownloadSelected() {
    if (selected.size === 0 || bulkBusy) return
    setBulkBusy(true)
    try {
      const res = await fetch(`/api/chats/${chatId}/media-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected] }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Download failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = ''
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      toast.success(
        `Downloading ${selected.size} item${selected.size === 1 ? '' : 's'} as .zip — check your downloads`
      )
      exitSelect()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not download selection'
      )
    } finally {
      setBulkBusy(false)
    }
  }

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

  function retryLinks() {
    msgsRequestedRef.current = null
    setMsgs(undefined)
  }

  if (!open || !mounted) return null

  const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
    { key: 'all', label: 'All', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
    { key: 'photos', label: 'Photos', icon: <ImageIcon className="h-3.5 w-3.5" /> },
    { key: 'links', label: 'Links', icon: <Link2 className="h-3.5 w-3.5" /> },
    { key: 'docs', label: 'Docs', icon: <FileText className="h-3.5 w-3.5" /> },
    { key: 'voice', label: 'Voice', icon: <Mic className="h-3.5 w-3.5" /> },
    ...(counts.stickers > 0
      ? [
          {
            key: 'stickers' as TabKey,
            label: 'Stickers',
            icon: <StickerIcon className="h-3.5 w-3.5" />,
          },
        ]
      : []),
  ]

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
      <div className="flex items-center gap-3 border-b border-white/10 bg-(--wa-panel) px-4 py-3">
        <Avatar name={chatTitle} size={36} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold text-(--wa-text)">
            {chatTitle} · media
          </h2>
          <p className="text-[11.5px] text-(--wa-text-2)">
            {items == null
              ? 'Loading…'
              : `${counts.all} item${counts.all === 1 ? '' : 's'}${
                  totalBytes > 0 ? ` · ${formatBytes(totalBytes)}` : ''
                }${msgs ? ` · ${counts.links} link${counts.links === 1 ? '' : 's'}` : ''} · click to view`}
          </p>
        </div>
        {items != null && availableCount > 0 && (
          <button
            onClick={handleDownloadZip}
            disabled={zipping || selectMode}
            aria-label="Download all media as zip"
            title="Download all media (.zip with transcript)"
            className="flex h-9 items-center gap-1.5 rounded-full bg-(--wa-accent) px-3.5 text-[12.5px] font-medium text-white transition-colors hover:bg-(--wa-accent-strong) disabled:opacity-60"
          >
            {zipping ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
            Download all
          </button>
        )}
        {isGridTab && items != null && shown.length > 0 && (
          <button
            onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
            aria-pressed={selectMode}
            title={selectMode ? 'Exit selection' : 'Select media to download'}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition-colors',
              selectMode
                ? 'bg-white text-(--wa-text)'
                : 'bg-white/10 text-(--wa-text) hover:bg-white/20'
            )}
          >
            <ListChecks className="h-4 w-4" />
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Close gallery"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Type filter tabs — pseudo-element pads the hit area to ≥44px */}
      {items != null && (
        <div
          role="tablist"
          aria-label="Gallery sections"
          className="flex gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:none]"
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              aria-selected={filter === t.key}
              role="tab"
              className={cn(
                'relative flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium transition-colors before:absolute before:inset-x-0 before:-inset-y-2.5 before:content-[""]',
                filter === t.key
                  ? 'bg-(--wa-accent) text-white'
                  : 'bg-white/10 text-(--wa-text-2) hover:bg-white/20'
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

      {/* Tab body */}
      <div className="wa-scroll flex-1 overflow-y-auto p-4">
        {items === undefined && (
          <div className="flex h-40 items-center justify-center gap-2 text-[13.5px] text-(--wa-text-2)">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading media…
          </div>
        )}
        {items === null && (
          <EmptyState
            icon={<ImageIcon className="h-7 w-7 text-(--wa-text-2)" />}
            title="Could not load media"
            body="Something went wrong. Close this gallery and try again."
          />
        )}

        {/* ---------- Grid tabs (All / Photos / Stickers) ---------- */}
        {items != null && isGridTab && shown.length === 0 && (
          <EmptyState
            icon={
              filter === 'stickers' ? (
                <StickerIcon className="h-7 w-7 text-(--wa-text-2)" />
              ) : (
                <ImageIcon className="h-7 w-7 text-(--wa-text-2)" />
              )
            }
            title={
              filter === 'all'
                ? 'No media in this chat'
                : filter === 'stickers'
                  ? 'No stickers here'
                  : 'No photos or videos yet'
            }
            body={
              filter === 'all'
                ? 'Media appears here when the chat was exported with media.'
                : filter === 'stickers'
                  ? 'Stickers appear here when the export includes media.'
                  : 'Shared photos and videos appear here.'
            }
          />
        )}
        {items != null && isGridTab && shown.length > 0 && (
          <div className="grid grid-cols-2 gap-2 pb-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {shown.map((m, i) => (
              <MediaTile
                key={m.id}
                item={m}
                chatId={chatId}
                isGroup={isGroup}
                canJump={canJump && !selectMode}
                selectMode={selectMode}
                isSelected={selected.has(m.id)}
                onToggleSelect={toggleSelect}
                onOpen={() => setViewerIndex(i)}
                onJump={canJump ? () => jumpTo(m.id) : undefined}
              />
            ))}
          </div>
        )}

        {/* ---------- Links tab ---------- */}
        {items != null && filter === 'links' && (
          <>
            {msgs === undefined && (
              <div className="flex h-40 items-center justify-center gap-2 text-[13.5px] text-(--wa-text-2)">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading links…
              </div>
            )}
            {msgs === null && (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <p className="text-[13.5px] text-(--wa-text-2)">
                  Could not load links
                </p>
                <button
                  onClick={retryLinks}
                  className="flex h-11 items-center rounded-full bg-white/10 px-4 text-[12.5px] font-medium text-(--wa-text) transition-colors hover:bg-white/20"
                >
                  Try again
                </button>
              </div>
            )}
            {msgs != null && links.length === 0 && (
              <EmptyState
                icon={<Link2 className="h-7 w-7 text-(--wa-text-2)" />}
                title="No links shared yet"
                body="Links sent in text messages will appear here."
              />
            )}
            {msgs != null && links.length > 0 && (
              <div className="mx-auto flex max-w-2xl flex-col gap-2 pb-4">
                {links.map((row) => (
                  <LinkRowItem
                    key={row.id}
                    row={row}
                    isGroup={isGroup}
                    canJump={canJump}
                    onJump={canJump ? () => jumpTo(row.messageId) : undefined}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ---------- Docs tab ---------- */}
        {items != null && filter === 'docs' && shown.length === 0 && (
          <EmptyState
            icon={<FileText className="h-7 w-7 text-(--wa-text-2)" />}
            title="No documents here"
            body="Documents shared in this chat will appear here."
          />
        )}
        {items != null && filter === 'docs' && shown.length > 0 && (
          <div className="mx-auto flex max-w-2xl flex-col gap-2 pb-4">
            {shown.map((m) => (
              <DocRowItem
                key={m.id}
                item={m}
                chatId={chatId}
                isGroup={isGroup}
                canJump={canJump}
                onJump={canJump ? () => jumpTo(m.id) : undefined}
              />
            ))}
          </div>
        )}

        {/* ---------- Voice tab ---------- */}
        {items != null && filter === 'voice' && shown.length === 0 && (
          <EmptyState
            icon={<Mic className="h-7 w-7 text-(--wa-text-2)" />}
            title="No voice messages here"
            body="Voice notes appear here when the chat was exported with media."
          />
        )}
        {items != null && filter === 'voice' && shown.length > 0 && (
          <div className="mx-auto flex max-w-2xl flex-col gap-2 pb-4">
            {shown.map((m) => (
              <VoiceRowItem
                key={m.id}
                item={m}
                chatId={chatId}
                isGroup={isGroup}
                canJump={canJump}
                onJump={canJump ? () => jumpTo(m.id) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Selection action bar */}
      {selectMode && (
        <div className="animate-in slide-in-from-bottom-2 flex items-center gap-2 border-t border-white/10 bg-(--wa-panel) px-4 py-2.5 duration-200">
          <button
            onClick={() =>
              setSelected(new Set(shown.filter((m) => m.mediaPath).map((m) => m.id)))
            }
            disabled={shown.length === 0}
            className="flex h-8 items-center rounded-full bg-white/10 px-3 text-[12px] font-medium text-(--wa-text) transition-colors hover:bg-white/20 disabled:opacity-50"
          >
            Select all
          </button>
          <button
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
            className="flex h-8 items-center rounded-full bg-white/10 px-3 text-[12px] font-medium text-(--wa-text) transition-colors hover:bg-white/20 disabled:opacity-50"
          >
            Clear
          </button>
          <span className="flex-1 text-center text-[12.5px] tabular-nums text-(--wa-text-2)">
            {selected.size} selected
          </span>
          <button
            onClick={handleDownloadSelected}
            disabled={selected.size === 0 || bulkBusy}
            className="flex h-9 items-center gap-1.5 rounded-full bg-(--wa-accent) px-4 text-[12.5px] font-medium text-white transition-colors hover:bg-(--wa-accent-strong) disabled:opacity-60"
          >
            {bulkBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Download
          </button>
        </div>
      )}

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

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5">
        {icon}
      </div>
      <p className="text-[14px] font-medium text-(--wa-text)">{title}</p>
      <p className="max-w-[280px] text-[12.5px] leading-relaxed text-(--wa-text-2)">
        {body}
      </p>
    </div>
  )
}

function Favicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false)
  const [prevHost, setPrevHost] = useState(host)
  if (prevHost !== host) {
    setPrevHost(host)
    setFailed(false)
  }
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-(--wa-text-2)">
      {failed ? (
        <Link2 className="h-4 w-4" />
      ) : (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
          alt=""
          width={20}
          height={20}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-5 w-5 rounded"
        />
      )}
    </span>
  )
}

function LinkRowItem({
  row,
  isGroup,
  canJump,
  onJump,
}: {
  row: LinkRow
  isGroup: boolean
  canJump: boolean
  onJump?: () => void
}) {
  return (
    <div className="group flex items-center gap-3 rounded-xl bg-white/5 p-2 ring-1 ring-white/10 transition-colors hover:bg-white/10">
      <Favicon host={row.host} />
      <a
        href={row.url}
        target="_blank"
        rel="noopener noreferrer"
        title={row.url}
        className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {isGroup && row.sender && row.sender !== 'You' && (
            <Avatar name={row.sender} size={14} />
          )}
          <span className="truncate text-[13px] font-medium text-(--wa-text)">
            {row.host}
          </span>
        </span>
        <span className="truncate text-[11.5px] text-(--wa-text-2)">
          {prettyUrl(row.url)}
        </span>
      </a>
      <span className="shrink-0 pr-1 text-[10.5px] tabular-nums text-(--wa-text-2)">
        {formatTime(row.ts)}
      </span>
      {canJump && onJump && (
        <button
          onClick={onJump}
          aria-label="Show in chat"
          title="Show in chat"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-white/10 hover:text-white"
        >
          <CornerDownLeft className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

function DocRowItem({
  item,
  chatId,
  isGroup,
  canJump,
  onJump,
}: {
  item: MediaItem
  chatId: string
  isGroup: boolean
  canJump: boolean
  onJump?: () => void
}) {
  const src = mediaUrl(chatId, item)
  const meta = [
    item.bytes != null ? formatBytes(item.bytes) : null,
    item.sender === 'You' ? 'You' : item.sender,
    formatTime(item.ts),
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="group flex items-center gap-3 rounded-xl bg-white/5 p-2 ring-1 ring-white/10 transition-colors hover:bg-white/10">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[#f2a33c]">
        <FileText className="h-5 w-5" />
      </span>
      <div className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center">
        <span className="flex min-w-0 items-center gap-1.5">
          {isGroup && item.sender && item.sender !== 'You' && (
            <Avatar name={item.sender} size={14} />
          )}
          <span className="truncate text-[13px] font-medium text-(--wa-text)">
            {item.mediaName ?? 'Document'}
          </span>
        </span>
        <span className="truncate text-[11.5px] text-(--wa-text-2)">{meta}</span>
      </div>
      {src && (
        <a
          href={src}
          download={item.mediaName ?? true}
          onClick={() => toast.success('Downloading document — check your downloads')}
          aria-label={`Download ${item.mediaName ?? 'document'}`}
          title="Download"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-white/10 hover:text-white"
        >
          <Download className="h-4 w-4" />
        </a>
      )}
      {canJump && onJump && (
        <button
          onClick={onJump}
          aria-label="Show in chat"
          title="Show in chat"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-white/10 hover:text-white"
        >
          <CornerDownLeft className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

function VoiceRowItem({
  item,
  chatId,
  isGroup,
  canJump,
  onJump,
}: {
  item: MediaItem
  chatId: string
  isGroup: boolean
  canJump: boolean
  onJump?: () => void
}) {
  const src = mediaUrl(chatId, item)
  return (
    <div className="rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10 transition-colors hover:bg-white/10">
      <div className="mb-1 flex min-h-[32px] items-center gap-1.5 px-0.5">
        {isGroup && item.sender && item.sender !== 'You' && (
          <Avatar name={item.sender} size={16} />
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-(--wa-text)">
          {item.sender === 'You' ? 'You' : item.sender ?? 'Voice message'}
          {item.mediaName && (
            <span className="font-normal text-(--wa-text-2)"> · {item.mediaName}</span>
          )}
        </span>
        <span className="shrink-0 text-[10.5px] tabular-nums text-(--wa-text-2)">
          {formatTime(item.ts)}
        </span>
        {canJump && onJump && (
          <button
            onClick={onJump}
            aria-label="Show in chat"
            title="Show in chat"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-white/10 hover:text-white"
          >
            <CornerDownLeft className="h-4 w-4" />
          </button>
        )}
      </div>
      {src ? (
        <VoicePlayer src={src} seed={item.id} />
      ) : (
        <span className="flex h-8 items-center text-[12.5px] text-(--wa-text-2)">
          Voice message — media unavailable
        </span>
      )}
    </div>
  )
}

function MediaTile({
  item,
  chatId,
  isGroup,
  canJump,
  selectMode,
  isSelected,
  onToggleSelect,
  onOpen,
  onJump,
}: {
  item: MediaItem
  chatId: string
  isGroup: boolean
  canJump: boolean
  selectMode: boolean
  isSelected: boolean
  onToggleSelect: (id: string) => void
  onOpen: () => void
  onJump?: () => void
}) {
  const kind = kindOf(item.type)
  const src = mediaUrl(chatId, item)

  return (
    <div
      className={cn(
        'group relative aspect-square overflow-hidden rounded-lg bg-white/5 ring-1 transition-all duration-200',
        src
          ? 'cursor-pointer hover:brightness-110'
          : 'cursor-default opacity-70',
        isSelected
          ? 'ring-2 ring-(--wa-accent)'
          : 'ring-white/10 hover:ring-2 hover:ring-(--wa-accent)'
      )}
      role={src ? 'button' : undefined}
      aria-label={
        selectMode
          ? `${isSelected ? 'Deselect' : 'Select'} ${item.mediaName ?? item.type}`
          : item.mediaName ?? item.type
      }
      aria-pressed={selectMode ? isSelected : undefined}
      title={
        item.mediaName
          ? `${item.mediaName}${item.bytes != null ? ` · ${formatBytes(item.bytes)}` : ''}`
          : undefined
      }
      onClick={() => {
        if (!src) return
        if (selectMode) onToggleSelect(item.id)
        else onOpen()
      }}
      onKeyDown={(e) => {
        if (!src) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (selectMode) onToggleSelect(item.id)
          else onOpen()
        }
      }}
      tabIndex={src ? 0 : undefined}
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
          <span
            className={cn(
              'absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-[9.5px] font-medium text-white backdrop-blur-sm transition-all duration-150',
              selectMode && 'left-8'
            )}
          >
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
        <span className="flex h-full w-full flex-col items-center justify-center gap-2 text-(--wa-accent)">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-(--wa-accent)/15">
            <Mic className="h-6 w-6" />
          </span>
          <span className="max-w-[85%] truncate px-2 text-[11px] text-(--wa-text-2)">
            {item.mediaName ?? 'Voice message'}
          </span>
        </span>
      )}
      {src && kind === 'doc' && (
        <span className="flex h-full w-full flex-col items-center justify-center gap-2 text-[#f2a33c]">
          <FileText className="h-10 w-10" />
          <span className="max-w-[85%] truncate px-2 text-[11px] text-(--wa-text-2)">
            {item.mediaName ?? 'Document'}
          </span>
        </span>
      )}
      {!src && (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 text-center">
          <i className="flex h-9 w-9 items-center justify-center rounded bg-white/10 text-[10px] font-bold tracking-wide text-(--wa-text-2)">
            {kind === 'image' ? 'IMG' : kind === 'video' ? 'VID' : kind === 'audio' ? 'AUD' : 'DOC'}
          </i>
          <span className="line-clamp-2 text-[10.5px] leading-tight text-(--wa-text-2)">
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

      {/* Selection checkbox */}
      {selectMode && src && (
        <span
          className={cn(
            'pointer-events-none absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full transition-all duration-150',
            isSelected
              ? 'scale-100 bg-(--wa-accent) text-white opacity-100'
              : 'scale-90 bg-black/55 text-transparent opacity-90 ring-1 ring-white/40'
          )}
        >
          <Check className="h-4 w-4" />
        </span>
      )}

      {/* Jump to message in chat */}
      {src && onJump && !selectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onJump()
          }}
          aria-label="Show in chat"
          title="Show in chat"
          className="absolute right-1.5 top-1.5 flex h-7 w-7 translate-y-1 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-(--wa-accent) focus-visible:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
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
