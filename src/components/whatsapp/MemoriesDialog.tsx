'use client'

/**
 * MemoriesDialog — "On this day" memories (task 14-a).
 *
 * Self-fetching dialog: GET /api/memories (defaults to today in UTC) returns
 * messages sent on this calendar date in earlier years, grouped by year.
 * Card click → onOpenMessage(chatId, messageId) and close, so the host can
 * open the chat and jump straight to the message (WhatsAppApp.openChat
 * supports the jumpMessageId argument).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Ban,
  BarChart3,
  CalendarHeart,
  FileText,
  Film,
  Image as ImageIcon,
  MapPin,
  Mic,
  PhoneMissed,
  RefreshCw,
  StickyNote,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Avatar } from './Avatar'

interface MemoryItem {
  id: string
  chatId: string
  chatTitle: string
  isGroup: boolean
  sender: string | null
  ts: string
  type: string
  preview: string
  hasMedia: boolean
  mediaName?: string
}

interface MemoryGroup {
  key: string
  label: string
  items: MemoryItem[]
}

interface MemoriesResponse {
  date: string
  groups: MemoryGroup[]
}

/** Friendly chip vocabulary — mirrors the chat-list TYPE_META labels. */
const MEDIA_META: Record<string, { label: string; icon: LucideIcon }> = {
  image: { label: 'Photo', icon: ImageIcon },
  sticker: { label: 'Sticker', icon: StickyNote },
  gif: { label: 'GIF', icon: Film },
  video: { label: 'Video', icon: Film },
  audio: { label: 'Voice message', icon: Mic },
  document: { label: 'Document', icon: FileText },
  location: { label: 'Location', icon: MapPin },
  contact: { label: 'Contact card', icon: UserRound },
  poll: { label: 'Poll', icon: BarChart3 },
  call: { label: 'Missed call', icon: PhoneMissed },
  deleted: { label: 'Deleted message', icon: Ban },
  media: { label: 'Media', icon: ImageIcon },
}

/** '10-12' → 'October 12' (UTC-pinned so the label matches the query). */
function friendlyDate(mmd: string): string {
  const d = new Date(`${mmd}T12:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return mmd
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** Card-side short relative label ("2 years ago", "Last year", "This year"). */
function shortRelative(ts: string): string {
  const diff = new Date().getUTCFullYear() - new Date(ts).getUTCFullYear()
  if (diff <= 0) return 'This year'
  if (diff === 1) return 'Last year'
  return `${diff} years ago`
}

/** One tappable memory card. */
function MemoryCard({
  item,
  onOpen,
}: {
  item: MemoryItem
  onOpen: (item: MemoryItem) => void
}) {
  const meta = item.hasMedia ? MEDIA_META[item.type] : undefined
  const ChipIcon = meta?.icon ?? ImageIcon
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className={`
        flex w-full items-center gap-3 rounded-xl border border-(--wa-line)
        bg-black/[0.03] p-3 text-left transition-colors
        hover:bg-(--wa-row-hover) focus-visible:outline-2
        focus-visible:outline-offset-2 focus-visible:outline-(--wa-accent)
        dark:bg-white/5 dark:hover:bg-(--wa-row-active)
      `}
    >
      <Avatar name={item.chatTitle} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-[14px] font-medium text-(--wa-text)">
            {item.chatTitle}
          </span>
          {item.isGroup && item.sender && (
            <span className="truncate text-[12px] text-(--wa-text-2)">
              · {item.sender}
            </span>
          )}
        </span>
        {meta ? (
          <span
            className={`
              mt-1 inline-flex max-w-full items-center gap-1.5 rounded-full
              bg-(--wa-accent)/10 px-2 py-0.5 text-[12px] font-medium
              text-(--wa-accent-strong) dark:text-(--wa-accent)
            `}
          >
            <ChipIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{meta.label}</span>
            {item.type === 'document' && item.mediaName && (
              <span className="truncate text-(--wa-text-2)">
                · {item.mediaName}
              </span>
            )}
          </span>
        ) : (
          <span className="mt-0.5 block truncate text-[13px] text-(--wa-text-2)">
            {item.preview || 'Empty message'}
          </span>
        )}
      </span>
      <span className="shrink-0 text-[12px] tabular-nums text-(--wa-text-2)">
        {shortRelative(item.ts)}
      </span>
    </button>
  )
}

export function MemoriesDialog({
  open,
  onOpenChange,
  onOpenMessage,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onOpenMessage?: (chatId: string, messageId: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<MemoriesResponse | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/memories', {
        cache: 'no-store',
        signal: ctrl.signal,
      })
      const payload = (await res.json().catch(() => null)) as
        | (MemoriesResponse & { error?: string })
        | null
      if (!res.ok) {
        throw new Error(payload?.error ?? 'Could not load memories')
      }
      if (!payload || !Array.isArray(payload.groups)) {
        throw new Error('Unexpected response from the server')
      }
      setData({ date: payload.date, groups: payload.groups })
    } catch (err) {
      if (ctrl.signal.aborted) return
      setError(
        err instanceof Error ? err.message : 'Something went wrong — try again',
      )
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [])

  // Fresh fetch every time the dialog opens; abort the in-flight request on
  // close so a slow response can never land after the dialog reopens.
  useEffect(() => {
    if (!open) return
    void load()
    return () => abortRef.current?.abort()
  }, [open, load])

  function handleOpen(item: MemoryItem) {
    onOpenMessage?.(item.chatId, item.id)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>On this day</DialogTitle>
          <DialogDescription>
            {data
              ? friendlyDate(data.date)
              : 'Messages from the same date in earlier years'}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex flex-col gap-2.5" role="status" aria-live="polite">
            <span className="sr-only">Loading memories…</span>
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl border border-(--wa-line) p-3"
                aria-hidden="true"
              >
                <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
                <Skeleton className="h-3 w-14 shrink-0" />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col gap-3" role="alert">
            <p className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                className="rounded-full"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
              <Button
                className={`
                  gap-1.5 rounded-full bg-(--wa-accent) text-white
                  hover:bg-(--wa-accent-strong)
                `}
                onClick={() => void load()}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Retry
              </Button>
            </div>
          </div>
        )}

        {!loading && !error && data && data.groups.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <span
              className={`
                flex h-12 w-12 items-center justify-center rounded-full
                bg-(--wa-accent)/10
              `}
            >
              <CalendarHeart
                className="h-6 w-6 text-(--wa-accent-strong) dark:text-(--wa-accent)"
                aria-hidden="true"
              />
            </span>
            <p className="text-[14px] font-medium text-(--wa-text)">
              No memories for this day yet
            </p>
            <p className="max-w-[40ch] text-[13px] leading-relaxed text-(--wa-text-2)">
              Messages exchanged on this date in previous years will appear
              here.
            </p>
          </div>
        )}

        {!loading && !error && data && data.groups.length > 0 && (
          <div
            className="wa-scroll -mx-2 max-h-[70vh] overflow-y-auto px-2"
            aria-live="polite"
            aria-label="Memories grouped by year"
          >
            {data.groups.map((group) => (
              <section key={group.key} aria-label={group.label} className="pb-3">
                <div
                  className={`
                    sticky top-0 z-10 -mx-2 bg-background/95 px-3 py-1.5
                    backdrop-blur-sm
                  `}
                >
                  <h3
                    className={`
                      text-[12px] font-semibold tracking-wide text-(--wa-text-2)
                      uppercase
                    `}
                  >
                    {group.label}
                  </h3>
                </div>
                <div className="mt-2 flex flex-col gap-2">
                  {group.items.map((item) => (
                    <MemoryCard key={item.id} item={item} onOpen={handleOpen} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default MemoriesDialog
