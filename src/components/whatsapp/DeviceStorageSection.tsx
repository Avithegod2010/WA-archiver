'use client'

/**
 * DeviceStorageSection — the on-device database card (Phase 1 of the
 * local-first refactor, docs/offline-architecture.md).
 *
 * Lives at the top of the "Data and storage" dialog. It runs the on-device
 * SQLite engine (sql.js WASM persisted to OPFS / IndexedDB) and offers:
 *  • live status (engine, persistence backend, sizes, last save time)
 *  • full client-side import of WhatsApp exports (.zip/.txt) — the archive
 *    never leaves the device
 *  • a list of chats stored locally with per-chat delete
 *  • a danger zone that wipes the whole device database
 *
 * This is deliberately independent from the server storage stats below it:
 * device data and server data are two different stores during the Phase 1
 * transition (Phase 2 flips the main chat list onto this engine).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  Database,
  FileUp,
  HardDrive,
  Loader2,
  MessageSquare,
  Smartphone,
  Trash2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  getLocalClient,
  importFileToDevice,
  LocalImportError,
  type DeviceStatus,
  type LocalImportProgress,
} from '@/lib/data'
import type { ChatSummary } from './types'

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

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Database
  label: string
  value: string
}) {
  return (
    <div
      className={`
        min-w-0 rounded-lg border border-(--wa-line) bg-black/[0.02] px-2.5
        py-2 dark:bg-white/[0.04]
      `}
    >
      <div className="flex items-center gap-1">
        <Icon
          className="h-3 w-3 shrink-0 text-(--wa-text-2)"
          aria-hidden="true"
        />
        <span className="truncate text-[10.5px] font-medium uppercase tracking-wide text-(--wa-text-2)">
          {label}
        </span>
      </div>
      <p className="mt-0.5 truncate text-[13.5px] font-semibold tabular-nums text-(--wa-text)">
        {value}
      </p>
    </div>
  )
}

const PHASE_LABEL: Record<LocalImportProgress['phase'], string> = {
  reading: 'Reading archive…',
  parsing: 'Parsing transcript…',
  media: 'Storing media on this device…',
  inserting: 'Writing to the device database…',
  done: 'Finishing…',
}

export function DeviceStorageSection({ visible }: { visible: boolean }) {
  const [starting, setStarting] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<DeviceStatus | null>(null)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [quota, setQuota] = useState<{ usage: number; quota: number } | null>(
    null
  )
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<LocalImportProgress | null>(null)
  const [includeAudio, setIncludeAudio] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reload = useCallback(async () => {
    const client = getLocalClient()
    try {
      await client.whenReady()
      const [st, list] = await Promise.all([
        client.deviceStatus(),
        client.listChats(),
      ])
      setStatus(st)
      setChats(list)
      setError(null)
      try {
        const est = await navigator.storage?.estimate?.()
        if (est) {
          setQuota({
            usage: est.usage ?? 0,
            quota: est.quota ?? 0,
          })
        }
      } catch {
        /* estimate not available */
      }
    } catch {
      setError(
        'This browser cannot run the on-device database. Try a recent Chrome, Edge, Firefox or Safari.'
      )
    }
  }, [])

  // Lazily start the engine the first time the dialog is shown.
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setStarting(true)
    void reload().finally(() => {
      if (!cancelled) setStarting(false)
    })
    return () => {
      cancelled = true
    }
  }, [visible, reload])

  // Reset two-step confirmations automatically after a few seconds.
  const armConfirm = useCallback(() => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    confirmTimer.current = setTimeout(() => {
      setConfirmDeleteId(null)
      setConfirmWipe(false)
    }, 3500)
  }, [])

  const runImport = useCallback(
    async (file: File) => {
      setImporting(true)
      setProgress(null)
      try {
        const result = await importFileToDevice(file, {
          includeAudio,
          onProgress: setProgress,
        })
        toast.success(
          `Imported “${result.title}” to this device — ${result.messages.toLocaleString('en-US')} messages${
            result.mediaFiles > 0
              ? `, ${result.mediaFiles.toLocaleString('en-US')} media files`
              : ''
          }. Nothing was uploaded.`
        )
        await reload()
      } catch (err) {
        const msg =
          err instanceof LocalImportError
            ? err.message
            : 'Import to this device failed. Please check the file and try again.'
        toast.error(msg)
      } finally {
        setImporting(false)
        setProgress(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [includeAudio, reload]
  )

  const onPickFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) void runImport(file)
    },
    [runImport]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      if (importing) return
      const file = e.dataTransfer.files?.[0]
      if (file) void runImport(file)
    },
    [importing, runImport]
  )

  const deleteChat = useCallback(
    async (id: string, title: string) => {
      setConfirmDeleteId(null)
      try {
        await getLocalClient().deleteChat(id)
        toast.success(`Removed “${title}” from this device`)
        await reload()
      } catch {
        toast.error('Could not remove the chat from this device')
      }
    },
    [reload]
  )

  const wipe = useCallback(async () => {
    setConfirmWipe(false)
    try {
      await getLocalClient().wipe()
      toast.success('Device database cleared')
      await reload()
    } catch {
      toast.error('Could not clear the device database')
    }
  }, [reload])

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : null

  return (
    <section
      aria-label="On this device"
      className="flex flex-col gap-3 rounded-xl border border-(--wa-line) bg-black/[0.02] p-3 dark:bg-white/[0.03]"
    >
      {/* ---- Header ---- */}
      <div className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--wa-accent)/10"
          aria-hidden="true"
        >
          <Smartphone className="h-[18px] w-[18px] text-(--wa-accent-strong) dark:text-(--wa-accent)" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-[14.5px] font-semibold text-(--wa-text)">
              On this device
            </h3>
            {status && (
              <span
                className={`
                  inline-flex items-center gap-1 rounded-full bg-emerald-500/10
                  px-1.5 py-0.5 text-[10.5px] font-semibold text-emerald-700
                  dark:text-emerald-400
                `}
              >
                <Check className="h-3 w-3" aria-hidden="true" />
                offline database
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-(--wa-text-2)">
            A private copy of chats that lives in this browser — works with
            no internet. Import an export to store it here; nothing is
            uploaded.
          </p>
        </div>
      </div>

      {/* ---- Status / counts ---- */}
      {starting && (
        <div
          className="flex items-center gap-2 py-1.5 text-[13px] text-(--wa-text-2)"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Starting the on-device database…
        </div>
      )}

      {!starting && error && (
        <p className="text-[12.5px] leading-snug text-amber-700 dark:text-amber-400">
          {error}
        </p>
      )}

      {!starting && status && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat icon={Database} label="Chats" value={String(status.chats)} />
            <Stat
              icon={MessageSquare}
              label="Messages"
              value={status.messages.toLocaleString('en-US')}
            />
            <Stat
              icon={FileUp}
              label="Media"
              value={String(status.mediaFiles)}
            />
            <Stat
              icon={HardDrive}
              label="Size"
              value={humanSize(status.dbBytes + status.mediaBytes)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-(--wa-text-2)">
            <span
              className="rounded-full bg-black/[0.05] px-1.5 py-0.5 font-medium dark:bg-white/[0.07]"
              title="SQLite compiled to WebAssembly runs entirely in this browser tab"
            >
              SQLite (WASM)
            </span>
            <span
              className="rounded-full bg-black/[0.05] px-1.5 py-0.5 font-medium dark:bg-white/[0.07]"
              title={
                status.persistence === 'opfs'
                  ? 'The database file is saved in your browser’s private file system (OPFS) and survives reloads'
                  : 'The database file is saved in IndexedDB and survives reloads'
              }
            >
              {status.persistence === 'opfs' ? 'Saved to OPFS ✓' : 'Saved to IndexedDB ✓'}
            </span>
            {status.lastSavedAt && (
              <span>
                last write{' '}
                {new Date(status.lastSavedAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            )}
            {quota && quota.quota > 0 && (
              <span className="ml-auto tabular-nums">
                {humanSize(quota.usage)} of {humanSize(quota.quota)} available
              </span>
            )}
          </div>

          {/* ---- Import zone ---- */}
          <div
            role="button"
            tabIndex={0}
            aria-label="Import a WhatsApp export to this device"
            onClick={() => !importing && fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                if (!importing) fileInputRef.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              if (!importing) setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-5 text-center transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--wa-accent)',
              dragOver
                ? 'border-(--wa-accent) bg-(--wa-accent)/[0.06]'
                : 'border-(--wa-line) hover:border-(--wa-accent)/60 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]',
              importing && 'pointer-events-none opacity-70'
            )}
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full bg-(--wa-accent)/10"
              aria-hidden="true"
            >
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin text-(--wa-accent-strong) dark:text-(--wa-accent)" />
              ) : (
                <Upload className="h-4 w-4 text-(--wa-accent-strong) dark:text-(--wa-accent)" />
              )}
            </span>
            <p className="text-[13px] font-medium text-(--wa-text)">
              {importing
                ? PHASE_LABEL[progress?.phase ?? 'reading']
                : 'Import a WhatsApp export to this device'}
            </p>
            <p className="text-[11.5px] text-(--wa-text-2)">
              Drop a <span className="font-medium">.zip</span> or{' '}
              <span className="font-medium">.txt</span> export here, or click
              to browse
            </p>
            {importing && pct !== null && (
              <div
                className="mt-1 h-1.5 w-full max-w-[240px] overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-200"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
            {importing && pct !== null && (
              <p className="text-[11px] tabular-nums text-(--wa-text-2)">
                {progress?.processed.toLocaleString('en-US')} /{' '}
                {progress?.total.toLocaleString('en-US')} media files
              </p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.txt"
              className="sr-only"
              onChange={onPickFile}
              disabled={importing}
              aria-label="Choose a WhatsApp export file"
            />
          </div>

          <div className="flex items-center justify-between gap-2 px-0.5">
            <Label
              htmlFor="device-import-audio"
              className="text-[12.5px] font-normal text-(--wa-text-2)"
            >
              Include voice notes & audio files
            </Label>
            <Switch
              id="device-import-audio"
              checked={includeAudio}
              onCheckedChange={setIncludeAudio}
              disabled={importing}
            />
          </div>

          {/* ---- Local chats ---- */}
          {chats.length > 0 && (
            <div className="flex flex-col gap-2" aria-live="polite">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
                Stored on this device
              </h4>
              <div className="wa-scroll -mx-1 flex max-h-44 flex-col gap-1.5 overflow-y-auto px-1">
                {chats.map((chat) => {
                  const confirming = confirmDeleteId === chat.id
                  return (
                    <div
                      key={chat.id}
                      className={`
                        flex items-center gap-2.5 rounded-lg border
                        border-(--wa-line) bg-black/[0.02] px-2.5 py-2
                        dark:bg-white/[0.04]
                      `}
                    >
                      <Database
                        className="h-3.5 w-3.5 shrink-0 text-(--wa-text-2)"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-(--wa-text)">
                          {chat.title}
                          {chat.pinned && chat.id !== 'saved-messages' && (
                            <span className="ml-1.5 text-[10px] font-semibold uppercase text-(--wa-text-2)">
                              pinned
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] tabular-nums text-(--wa-text-2)">
                          {chat.messageCount.toLocaleString('en-US')}{' '}
                          {chat.messageCount === 1 ? 'message' : 'messages'}
                          {chat.mediaCount > 0
                            ? ` · ${chat.mediaCount.toLocaleString('en-US')} media`
                            : ''}
                        </p>
                      </div>
                      {confirming ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 rounded-full px-2.5 text-[11.5px]"
                          onClick={() => void deleteChat(chat.id, chat.title)}
                        >
                          Confirm
                        </Button>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-full text-(--wa-text-2) hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400"
                          aria-label={`Remove ${chat.title} from this device`}
                          onClick={() => {
                            setConfirmDeleteId(chat.id)
                            armConfirm()
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ---- Danger zone ---- */}
          {status.chats > 0 && (
            <div className="flex items-center justify-between gap-2 border-t border-(--wa-line) pt-2.5">
              <p className="text-[11.5px] leading-snug text-(--wa-text-2)">
                Device chats are managed here for now — an upcoming version
                will let the main chat list switch to this offline database.
              </p>
              {confirmWipe ? (
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-8 shrink-0 rounded-full px-3"
                  onClick={() => void wipe()}
                >
                  Delete everything
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 shrink-0 rounded-full px-3 text-rose-600 hover:bg-rose-500/10 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
                  onClick={() => {
                    setConfirmWipe(true)
                    armConfirm()
                  }}
                >
                  Clear device data
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default DeviceStorageSection
