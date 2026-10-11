'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Download,
  Keyboard,
  Loader2,
  Lock,
  ShieldCheck,
  Smartphone,
  Upload,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  LOCK_CHANGED_EVENT,
  LOCK_HASH_KEY,
  sha256Hex,
} from './AppLock'

interface RestoreResult {
  chatsCreated?: number
  chatsSkipped?: number
  messagesImported?: number
  error?: string
}

type PinStage = 'idle' | 'create' | 'disable'

const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 4)

function readLockHash(): string | null {
  try {
    return localStorage.getItem(LOCK_HASH_KEY)
  } catch {
    return null
  }
}

/**
 * Settings dialog (Task 7-e #14): backup & restore, app lock (PIN),
 * keyboard shortcuts entry, install / offline info.
 */
export function SettingsDialog({
  open,
  onOpenChange,
  onOpenShortcuts,
  onRefreshChats,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenShortcuts: () => void
  onRefreshChats: () => Promise<void> | void
}) {
  // Backup & restore
  const [backingUp, setBackingUp] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const restoreInputRef = useRef<HTMLInputElement | null>(null)

  // App lock — state derived from key presence, read in an effect (hydration-safe)
  const [lockOn, setLockOn] = useState(false)
  const [lockReady, setLockReady] = useState(false)
  const [pinStage, setPinStage] = useState<PinStage>('idle')
  const [pinCreate, setPinCreate] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinDisable, setPinDisable] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [lockBusy, setLockBusy] = useState(false)

  useEffect(() => {
    const sync = () => {
      setLockOn(!!readLockHash())
      setLockReady(true)
    }
    sync()
    window.addEventListener(LOCK_CHANGED_EVENT, sync)
    return () => window.removeEventListener(LOCK_CHANGED_EVENT, sync)
  }, [])

  // Reset transient PIN UI whenever the dialog closes
  useEffect(() => {
    if (!open) {
      setPinStage('idle')
      setPinCreate('')
      setPinConfirm('')
      setPinDisable('')
      setPinError(null)
    }
  }, [open])

  const downloadBackup = async () => {
    setBackingUp(true)
    toast.success('Preparing your backup…')
    try {
      const res = await fetch('/api/backup', { cache: 'no-store' })
      if (!res.ok) throw new Error('backup failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `whatsapp-viewer-backup-${new Date()
        .toISOString()
        .slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      toast.error('Backup needs a connection')
    } finally {
      setBackingUp(false)
    }
  }

  const restoreBackup = async (file: File) => {
    setRestoring(true)
    try {
      const text = await file.text()
      JSON.parse(text) // sanity check — invalid JSON throws before the request
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      })
      const data: RestoreResult | null = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error ?? 'Restore failed — invalid backup file')
        return
      }
      const created = data?.chatsCreated ?? 0
      const skipped = data?.chatsSkipped ?? 0
      const imported = data?.messagesImported ?? 0
      toast.success(
        `Restored: ${created} chat${created === 1 ? '' : 's'} created · ${skipped} skipped · ${imported.toLocaleString()} messages imported`
      )
      await onRefreshChats()
    } catch {
      toast.error('Restore needs a connection')
    } finally {
      setRestoring(false)
    }
  }

  const enableLock = async () => {
    if (!/^\d{4}$/.test(pinCreate) || !/^\d{4}$/.test(pinConfirm)) {
      setPinError('Enter a 4-digit PIN (numbers only)')
      return
    }
    if (pinCreate !== pinConfirm) {
      setPinError('PINs don\u2019t match — try again')
      return
    }
    setLockBusy(true)
    try {
      const hex = await sha256Hex(pinCreate)
      if (!hex) {
        setPinError('App lock is not available on this device/browser')
        return
      }
      localStorage.setItem(LOCK_HASH_KEY, hex)
      window.dispatchEvent(new Event(LOCK_CHANGED_EVENT))
      setLockOn(true)
      setPinStage('idle')
      setPinCreate('')
      setPinConfirm('')
      setPinError(null)
      toast.success('App lock enabled — it re-locks after 5 minutes idle')
    } catch {
      setPinError('Could not enable app lock — storage unavailable')
    } finally {
      setLockBusy(false)
    }
  }

  const disableLock = async () => {
    const stored = readLockHash()
    if (!stored) {
      setLockOn(false)
      setPinStage('idle')
      return
    }
    if (!/^\d{4}$/.test(pinDisable)) {
      setPinError('Enter your current 4-digit PIN')
      return
    }
    setLockBusy(true)
    try {
      const hex = await sha256Hex(pinDisable)
      if (!hex || hex !== stored) {
        setPinError('Wrong PIN — try again')
        setPinDisable('')
        return
      }
      localStorage.removeItem(LOCK_HASH_KEY)
      window.dispatchEvent(new Event(LOCK_CHANGED_EVENT))
      setLockOn(false)
      setPinStage('idle')
      setPinDisable('')
      setPinError(null)
      toast.success('App lock disabled')
    } catch {
      setPinError('Could not verify the PIN — try again')
    } finally {
      setLockBusy(false)
    }
  }

  const busy = backingUp || restoring

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="wa-scroll max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <ShieldCheck className="h-4.5 w-4.5 text-(--wa-accent)" aria-hidden />
            Settings
          </DialogTitle>
          <DialogDescription className="text-left">
            Everything stays on this device — nothing is uploaded anywhere.
          </DialogDescription>
        </DialogHeader>

        {/* a) Backup & restore */}
        <section aria-label="Backup and restore" className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold text-(--wa-text)">
            Backup &amp; restore
          </h3>
          <p className="text-[12px] leading-snug text-(--wa-text-2)">
            Download all chats and messages as a JSON file, or restore from a
            previous backup.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void downloadBackup()}
              disabled={busy}
              className="gap-1.5"
            >
              {backingUp ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Download className="h-4 w-4" aria-hidden />
              )}
              Download backup (.json)
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => restoreInputRef.current?.click()}
              disabled={busy}
              className="gap-1.5"
            >
              {restoring ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="h-4 w-4" aria-hidden />
              )}
              Restore from backup
            </Button>
            <input
              ref={restoreInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="Choose a backup file"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void restoreBackup(file)
              }}
            />
          </div>
        </section>

        <div className="h-px bg-black/10 dark:bg-white/10" />

        {/* b) App lock (PIN) */}
        <section aria-label="App lock" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
                <Lock className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
                App lock (PIN)
              </h3>
              <p className="mt-0.5 text-[12px] leading-snug text-(--wa-text-2)">
                Lock the app with a 4-digit PIN on this device. It re-locks
                after 5 minutes of inactivity.
              </p>
            </div>
            <Switch
              checked={lockReady && lockOn}
              disabled={!lockReady || lockBusy}
              onCheckedChange={(checked) => {
                setPinError(null)
                if (checked) {
                  setPinCreate('')
                  setPinConfirm('')
                  setPinStage('create')
                } else {
                  setPinDisable('')
                  setPinStage('disable')
                }
              }}
              aria-label="Enable app lock"
            />
          </div>

          {pinStage === 'create' && (
            <div className="anim-fade-up flex flex-col gap-2 rounded-lg bg-black/[0.03] p-3 dark:bg-white/[0.04]">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  value={pinCreate}
                  onChange={(e) => setPinCreate(digitsOnly(e.target.value))}
                  placeholder="New PIN"
                  aria-label="New 4-digit PIN"
                  className="w-24 text-center tracking-[0.35em]"
                />
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(digitsOnly(e.target.value))}
                  placeholder="Repeat"
                  aria-label="Repeat 4-digit PIN"
                  className="w-24 text-center tracking-[0.35em]"
                />
                <Button
                  size="sm"
                  onClick={() => void enableLock()}
                  disabled={lockBusy}
                  className="gap-1.5"
                >
                  {lockBusy && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  )}
                  Set PIN
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPinStage('idle')
                    setPinError(null)
                  }}
                >
                  Cancel
                </Button>
              </div>
              {pinError && (
                <p role="alert" className="text-[12px] font-medium text-red-600 dark:text-red-400">
                  {pinError}
                </p>
              )}
            </div>
          )}

          {pinStage === 'disable' && (
            <div className="anim-fade-up flex flex-col gap-2 rounded-lg bg-black/[0.03] p-3 dark:bg-white/[0.04]">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="off"
                  value={pinDisable}
                  onChange={(e) => setPinDisable(digitsOnly(e.target.value))}
                  placeholder="Current PIN"
                  aria-label="Current 4-digit PIN"
                  className="w-24 text-center tracking-[0.35em]"
                />
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void disableLock()}
                  disabled={lockBusy}
                  className="gap-1.5"
                >
                  {lockBusy && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  )}
                  Turn off
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPinStage('idle')
                    setPinError(null)
                  }}
                >
                  Cancel
                </Button>
              </div>
              {pinError && (
                <p role="alert" className="text-[12px] font-medium text-red-600 dark:text-red-400">
                  {pinError}
                </p>
              )}
            </div>
          )}
        </section>

        <div className="h-px bg-black/10 dark:bg-white/10" />

        {/* c) Keyboard shortcuts */}
        <section aria-label="Keyboard shortcuts" className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold text-(--wa-text)">
            Keyboard shortcuts
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenShortcuts}
            className="w-full justify-start gap-1.5"
          >
            <Keyboard className="h-4 w-4" aria-hidden />
            View shortcuts (press ?)
          </Button>
        </section>

        <div className="h-px bg-black/10 dark:bg-white/10" />

        {/* d) Install / offline */}
        <section aria-label="Install and offline" className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
            <Smartphone className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            Install &amp; offline
          </h3>
          <p className="text-[12px] leading-snug text-(--wa-text-2)">
            Installable: use your browser menu → Install app / Add to Home
            Screen. Recently opened chats stay readable offline.
          </p>
        </section>
      </DialogContent>
    </Dialog>
  )
}
