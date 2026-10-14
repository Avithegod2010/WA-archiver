/**
 * Voice-note playback progress (localStorage-backed) — idea #7
 * "resume-where-you-left" for long notes.
 *
 * Storage:
 *   wa-viewer:voice-progress → JSON Record<messageId, seconds>
 *   Capped at 500 entries; when full the OLDEST entries (insertion order)
 *   are dropped.
 *
 * Written by the shared audio-engine (throttled on 'timeupdate', plus on
 * pause/close/unload). Cleared when a track finishes or is replayed past
 * its saved spot.
 */

const STORAGE_KEY = 'wa-viewer:voice-progress'
const MAX_ENTRIES = 500
/** Positions shorter than this aren't worth remembering. */
export const MIN_RESUME_SECONDS = 3

export type ProgressMap = Record<string, number>

const EMPTY: ProgressMap = {}

let cached: ProgressMap | null = null

function readAll(): ProgressMap {
  if (typeof window === 'undefined') return EMPTY
  if (cached) return cached
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: ProgressMap = {}
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'number' && isFinite(v) && v > 0) out[k] = v
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

function writeAll(map: ProgressMap): void {
  cached = map
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* storage unavailable — in-memory state still works */
  }
}

/** Saved position (seconds) for a voice message, 0 when none. */
export function getProgress(id: string): number {
  if (!id) return 0
  return readAll()[id] ?? 0
}

/** Persist the current position of a track. */
export function setProgress(id: string, seconds: number): void {
  if (typeof window === 'undefined' || !id) return
  if (!isFinite(seconds) || seconds < MIN_RESUME_SECONDS) return
  const map = readAll()
  if (map[id] === seconds) return
  writeAll({ ...map, [id]: seconds })
}

/** Forget a track's saved position (finished, or replayed past it). */
export function clearProgress(id: string): void {
  if (!id) return
  const map = readAll()
  if (map[id] === undefined) return
  const next = { ...map }
  delete next[id]
  writeAll(next)
}

/** Drop oldest entries beyond the cap (call after writes, cheap). */
export function trimProgress(): void {
  const map = readAll()
  const keys = Object.keys(map)
  if (keys.length <= MAX_ENTRIES) return
  const next: ProgressMap = {}
  for (const k of keys.slice(keys.length - MAX_ENTRIES)) next[k] = map[k]
  writeAll(next)
}
