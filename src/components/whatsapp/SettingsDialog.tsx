'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BookOpen,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileDown,
  Cloud,
  HardDrive,
  Smartphone,
  Info,
  Keyboard,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react'
import { aiHeaders, getGeminiKey, setGeminiKey } from '@/lib/ai-client'
import { GettingStartedDialog, openGettingStarted } from './GettingStartedDialog'
import { StorageDialog } from './StorageDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { LOCK_CHANGED_EVENT } from './AppLock'
import { useData } from './data-provider'
import {
  getStorageMode,
  setStorageMode,
  type StorageMode,
} from './storage-mode'
import {
  lockChange,
  lockDisable,
  lockReset,
  lockSet,
  lockStatus,
} from '@/lib/data/lock-client'
import {
  CADENCE_OPTIONS,
  DEFAULT_BACKUP_REMIND,
  formatRelativeTime,
  maybeRemindBackup,
  readBackupRemindPref,
  readLastBackupAt,
  writeBackupRemindPref,
  writeLastBackupAt,
  type BackupCadence,
  type BackupRemindPref,
} from './backup-reminder'

interface RestoreResult {
  chatsCreated?: number
  chatsSkipped?: number
  messagesImported?: number
  error?: string
}

type PinStage = 'idle' | 'create' | 'change' | 'disable'

const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 8)

// AI preference keys ('0' toasts = disabled/absent enabled · '1' auto-clean = on)
const TOASTS_PREF_KEY = 'wa-viewer:toasts'
const AUTO_CLEAN_PREF_KEY = 'wa-viewer:auto-clean'

// Export preference: embed audio files in exports ('1' = on). Persisted in
// localStorage AND mirrored to a 1-year `wa_export_audio=1` cookie (path=/)
// so the server-side export routes can read it without extra headers.
const EXPORT_AUDIO_KEY = 'wa-viewer:export-audio'
const EXPORT_AUDIO_COOKIE = 'wa_export_audio'

function setExportAudioCookie(on: boolean): void {
  try {
    if (on) {
      document.cookie = `${EXPORT_AUDIO_COOKIE}=1; path=/; max-age=31536000; samesite=lax`
    } else {
      // Expire the cookie so server routes stop embedding audio
      document.cookie = `${EXPORT_AUDIO_COOKIE}=; path=/; max-age=0; samesite=lax`
    }
  } catch {
    // Cookies unavailable — exports just won't embed audio
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
  // Active transport (Phase 2) — server REST vs on-device engine
  const { mode, data } = useData()
  // Backup & restore
  const [backingUp, setBackingUp] = useState(false)
  const [storageOpen, setStorageOpen] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const restoreInputRef = useRef<HTMLInputElement | null>(null)

  // Backup reminders (Task 14-j) — read from localStorage in an effect
  // below (hydration-safe; defaults until then)
  const [remindPref, setRemindPref] = useState<BackupRemindPref>(DEFAULT_BACKUP_REMIND)
  const [remindReady, setRemindReady] = useState(false)
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(null)

  // App lock — state lives on the server (AppSetting), fetched via
  // /api/auth/lock (Task 14; hydration-safe, read in an effect)
  const [lockOn, setLockOn] = useState(false)
  const [lockReady, setLockReady] = useState(false)
  const [pinStage, setPinStage] = useState<PinStage>('idle')
  const [pinCreate, setPinCreate] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [pinCurrent, setPinCurrent] = useState('')
  const [pinNew, setPinNew] = useState('')
  const [pinDisable, setPinDisable] = useState('')
  const [pinError, setPinError] = useState<string | null>(null)
  const [lockBusy, setLockBusy] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  // AI features — Gemini key + preferences (read in an effect; hydration-safe)
  const [aiKey, setAiKey] = useState('')
  const [aiReady, setAiReady] = useState(false)
  const [showAiKey, setShowAiKey] = useState(false)
  const [testingKey, setTestingKey] = useState(false)
  const [toastsOn, setToastsOn] = useState(true)
  const [autoCleanOn, setAutoCleanOn] = useState(false)
  const [exportAudioOn, setExportAudioOn] = useState(false)

  const syncLock = useCallback(async () => {
    try {
      const status = await lockStatus(mode, data)
      setLockOn(status.enabled)
    } catch {
      // Keep the last known state; lockReady still flips so the UI isn't stuck
    }
    setLockReady(true)
  }, [mode, data])

  useEffect(() => {
    void syncLock()
    const onSync = () => void syncLock()
    window.addEventListener(LOCK_CHANGED_EVENT, onSync)
    return () => window.removeEventListener(LOCK_CHANGED_EVENT, onSync)
  }, [syncLock])

  // Re-sync from the server whenever the dialog opens
  useEffect(() => {
    if (open) void syncLock()
  }, [open, syncLock])

  // Reset transient PIN UI whenever the dialog closes
  useEffect(() => {
    if (!open) {
      setPinStage('idle')
      setPinCreate('')
      setPinConfirm('')
      setPinCurrent('')
      setPinNew('')
      setPinDisable('')
      setPinError(null)
      setResetOpen(false)
    }
  }, [open])

  useEffect(() => {
    setAiKey(getGeminiKey())
    try {
      setToastsOn(localStorage.getItem(TOASTS_PREF_KEY) !== '0')
      setAutoCleanOn(localStorage.getItem(AUTO_CLEAN_PREF_KEY) === '1')
      const exportAudio = localStorage.getItem(EXPORT_AUDIO_KEY) === '1'
      setExportAudioOn(exportAudio)
      // Keep the cookie in sync with the stored preference (it may have
      // expired or been cleared while localStorage survived).
      setExportAudioCookie(exportAudio)
    } catch {
      // Storage unavailable — keep defaults
    }
    setAiReady(true)
  }, [])

  const handleAiKeyChange = (value: string) => {
    setAiKey(value)
    setGeminiKey(value) // trim + persist ('' clears)
  }

  const testAiKey = async () => {
    const key = aiKey.trim()
    if (!key) {
      toast.error('Paste your Gemini API key first')
      return
    }
    setGeminiKey(key)
    setTestingKey(true)
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...aiHeaders() },
        body: JSON.stringify({ mode: 'translate', text: 'hello' }),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null
      if (res.ok && data?.ok) {
        toast.success('Gemini key works — Translate, Explain & Reply will use it')
      } else {
        toast.error(data?.error ?? 'Gemini test failed — try again')
      }
    } catch {
      toast.error('Gemini test failed — check your connection')
    } finally {
      setTestingKey(false)
    }
  }

  const handleToastsChange = (checked: boolean) => {
    setToastsOn(checked)
    try {
      if (checked) localStorage.removeItem(TOASTS_PREF_KEY)
      else localStorage.setItem(TOASTS_PREF_KEY, '0')
    } catch {
      // Storage unavailable — ignore
    }
  }

  const handleAutoCleanChange = (checked: boolean) => {
    setAutoCleanOn(checked)
    try {
      if (checked) localStorage.setItem(AUTO_CLEAN_PREF_KEY, '1')
      else localStorage.removeItem(AUTO_CLEAN_PREF_KEY)
    } catch {
      // Storage unavailable — ignore
    }
  }

  const handleExportAudioChange = (checked: boolean) => {
    setExportAudioOn(checked)
    try {
      if (checked) localStorage.setItem(EXPORT_AUDIO_KEY, '1')
      else localStorage.removeItem(EXPORT_AUDIO_KEY)
    } catch {
      // Storage unavailable — ignore
    }
    setExportAudioCookie(checked)
  }

  // Task 14-j — reminder preference, persisted as JSON via the helper
  // (tolerant read, storage-unavailability safe)
  const handleRemindChange = (checked: boolean) => {
    const next = { ...remindPref, on: checked }
    setRemindPref(next)
    writeBackupRemindPref(next)
  }

  const handleCadenceChange = (cadence: BackupCadence) => {
    const next = { ...remindPref, cadence }
    setRemindPref(next)
    writeBackupRemindPref(next)
  }

  // Shared backup flow — used by the "Download backup" button AND the
  // reminder toast's "Back up now" action (Task 14-j). useCallback keeps the
  // reference stable so the reminder effect below doesn't re-run on renders.
  const downloadBackup = useCallback(async () => {
    setBackingUp(true)
    toast.success('Preparing your backup…')
    try {
      const blob = await data.exportBackup()
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
      // Success → record the timestamp (auto-snoozes the reminder, Task 14-j)
      // and refresh the "Last backup" line immediately.
      const at = Date.now()
      writeLastBackupAt(at)
      setLastBackupAt(at)
    } catch {
      toast.error('Backup needs a connection')
    } finally {
      setBackingUp(false)
    }
  }, [data])

  // Task 14-j — backup reminders: read the stored prefs + fire the
  // once-per-session due check whenever the settings dialog opens.
  // (SettingsDialog stays mounted in WhatsAppApp, so the check keys on
  // `open` transitions; app-level firing without opening Settings is a
  // documented one-line hook: scheduleBackupReminder(downloadBackup).)
  useEffect(() => {
    if (!open) return
    setRemindPref(readBackupRemindPref())
    setLastBackupAt(readLastBackupAt())
    setRemindReady(true)
    maybeRemindBackup(() => void downloadBackup())
  }, [open, downloadBackup])

  const restoreBackup = async (file: File) => {
    setRestoring(true)
    try {
      let created = 0
      let skipped = 0
      let imported = 0
      if (mode === 'device') {
        // On-device restore: parse + insert locally, nothing uploaded.
        const res = await data.importBackup(file)
        created = res.chats
        imported = res.messages
      } else {
        const text = await file.text()
        JSON.parse(text) // sanity check — invalid JSON throws before the request
        const res = await fetch('/api/backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: text,
        })
        const json: RestoreResult | null = await res.json().catch(() => null)
        if (!res.ok) {
          toast.error(json?.error ?? 'Restore failed — invalid backup file')
          return
        }
        created = json?.chatsCreated ?? 0
        skipped = json?.chatsSkipped ?? 0
        imported = json?.messagesImported ?? 0
      }
      toast.success(
        `Restored: ${created} chat${created === 1 ? '' : 's'} created${skipped ? ` · ${skipped} skipped` : ''} · ${imported.toLocaleString()} messages imported`
      )
      await onRefreshChats()
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : mode === 'device'
            ? 'Restore failed — invalid backup file'
            : 'Restore needs a connection'
      )
    } finally {
      setRestoring(false)
    }
  }

  const enableLock = async () => {
    if (!/^\d{4,8}$/.test(pinCreate) || !/^\d{4,8}$/.test(pinConfirm)) {
      setPinError('Enter a 4–8 digit PIN (numbers only)')
      return
    }
    if (pinCreate !== pinConfirm) {
      setPinError('PINs don\u2019t match — try again')
      return
    }
    setLockBusy(true)
    try {
      await lockSet(mode, data, pinCreate)
      setLockOn(true)
      setPinStage('idle')
      setPinCreate('')
      setPinConfirm('')
      setPinError(null)
      window.dispatchEvent(new Event(LOCK_CHANGED_EVENT))
      toast.success(
        mode === 'device'
          ? 'App lock enabled — verified on this device'
          : 'App lock enabled — verified on the server'
      )
    } catch (err) {
      setPinError(
        err instanceof Error
          ? err.message
          : 'Could not enable app lock — try again'
      )
    } finally {
      setLockBusy(false)
    }
  }

  const changePin = async () => {
    if (!/^\d{4,8}$/.test(pinCurrent) || !/^\d{4,8}$/.test(pinNew)) {
      setPinError('PINs must be 4–8 digits (numbers only)')
      return
    }
    setLockBusy(true)
    try {
      await lockChange(mode, data, pinCurrent, pinNew)
      setPinStage('idle')
      setPinCurrent('')
      setPinNew('')
      setPinError(null)
      window.dispatchEvent(new Event(LOCK_CHANGED_EVENT))
      toast.success('PIN changed')
    } catch (err) {
      setPinError(
        err instanceof Error ? err.message : 'Could not change the PIN — try again'
      )
    } finally {
      setLockBusy(false)
    }
  }

  const disableLock = async () => {
    if (!/^\d{4,8}$/.test(pinDisable)) {
      setPinError('Enter your current 4–8 digit PIN')
      return
    }
    setLockBusy(true)
    try {
      await lockDisable(mode, data, pinDisable)
      setLockOn(false)
      setPinStage('idle')
      setPinDisable('')
      setPinError(null)
      window.dispatchEvent(new Event(LOCK_CHANGED_EVENT))
      toast.success('App lock disabled')
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Wrong PIN — try again')
      setPinDisable('')
    } finally {
      setLockBusy(false)
    }
  }

  const resetLock = async () => {
    setResetOpen(false)
    setLockBusy(true)
    try {
      await lockReset(mode, data)
      setLockOn(false)
      setPinStage('idle')
      setPinCreate('')
      setPinConfirm('')
      setPinCurrent('')
      setPinNew('')
      setPinDisable('')
      setPinError(null)
      window.dispatchEvent(new Event(LOCK_CHANGED_EVENT))
      toast.success('App lock reset — set a new PIN anytime')
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Could not reset the lock — try again'
      )
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

        {/* a) AI features (Gemini key + preferences) */}
        <section aria-label="AI features" className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
            <Sparkles className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            AI features
          </h3>
          <div className="flex flex-col gap-1.5">
            <div className="relative">
              <Input
                type={showAiKey ? 'text' : 'password'}
                value={aiKey}
                onChange={(e) => handleAiKeyChange(e.target.value)}
                placeholder="Paste your Gemini API key"
                aria-label="Gemini API key"
                autoComplete="off"
                spellCheck={false}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowAiKey((v) => !v)}
                aria-label={showAiKey ? 'Hide API key' : 'Show API key'}
                className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-(--wa-text-2) transition-colors hover:bg-black/5 hover:text-(--wa-text) dark:hover:bg-white/10"
              >
                {showAiKey ? (
                  <EyeOff className="h-4 w-4" aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>
            <p className="text-[12px] leading-snug text-(--wa-text-2)">
              Used for Translate, Explain and Reply features. Stored only in
              this browser.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void testAiKey()}
              disabled={testingKey}
              className="gap-1.5"
            >
              {testingKey ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <KeyRound className="h-4 w-4" aria-hidden />
              )}
              Test key
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openGettingStarted}
              className="gap-1.5"
            >
              <BookOpen className="h-4 w-4" aria-hidden />
              How to get started
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] p-3 dark:bg-white/[0.04]">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-(--wa-text)">
                Message notification previews
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-(--wa-text-2)">
                Show pop-up previews when new messages arrive.
              </p>
            </div>
            <Switch
              checked={aiReady && toastsOn}
              disabled={!aiReady}
              onCheckedChange={handleToastsChange}
              aria-label="Message notification previews"
            />
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] p-3 dark:bg-white/[0.04]">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-(--wa-text)">
                Auto-clean archived chats (30+ days idle)
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-(--wa-text-2)">
                Runs on app start. Archived chats only.
              </p>
            </div>
            <Switch
              checked={aiReady && autoCleanOn}
              disabled={!aiReady}
              onCheckedChange={handleAutoCleanChange}
              aria-label="Auto-clean archived chats"
            />
          </div>

          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md px-1 text-[12.5px] font-medium text-(--wa-accent-strong) transition-colors hover:text-(--wa-accent) hover:underline dark:text-(--wa-accent)"
          >
            Get a free Gemini key →
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </section>

        <div className="h-px bg-black/10 dark:bg-white/10" />

        {/* b) Backup & restore */}
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

          {/* Task 14-j — last backup line (subtle, under the buttons) */}
          {remindReady && (
            <p
              role="status"
              className="text-[11.5px] leading-snug text-(--wa-text-2)"
            >
              {lastBackupAt != null
                ? `Last backup: ${formatRelativeTime(lastBackupAt)}`
                : 'No backup yet'}
            </p>
          )}

          {/* Task 14-j — backup reminder toggle */}
          <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] p-3 dark:bg-white/[0.04]">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-(--wa-text)">
                Remind me to back up
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-(--wa-text-2)">
                A gentle reminder when a backup is due.
              </p>
            </div>
            <Switch
              checked={remindReady && remindPref.on}
              disabled={!remindReady}
              onCheckedChange={handleRemindChange}
              aria-label="Remind me to back up"
            />
          </div>

          {/* Task 14-j — cadence: segmented Daily / Weekly / Monthly
              (default Weekly; shown only while reminders are on) */}
          {remindReady && remindPref.on && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] p-3 dark:bg-white/[0.04]">
              <p className="min-w-0 text-[12.5px] font-medium text-(--wa-text)">
                Reminder frequency
              </p>
              <div
                role="group"
                aria-label="Backup reminder frequency"
                className="flex gap-0.5 rounded-lg border border-(--wa-line) p-0.5"
              >
                {CADENCE_OPTIONS.map((opt) => {
                  const selected = remindPref.cadence === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleCadenceChange(opt.value)}
                      aria-pressed={selected}
                      className={`
                        h-7 rounded-md px-2.5 text-[12px] font-medium
                        transition-colors focus-visible:outline-2
                        focus-visible:outline-offset-1
                        focus-visible:outline-(--wa-accent)
                        ${
                          selected
                            ? 'bg-(--wa-accent) text-white shadow-xs'
                            : 'text-(--wa-text-2) hover:bg-black/5 dark:hover:bg-white/10'
                        }
                      `}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        <div className="h-px bg-black/10 dark:bg-white/10" />

        {/* Data and storage (task 14-h) */}
        <section aria-label="Data and storage" className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
            <HardDrive className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            Data and storage
          </h3>
          {/* Storage mode (Phase 2): where chats + media live */}
          <div
            role="group"
            aria-label="Storage mode"
            className="rounded-lg bg-black/[0.03] p-3 dark:bg-white/[0.04]"
          >
            <p className="text-[12.5px] font-medium text-(--wa-text)">
              Storage mode
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-(--wa-text-2)">
              {mode === 'device'
                ? 'Chats and media live in this browser — fully offline, nothing leaves the device.'
                : 'Chats live on the server via /api — the classic hosted mode.'}
            </p>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              {(
                [
                  {
                    key: 'server' as StorageMode,
                    label: 'Server',
                    icon: Cloud,
                    hint: 'Hosted / demo mode',
                  },
                  {
                    key: 'device' as StorageMode,
                    label: 'This device',
                    icon: Smartphone,
                    hint: 'Offline-first, private',
                  },
                ]
              ).map((opt) => {
                const active = mode === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      if (active) return
                      setStorageMode(opt.key)
                      toast.info(
                        `Switching to ${opt.label.toLowerCase()} storage — reloading…`
                      )
                      // The transport owns every in-memory cache; a reload
                      // re-resolves the whole data boundary cleanly.
                      setTimeout(() => window.location.reload(), 450)
                    }}
                    className={`
                      flex flex-col items-start gap-0.5 rounded-md px-2.5 py-2
                      text-left transition-transform duration-150
                      hover:scale-[1.02] active:scale-[0.98]
                      ${
                        active
                          ? 'bg-(--wa-accent)/10 ring-1 ring-(--wa-accent)'
                          : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                      }
                    `}
                  >
                    <span className="flex w-full items-center gap-1.5">
                      <opt.icon
                        className={`h-3.5 w-3.5 ${active ? 'text-(--wa-accent)' : 'text-(--wa-text-2)'}`}
                        aria-hidden
                      />
                      <span
                        className={cn(
                          'text-[12px] font-semibold',
                          active ? 'text-(--wa-accent)' : 'text-(--wa-text)'
                        )}
                      >
                        {opt.label}
                      </span>
                    </span>
                    <span className="text-[10.5px] leading-tight text-(--wa-text-2)">
                      {opt.hint}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setStorageOpen(true)}
            className={`
              flex items-center justify-between gap-3 rounded-lg
              bg-black/[0.03] p-3 text-left transition-colors
              hover:bg-black/[0.05] focus-visible:outline-2
              focus-visible:outline-offset-2 focus-visible:outline-(--wa-accent)
              dark:bg-white/[0.04] dark:hover:bg-white/[0.06]
            `}
          >
            <span className="min-w-0">
              <span className="block text-[12.5px] font-medium text-(--wa-text)">
                Media &amp; database usage
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-(--wa-text-2)">
                See how much storage each chat&apos;s photos, videos and voice
                notes use.
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-(--wa-text-2)" aria-hidden />
          </button>
        </section>

        <div className="h-px bg-black/10 dark:bg-white/10" />

        {/* c) Export */}
        <section aria-label="Export" className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
            <FileDown className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            Export
          </h3>
          <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] p-3 dark:bg-white/[0.04]">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-(--wa-text)">
                Embed audio files in exports
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-(--wa-text-2)">
                HTML exports play voice notes offline; ZIP exports add an
                audio folder. Larger files.
              </p>
            </div>
            <Switch
              checked={aiReady && exportAudioOn}
              disabled={!aiReady}
              onCheckedChange={handleExportAudioChange}
              aria-label="Embed audio files in exports"
            />
          </div>
        </section>

        <div className="h-px bg-black/10 dark:bg-white/10" />

        {/* d) App lock (PIN) — verified on the server (server) or on-device (device) */}
        <section aria-label="App lock" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
                <Lock className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
                App lock (PIN)
              </h3>
              {lockReady && lockOn ? (
                <p className="mt-0.5 text-[12px] leading-snug text-(--wa-text-2)">
                  {mode === 'device'
                    ? 'Device-verified · unlocks until the tab closes'
                    : 'Server-verified · session lasts 12 h'}
                </p>
              ) : (
                <p className="mt-0.5 text-[12px] leading-snug text-(--wa-text-2)">
                  {mode === 'device'
                    ? 'Lock the app behind a 4–8 digit PIN, verified on this device.'
                    : 'Lock the app behind a 4–8 digit PIN, verified on the server.'}
                </p>
              )}
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

          {lockReady && lockOn && pinStage === 'idle' && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPinCurrent('')
                  setPinNew('')
                  setPinError(null)
                  setPinStage('change')
                }}
                disabled={lockBusy}
                className="gap-1.5"
              >
                <KeyRound className="h-3.5 w-3.5" aria-hidden />
                Change PIN
              </Button>
              <button
                type="button"
                onClick={() => setResetOpen(true)}
                className="inline-flex h-8 w-fit items-center rounded-md px-1 text-[12.5px] font-medium text-(--wa-accent-strong) transition-colors hover:text-(--wa-accent) hover:underline dark:text-(--wa-accent)"
              >
                Forgot PIN?
              </button>
            </div>
          )}

          {pinStage === 'create' && (
            <div className="anim-fade-up flex flex-col gap-2 rounded-lg bg-black/[0.03] p-3 dark:bg-white/[0.04]">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  autoComplete="off"
                  value={pinCreate}
                  onChange={(e) => setPinCreate(digitsOnly(e.target.value))}
                  placeholder="New PIN"
                  aria-label="New PIN (4–8 digits)"
                  className="w-24 text-center tracking-[0.35em]"
                />
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  autoComplete="off"
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(digitsOnly(e.target.value))}
                  placeholder="Repeat"
                  aria-label="Repeat PIN (4–8 digits)"
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
                  Save
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
              <p className="text-[11.5px] leading-snug text-(--wa-text-2)">
                {mode === 'device'
                  ? '4–8 digits. Unlocking lasts until you close the tab.'
                  : '4–8 digits. Unlocking starts a 12-hour verified session.'}
              </p>
              {pinError && (
                <p role="alert" className="text-[12px] font-medium text-red-600 dark:text-red-400">
                  {pinError}
                </p>
              )}
            </div>
          )}

          {pinStage === 'change' && (
            <div className="anim-fade-up flex flex-col gap-2 rounded-lg bg-black/[0.03] p-3 dark:bg-white/[0.04]">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  autoComplete="off"
                  value={pinCurrent}
                  onChange={(e) => setPinCurrent(digitsOnly(e.target.value))}
                  placeholder="Current PIN"
                  aria-label="Current PIN (4–8 digits)"
                  className="w-24 text-center tracking-[0.35em]"
                />
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  autoComplete="off"
                  value={pinNew}
                  onChange={(e) => setPinNew(digitsOnly(e.target.value))}
                  placeholder="New PIN"
                  aria-label="New PIN (4–8 digits)"
                  className="w-24 text-center tracking-[0.35em]"
                />
                <Button
                  size="sm"
                  onClick={() => void changePin()}
                  disabled={lockBusy}
                  className="gap-1.5"
                >
                  {lockBusy && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  )}
                  Save
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
                  maxLength={8}
                  autoComplete="off"
                  value={pinDisable}
                  onChange={(e) => setPinDisable(digitsOnly(e.target.value))}
                  placeholder="Current PIN"
                  aria-label="Current PIN (4–8 digits)"
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

          <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset app lock?</AlertDialogTitle>
                <AlertDialogDescription>
                  This resets the lock without a PIN — this is a local viewer,
                  so the reset is allowed. Your chats are not touched.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={lockBusy}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void resetLock()}
                  disabled={lockBusy}
                >
                  Reset lock
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </section>

        <div className="h-px bg-black/10 dark:bg-white/10" />

        {/* e) Keyboard shortcuts */}
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

        {/* f) Install / offline */}
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

        {/* g) About — v1.0 release */}
        <section aria-label="About" className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
            <Info className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            About
          </h3>
          <div className="rounded-lg border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-(--wa-text)">
                WhatsApp Viewer
              </span>
              <span
                className="rounded-full bg-(--wa-accent)/10 px-2 py-0.5 text-[11px] font-semibold text-(--wa-accent)"
                aria-label="Version 1.0"
              >
                v1.0
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-snug text-(--wa-text-2)">
              View, explore and enrich your exported WhatsApp chats — media,
              voice notes, reactions, AI tools, privacy lock and more, all on
              your own device.
            </p>
            <p className="mt-2 text-[11px] leading-snug text-(--wa-text-2)">
              You&apos;re running the v1.0 release. More features are planned
              for upcoming versions.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={openGettingStarted}
              className="mt-2 w-full justify-start gap-1.5"
            >
              <BookOpen className="h-4 w-4" aria-hidden />
              Take the feature tour
            </Button>
          </div>
        </section>

        {/* Self-managed tutorial — opens via the 'wa-open-getting-started' event */}
        <GettingStartedDialog />

        {/* Data and storage dashboard (task 14-h) */}
        <StorageDialog open={storageOpen} onOpenChange={setStorageOpen} />
      </DialogContent>
    </Dialog>
  )
}
