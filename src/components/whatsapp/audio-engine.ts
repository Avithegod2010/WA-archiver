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
 */

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
  /** Index into RATES — persists for the whole session across tracks. */
  rateIdx: number
  /** True when the media failed to load/play. */
  failed: boolean
}

/** Playback speeds, cycled by `cycleRate()` (1× → 1.5× → 2×). */
export const RATES = [1, 1.5, 2] as const

/** Window event dispatched on every engine state change. */
export const AUDIO_STATE_EVENT = 'wa-audio-state'

const INITIAL: AudioEngineState = {
  currentId: null,
  chatId: '',
  chatTitle: '',
  sender: '',
  src: '',
  playing: false,
  current: 0,
  duration: 0,
  rateIdx: 0,
  failed: false,
}

let state: AudioEngineState = INITIAL
const listeners = new Set<() => void>()
let el: HTMLAudioElement | null = null
/** Chosen speed persists across tracks for the whole session. */
let rateIdx = 0

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
    if (el) setState({ current: el.currentTime })
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
    setState({ playing: false, current: 0 })
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
  a.src = meta.src
  a.playbackRate = RATES[rateIdx]
  try {
    a.currentTime = 0
  } catch {
    /* metadata not loaded yet — starts at 0 anyway */
  }
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
  })
}

/** Resume/play the active track. No-op when nothing is loaded. */
export function play(): void {
  const a = getEl()
  if (!a || !state.currentId || !state.src || state.failed) return
  a.playbackRate = RATES[state.rateIdx]
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
  setState({ current: t })
}

/** Seek relatively by ±seconds, clamped to the track. */
export function seekBy(seconds: number): void {
  const a = getEl()
  if (!a || !state.currentId) return
  const dur = (isFinite(a.duration) ? a.duration : 0) || state.duration
  if (dur <= 0) return
  seekRatio((state.current + seconds) / dur)
}

/** Cycle 1× → 1.5× → 2×. Applies immediately and persists for the session. */
export function cycleRate(): void {
  rateIdx = (rateIdx + 1) % RATES.length
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
  })
}

/** m:ss formatter shared by the bubble player and the dock. */
export function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
