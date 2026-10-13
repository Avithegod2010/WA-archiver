/**
 * Per-chat accent theme + mute store (localStorage-backed).
 *
 * Storage keys:
 *   wa-viewer:theme:<chatId>  → JSON ChatTheme ({ accent?: string })
 *   wa-viewer:mute:<chatId>   → '1' when notifications are muted (key removed when unmuted)
 *
 * Events (window CustomEvents, bubble to all listeners):
 *   'wa-theme-changed'  → detail { chatId }   — after write/clear of a chat theme
 *   'wa-mute-changed'   → detail { chatId }   — after mute/unmute
 *
 * The accent overrides the app-wide `--wa-accent` / `--wa-accent-strong`
 * CSS variables for one chat: consumers set
 *   style={{ '--wa-accent': pair.accent, '--wa-accent-strong': pair.accentStrong }}
 * on the chat's wrapper element and every bubble / header / pill that uses
 * `bg-(--wa-accent)`, `text-(--wa-accent)` etc. picks it up automatically.
 *
 * Mirrors the store pattern in wallpaper.ts (defensive reads + custom events
 * + storage-event subscription so cross-tab changes stay in sync).
 */

export type ChatTheme = {
  /** Accent color for this chat — hex like '#00a884'. Undefined = app default. */
  accent?: string
}

export interface ChatAccent {
  name: string
  /** Main accent (maps to --wa-accent) */
  accent: string
  /** Darker variant for gradients/hover/pressed states (maps to --wa-accent-strong) */
  accentStrong: string
}

export const CHAT_THEME_EVENT = 'wa-theme-changed'
export const CHAT_MUTE_EVENT = 'wa-mute-changed'

/** App-wide default pair (matches globals.css :root --wa-accent values). */
export const DEFAULT_ACCENT: ChatAccent = {
  name: 'Default',
  accent: '#00a884',
  accentStrong: '#008069',
}

/**
 * 8 curated WhatsApp-flavored accents. accentStrong is a darker shade of
 * accent for gradients / hover / pressed states. No default indigo/blue vibes.
 */
export const CHAT_ACCENTS: ChatAccent[] = [
  { name: 'Teal', accent: '#00a884', accentStrong: '#008069' },
  { name: 'Sunset', accent: '#ea580c', accentStrong: '#9a3412' },
  { name: 'Rose', accent: '#e11d48', accentStrong: '#9f1239' },
  { name: 'Grape', accent: '#9333ea', accentStrong: '#6b21a8' },
  { name: 'Berry', accent: '#d6409f', accentStrong: '#a12b7d' },
  { name: 'Honey', accent: '#d97706', accentStrong: '#92400e' },
  { name: 'Lagoon', accent: '#0891b2', accentStrong: '#0e7490' },
  { name: 'Olive', accent: '#74873c', accentStrong: '#4c591f' },
]

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function themeKey(chatId: string): string {
  return `wa-viewer:theme:${chatId}`
}

/** Storage key for a chat's mute flag: `wa-viewer:mute:<chatId>` ('1' = muted). */
export function muteKey(chatId: string): string {
  return `wa-viewer:mute:${chatId}`
}

function validAccent(v: unknown): string | null {
  return typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim().toLowerCase() : null
}

/** Read a chat's theme. Defensive: never throws, {} when unset/invalid/SSR. */
export function readChatTheme(chatId: string): ChatTheme {
  if (typeof window === 'undefined' || !chatId) return {}
  try {
    const raw = localStorage.getItem(themeKey(chatId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const accent = validAccent((parsed as { accent?: unknown }).accent)
    return accent ? { accent } : {}
  } catch {
    return {}
  }
}

/**
 * Merge-patch a chat's theme and notify listeners. Pass {} to strip all
 * fields (removes the key when nothing remains). Dispatches
 * 'wa-theme-changed' with detail { chatId } (also when nothing was stored).
 */
export function writeChatTheme(chatId: string, theme: ChatTheme): void {
  if (typeof window === 'undefined' || !chatId) return
  try {
    const next: ChatTheme = { ...readChatTheme(chatId) }
    const accent = validAccent(theme.accent)
    if (accent) next.accent = accent
    else delete next.accent
    if (Object.keys(next).length > 0) {
      localStorage.setItem(themeKey(chatId), JSON.stringify(next))
    } else {
      localStorage.removeItem(themeKey(chatId))
    }
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(CHAT_THEME_EVENT, { detail: { chatId } }))
}

/** Remove a chat's theme override entirely and notify listeners. */
export function clearChatTheme(chatId: string): void {
  if (typeof window === 'undefined' || !chatId) return
  try {
    localStorage.removeItem(themeKey(chatId))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(CHAT_THEME_EVENT, { detail: { chatId } }))
}

/** Resolve a theme into a full accent pair (defaults when unset/unknown). */
export function accentFor(theme: ChatTheme): ChatAccent {
  if (!theme.accent) return DEFAULT_ACCENT
  return (
    CHAT_ACCENTS.find((a) => a.accent === theme.accent) ?? {
      name: 'Custom',
      accent: theme.accent,
      accentStrong: theme.accent,
    }
  )
}

/** Convenience: read + resolve a chat's accent pair in one call. */
export function readChatAccent(chatId: string): ChatAccent {
  return accentFor(readChatTheme(chatId))
}

/** True when toast notifications for this chat are muted. */
export function isChatMuted(chatId: string): boolean {
  if (typeof window === 'undefined' || !chatId) return false
  try {
    return localStorage.getItem(muteKey(chatId)) === '1'
  } catch {
    return false
  }
}

/**
 * Set/unset the mute flag for a chat ('1' stored, key removed when unmuted)
 * and dispatch 'wa-mute-changed' with detail { chatId }.
 */
export function setChatMuted(chatId: string, muted: boolean): void {
  if (typeof window === 'undefined' || !chatId) return
  try {
    if (muted) localStorage.setItem(muteKey(chatId), '1')
    else localStorage.removeItem(muteKey(chatId))
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new CustomEvent(CHAT_MUTE_EVENT, { detail: { chatId } }))
}

/**
 * Subscribe to theme changes (custom event + cross-tab 'storage').
 * Returns an unsubscribe function.
 */
export function subscribeChatTheme(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CHAT_THEME_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(CHAT_THEME_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

/** Subscribe to mute changes (custom event + cross-tab 'storage'). */
export function subscribeChatMute(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CHAT_MUTE_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(CHAT_MUTE_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}
