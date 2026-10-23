'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react'
import { toast } from 'sonner'
import {
  AudioLines,
  BookOpen,
  ChevronRight,
  ArrowDownUp,
  Check,
  Download,
  FileJson,
  ExternalLink,
  Eye,
  EyeOff,
  FileDown,
  Cloud,
  HardDrive,
  Image as ImageIcon,
  Languages,
  Paintbrush,
  Plus,
  Smartphone,
  Info,
  Keyboard,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlock,
  Upload,
} from 'lucide-react'
import { aiHeaders, getGeminiKey, setGeminiKey } from '@/lib/ai-client'
import { runDeviceAi } from '@/lib/device-ai'
import { isOnline, offlineAiMessage } from '@/lib/online'
import {
  downloadPersonalData,
  parsePersonalData,
  personalDataStats,
  writePersonalData,
  type PersonalDataFile,
} from '@/lib/personal-data'
import { APP_VERSION } from '@/lib/version'
import {
  decryptBackupText,
  encryptBackupText,
  isEncryptedBackup,
} from '@/lib/backup-crypto'
import {
  ASR_MODEL_MB,
  asrModelReady,
  clearTranscriptCache,
  prepareAsrModel,
  resetAsrModel,
} from '@/lib/whisper-asr'
import { GettingStartedDialog, openGettingStarted } from './GettingStartedDialog'
import { StorageDialog } from './StorageDialog'
import { SnapshotsCard } from './SnapshotsCard'
import { SyncVaultCard } from './SyncVaultCard'
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
  isNativeApp,
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
import { useT, useLocale, setLocale, syncDocumentLang, LOCALES } from '@/lib/i18n'
import {
  APP_THEMES,
  applyCustomTheme,
  applyThemeAttribute,
  captureCurrentLook,
  deleteCustomTheme,
  getAccentOverride,
  getAppTheme,
  listCustomThemes,
  saveCustomTheme,
  setAppTheme,
  subscribeAccent,
  subscribeAppTheme,
  type AppThemeKey,
  type CustomThemePreset,
} from './app-theme'
import {
  getBubbleStyle,
  getDensity,
  subscribeBubbleStyle,
  subscribeDensity,
  type BubbleStyleKey,
  type DensityKey,
} from './display'

interface RestoreResult {
  chatsCreated?: number
  chatsSkipped?: number
  messagesImported?: number
  error?: string
}

type PinStage = 'idle' | 'create' | 'change' | 'disable'

const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, 8)

/**
 * Mini phone-ish preview for a theme-studio card — built purely inline from
 * the preset's actual swatch colors (appbar strip + accent dot on top, an
 * incoming + outgoing bubble pair on the classic neutral chat background).
 * All 17 presets ship light bubble swatches, so the chat area is always the
 * neutral light one (matches the app-bar picker's swatch rendering).
 * Decorative only: the parent button carries the semantics via aria-label.
 */
function PresetPreview({
  appbar,
  bubble,
  accent,
  wallpaperBadge,
}: {
  appbar: string
  bubble: string
  accent: string
  wallpaperBadge?: string | null
}) {
  return (
    <span className="relative block h-16 w-full shrink-0 overflow-hidden rounded-lg ring-1 ring-black/10 dark:ring-white/10">
      <span
        className="flex h-4 w-full items-center gap-1 px-1.5"
        style={{ background: appbar }}
      >
        <span className="h-1 w-7 rounded-full bg-white/80" />
        <span
          className="ml-auto block h-1.5 w-1.5 rounded-full"
          style={{ background: accent, boxShadow: '0 0 0 1px rgba(255,255,255,0.55)' }}
        />
      </span>
      <span
        className="flex h-[calc(100%-1rem)] w-full items-center justify-between px-1.5"
        style={{ background: '#efeae2' }}
      >
        <i
          className="block h-3.5 w-9 rounded-md rounded-bl-none bg-white"
        />
        <i
          className="block h-3.5 w-9 rounded-md rounded-br-none"
          style={{ background: bubble }}
        />
      </span>
      {wallpaperBadge && (
        <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-px text-[9px] font-medium leading-tight text-white">
          <ImageIcon className="h-2.5 w-2.5 shrink-0" aria-hidden />
          <span className="max-w-[76px] truncate">{wallpaperBadge}</span>
        </span>
      )}
    </span>
  )
}

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
  // Encrypted backups (AES-GCM): persisted on/off pref (never the passphrase)
  // plus transient passphrase state for download and for unlocking an
  // encrypted file picked for restore.
  const [encryptBackups, setEncryptBackups] = useState(false)
  const [backupPass, setBackupPass] = useState('')
  const [showBackupPass, setShowBackupPass] = useState(false)
  const [pendingEnc, setPendingEnc] = useState<string | null>(null)
  const [encBusy, setEncBusy] = useState(false)
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
  // Standalone shell detection (Phase 3) — read in an effect so SSR/CSR agree.
  const [native, setNative] = useState(false)
  // On-device voice transcription (Phase 4) — Whisper model manager state.
  const [asrReady, setAsrReady] = useState(false)
  const [asrBusy, setAsrBusy] = useState(false)
  const [asrPct, setAsrPct] = useState(0)

  // ---- Theme studio (C1 #13) + language (C1 #14) --------------------------
  // The live look (theme / accent / bubble style / density) comes from the
  // same external stores the app shell reads, so this dialog can never
  // disagree with what's applied. Custom presets are local UI state.
  const t = useT()
  const locale = useLocale()
  const themeKey: AppThemeKey = useSyncExternalStore(
    subscribeAppTheme,
    getAppTheme,
    () => 'classic' as AppThemeKey
  )
  const accentKey: string | null = useSyncExternalStore(
    subscribeAccent,
    getAccentOverride,
    () => null
  )
  const bubbleStyleKey: BubbleStyleKey = useSyncExternalStore(
    subscribeBubbleStyle,
    getBubbleStyle,
    () => 'classic' as BubbleStyleKey
  )
  const densityKey: DensityKey = useSyncExternalStore(
    subscribeDensity,
    getDensity,
    () => 'cozy' as DensityKey
  )
  const [customThemes, setCustomThemes] = useState<CustomThemePreset[]>([])
  const [saveOpen, setSaveOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const presetNameRef = useRef<HTMLInputElement | null>(null)

  const refreshCustomThemes = useCallback(
    () => setCustomThemes(listCustomThemes()),
    []
  )

  // Reload the saved presets whenever the dialog opens; reset transient UI.
  useEffect(() => {
    if (!open) return
    refreshCustomThemes()
    setSaveOpen(false)
    setPresetName('')
    setConfirmDeleteId(null)
  }, [open, refreshCustomThemes])

  // Keep <html lang> in sync with the chosen locale (first read + changes).
  useEffect(() => {
    syncDocumentLang(locale)
  }, [locale])

  // Focus the preset-name input when the inline save form opens.
  useEffect(() => {
    if (saveOpen) presetNameRef.current?.focus()
  }, [saveOpen])

  const applyPresetTheme = useCallback((k: AppThemeKey) => {
    // Same flow as the app-bar display popover: persist + apply the
    // attribute immediately (the shell re-applies it from its own effect).
    setAppTheme(k)
    applyThemeAttribute(k)
  }, [])

  const applyPreset = useCallback(
    (preset: CustomThemePreset) => {
      applyCustomTheme(preset)
      toast.success(t('theme.studio.applied', { name: preset.name }))
    },
    [t]
  )

  const submitPreset = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const name = presetName.trim()
    if (!name) {
      toast.error(t('theme.studio.nameRequired'))
      return
    }
    const res = saveCustomTheme({ name, ...captureCurrentLook() })
    if (!res.ok) {
      if (res.reason === 'limit') toast.error(t('theme.studio.limit'))
      else if (res.reason === 'name-taken') toast.error(t('theme.studio.nameTaken'))
      else toast.error(t('theme.studio.storageError'))
      return
    }
    refreshCustomThemes()
    setPresetName('')
    setSaveOpen(false)
    toast.success(t('theme.studio.saved', { name: res.preset.name }))
  }

  const confirmDelete = () => {
    if (!confirmDeleteId) return
    deleteCustomTheme(confirmDeleteId)
    setConfirmDeleteId(null)
    refreshCustomThemes()
    toast.success(t('theme.studio.deleted'))
  }

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
    setNative(isNativeApp())
    setAsrReady(asrModelReady())
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

  // Refresh the ASR-model status every time the dialog opens — the model
  // may have been downloaded (or removed) since this component mounted.
  useEffect(() => {
    if (open) setAsrReady(asrModelReady())
  }, [open])

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
      // Device transport (Phase 3): there is no /api/ai in the standalone
      // app — ping Gemini directly with the pasted key. Server transport:
      // the classic proxy test (server uses the key when present).
      if (mode === 'device' || isNativeApp()) {
        await runDeviceAi({ mode: 'translate', text: 'hello' })
      } else {
        if (!isOnline()) throw new Error(offlineAiMessage())
        const res = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...aiHeaders() },
          body: JSON.stringify({ mode: 'translate', text: 'hello' }),
        })
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string }
          | null
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error ?? 'Gemini test failed — try again')
        }
      }
      toast.success(
        'Gemini key works — Translate, Explain & Reply will use it'
      )
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : 'Gemini test failed — check your connection'
      )
    } finally {
      setTestingKey(false)
    }
  }

  // ---- On-device voice transcription (Phase 4) ----------------------------

  const handleAsrDownload = async () => {
    if (asrBusy) return
    setAsrBusy(true)
    setAsrPct(0)
    try {
      await prepareAsrModel((p) => {
        if (typeof p.pct === 'number') setAsrPct(p.pct)
      })
      setAsrReady(true)
      toast.success('Voice model ready — transcription now works offline')
    } catch (err) {
      setAsrReady(false)
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : 'Could not download the voice model — try again'
      )
    } finally {
      setAsrBusy(false)
    }
  }

  const handleAsrRemove = async () => {
    if (asrBusy) return
    setAsrBusy(true)
    try {
      await resetAsrModel()
      const cleared = clearTranscriptCache()
      setAsrReady(false)
      toast.success(
        cleared > 0
          ? `Voice model removed — ${cleared} cached transcript${cleared === 1 ? '' : 's'} cleared`
          : 'Voice model removed'
      )
    } finally {
      setAsrBusy(false)
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

  // Personal data (portable half): themes, bookmarks, wallpapers, prefs.
  const personalInputRef = useRef<HTMLInputElement>(null)
  const [pendingPersonal, setPendingPersonal] =
    useState<PersonalDataFile | null>(null)
  const [applyingPersonal, setApplyingPersonal] = useState(false)

  const exportPersonal = useCallback(() => {
    try {
      const keys = downloadPersonalData(APP_VERSION)
      toast.success(
        keys > 0
          ? `Personal data exported — ${keys} setting${keys === 1 ? '' : 's'}`
          : 'Nothing to export yet — personalize something first'
      )
    } catch {
      toast.error('Export failed — storage unavailable')
    }
  }, [])

  const onPersonalFile = useCallback((file: File) => {
    void file.text().then((raw) => {
      const parsed = parsePersonalData(raw)
      if (parsed === 'invalid') {
        toast.error('Not a valid personal-data file')
        return
      }
      setPendingPersonal(parsed)
    })
  }, [])

  const applyPersonal = useCallback(() => {
    if (!pendingPersonal) return
    setApplyingPersonal(true)
    // Small delay so the toast paints before the reload re-reads every store
    setTimeout(() => {
      const written = writePersonalData(pendingPersonal)
      toast.success(`Applied ${written} setting${written === 1 ? '' : 's'} — reloading…`)
      setTimeout(() => window.location.reload(), 900)
    }, 150)
  }, [pendingPersonal])

  // Shared backup flow — used by the "Download backup" button AND the
  // reminder toast's "Back up now" action (Task 14-j). useCallback keeps the
  // reference stable so the reminder effect below doesn't re-run on renders.
  const downloadBackup = useCallback(async () => {
    setBackingUp(true)
    toast.success('Preparing your backup…')
    try {
      const blob = await data.exportBackup()
      let out = blob
      let encrypted = false
      if (encryptBackups) {
        if (!backupPass || backupPass.length < 8) {
          toast.error(
            'Enter a passphrase of at least 8 characters (or turn encryption off)'
          )
          setBackingUp(false)
          return
        }
        const text = await blob.text()
        const encText = await encryptBackupText(text, backupPass)
        out = new Blob([encText], { type: 'application/json' })
        encrypted = true
      }
      const url = URL.createObjectURL(out)
      const a = document.createElement('a')
      a.href = url
      a.download = `wa-archiver-backup-${new Date()
        .toISOString()
        .slice(0, 10)}${encrypted ? '.encrypted' : ''}.json`
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
  }, [data, encryptBackups, backupPass])

  // Task 14-j — backup reminders: read the stored prefs + fire the
  // once-per-session due check whenever the settings dialog opens.
  // (SettingsDialog stays mounted in WhatsAppApp, so the check keys on
  // `open` transitions; app-level firing without opening Settings is a
  // documented one-line hook: scheduleBackupReminder(downloadBackup).)
  useEffect(() => {
    if (!open) return
    setRemindPref(readBackupRemindPref())
    setLastBackupAt(readLastBackupAt())
    try {
      setEncryptBackups(localStorage.getItem('wa-backup-encrypt') === '1')
    } catch {
      /* private mode */
    }
    setRemindReady(true)
    maybeRemindBackup(() => void downloadBackup())
  }, [open, downloadBackup])

  // Encrypted-restore helpers: a picked file that is an AES-GCM envelope
  // parks here until the user supplies the passphrase; only the decrypted
  // plaintext JSON ever reaches the restore path.
  const handleRestoreFilePick = async (file: File) => {
    const text = await file.text()
    if (isEncryptedBackup(text)) {
      setPendingEnc(text)
      setBackupPass('')
      toast.info('This backup is encrypted — enter the passphrase to restore')
      return
    }
    restoreBackup(file)
  }

  const confirmEncRestore = async () => {
    if (!pendingEnc) return
    if (!backupPass) {
      toast.error('Enter the backup passphrase')
      return
    }
    setEncBusy(true)
    try {
      const plain = await decryptBackupText(pendingEnc, backupPass)
      setPendingEnc(null)
      setBackupPass('')
      await restoreBackup(new File([plain], 'restored-backup.json', {
        type: 'application/json',
      }))
    } catch {
      toast.error('Wrong passphrase or corrupted backup file')
    } finally {
      setEncBusy(false)
    }
  }

  const toggleEncryptBackups = (on: boolean) => {
    setEncryptBackups(on)
    try {
      localStorage.setItem('wa-backup-encrypt', on ? '1' : '0')
    } catch {
      /* private mode */
    }
    if (!on) setBackupPass('')
  }

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
      <DialogContent
        className="wa-scroll max-h-[80vh] overflow-y-auto sm:max-w-md"
        onEscapeKeyDown={(e) => {
          // Esc cascade: the theme studio's inline save form / delete
          // confirm close first (their own key handlers), the dialog only
          // closes on a second press — mirrors the app-wide Esc cascade.
          if (saveOpen || confirmDeleteId) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <ShieldCheck className="h-4.5 w-4.5 text-(--wa-accent)" aria-hidden />
            {t('settings.title')}
          </DialogTitle>
          <DialogDescription className="text-left">
            {t('settings.description')}
          </DialogDescription>
        </DialogHeader>

        {/* a) AI features (Gemini key + preferences) */}
        <section aria-label={t('settings.section.ai')} className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
            <Sparkles className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            {t('settings.section.ai')}
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

          {/* On-device voice transcription (Phase 4) — Whisper model manager */}
          <div className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] p-3 dark:bg-white/[0.04]">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-(--wa-text)">
                <AudioLines className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
                Voice transcription (offline)
                {asrReady && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-(--wa-accent)/10 px-1.5 py-px text-[10px] font-semibold text-(--wa-accent-strong) dark:text-(--wa-accent)">
                    <span className="h-1.5 w-1.5 rounded-full bg-(--wa-accent)" aria-hidden />
                    Ready
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-(--wa-text-2)">
                {asrReady
                  ? 'Whisper runs on this device — voice notes transcribe with no internet and no API key.'
                  : `Downloads the Whisper voice model (~${ASR_MODEL_MB} MB, one time). After that, voice notes transcribe fully offline on this device.`}
              </p>
              {asrBusy && asrPct > 0 && (
                <div
                  className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={asrPct}
                  aria-label="Downloading voice model"
                >
                  <div
                    className="h-full rounded-full bg-(--wa-accent) transition-[width] duration-200"
                    style={{ width: `${asrPct}%` }}
                  />
                </div>
              )}
            </div>
            {asrReady ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleAsrRemove()}
                disabled={asrBusy}
                className="shrink-0 gap-1.5"
              >
                {asrBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-4 w-4" aria-hidden />
                )}
                Remove
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleAsrDownload()}
                disabled={asrBusy}
                className="shrink-0 gap-1.5"
              >
                {asrBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    {asrPct > 0 ? `${asrPct}%` : '…'}
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" aria-hidden />
                    Download
                  </>
                )}
              </Button>
            )}
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
        <section aria-label={t('settings.section.backup')} className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold text-(--wa-text)">
            {t('settings.section.backup')}
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
                if (file) void handleRestoreFilePick(file)
              }}
            />
          </div>

          {/* Encrypted backups — optional passphrase (AES-GCM-256 + PBKDF2).
              The pref (never the passphrase) persists in localStorage. */}
          <div className="flex flex-col gap-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-(--wa-text-2)">
              <button
                type="button"
                role="switch"
                aria-checked={encryptBackups}
                onClick={() => toggleEncryptBackups(!encryptBackups)}
                className={cn(
                  'relative h-4.5 w-8 shrink-0 rounded-full transition-colors',
                  encryptBackups ? 'bg-(--wa-accent)' : 'bg-black/15 dark:bg-white/20'
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all',
                    encryptBackups ? 'left-4' : 'left-0.5'
                  )}
                />
              </button>
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Encrypt backup with a passphrase
            </label>
            {encryptBackups && (
              <div className="relative ms-6 max-w-xs">
                <KeyRound
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--wa-text-2)"
                  aria-hidden
                />
                <input
                  type={showBackupPass ? 'text' : 'password'}
                  value={backupPass}
                  onChange={(e) => setBackupPass(e.target.value)}
                  placeholder="Passphrase (min 8 characters)"
                  autoComplete="new-password"
                  aria-label="Backup passphrase"
                  className="h-8.5 w-full rounded-md border border-black/10 bg-white/60 ps-8 pe-8 text-[12.5px] text-(--wa-text) outline-none placeholder:text-(--wa-text-2)/60 focus-visible:ring-2 focus-visible:ring-(--wa-accent)/50 dark:border-white/10 dark:bg-white/5"
                />
                <button
                  type="button"
                  onClick={() => setShowBackupPass((v) => !v)}
                  aria-label={showBackupPass ? 'Hide passphrase' : 'Show passphrase'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-(--wa-text-2) hover:text-(--wa-text)"
                >
                  {showBackupPass ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            )}
          </div>

          {/* Encrypted file picked for restore — passphrase gate */}
          {pendingEnc && (
            <div
              role="dialog"
              aria-label="Encrypted backup passphrase"
              className="flex flex-col gap-2 rounded-lg border border-(--wa-accent)/30 bg-(--wa-accent)/5 p-3"
            >
              <p className="text-[12px] font-medium text-(--wa-text)">
                <ShieldCheck className="me-1 inline h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
                This backup is encrypted. Enter its passphrase to restore.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={backupPass}
                  onChange={(e) => setBackupPass(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void confirmEncRestore()
                  }}
                  placeholder="Backup passphrase"
                  autoComplete="off"
                  aria-label="Passphrase for encrypted backup"
                  className="h-8.5 min-w-0 flex-1 rounded-md border border-black/10 bg-white/60 px-3 text-[12.5px] text-(--wa-text) outline-none placeholder:text-(--wa-text-2)/60 focus-visible:ring-2 focus-visible:ring-(--wa-accent)/50 dark:border-white/10 dark:bg-white/5"
                />
                <Button size="sm" onClick={() => void confirmEncRestore()} disabled={encBusy || !backupPass}>
                  {encBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Unlock className="h-4 w-4" aria-hidden />}
                  Decrypt &amp; restore
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPendingEnc(null)
                    setBackupPass('')
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

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

        {/* c) Personal data transfer — the portable half */}
        <section aria-label={t('settings.section.personal')} className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
            <ArrowDownUp className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            {t('settings.section.personal')}
          </h3>
          <p className="text-[12px] leading-snug text-(--wa-text-2)">
            Move your themes, bookmarks, wallpapers and preferences to another
            device. Chats ride with the full backup above; secrets (app-lock
            PIN, AI key) never leave this device.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={exportPersonal}
              disabled={busy}
              className="gap-1.5"
            >
              <FileJson className="h-4 w-4" aria-hidden />
              Export settings
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => personalInputRef.current?.click()}
              disabled={busy || !!pendingPersonal}
              className="gap-1.5"
            >
              <Upload className="h-4 w-4" aria-hidden />
              Import settings
            </Button>
            <input
              ref={personalInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="Choose a personal-data file"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) onPersonalFile(file)
              }}
            />
          </div>

          {pendingPersonal && (
            <div className="rounded-lg border border-(--wa-accent)/30 bg-(--wa-accent)/[0.06] p-3">
              {(() => {
                const stats = personalDataStats(pendingPersonal)
                return (
                  <>
                    <p className="text-[12.5px] font-medium text-(--wa-text)">
                      Apply {stats.keys} setting{stats.keys === 1 ? '' : 's'}?
                    </p>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-(--wa-text-2)">
                      {stats.bookmarks > 0 && `${stats.bookmarks} bookmark list${stats.bookmarks === 1 ? '' : 's'} · `}
                      {stats.wallpapers > 0 && `${stats.wallpapers} wallpaper${stats.wallpapers === 1 ? '' : 's'} · `}
                      exported {new Date(pendingPersonal.exportedAt).toLocaleDateString()}
                      {' '}· overwrites matching settings on this device
                    </p>
                  </>
                )
              })()}
              <div className="mt-2.5 flex gap-2">
                <Button
                  size="sm"
                  className="h-7 gap-1 rounded-full bg-(--wa-accent) px-3 text-[12px] font-medium text-white hover:bg-(--wa-accent-strong)"
                  onClick={applyPersonal}
                  disabled={applyingPersonal}
                >
                  {applyingPersonal ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Apply &amp; reload
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-full px-3 text-[12px] text-(--wa-text-2)"
                  onClick={() => setPendingPersonal(null)}
                  disabled={applyingPersonal}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Idea #14 — rolling on-device snapshots */}
        <SnapshotsCard />

        {/* Idea #11 — encrypted portable sync file (E2E) */}
        <SyncVaultCard onRefreshChats={onRefreshChats} />

        <div className="h-px bg-black/10 dark:bg-white/10" />

        {/* Theme studio (C1 #13) + language (C1 #14) — the studio UI lives
            inside SettingsDialog (no separate ThemeStudioDialog component)
            so it shares this dialog's scroll container and Esc cascade. */}
        <section
          aria-label={t('settings.section.themeStudio')}
          className="flex flex-col gap-2"
        >
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
            <Paintbrush className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            {t('settings.section.appearance')}
          </h3>
          <p className="text-[12px] leading-snug text-(--wa-text-2)">
            {t('theme.studio.hint')}
          </p>

          {/* Language — button grid mirroring the density select pattern
              (native <select> is unused anywhere in this codebase) */}
          <div className="rounded-lg bg-black/[0.03] p-3 dark:bg-white/[0.04]">
            <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-(--wa-text)">
              <Languages className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
              {t('settings.language.label')}
            </p>
            <div
              role="group"
              aria-label={t('settings.language.label')}
              className="mt-2 grid grid-cols-2 gap-2"
            >
              {LOCALES.map((l) => {
                const active = locale === l.code
                return (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => setLocale(l.code)}
                    aria-pressed={active}
                    className={`
                      flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-3 py-2
                      text-[12.5px] font-medium transition-colors
                      focus-visible:outline-2 focus-visible:outline-offset-2
                      focus-visible:outline-(--wa-accent)
                      ${
                        active
                          ? 'bg-(--wa-accent)/10 text-(--wa-accent-strong) ring-1 ring-(--wa-accent) dark:text-(--wa-accent)'
                          : 'text-(--wa-text) hover:bg-black/5 dark:hover:bg-white/10'
                      }
                    `}
                  >
                    {active && <Check className="h-3.5 w-3.5" aria-hidden />}
                    {l.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] leading-snug text-(--wa-text-2)">
              {t('settings.language.hint')}
            </p>
          </div>

          {/* Preset grid — the 17 built-ins + the saved looks (3-up ≥sm) */}
          <div
            role="group"
            aria-label={t('settings.section.themeStudio')}
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          >
            {(Object.keys(APP_THEMES) as AppThemeKey[]).map((k) => {
              const sw = APP_THEMES[k].swatch
              const active = themeKey === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => applyPresetTheme(k)}
                  aria-pressed={active}
                  aria-label={t('theme.studio.aria.applyNamed', {
                    name: APP_THEMES[k].label,
                  })}
                  className={cn(
                    'flex flex-col gap-1 rounded-xl p-1.5 text-left transition-transform duration-150 hover:scale-[1.03] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--wa-accent)',
                    active
                      ? 'bg-(--wa-accent)/10 ring-1 ring-(--wa-accent)'
                      : 'hover:bg-black/5 dark:hover:bg-white/5'
                  )}
                >
                  <PresetPreview
                    appbar={sw.appbar}
                    bubble={sw.bubble}
                    accent={sw.accent}
                  />
                  {active && (
                    <span className="self-center rounded-full bg-(--wa-accent) px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white">
                      {t('theme.studio.active')}
                    </span>
                  )}
                  <span
                    className={cn(
                      'truncate text-center text-[11px] font-medium',
                      active
                        ? 'text-(--wa-accent-strong) dark:text-(--wa-accent)'
                        : 'text-(--wa-text)'
                    )}
                  >
                    {APP_THEMES[k].label}
                  </span>
                </button>
              )
            })}

            {/* Saved looks — same grid; the card applies, the corner button
                deletes (inline confirm overlay, Esc cancels) */}
            {customThemes.map((c) => {
              const sw = APP_THEMES[c.themeId].swatch
              const active =
                c.themeId === themeKey &&
                (c.accent ?? null) === (accentKey ?? null) &&
                c.bubbleStyle === bubbleStyleKey &&
                c.density === densityKey
              return (
                <div
                  key={c.id}
                  className={cn(
                    'relative flex flex-col gap-1 rounded-xl p-1.5 transition-transform duration-150',
                    active
                      ? 'bg-(--wa-accent)/10 ring-1 ring-(--wa-accent)'
                      : 'hover:bg-black/5 dark:hover:bg-white/5'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => applyPreset(c)}
                    aria-label={t('theme.studio.aria.applyNamed', { name: c.name })}
                    className="flex min-h-[44px] flex-col gap-1 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--wa-accent)"
                  >
                    <PresetPreview
                      appbar={sw.appbar}
                      bubble={sw.bubble}
                      accent={sw.accent}
                      wallpaperBadge={
                        c.wallpaper ? t('theme.studio.includesWallpaper') : null
                      }
                    />
                    {active && (
                      <span className="self-center rounded-full bg-(--wa-accent) px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white">
                        {t('theme.studio.active')}
                      </span>
                    )}
                    <span
                      className={cn(
                        'truncate text-center text-[11px] font-medium',
                        active
                          ? 'text-(--wa-accent-strong) dark:text-(--wa-accent)'
                          : 'text-(--wa-text)'
                      )}
                    >
                      {c.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(c.id)}
                    aria-label={`${t('theme.studio.delete')}: ${c.name}`}
                    className="absolute right-0 top-0 z-10 flex h-11 w-11 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--wa-accent) dark:hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  {confirmDeleteId === c.id && (
                    <div
                      role="group"
                      aria-label={t('theme.studio.confirmDelete', { name: c.name })}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.stopPropagation()
                          setConfirmDeleteId(null)
                        }
                      }}
                      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-(--wa-panel)/95 p-2 text-center backdrop-blur-[2px]"
                    >
                      <p className="line-clamp-2 text-[11.5px] font-semibold leading-tight text-(--wa-text)">
                        {t('theme.studio.confirmDelete', { name: c.name })}
                      </p>
                      <p className="text-[10px] leading-tight text-(--wa-text-2)">
                        {t('theme.studio.confirmDeleteHint')}
                      </p>
                      <div className="flex w-full gap-1.5">
                        <button
                          type="button"
                          onClick={confirmDelete}
                          className="h-11 flex-1 rounded-md bg-red-600 text-[12px] font-semibold text-white transition-colors hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                        >
                          {t('common.delete')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="h-11 flex-1 rounded-md border border-(--wa-line) text-[12px] font-medium text-(--wa-text) transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--wa-accent) dark:hover:bg-white/10"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Save current look — inline name form (Esc closes it, not the
              dialog; the DialogContent onEscapeKeyDown guard handles that) */}
          {saveOpen ? (
            <form
              onSubmit={submitPreset}
              className="flex flex-wrap items-center gap-2 rounded-lg bg-black/[0.03] p-2 dark:bg-white/[0.04]"
            >
              <Input
                ref={presetNameRef}
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setSaveOpen(false)
                    setPresetName('')
                  }
                }}
                maxLength={40}
                placeholder={t('theme.studio.namePlaceholder')}
                aria-label={t('theme.studio.namePlaceholder')}
                className="min-w-[8rem] flex-1"
              />
              <Button type="submit" size="sm" className="h-11 gap-1.5 px-4">
                <Check className="h-4 w-4" aria-hidden />
                {t('theme.studio.saveButton')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSaveOpen(false)
                  setPresetName('')
                }}
                className="h-11 px-4 text-(--wa-text-2)"
              >
                {t('common.cancel')}
              </Button>
            </form>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSaveOpen(true)}
              className="h-11 w-full justify-start gap-1.5"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t('theme.studio.save')}
            </Button>
          )}
        </section>

        <div className="h-px bg-black/10 dark:bg-white/10" />

        {/* Data and storage (task 14-h) */}
        <section aria-label={t('settings.section.storage')} className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
            <HardDrive className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            {t('settings.section.storage')}
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
              {native
                ? 'Standalone app — chats and media live on this device. Nothing to configure.'
                : mode === 'device'
                  ? 'Chats and media live in this browser — fully offline, nothing leaves the device.'
                  : 'Chats live on the server via /api — the classic hosted mode.'}
            </p>
            {native ? (
              // Standalone shell (Phase 3): there is no server to switch to —
              // the bundled app runs the device transport exclusively.
              <p className="mt-2.5 flex items-center gap-1.5 rounded-md bg-(--wa-accent)/10 px-2.5 py-2 text-[11.5px] font-medium leading-snug text-(--wa-accent-strong) dark:text-(--wa-accent)">
                <Smartphone className="h-3.5 w-3.5 shrink-0" aria-hidden />
                On-device storage — this app works fully offline.
              </p>
            ) : (
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
            )}
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
        <section aria-label={t('settings.section.export')} className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
            <FileDown className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            {t('settings.section.export')}
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
                {t('settings.section.lock')}
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
        <section aria-label={t('settings.section.shortcuts')} className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold text-(--wa-text)">
            {t('settings.section.shortcuts')}
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
        <section aria-label={t('settings.section.install')} className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
            <Smartphone className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            {t('settings.section.install')}
          </h3>
          <p className="text-[12px] leading-snug text-(--wa-text-2)">
            Installable: use your browser menu → Install app / Add to Home
            Screen. Recently opened chats stay readable offline.
          </p>
        </section>

        {/* g) About — version badge (APP_VERSION-driven) */}
        <section aria-label={t('settings.section.about')} className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-(--wa-text)">
            <Info className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
            {t('settings.section.about')}
          </h3>
          <div className="rounded-lg border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.04]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-(--wa-text)">
                {t('app.name')}
              </span>
              <span
                className="rounded-full bg-(--wa-accent)/10 px-2 py-0.5 text-[11px] font-semibold text-(--wa-accent)"
                aria-label={`Version ${APP_VERSION}`}
              >
                v{APP_VERSION}
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-snug text-(--wa-text-2)">
              View, explore and enrich your exported WhatsApp chats — media,
              voice notes, reactions, AI tools, privacy lock and more, all on
              your own device.
            </p>
            <p className="mt-2 text-[11px] leading-snug text-(--wa-text-2)">
              You&apos;re running the v{APP_VERSION} release. More features are planned
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
