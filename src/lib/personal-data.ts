/**
 * Personal data export/import — the portable half of a user's setup.
 *
 * The DB backup (Settings ▸ Backup & restore) already covers chats, messages
 * and starred flags. This module covers everything that lives in
 * localStorage: themes, accent, bubble style, density, clock, text size,
 * font, wallpapers (incl. per-chat photos), bookmarks, folders, favorites
 * and read-state. Together the two files make a device migration complete.
 *
 * Security: an explicit allowlist decides what leaves the device and what an
 * import may write. Secrets (lock hash, AI key) and bulky ephemeral caches
 * are never included, and imported values stay strings — written verbatim,
 * one key at a time, never evaluated.
 */

export const PERSONAL_DATA_KIND = 'whatsapp-viewer-personal-data'
export const PERSONAL_DATA_VERSION = 1

/** Exact keys exported/imported as-is. */
const EXACT_KEYS = new Set([
  'wa-viewer:theme',
  'wa-viewer:accent',
  'wa-viewer:bubblestyle',
  'wa-viewer:density',
  'wa-viewer:timeformat',
  'wa-viewer:textsize',
  'wa-viewer:fontfamily',
  'wa-viewer:reading-prefs',
  'wa-viewer:read-only',
  'wa-viewer:auto-reply',
  'wa-viewer:auto-clean',
  'wa-viewer:wallpaper',
  'wa-viewer:folders',
  'wa-viewer:active-folder',
  'wa-viewer:fav-chats',
  'wa-viewer:seen-chats',
])

/** Prefixes that carry per-chat state: bookmarks, wallpapers, mutes. */
const PREFIX_KEYS: { prefix: string; label: string }[] = [
  { prefix: 'wa-viewer:bookmarks:', label: 'bookmarks' },
  { prefix: 'wa-viewer:wallpaper:', label: 'wallpaper' },
  { prefix: 'wa-viewer:mute:', label: 'mute' },
]

export interface PersonalDataFile {
  kind: typeof PERSONAL_DATA_KIND
  version: number
  exportedAt: string
  /** localStorage key → raw stored string. */
  entries: Record<string, string>
  /** App version that produced the file (informational). */
  appVersion?: string
}

export interface PersonalDataStats {
  keys: number
  bookmarks: number
  wallpapers: number
  /** Total serialized size in bytes (approximate, UTF-16 aware). */
  bytes: number
}

function keyKind(key: string): 'prefs' | 'bookmarks' | 'wallpaper' | 'mute' {
  if (key.startsWith('wa-viewer:bookmarks:')) return 'bookmarks'
  if (key.startsWith('wa-viewer:wallpaper:')) return 'wallpaper'
  if (key.startsWith('wa-viewer:mute:')) return 'mute'
  return 'prefs'
}

/** True when a localStorage key may be exported / imported. */
export function isPortableKey(key: string): boolean {
  if (EXACT_KEYS.has(key)) return true
  return PREFIX_KEYS.some((p) => key.startsWith(p.prefix))
}

/** Snapshot every portable key currently in localStorage. */
export function collectPersonalData(): PersonalDataFile {
  const entries: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !isPortableKey(key)) continue
      const value = localStorage.getItem(key)
      if (value !== null) entries[key] = value
    }
  } catch {
    /* storage unavailable — return what we have (nothing) */
  }
  return {
    kind: PERSONAL_DATA_KIND,
    version: PERSONAL_DATA_VERSION,
    exportedAt: new Date().toISOString(),
    entries,
  }
}

/** Summary counters for the confirmation dialog / toast. */
export function personalDataStats(file: PersonalDataFile): PersonalDataStats {
  let bookmarks = 0
  let wallpapers = 0
  let bytes = 0
  for (const [key, value] of Object.entries(file.entries)) {
    bytes += key.length * 2 + value.length * 2
    const kind = keyKind(key)
    if (kind === 'bookmarks') bookmarks++
    else if (kind === 'wallpaper') wallpapers++
  }
  return { keys: Object.keys(file.entries).length, bookmarks, wallpapers, bytes }
}

/**
 * Validate a parsed personal-data file. Accepts version ≤ current so future
 * exports still import on older builds (unknown keys are dropped by the
 * allowlist anyway).
 */
export function parsePersonalData(raw: string): PersonalDataFile | 'invalid' {
  try {
    const o = JSON.parse(raw) as Partial<PersonalDataFile> | null
    if (!o || typeof o !== 'object') return 'invalid'
    if (o.kind !== PERSONAL_DATA_KIND) return 'invalid'
    if (typeof o.version !== 'number' || o.version > PERSONAL_DATA_VERSION)
      return 'invalid'
    if (!o.entries || typeof o.entries !== 'object') return 'invalid'
    const entries: Record<string, string> = {}
    for (const [key, value] of Object.entries(o.entries)) {
      if (typeof value === 'string' && isPortableKey(key)) entries[key] = value
    }
    return {
      kind: PERSONAL_DATA_KIND,
      version: o.version,
      exportedAt:
        typeof o.exportedAt === 'string' ? o.exportedAt : new Date(0).toISOString(),
      entries,
    }
  } catch {
    return 'invalid'
  }
}

/**
 * Write a validated file's entries into localStorage. Values land verbatim
 * as strings; only allowlisted keys are touched. Returns how many keys were
 * written. The caller should reload (or re-dispatch pref events) afterwards —
 * a full reload is the simplest way to re-read every store consistently.
 */
export function writePersonalData(file: PersonalDataFile): number {
  let written = 0
  try {
    for (const [key, value] of Object.entries(file.entries)) {
      if (!isPortableKey(key)) continue
      localStorage.setItem(key, value)
      written++
    }
  } catch {
    /* storage unavailable / quota — partial writes are re-runnable */
  }
  return written
}

/** Build and trigger the download of the personal-data file. */
export function downloadPersonalData(appVersion?: string): number {
  const file = collectPersonalData()
  if (appVersion) file.appVersion = appVersion
  const stats = personalDataStats(file)
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `chat-archiver-personal-data-${new Date()
    .toISOString()
    .slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return stats.keys
}
