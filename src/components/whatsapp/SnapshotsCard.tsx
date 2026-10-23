'use client'

/**
 * On-device snapshots card (backlog idea #14) — Settings section.
 *
 * Shows the rolling window of up to 5 full-database snapshots kept in
 * IndexedDB: taken automatically after every import (throttled) and
 * manually via "Snapshot now". One-click Restore (with an inline
 * confirm) swaps the live database for the snapshot image — the
 * pre-restore state is itself snapshotted first, so a restore is
 * always undoable while the window holds it.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Camera,
  Check,
  DatabaseBackup,
  History,
  Loader2,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useData } from './data-provider'
import { getStorageMode } from './storage-mode'
import {
  deleteSnapshot,
  listSnapshots,
  MAX_SNAPSHOTS,
  restoreSnapshot,
  takeSnapshot,
  type SnapshotMeta,
} from './rolling-backups'
import { formatRelativeTime } from './backup-reminder'
import { useT } from '@/lib/i18n'

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const REASON_LABEL: Record<SnapshotMeta['reason'], string> = {
  import: 'after import',
  manual: 'manual',
  restore: 'before restore',
}

export function SnapshotsCard() {
  const { data, mode } = useData()
  const t = useT()
  const [rows, setRows] = useState<SnapshotMeta[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const list = await listSnapshots()
      setRows(list)
    } catch {
      setRows([])
    }
  }, [])

  // Refresh whenever Settings opens (the card mounts with the dialog).
  useEffect(() => {
    void refresh()
  }, [refresh])

  const snapshotNow = async () => {
    if (busy) return
    setBusy(true)
    try {
      await data.flush().catch(() => {})
      const snap = await takeSnapshot('manual')
      if (snap) {
        toast.success(
          `Snapshot saved · ${snap.chats} chats · ${fmtSize(snap.size)}`
        )
      } else {
        toast.error('Snapshots need on-device storage (device mode)')
      }
      await refresh()
    } catch {
      toast.error('Could not take a snapshot')
    } finally {
      setBusy(false)
    }
  }

  const doRestore = async (id: string) => {
    setConfirmId(null)
    setBusy(true)
    try {
      await data.flush().catch(() => {})
      const counts = await restoreSnapshot(id)
      toast.success(
        `Restored ${counts.chats} chats · ${counts.messages.toLocaleString()} messages — reloading…`
      )
      setTimeout(() => window.location.reload(), 900)
    } catch {
      toast.error('Restore failed — the snapshot could not be applied')
      setBusy(false)
    }
  }

  const doDelete = async (id: string) => {
    try {
      await deleteSnapshot(id)
      await refresh()
    } catch {
      toast.error('Could not delete the snapshot')
    }
  }

  const device = mode === 'device' || getStorageMode() === 'device'

  return (
    <section
      aria-label="On-device snapshots"
      className="flex flex-col gap-2 rounded-lg border border-black/[0.06] p-3 dark:border-white/10"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
          <History className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
          {t('snapshots.title')}
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void snapshotNow()}
          disabled={busy || !device}
          className="h-7 gap-1.5 px-2 text-[12px]"
          title={
            device
              ? 'Save the current state as a restore point (keeps the last 5)'
              : 'Switch storage to “This device” first — snapshots protect on-device data'
          }
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Camera className="h-3.5 w-3.5" aria-hidden />
          )}
          {t('snapshots.now')}
        </Button>
      </div>
      <p className="text-[11.5px] leading-snug text-(--wa-text-2)">
        Rolling restore points — one is taken automatically after every
        import. The newest {MAX_SNAPSHOTS} are kept on this device only.
      </p>

      {rows && rows.length > 0 && (
        <ul className="wa-scroll flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-0.5">
          {rows.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded-md bg-black/[0.03] px-2.5 py-2 dark:bg-white/[0.05]"
            >
              <DatabaseBackup
                className="h-4 w-4 shrink-0 text-(--wa-text-2)"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-(--wa-text)">
                  {formatRelativeTime(s.at)}
                </span>
                <span className="block truncate text-[11px] text-(--wa-text-2)">
                  {s.chats} chats · {s.messages.toLocaleString()} messages ·{' '}
                  {fmtSize(s.size)} · {REASON_LABEL[s.reason]}
                </span>
              </span>
              {confirmId === s.id ? (
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    onClick={() => void doRestore(s.id)}
                    disabled={busy}
                    className="h-7 gap-1 bg-(--wa-accent) px-2 text-[11.5px] text-white hover:bg-(--wa-accent-strong)"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    Sure?
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setConfirmId(null)}
                    className="h-7 w-7"
                    aria-label="Cancel restore"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </span>
              ) : (
                <span className="flex shrink-0 items-center gap-0.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setConfirmId(s.id)}
                    disabled={busy}
                    className="h-7 w-7 text-(--wa-accent-strong)"
                    aria-label={`Restore snapshot from ${formatRelativeTime(s.at)}`}
                    title="Restore this snapshot"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void doDelete(s.id)}
                    disabled={busy}
                    className="h-7 w-7 text-(--wa-text-2) hover:text-red-500"
                    aria-label={`Delete snapshot from ${formatRelativeTime(s.at)}`}
                    title="Delete snapshot"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {rows && rows.length === 0 && (
        <p className="rounded-md bg-black/[0.03] px-3 py-2.5 text-[12px] leading-snug text-(--wa-text-2) dark:bg-white/[0.05]">
          {device ? (
            <>No snapshots yet. Import an export or press “Snapshot now” to
            create the first restore point.</>
          ) : (
            <>
              Snapshots protect <strong>on-device</strong> data — switch the
              storage mode below to “This device”, then import or snapshot.
            </>
          )}
        </p>
      )}
    </section>
  )
}

export default SnapshotsCard
