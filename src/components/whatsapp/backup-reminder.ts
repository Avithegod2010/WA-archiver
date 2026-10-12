/**
 * Backup reminders (Task 14-j).
 *
 * Client-side helper that decides when a gentle "time to back up" toast is
 * due, based on two localStorage keys:
 *
 * - `wa-viewer:backup-remind`   JSON { on: boolean, cadence: 'daily' | 'weekly' | 'monthly' }
 * - `wa-viewer:last-backup-at`  epoch-ms string of the last successful backup
 *
 * Every storage access is try/catch-guarded so the module never throws when
 * localStorage is unavailable (private mode, storage quotas, SSR, etc.).
 *
 * SSR-safe: every exported function is guarded with `typeof window`, and the
 * reminder itself is only ever fired from client effects.
 *
 * v1 FIRING MODEL: the due check runs from SettingsDialog's effect whenever
 * the settings dialog opens (SettingsDialog stays mounted in WhatsAppApp, so
 * the check is keyed on `open` transitions). App-level firing — a reminder on
 * normal app usage without opening Settings — is a documented one-line hook:
 * call `scheduleBackupReminder(runBackup)` once from an app-level effect in
 * WhatsAppApp.tsx (same signature as `maybeRemindBackup`). The module-level
 * session flag guarantees at most one toast per app session either way.
 */

import { toast } from 'sonner'

export type BackupCadence = 'daily' | 'weekly' | 'monthly'

export interface BackupRemindPref {
  on: boolean
  cadence: BackupCadence
}

export const BACKUP_REMIND_KEY = 'wa-viewer:backup-remind'
export const LAST_BACKUP_KEY = 'wa-viewer:last-backup-at'

/** Due intervals: daily 24 h, weekly 7 d, monthly 30 d. */
export const CADENCE_MS: Record<BackupCadence, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
}

export const DEFAULT_BACKUP_REMIND: BackupRemindPref = {
  on: false,
  cadence: 'weekly',
}

/** Segmented-control options for the settings UI. */
export const CADENCE_OPTIONS: { value: BackupCadence; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

const isBackupCadence = (v: unknown): v is BackupCadence =>
  v === 'daily' || v === 'weekly' || v === 'monthly'

/** Read the reminder preference; falls back to defaults on any error. */
export function readBackupRemindPref(): BackupRemindPref {
  if (typeof window === 'undefined') return { ...DEFAULT_BACKUP_REMIND }
  try {
    const raw = localStorage.getItem(BACKUP_REMIND_KEY)
    if (!raw) return { ...DEFAULT_BACKUP_REMIND }
    const parsed = JSON.parse(raw) as Partial<BackupRemindPref> | null
    return {
      on: typeof parsed?.on === 'boolean' ? parsed.on : DEFAULT_BACKUP_REMIND.on,
      cadence: isBackupCadence(parsed?.cadence)
        ? parsed.cadence
        : DEFAULT_BACKUP_REMIND.cadence,
    }
  } catch {
    return { ...DEFAULT_BACKUP_REMIND }
  }
}

/** Persist the reminder preference; silently no-ops without storage. */
export function writeBackupRemindPref(pref: BackupRemindPref): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(BACKUP_REMIND_KEY, JSON.stringify(pref))
  } catch {
    // Storage unavailable — preference stays for this session only
  }
}

/** Epoch ms of the last successful backup, or null when never backed up. */
export function readLastBackupAt(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LAST_BACKUP_KEY)
    if (!raw) return null
    const ts = Number(raw)
    return Number.isFinite(ts) && ts > 0 ? ts : null
  } catch {
    return null
  }
}

/** Record a successful backup (epoch ms) — this auto-snoozes the reminder. */
export function writeLastBackupAt(at: number = Date.now()): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(LAST_BACKUP_KEY, String(Math.round(at)))
  } catch {
    // Storage unavailable — reminder timing just won't persist
  }
}

/**
 * "2 days ago"-style relative time (seconds/minutes/hours/days/weeks).
 * Trims a trailing `.0` on day/week decimals and treats future timestamps
 * (clock skew) gracefully as "just now". Never throws.
 */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts)) return ''
  const diff = now - ts
  if (diff < 1000) return 'just now' // future timestamps or sub-second age
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) {
    return seconds === 1 ? '1 second ago' : `${seconds} seconds ago`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  }
  const trimOne = (n: number) => {
    const s = n.toFixed(1)
    return s.endsWith('.0') ? s.slice(0, -2) : s
  }
  const days = diff / 86_400_000
  if (days < 7) {
    return trimOne(days) === '1' ? '1 day ago' : `${trimOne(days)} days ago`
  }
  const weeks = days / 7
  return trimOne(weeks) === '1' ? '1 week ago' : `${trimOne(weeks)} weeks ago`
}

/** Due when reminders are on AND (never backed up OR older than the cadence). */
export function isBackupDue(pref: BackupRemindPref): boolean {
  if (!pref.on) return false
  const last = readLastBackupAt()
  if (last == null) return true // never backed up — the most due case
  return Date.now() - last > CADENCE_MS[pref.cadence]
}

// One reminder per app session, no matter how often the check runs.
let remindedThisSession = false

/**
 * Fire the (once-per-session) backup reminder toast when one is due.
 * `triggerBackup` must run the app's exact backup flow — in SettingsDialog
 * this is the same `runBackup` handler the "Download backup" button uses.
 */
export function maybeRemindBackup(triggerBackup: () => void): void {
  if (typeof window === 'undefined') return // never during SSR
  if (remindedThisSession) return
  const pref = readBackupRemindPref()
  if (!isBackupDue(pref)) return
  remindedThisSession = true
  const last = readLastBackupAt()
  toast('Time to back up your chats', {
    description:
      last == null
        ? 'You have not downloaded a backup yet. Keep a copy of your chats safe.'
        : `Last backup was ${formatRelativeTime(last)}. Keep a fresh copy safe.`,
    duration: Infinity,
    action: { label: 'Back up now', onClick: () => triggerBackup() },
    cancel: {
      label: 'Close',
      onClick: () => {
        // Sonner dismisses the toast automatically
      },
    },
    // Gentle teal accent, matching the app's WhatsApp theme vars.
    actionButtonStyle: { background: 'var(--wa-accent)', color: '#ffffff' },
  })
}

/**
 * App-level hook point (Task 14-j): any future caller — e.g. a one-line
 * effect in WhatsAppApp.tsx — can invoke `scheduleBackupReminder(runBackup)`
 * on normal app usage to get the same once-per-session due check without
 * opening Settings. Alias of `maybeRemindBackup` with a stable name.
 */
export function scheduleBackupReminder(triggerBackup: () => void): void {
  maybeRemindBackup(triggerBackup)
}
