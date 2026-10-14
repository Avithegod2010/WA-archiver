/**
 * Shared voice-note playback engine (module-level singleton).
 *
 * ONE HTMLAudioElement is created lazily and re-used for every voice message
 * in the app. Because the engine lives at module scope, playback SURVIVES
 * chat switches: the bubble that started it may unmount, the audio keeps
 * going, and the floating AudioDock keeps showing/controlling it.
 *
 * React components bind via `useSyncExternalStore(subscribe, getState)` —
 * the state object is replaced (never mutated) on every change so snapshot
 * identity stays stable between updates.
 *
 * Non-React code can also sync by listening for the window CustomEvent
 *   'wa-audio-state'   (dispatched on EVERY state change, no detail)
 *
 * Track meta shape accepted by `load()`:
 *   { id, chatId, chatTitle, sender, src }
 *   - id:       unique track/message id (also used as the waveform seed)
 *   - chatId:   id of the chat the message belongs to ('' if unknown)
 *   - chatTitle: chat display name ('' if unknown)
 *   - sender:   voice-note sender name ('' if unknown)
 *   - src:      media URL (e.g. /api/media/<chatId>/<path>)
 *
 * Idea #7 (voice-note upgrade):
 *   - 0.5× – 2× speed range, persisted across sessions (localStorage)
 *   - resume-where-you-left: positions are persisted via voice-progress.ts
 *     (throttled on timeupdate + on pause/close), and `play()` transparently
 *     seeks back to the saved spot for tracks >3s that weren't finished.
 */

import {
  MIN_RESUME_SECONDS,
  clearProgress,
  getProgress,
  setProgress,
} from './voice-progress'


export type AudioTrackMeta = {
  id: string
  chatId: string
  chatTitle: string
  sender: string
  src: string
}

export type AudioEngineState = {
  /** Id of the loaded track, or null when nothing is loaded. */
  currentId: string | null
  chatId: string
  chatTitle: string
  sender: string
  src: string
  playing: boolean
  /** Seconds elapsed (driven by 'timeupdate'). */
  current: number
  /** Seconds total (0 until metadata is loaded). */
  duration: number
  /** Index into RATES — persists across tracks AND sessions (localStorage). */
  rateIdx: number
  /** Saved resume position (seconds) for the active track, 0 when none. */
  savedAt: number
  /** True when the media failed to load/play. */
  failed: boolean
}

/**
 * Playback speeds, cycled by `cycleRate()` (0.5× → 1× → 1.5× → 2×).
 * 0.5× covers idea #7's slow-listen end of the range.
 */
export const RATES = [0.5, 1, 1.5, 2] as const

/** Window event dispatched on every engine state change. */
export const AUDIO_STATE_EVENT = 'wa-audio-state'

const RATE_STORAGE_KEY = 'wa-viewer:voice-rate'

function readStoredRateIdx(): number {
  if (typeof window === 'undefined') return 1
  try {
    const raw = window.localStorage.getItem(RATE_STORAGE_KEY)
    if (raw === null) return 1 // default 1× (0.5× stays opt-in via cycling)
    const n = Number(raw)
    return Number.isInteger(n) && n >= 0 && n < RATES.length ? n : 1
  } catch {
    return 1
  }
}

function writeStoredRateIdx(idx: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RATE_STORAGE_KEY, String(idx))
  } catch {
    /* storage unavailable — session-only persistence */
  }
}

// Chosen speed persists across tracks for the session + across reloads.
// SSR-SAFE: the initial STATE always renders the default (1×) on both
// server and client so hydration matches; the stored value is applied in
// a post-hydration task (a client-side re-render swaps the label right
// after mount). Reading it into the first render caused hydration
// mismatches when localStorage held a different index.
const INITIAL_RATE_IDX = 1

const INITIAL: AudioEngineState = {
  currentId: null,
  chatId: '',
  chatTitle: '',
  sender: '',
  src: '',
  playing: false,
  current: 0,
  duration: 0,
  rateIdx: INITIAL_RATE_IDX,
  savedAt: 0,
  failed: false,
}

let state: AudioEngineState = INITIAL
const listeners = new Set<() => void>()
let el: HTMLAudioElement | null = null
let rateIdx = INITIAL_RATE_IDX
/** Position write throttle — persist at most every 2s of playback. */
let lastSavedAt = 0
/** Only restore a saved position once per load of a given track. */
let resumedForId: string | null = null

// Apply the persisted speed once the app has hydrated (client only).
if (typeof window !== 'undefined') {
  const stored = readStoredRateIdx()
  if (stored !== INITIAL_RATE_IDX) {
    window.setTimeout(() => {
      rateIdx = stored
      setState({ rateIdx: stored })
    }, 0)
  }
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* a broken listener must not kill the rest */
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUDIO_STATE_EVENT))
  }
}

function setState(patch: Partial<AudioEngineState>): void {
  state = { ...state, ...patch }
  notify()
}

/** Create the single <audio> element on first use (client only). */
function getEl(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null
  if (el) return el
  el = new Audio()
  el.preload = 'metadata'
  el.addEventListener('loadedmetadata', () => {
    if (el && isFinite(el.duration)) setState({ duration: el.duration })
  })
  el.addEventListener('timeupdate', () => {
    if (!el) return
    setState({ current: el.currentTime })
    // Persist resume position at most every 2s of playback (idea #7).
    const now = Date.now()
    if (
      state.currentId &&
      el.currentTime > 0 &&
      isFinite(el.duration) &&
      el.currentTime < el.duration - 0.5 &&
      now - lastSavedAt > 2000
    ) {
      lastSavedAt = now
      setProgress(state.currentId, el.currentTime)
      setState({ savedAt: el.currentTime })
    }
  })
  el.addEventListener('play', () => setState({ playing: true }))
  el.addEventListener('pause', () => setState({ playing: false }))
  el.addEventListener('ended', () => {
    if (el) {
      try {
        el.currentTime = 0
      } catch {
        /* not seekable yet */
      }
    }
    // Finished → forget the resume point.
    if (state.currentId) clearProgress(state.currentId)
    resumedForId = null
    setState({ playing: false, current: 0, savedAt: 0 })
  })
  el.addEventListener('error', () => setState({ failed: true, playing: false }))
  return el
}

/** Current engine state (stable reference between changes — React-safe). */
export function getState(): AudioEngineState {
  return state
}

/** Subscribe to state changes. Returns an unsubscribe function. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/**
 * Make `meta` the active track (paused, at 0:00) and release any previous
 * track. No-op when this exact track is already active, so repeated calls
 * never reset the position of a playing/paused track.
 */
export function load(meta: AudioTrackMeta): void {
  const a = getEl()
  if (!a) return
  if (state.currentId === meta.id && state.src === meta.src) return
  try {
    a.pause()
  } catch {
    /* ignore */
  }
  // Persist the position of the track we're leaving (mid-flight switch).
  if (state.currentId && state.current > MIN_RESUME_SECONDS) {
    setProgress(state.currentId, state.current)
  }
  a.src = meta.src
  a.playbackRate = RATES[rateIdx]
  try {
    a.currentTime = 0
  } catch {
    /* metadata not loaded yet — starts at 0 anyway */
  }
  const saved = getProgress(meta.id)
  resumedForId = null
  lastSavedAt = Date.now()
  setState({
    currentId: meta.id,
    chatId: meta.chatId,
    chatTitle: meta.chatTitle,
    sender: meta.sender,
    src: meta.src,
    playing: false,
    current: 0,
    duration: 0,
    failed: false,
    rateIdx,
    savedAt: saved,
  })
}

/** Resume/play the active track. No-op when nothing is loaded. */
export function play(): void {
  const a = getEl()
  if (!a || !state.currentId || !state.src || state.failed) return
  a.playbackRate = RATES[state.rateIdx]
  // Resume-where-you-left (idea #7): the FIRST play of a freshly loaded
  // track jumps back to its saved position (only for meaningful spots —
  // >3s in and not already past it).
  if (
    state.savedAt > MIN_RESUME_SECONDS &&
    resumedForId !== state.currentId &&
    state.current < state.savedAt - 0.75
  ) {
    resumedForId = state.currentId
    try {
      a.currentTime = state.savedAt
      setState({ current: state.savedAt })
    } catch {
      /* metadata not loaded — currentTime settles once it is */
    }
  }
  a.play()
    .then(() => setState({ playing: true }))
    .catch(() => setState({ playing: false }))
}

/** Pause the active track. No-op when nothing is loaded. */
export function pause(): void {
  const a = getEl()
  if (!a || !state.currentId) return
  try {
    a.pause()
  } catch {
    /* ignore */
  }
  // Pausing is the classic resume checkpoint.
  if (state.current > MIN_RESUME_SECONDS) {
    setProgress(state.currentId, state.current)
    setState({ savedAt: state.current })
  }
  setState({ playing: false })
}

/** Play when paused, pause when playing. */
export function toggle(): void {
  if (state.playing) pause()
  else play()
}

/** Seek to a 0..1 ratio of the track (ignored while duration is unknown). */
export function seekRatio(ratio: number): void {
  const a = getEl()
  if (!a || !state.currentId) return
  const dur = isFinite(a.duration) ? a.duration : 0
  if (dur <= 0) return
  const t = Math.min(Math.max(ratio, 0), 1) * dur
  try {
    a.currentTime = t
  } catch {
    /* not seekable yet */
  }
  // A manual seek is the user's explicit choice of position.
  resumedForId = state.currentId
  if (t > MIN_RESUME_SECONDS) {
    setProgress(state.currentId, t)
    lastSavedAt = Date.now()
  }
  setState({ current: t, savedAt: t > MIN_RESUME_SECONDS ? t : 0 })
}

/** Seek relatively by ±seconds, clamped to the track. */
export function seekBy(seconds: number): void {
  const a = getEl()
  if (!a || !state.currentId) return
  const dur = (isFinite(a.duration) ? a.duration : 0) || state.duration
  if (dur <= 0) return
  seekRatio((state.current + seconds) / dur)
}

/** Cycle 0.5× → 1× → 1.5× → 2×. Applies now; persists across sessions. */
export function cycleRate(): void {
  rateIdx = (rateIdx + 1) % RATES.length
  writeStoredRateIdx(rateIdx)
  const a = el
  if (a) a.playbackRate = RATES[rateIdx]
  setState({ rateIdx })
}

/** Stop playback and clear the dock/state (element released for GC reuse). */
export function close(): void {
  const a = getEl()
  if (a) {
    try {
      a.pause()
      a.removeAttribute('src')
      a.load()
    } catch {
      /* ignore */
    }
  }
  // Keep the resume point when closing mid-track (chat switch / dock X).
  if (state.currentId && state.current > MIN_RESUME_SECONDS) {
    setProgress(state.currentId, state.current)
  }
  setState({
    currentId: null,
    chatId: '',
    chatTitle: '',
    sender: '',
    src: '',
    playing: false,
    current: 0,
    duration: 0,
    failed: false,
    savedAt: 0,
  })
}

/** m:ss formatter shared by the bubble player and the dock. */
export function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
