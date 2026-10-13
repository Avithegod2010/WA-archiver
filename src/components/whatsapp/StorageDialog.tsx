'use client'

/**
 * StorageDialog — "Data and storage" dashboard (task 14-h).
 *
 * Self-fetching dialog: GET /api/storage walks the on-disk media root and
 * reports total media bytes, file count, database size and a per-chat
 * breakdown sorted by usage. Owned media gets an emerald share bar; media
 * directories without a matching chat are surfaced separately as an amber
 * "untracked media" row (leftovers from deleted chats).
 *
 * Props contract: { open, onOpenChange } — the host only needs to control
 * open state; fetching, refresh, skeleton and error handling are internal.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Database,
  Files,
  FolderX,
  HardDrive,
  Images,
  RefreshCw,
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
import { cn } from '@/lib/utils'
import { Avatar } from './Avatar'
import { DeviceStorageSection } from './DeviceStorageSection'

interface ChatStorageRow {
  chatId: string
  title: string
  isGroup: boolean
  messageCount: number
  bytes: number
  files: number
  images: number
  videos: number
  audios: number
  docs: number
}

interface StorageResponse {
  totalBytes: number
  fileCount: number
  dbBytes: number
  orphanBytes: number
  orphanFiles: number
  chats: ChatStorageRow[]
}

/** B → KB → MB → GB, one decimal, trailing ".0" trimmed ("48.2 MB"). */
function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB'] as const
  let value = bytes
  let unit: (typeof units)[number] = 'KB'
  for (const u of units) {
    if (value < 1024) break
    value /= 1024
    unit = u
  }
  return `${value.toFixed(1).replace(/\.0$/, '')} ${unit}`
}

/** "3 images · 2 videos · 12 voice notes · 1 doc" — zero groups omitted. */
function breakdownLine(chat: ChatStorageRow): string {
  const parts: string[] = []
  if (chat.images > 0)
    parts.push(`${chat.images} ${chat.images === 1 ? 'image' : 'images'}`)
  if (chat.videos > 0)
    parts.push(`${chat.videos} ${chat.videos === 1 ? 'video' : 'videos'}`)
  if (chat.audios > 0)
    parts.push(
      `${chat.audios} ${chat.audios === 1 ? 'voice note' : 'voice notes'}`,
    )
  if (chat.docs > 0)
    parts.push(`${chat.docs} ${chat.docs === 1 ? 'doc' : 'docs'}`)
  return parts.join(' · ')
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <div
      className={`
        min-w-0 rounded-xl border border-(--wa-line) bg-black/[0.03] p-3
        dark:bg-white/5
      `}
    >
      <div className="flex items-center gap-1.5">
        <Icon
          className="h-3.5 w-3.5 shrink-0 text-(--wa-accent-strong) dark:text-(--wa-accent)"
          aria-hidden="true"
        />
        <span
          className={`
            truncate text-[11px] font-medium uppercase tracking-wide
            text-(--wa-text-2)
          `}
        >
          {label}
        </span>
      </div>
      <p className="mt-1.5 truncate text-[15px] font-semibold tabular-nums text-(--wa-text)">
        {value}
      </p>
    </div>
  )
}

function StorageRow({ chat, maxBytes }: { chat: ChatStorageRow; maxBytes: number }) {
  // Relative share of the largest chat; tiny chats still show a sliver.
  const pct =
    maxBytes > 0 ? Math.min(100, Math.max(1.5, (chat.bytes / maxBytes) * 100)) : 0
  const breakdown = breakdownLine(chat)
  return (
    <div
      className={`
        rounded-xl border border-(--wa-line) bg-black/[0.03] p-3
        dark:bg-white/5
      `}
    >
      <div className="flex items-start gap-3">
        <Avatar name={chat.title} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[14px] font-medium text-(--wa-text)">
              {chat.title}
            </span>
            <span className="shrink-0 text-[12.5px] font-medium tabular-nums text-(--wa-text)">
              {humanSize(chat.bytes)}
            </span>
          </div>
          {chat.files > 0 && breakdown && (
            <p className="mt-0.5 truncate text-[12px] text-(--wa-text-2)">
              {breakdown}
            </p>
          )}
        </div>
      </div>
      <div
        className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function StorageDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<StorageResponse | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/storage', {
        cache: 'no-store',
        signal: ctrl.signal,
      })
      const payload = (await res.json().catch(() => null)) as
        | (StorageResponse & { error?: string })
        | null
      if (!res.ok) {
        throw new Error(payload?.error ?? 'Could not load storage usage')
      }
      if (!payload || !Array.isArray(payload.chats)) {
        throw new Error('Unexpected response from the server')
      }
      setData({
        totalBytes: payload.totalBytes,
        fileCount: payload.fileCount,
        dbBytes: payload.dbBytes,
        orphanBytes: payload.orphanBytes,
        orphanFiles: payload.orphanFiles,
        chats: payload.chats,
      })
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

  const maxBytes = data ? Math.max(0, ...data.chats.map((c) => c.bytes)) : 0
  const hasOrphans = !!data && (data.orphanBytes > 0 || data.orphanFiles > 0)
  const isEmpty =
    !!data && !loading && !error && data.chats.length === 0 && !hasOrphans

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HardDrive
              className="h-[18px] w-[18px] text-(--wa-accent-strong) dark:text-(--wa-accent)"
              aria-hidden="true"
            />
            Data and storage
          </DialogTitle>
          <DialogDescription>
            Media stored on disk for each chat, plus the size of the database.
          </DialogDescription>
        </DialogHeader>

        {/* On-device database (Phase 1, local-first refactor) — independent
            of the server stats below, so it renders immediately. */}
        <DeviceStorageSection visible={open} />

        {loading && !data && (
          <div className="flex flex-col gap-3" role="status" aria-live="polite">
            <span className="sr-only">Loading storage usage…</span>
            <div className="grid grid-cols-3 gap-2.5" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <Skeleton
                  key={i}
                  className="h-[62px] rounded-xl border border-(--wa-line)"
                />
              ))}
            </div>
            {[0, 1, 2, 3].map((i) => (
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

        {isEmpty && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <span
              className={`
                flex h-12 w-12 items-center justify-center rounded-full
                bg-(--wa-accent)/10
              `}
            >
              <HardDrive
                className="h-6 w-6 text-(--wa-accent-strong) dark:text-(--wa-accent)"
                aria-hidden="true"
              />
            </span>
            <p className="text-[14px] font-medium text-(--wa-text)">
              No media stored yet.
            </p>
            <p className="max-w-[40ch] text-[13px] leading-relaxed text-(--wa-text-2)">
              Photos, videos, voice notes and documents from your chats will
              appear here.
            </p>
          </div>
        )}

        {!loading && !error && data && !isEmpty && (
          <>
            <div className="grid grid-cols-3 gap-2.5">
              <SummaryCard
                icon={Images}
                label="Total media"
                value={humanSize(data.totalBytes)}
              />
              <SummaryCard
                icon={Files}
                label="Files"
                value={data.fileCount.toLocaleString('en-US')}
              />
              <SummaryCard
                icon={Database}
                label="Database"
                value={humanSize(data.dbBytes)}
              />
            </div>

            <div className="flex items-center justify-between">
              <h3
                className={`
                  text-[12px] font-semibold uppercase tracking-wide
                  text-(--wa-text-2)
                `}
              >
                Storage per chat
              </h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void load()}
                disabled={loading}
                className={`
                  h-8 gap-1.5 rounded-full px-2.5 text-[12px]
                  text-(--wa-text-2) hover:text-(--wa-text)
                `}
              >
                <RefreshCw
                  className={cn('h-3.5 w-3.5', loading && 'animate-spin')}
                  aria-hidden="true"
                />
                Refresh
              </Button>
            </div>

            <div
              className="wa-scroll -mx-2 max-h-[60vh] overflow-y-auto px-2"
              aria-label="Storage per chat"
              aria-live="polite"
            >
              <div className="flex flex-col gap-2.5 pb-1">
                {data.chats.map((chat) => (
                  <StorageRow key={chat.chatId} chat={chat} maxBytes={maxBytes} />
                ))}

                {hasOrphans && (
                  <div
                    role="note"
                    aria-label="Untracked media"
                    className={`
                      flex items-start gap-3 rounded-xl border
                      border-amber-500/30 bg-amber-500/[0.08] p-3
                      dark:border-amber-400/25 dark:bg-amber-400/[0.08]
                    `}
                  >
                    <span
                      className={`
                        flex h-10 w-10 shrink-0 items-center justify-center
                        rounded-full bg-amber-500/15
                      `}
                      aria-hidden="true"
                    >
                      <FolderX className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium text-amber-700 dark:text-amber-300">
                        Untracked media
                      </p>
                      <p className="mt-0.5 text-[12px] leading-snug text-amber-700/80 dark:text-amber-300/80">
                        {humanSize(data.orphanBytes)} in{' '}
                        {data.orphanFiles.toLocaleString('en-US')}{' '}
                        {data.orphanFiles === 1 ? 'file' : 'files'} (chat no
                        longer exists)
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default StorageDialog
