'use client'

/**
 * MediaHub — global media triage view (backlog #6).
 *
 * A dark full-screen overlay indexing every photo / video / voice note /
 * sticker / document across ALL chats, grouped by month. Features:
 *   • kind + chat + favorites filters, text search, newest/oldest sort
 *   • favorites reuse the message-level star (works on both transports)
 *   • multi-select → client-side ZIP export organized in per-chat folders
 *   • storage meter (per-kind bytes; OPFS quota readout on device mode)
 *   • click → Lightbox, jump-to-message, single-file save
 *
 * Data comes from the DataClient seam (`listAllMedia`) so it works in both
 * server and device modes; device blob: URLs are resolved via the existing
 * useMessageNormalizer cache.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import {
  ArrowDownUp,
  AudioLines,
  Check,
  Download,
  FileText,
  Film,
  Heart,
  ImageOff,
  Images,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { displayMediaSrc } from './media-src'
import { useData, useMessageNormalizer } from './data-provider'
import { Lightbox } from './Lightbox'
import { isAudioName, isVideoName } from '@/lib/media-kinds'
import type { AllMediaItem } from '@/lib/data/types'
import type { ChatMessage } from './types'

type KindKey = 'all' | 'photos' | 'videos' | 'voice' | 'stickers' | 'docs'
type SortKey = 'new' | 'old'
type Kind = 'photo' | 'video' | 'voice' | 'sticker' | 'doc'

const DOC_EXT_RE =
  /\.(pdf|docx?|pptx?|xlsx?|csv|tsv|txt|rtf|odt|ods|odp|pages|numbers|key|epub|zip|rar|7z|tar|gz|bz2|xz|dmg|iso|apk|exe|msi|deb|rpm|jar|json|xml|sql|ics|vcf)$/i

function classify(item: AllMediaItem): Kind {
  const name = item.mediaName ?? ''
  if (item.type === 'sticker') return 'sticker'
  if (item.type === 'video' || item.type === 'gif' || isVideoName(name)) return 'video'
  if (item.type === 'audio' || isAudioName(name)) return 'voice'
  if (item.type === 'document' || DOC_EXT_RE.test(name)) return 'doc'
  return 'photo'
}

const KIND_TABS: { key: KindKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'photos', label: 'Photos' },
  { key: 'videos', label: 'Videos' },
  { key: 'voice', label: 'Voice' },
  { key: 'stickers', label: 'Stickers' },
  { key: 'docs', label: 'Docs' },
]

const KIND_OF_TAB: Partial<Record<KindKey, Kind>> = {
  photos: 'photo',
  videos: 'video',
  voice: 'voice',
  stickers: 'sticker',
  docs: 'doc',
}

function formatBytes(n: number | null): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function monthKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString([], { month: 'long', year: 'numeric' })
}

/** Sanitize a chat title into a zip-safe folder name. */
function zipFolder(title: string): string {
  return title.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'chat'
}

/** Sanitize a filename for zip entries. */
function zipName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'file'
}

export function MediaHub({
  open,
  onClose,
  onOpenMessage,
}: {
  open: boolean
  onClose: () => void
  /** Open the owning chat scrolled to this message. */
  onOpenMessage: (chatId: string, messageId: string) => void
}) {
  const { mode, data, modeResolved } = useData()
  const normalizeMessages = useMessageNormalizer()

  const [items, setItems] = useState<AllMediaItem[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [kind, setKind] = useState<KindKey>('all')
  const [chatFilter, setChatFilter] = useState<string>('all')
  const [favOnly, setFavOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('new')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [zipping, setZipping] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [viewerIdx, setViewerIdx] = useState<number | null>(null)
  const [visibleMonths, setVisibleMonths] = useState(8)
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // SSR-safe portal guard (same as MediaGallery / Lightbox).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  const load = useCallback(async () => {
    if (!modeResolved) return
    setLoading(true)
    try {
      const { items: rows, truncated: tr } = await data.listAllMedia()
      // Device mode: swap stored names for blob: URLs per chat, reusing the
      // normalizer's URL cache (same trick as the per-chat gallery).
      let resolved = rows
      if (mode === 'device') {
        const byChat = new Map<string, AllMediaItem[]>()
        for (const r of rows) {
          const list = byChat.get(r.chatId) ?? []
          list.push(r)
          byChat.set(r.chatId, list)
        }
        await Promise.all(
          [...byChat.entries()].map(async ([chatId, list]) => {
            const norm = (await normalizeMessages(
              chatId,
              list as unknown as ChatMessage[]
            )) as unknown as AllMediaItem[]
            list.forEach((_, i) => {
              list[i] = norm[i]
            })
          })
        )
      }
      setItems(resolved)
      setTruncated(!!tr)
    } catch {
      setItems(null)
      toast.error('Could not load the media index')
    } finally {
      setLoading(false)
    }
  }, [data, mode, modeResolved, normalizeMessages])

  useEffect(() => {
    if (open) {
      setItems(null)
      setSelected(new Set())
      setSelectMode(false)
      setViewerIdx(null)
      setVisibleMonths(8)
      load()
    }
  }, [open, modeResolved, load])

  // OPFS/origin quota readout (device mode only — server storage is unbounded).
  useEffect(() => {
    if (!open || mode !== 'device') return
    navigator.storage
      ?.estimate?.()
      .then((est) => {
        if (est.usage != null) setQuota({ usage: est.usage, quota: est.quota ?? 0 })
      })
      .catch(() => {})
  }, [open, mode])

  // Escape: leave select mode first, then lightbox, then close.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (viewerIdx != null) return // Lightbox handles its own Escape
      if (selectMode) {
        setSelectMode(false)
        setSelected(new Set())
      } else {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, viewerIdx, selectMode, onClose])

  // Body scroll lock while open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  /** Chat options derived from the index itself (chats that actually have media). */
  const chatOptions = useMemo(() => {
    if (!items) return []
    const map = new Map<string, string>()
    for (const it of items) if (!map.has(it.chatId)) map.set(it.chatId, it.chatTitle)
    return [...map.entries()]
      .map(([id, title]) => ({ id, title }))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [items])

  const filtered = useMemo(() => {
    if (!items) return []
    const wantKind = KIND_OF_TAB[kind]
    const q = query.trim().toLowerCase()
    let rows = items
    if (wantKind) rows = rows.filter((it) => classify(it) === wantKind)
    if (chatFilter !== 'all') rows = rows.filter((it) => it.chatId === chatFilter)
    if (favOnly) rows = rows.filter((it) => it.starred)
    if (q) {
      rows = rows.filter(
        (it) =>
          (it.mediaName ?? '').toLowerCase().includes(q) ||
          (it.sender ?? '').toLowerCase().includes(q) ||
          it.chatTitle.toLowerCase().includes(q)
      )
    }
    if (sort === 'old') rows = [...rows].reverse()
    return rows
  }, [items, kind, chatFilter, favOnly, query, sort])

  /** Month-ordered groups of the filtered rows (newest first). */
  const groups = useMemo(() => {
    const map = new Map<string, AllMediaItem[]>()
    for (const it of filtered) {
      const k = monthKey(it.ts)
      const list = map.get(k) ?? []
      list.push(it)
      map.set(k, list)
    }
    return [...map.entries()]
  }, [filtered])

  /** Flat list matching the rendered order (drives the Lightbox). */
  const flatShown = useMemo(
    () => groups.slice(0, visibleMonths).flatMap(([, list]) => list),
    [groups, visibleMonths]
  )

  const totals = useMemo(() => {
    const per = { photo: 0, video: 0, voice: 0, sticker: 0, doc: 0 } as Record<Kind, number>
    const bytesPer = { photo: 0, video: 0, voice: 0, sticker: 0, doc: 0 } as Record<Kind, number>
    let totalBytes = 0
    let starred = 0
    if (items) {
      for (const it of items) {
        const k = classify(it)
        per[k]++
        bytesPer[k] += it.bytes ?? 0
        totalBytes += it.bytes ?? 0
        if (it.starred) starred++
      }
    }
    return { per, bytesPer, totalBytes, starred }
  }, [items])

  const selectedItems = useMemo(
    () => flatShown.filter((it) => selected.has(it.id)),
    [flatShown, selected]
  )
  const selectedBytes = selectedItems.reduce((acc, it) => acc + (it.bytes ?? 0), 0)

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllShown() {
    setSelected(new Set(flatShown.map((it) => it.id)))
  }

  async function toggleFav(it: AllMediaItem) {
    const next = !it.starred
    setItems((prev) =>
      prev?.map((m) => (m.id === it.id ? { ...m, starred: next } : m)) ?? prev
    )
    try {
      await data.toggleStar(it.id, next)
    } catch {
      setItems((prev) =>
        prev?.map((m) => (m.id === it.id ? { ...m, starred: !next } : m)) ?? prev
      )
      toast.error('Could not update favorite')
    }
  }

  function saveOne(it: AllMediaItem) {
    const src = displayMediaSrc(it.chatId, it.mediaPath)
    if (!src) {
      toast.error('File not available (missing from export)')
      return
    }
    const a = document.createElement('a')
    a.href = src
    a.download = it.mediaName || `${it.type}-${it.id}`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function exportZip() {
    if (selectedItems.length === 0 || zipping) return
    setZipping(true)
    const toastId = toast.loading(`Packing 0/${selectedItems.length}…`)
    try {
      const { default: JSZip } = await import('jszip')
      const zip = new JSZip()
      const used = new Set<string>()
      let added = 0
      let failed = 0
      for (let n = 0; n < selectedItems.length; n++) {
        const it = selectedItems[n]
        const src = displayMediaSrc(it.chatId, it.mediaPath)
        if (!src) {
          failed++
        } else {
          try {
            const res = await fetch(src)
            if (!res.ok) throw new Error(String(res.status))
            const blob = await res.blob()
            const folder = zipFolder(it.chatTitle)
            const base = zipName(it.mediaName || `${it.type}-${it.id}`)
            let name = base
            let k = 2
            while (used.has(`${folder}/${name}`)) {
              name = base.replace(/(\.[^.]*)?$/, ` (${k++})$1`)
            }
            used.add(`${folder}/${name}`)
            zip.file(`${folder}/${name}`, blob)
            added++
          } catch {
            failed++
          }
        }
        if (n % 5 === 0 || n === selectedItems.length - 1) {
          toast.loading(`Packing ${n + 1}/${selectedItems.length}…`, { id: toastId })
        }
      }
      if (added === 0) {
        toast.error('None of the selected files could be packed', { id: toastId })
        return
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `whatsapp-media-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast.success(
        `Exported ${added} file${added === 1 ? '' : 's'}${failed ? ` · ${failed} unavailable` : ''}`,
        { id: toastId }
      )
      setSelectMode(false)
      setSelected(new Set())
    } catch {
      toast.error('Export failed', { id: toastId })
    } finally {
      setZipping(false)
    }
  }

  /**
   * Bulk delete the selected media files. The messages stay in their chats
   * with a WhatsApp-style "Media deleted" placeholder; the bytes are freed
   * (disk in server mode, IndexedDB blobs in device mode).
   */
  async function deleteSelected() {
    if (selectedItems.length === 0 || deleting) return
    setDeleting(true)
    try {
      const n = await data.deleteMessageMedia(selectedItems.map((it) => it.id))
      toast.success(
        n > 0
          ? `Deleted ${n} file${n === 1 ? '' : 's'} · ${formatBytes(selectedBytes)} freed — chats now show a "Media deleted" note`
          : 'Nothing to delete — the files were already missing'
      )
      setConfirmDelete(false)
      setSelectMode(false)
      setSelected(new Set())
      await load()
    } catch {
      toast.error('Could not delete the selected media')
    } finally {
      setDeleting(false)
    }
  }

  if (!open || !mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex flex-col bg-[#0b141a]/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Media hub"
    >
      {/* Header */}
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--wa-accent)/15 text-(--wa-accent)">
          <Images className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15.5px] font-semibold text-white">
            Media hub
          </h2>
          <p className="truncate text-[11.5px] text-white/60">
            {loading
              ? 'Loading media index…'
              : items
                ? `${items.length.toLocaleString()} item${items.length === 1 ? '' : 's'} · ${formatBytes(totals.totalBytes) || '0 B'} across ${chatOptions.length} chat${chatOptions.length === 1 ? '' : 's'}${truncated ? ' (newest 5000)' : ''}`
                : 'Index unavailable'}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="wa-iconbtn h-9 w-9 rounded-full text-white/85 hover:bg-white/10"
          onClick={() => load()}
          disabled={loading}
          title="Refresh index"
          aria-label="Refresh index"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="wa-iconbtn h-9 w-9 rounded-full text-white/85 hover:bg-white/10"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close media hub"
        >
          <X className="h-4.5 w-4.5" />
        </Button>
      </header>

      {/* Toolbar */}
      <div className="shrink-0 border-b border-white/10 px-4 py-2.5 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          {/* Kind pills */}
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Media kind">
            {KIND_TABS.map((t) => {
              const wantKind = KIND_OF_TAB[t.key]
              const count = t.key === 'all' ? items?.length ?? 0 : wantKind ? totals.per[wantKind] : 0
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={kind === t.key}
                  onClick={() => setKind(t.key)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
                    kind === t.key
                      ? 'bg-(--wa-accent) text-white'
                      : 'bg-white/8 text-white/75 hover:bg-white/15 hover:text-white'
                  )}
                >
                  {t.label}
                  {count > 0 && (
                    <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="ms-auto flex flex-wrap items-center gap-2">
            {/* Favorites toggle */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setFavOnly((v) => !v)}
              className={cn(
                'wa-iconbtn h-8.5 gap-1.5 rounded-full px-3 text-[12px] font-medium',
                favOnly
                  ? 'bg-rose-500/90 text-white hover:bg-rose-500'
                  : 'bg-white/8 text-white/75 hover:bg-white/15 hover:text-white'
              )}
              title="Favorites only (starred media)"
              aria-pressed={favOnly}
            >
              <Heart className={cn('h-3.5 w-3.5', favOnly && 'fill-current')} />
              {totals.starred > 0 && <span className="tabular-nums">{totals.starred}</span>}
            </Button>

            {/* Chat filter */}
            <Select value={chatFilter} onValueChange={setChatFilter}>
              <SelectTrigger className="h-8.5 w-[150px] rounded-full border-white/15 bg-white/8 text-[12px] text-white sm:w-[180px] [&>svg]:text-white/70">
                <SelectValue placeholder="All chats" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="all">All chats</SelectItem>
                {chatOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Sort */}
            <Button
              size="icon"
              variant="ghost"
              className="wa-iconbtn h-8.5 w-8.5 rounded-full bg-white/8 text-white/75 hover:bg-white/15 hover:text-white"
              onClick={() => setSort((s) => (s === 'new' ? 'old' : 'new'))}
              title={sort === 'new' ? 'Newest first (click to flip)' : 'Oldest first (click to flip)'}
              aria-label="Toggle sort order"
            >
              <ArrowDownUp className="h-3.5 w-3.5" />
            </Button>

            {/* Select mode */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelectMode((v) => !v)
                setSelected(new Set())
              }}
              className={cn(
                'wa-iconbtn h-8.5 gap-1.5 rounded-full px-3 text-[12px] font-medium',
                selectMode
                  ? 'bg-(--wa-accent) text-white hover:bg-(--wa-accent)'
                  : 'bg-white/8 text-white/75 hover:bg-white/15 hover:text-white'
              )}
              aria-pressed={selectMode}
            >
              <Check className="h-3.5 w-3.5" />
              Select
            </Button>
          </div>
        </div>

        {/* Search + meter row */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search file name, sender or chat…"
              className="h-8.5 rounded-full border-white/15 bg-white/8 ps-8 text-[12.5px] text-white placeholder:text-white/40 focus-visible:ring-(--wa-accent)/50"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/55">
            {(['photo', 'video', 'voice', 'doc'] as Kind[]).map((k) => {
              if (totals.per[k] === 0) return null
              const label =
                k === 'photo'
                  ? totals.per[k] === 1
                    ? 'photo'
                    : 'photos'
                  : k === 'video'
                    ? totals.per[k] === 1
                      ? 'video'
                      : 'videos'
                    : k === 'voice'
                      ? totals.per[k] === 1
                        ? 'voice note'
                        : 'voice notes'
                      : totals.per[k] === 1
                        ? 'doc'
                        : 'docs'
              return (
                <span key={k} className="tabular-nums">
                  {totals.per[k]} {label} · {formatBytes(totals.bytesPer[k])}
                </span>
              )
            })}
            {quota && (
              <span className="tabular-nums text-white/40">
                device store {formatBytes(quota.usage)}
                {quota.quota ? ` of ${formatBytes(quota.quota)}` : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto wa-scroll px-4 pb-28 pt-4 sm:px-5">
        {loading && !items && (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-md bg-white/5" />
            ))}
          </div>
        )}

        {!loading && items && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 pt-24 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/5 text-white/35">
              <ImageOff className="h-7 w-7" />
            </span>
            <div>
              <p className="text-[14px] font-medium text-white/85">No media found</p>
              <p className="mt-1 max-w-xs text-[12px] leading-relaxed text-white/50">
                {items.length === 0
                  ? 'Import a WhatsApp export with photos, videos or voice notes and they will show up here.'
                  : 'Try clearing the filters or search.'}
              </p>
            </div>
          </div>
        )}

        {groups.slice(0, visibleMonths).map(([key, list]) => (
          <section key={key} className="mb-5">
            <div className="sticky top-0 z-10 -mx-1 mb-2 flex items-center gap-2 bg-[#0b141a]/85 px-1 py-1.5 backdrop-blur-sm">
              <h3 className="text-[12.5px] font-semibold text-white/90">{monthLabel(key)}</h3>
              <span className="text-[10.5px] tabular-nums text-white/40">
                {list.length} item{list.length === 1 ? '' : 's'}
              </span>
              {selectMode && (
                <button
                  onClick={() =>
                    setSelected((prev) => {
                      const next = new Set(prev)
                      for (const it of list) next.add(it.id)
                      return next
                    })
                  }
                  className="rounded-full bg-white/8 px-2 py-0.5 text-[10.5px] text-white/70 hover:bg-white/15 hover:text-white"
                >
                  Select month
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {list.map((it) => (
                <HubTile
                  key={it.id}
                  item={it}
                  selectMode={selectMode}
                  isSelected={selected.has(it.id)}
                  onToggleSelect={() => toggleSelect(it.id)}
                  onOpen={() => {
                    if (classify(it) === 'doc') saveOne(it)
                    else setViewerIdx(flatShown.findIndex((f) => f.id === it.id))
                  }}
                  onToggleFav={() => toggleFav(it)}
                  onJump={() => {
                    onClose()
                    onOpenMessage(it.chatId, it.id)
                  }}
                  onSave={selectMode ? undefined : () => saveOne(it)}
                />
              ))}
            </div>
          </section>
        ))}

        {!loading && groups.length > visibleMonths && (
          <div className="flex justify-center pt-2">
            <Button
              size="sm"
              variant="ghost"
              className="wa-iconbtn rounded-full bg-white/8 px-4 text-[12px] text-white/80 hover:bg-white/15 hover:text-white"
              onClick={() => setVisibleMonths((m) => m + 8)}
            >
              Show older months ({groups.length - visibleMonths} more)
            </Button>
          </div>
        )}

        {!loading && truncated && items && (
          <p className="pt-3 text-center text-[11px] text-white/40">
            Showing the newest 5000 items — older media is not listed.
          </p>
        )}
      </div>

      {/* Selection action bar */}
      {selectMode && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/10 bg-[#111b21]/95 py-2 pl-4 pr-2 shadow-2xl backdrop-blur">
            <span className="text-[12.5px] font-medium text-white/90 tabular-nums">
              {selected.size} selected
              {selectedBytes > 0 && (
                <span className="ms-1.5 font-normal text-white/50">{formatBytes(selectedBytes)}</span>
              )}
            </span>
            <span className="mx-1 h-4 w-px bg-white/15" />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 rounded-full px-3 text-[12px] text-white/70 hover:bg-white/10 hover:text-white"
              onClick={selectAllShown}
            >
              Select all
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 rounded-full bg-(--wa-accent) px-3 text-[12px] font-medium text-white hover:bg-(--wa-accent-strong)"
              onClick={exportZip}
              disabled={selected.size === 0 || zipping}
            >
              {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Export ZIP
            </Button>
            <Button
              size="sm"
              className="h-8 gap-1.5 rounded-full bg-rose-600/90 px-3 text-[12px] font-medium text-white hover:bg-rose-600"
              onClick={() => setConfirmDelete(true)}
              disabled={selected.size === 0 || deleting}
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 rounded-full text-white/60 hover:bg-white/10 hover:text-white"
              onClick={() => {
                setSelectMode(false)
                setSelected(new Set())
              }}
              title="Exit selection"
              aria-label="Exit selection mode"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="max-w-[min(92vw,420px)]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selected.size} file{selected.size === 1 ? '' : 's'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The files are removed from this device
              {selectedBytes > 0 ? ` (${formatBytes(selectedBytes)} freed)` : ''} and the
              messages stay in their chats with a “Media deleted” note. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-600/40"
              disabled={deleting}
              onClick={(e) => {
                // Keep the dialog mounted while the deletion runs.
                e.preventDefault()
                void deleteSelected()
              }}
            >
              {deleting ? 'Deleting…' : 'Delete files'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lightbox over the hub */}
      {viewerIdx != null && flatShown[viewerIdx] && (
        <Lightbox
          src={displayMediaSrc(flatShown[viewerIdx].chatId, flatShown[viewerIdx].mediaPath) ?? ''}
          caption={(() => {
            const it = flatShown[viewerIdx]
            const bits = [it.sender ?? null, formatTime(it.ts), it.chatTitle]
            return bits.filter(Boolean).join(' · ')
          })()}
          downloadName={flatShown[viewerIdx].mediaName}
          kind={(() => {
            const k = classify(flatShown[viewerIdx])
            return k === 'video' ? 'video' : k === 'voice' ? 'audio' : 'image'
          })()}
          position={viewerIdx + 1}
          total={flatShown.length}
          onClose={() => setViewerIdx(null)}
          onPrev={viewerIdx > 0 ? () => setViewerIdx((i) => (i ?? 1) - 1) : undefined}
          onNext={
            viewerIdx < flatShown.length - 1 ? () => setViewerIdx((i) => (i ?? 0) + 1) : undefined
          }
        />
      )}
    </div>,
    document.body
  )
}

/** One grid tile (adapted from the per-chat MediaGallery MediaTile). */
function HubTile({
  item,
  selectMode,
  isSelected,
  onToggleSelect,
  onOpen,
  onToggleFav,
  onJump,
  onSave,
}: {
  item: AllMediaItem
  selectMode: boolean
  isSelected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onToggleFav: () => void
  onJump: () => void
  onSave?: () => void
}) {
  const kind = classify(item)
  const src = displayMediaSrc(item.chatId, item.mediaPath)

  return (
    <div
      className={cn(
        'group relative aspect-square cursor-pointer overflow-hidden rounded-md bg-white/5 ring-1 transition-all duration-150 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--wa-accent)',
        isSelected ? 'ring-2 ring-(--wa-accent)' : 'ring-white/10'
      )}
      onClick={() => (selectMode ? onToggleSelect() : onOpen())}
      onKeyDown={(e) => {
        if (!src) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (selectMode) onToggleSelect()
          else onOpen()
        }
      }}
      tabIndex={src ? 0 : undefined}
      role="button"
      aria-label={item.mediaName ?? `${kind} from ${item.chatTitle}`}
    >
      {src && kind === 'photo' && (
        <img
          src={src}
          alt={item.mediaName ?? 'Chat media'}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
        />
      )}
      {src && kind === 'sticker' && (
        <img
          src={src}
          alt={item.mediaName ?? 'Sticker'}
          loading="lazy"
          className="h-full w-full object-contain p-1.5 transition-transform duration-300 group-hover:scale-[1.06]"
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
            )
          }>
            <Film className="h-3 w-3" /> Video
          </span>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-transform duration-200 group-hover:scale-110">
              <Play className="ml-0.5 h-4 w-4 fill-current" />
            </span>
          </span>
        </>
      )}
      {src && kind === 'voice' && (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-(--wa-accent)">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-(--wa-accent)/15">
            <AudioLines className="h-5 w-5" />
          </span>
          <span className="max-w-[88%] truncate px-2 text-[10px] text-white/60">
            {item.mediaName ?? 'Voice message'}
          </span>
        </span>
      )}
      {src && kind === 'doc' && (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[#f2a33c]">
          <FileText className="h-8 w-8" />
          <span className="max-w-[88%] truncate px-2 text-[10px] text-white/60">
            {item.mediaName ?? 'Document'}
          </span>
        </span>
      )}
      {!src && (
        <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 text-center">
          <i className="flex h-8 w-8 items-center justify-center rounded bg-white/10 text-[10px] font-bold tracking-wide text-white/50">
            {kind === 'photo' || kind === 'sticker' ? 'IMG' : kind === 'video' ? 'VID' : kind === 'voice' ? 'AUD' : 'DOC'}
          </i>
          <span className="line-clamp-2 text-[10px] leading-tight text-white/45">
            {item.mediaName ?? 'Not in export'}
          </span>
        </span>
      )}

      {/* Hover overlay: sender · time · chat */}
      {src && (
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-1.5 pb-1.5 pt-6 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-left text-[10px] font-medium text-white/95">
              {item.sender === 'You' ? 'You' : item.sender ?? item.type}
            </span>
            <span className="block truncate text-left text-[9px] text-white/60">
              {item.chatTitle}
            </span>
          </span>
          <span className="shrink-0 text-[9px] tabular-nums text-white/70">
            {formatTime(item.ts)}
          </span>
        </span>
      )}

      {/* Favorite star (top-right, hover) */}
      {src && !selectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleFav()
          }}
          aria-label={item.starred ? 'Remove favorite' : 'Add favorite'}
          title={item.starred ? 'Remove favorite' : 'Add favorite'}
          className={cn(
            'absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-sm transition-all duration-200 hover:scale-110 focus-visible:opacity-100 group-hover:opacity-100',
            item.starred
              ? 'bg-rose-500/90 text-white opacity-100'
              : 'bg-black/55 text-white opacity-0 hover:bg-rose-500/90'
          )}
        >
          <Heart className={cn('h-3.5 w-3.5', item.starred && 'fill-current')} />
        </button>
      )}

      {/* Save (single file) — hover action next to favorite */}
      {src && onSave && !selectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onSave()
          }}
          aria-label="Save file"
          title="Save file"
          className="absolute right-9 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-(--wa-accent) focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Save className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Jump to chat */}
      {src && !selectMode && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onJump()
          }}
          aria-label="Show in chat"
          title="Show in chat"
          className="absolute right-1.5 top-9 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-all duration-200 hover:scale-110 hover:bg-(--wa-accent) focus-visible:opacity-100 group-hover:opacity-100"
        >
          <MessageSquare className="h-3.5 w-3.5" />
        </button>
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
    </div>
  )
}
