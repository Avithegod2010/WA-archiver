/**
 * "Unplayed voice note" store (localStorage-backed).
 *
 * Storage:
 *   wa-viewer:voice-played → JSON Record<messageId, 1>
 *   Capped at ~2000 entries; when full, the OLDEST entries (by insertion
 *   order) are dropped.
 *
 * Events (window CustomEvents):
 *   'wa-voice-played' → detail { id } — fired by markPlayed()
 *
 * Pattern mirrors chat-theme.ts / wallpaper.ts: defensive reads, a cached
 * snapshot object for useSyncExternalStore (identity-stable between writes),
 * custom events + cross-tab 'storage' subscription.
 */

export const VOICE_PLAYED_EVENT = 'wa-voice-played'

const STORAGE_KEY = 'wa-viewer:voice-played'
const MAX_ENTRIES = 2000

export type PlayedMap = Record<string, 1>

const EMPTY: PlayedMap = {}

let cached: PlayedMap | null = null

function readAll(): PlayedMap {
  if (typeof window === 'undefined') return EMPTY
  if (cached) return cached
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: PlayedMap = {}
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (v === 1) out[k] = 1
        }
        cached = out
        return out
      }
    }
  } catch {
    /* corrupted/unavailable storage → treat as empty */
  }
  cached = {}
  return cached
}

/** True when the voice message has NOT been played yet (client-side). */
export function isUnplayed(id: string): boolean {
  if (!id) return false
  return readAll()[id] !== 1
}

/**
 * Record a message as played (first write persists + caps the map) and
 * dispatch 'wa-voice-played' { id }. Safe to call repeatedly.
 */
export function markPlayed(id: string): void {
  if (typeof window === 'undefined' || !id) return
  const map = readAll()
  if (map[id] !== 1) {
    const next: PlayedMap = { ...map, [id]: 1 }
    const keys = Object.keys(next)
    if (keys.length > MAX_ENTRIES) {
      // Drop the oldest entries (insertion order) beyond the cap.
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete next[k]
    }
    cached = next
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable — in-memory state still works */
    }
  }
  window.dispatchEvent(new CustomEvent(VOICE_PLAYED_EVENT, { detail: { id } }))
}

/**
 * Snapshot getter for useSyncExternalStore — returns the cached map object,
 * replaced (not mutated) on writes so React re-renders only on real changes.
 */
export function getPlayedSnapshot(): PlayedMap {
  return readAll()
}

/** Server snapshot (never "played" during SSR/hydration). */
export function getEmptyPlayedSnapshot(): PlayedMap {
  return EMPTY
}

/** Subscribe to played/unplayed changes (custom event + cross-tab storage). */
export function subscribePlayed(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = () => {
    cached = null // re-parse on next read (other tab may have changed it)
    fn()
  }
  window.addEventListener(VOICE_PLAYED_EVENT, fn)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(VOICE_PLAYED_EVENT, fn)
    window.removeEventListener('storage', onStorage)
  }
}
