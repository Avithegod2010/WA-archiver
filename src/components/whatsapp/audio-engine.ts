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
 *
 * Real waveforms (Task A2):
 *   - `requestPeaks()` lazily decodes a track to WAVE_PEAK_COUNT normalized
 *     amplitude buckets (fetch → AudioContext.decodeAudioData → mono
 *     downmix → max-abs per bucket → normalize with a floor), serialized so
 *     at most ONE decode runs at a time, and LRU-cached (50 entries) at
 *     module scope so decoded peaks survive mount/unmount of bubbles.
 *   - VoicePlayer renders those peaks once available and keeps its
 *     deterministic pseudo-random bars while decoding or on failure
 *     (e.g. codecs Safari can't decode) — seek/aria/keyboard are unchanged.
 *   - Stale-decode protection lives at the delivery site: VoicePlayer bumps
 *     a generation counter when its src changes and drops results from a
 *     superseded generation. (A module-global counter would wrongly drop
 *     concurrent decodes for several visible tracks; completed decodes are
 *     always cached, so the work is never wasted.)
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

// ---------------------------------------------------------------------------
// Real waveform peaks (Task A2) — lazy amplitude decoder
//
// Pipeline: fetch(media src) → arrayBuffer → AudioContext.decodeAudioData →
// downmix to mono → WAVE_PEAK_COUNT max-abs buckets → normalize 0..1 with a
// small floor (so silent tracks still render). Everything here is
// best-effort: any failure resolves `null` and the UI keeps its fallback
// bars. This section never touches playback — the single <audio> above is
// the only thing that plays sound.
// ---------------------------------------------------------------------------

/**
 * Peak buckets produced by the amplitude decoder. The VoicePlayer renders
 * 26 bars and maps these buckets onto them (group-max), so the on-screen
 * layout never changes; 48 leaves headroom for other consumers.
 */
export const WAVE_PEAK_COUNT = 48

/** Normalized peak buckets (0..1) for one track; index 0 = track start. */
export type WavePeaks = readonly number[]

/** Cache entries kept before the oldest one is evicted. */
const PEAKS_CACHE_MAX = 50

/** Minimum normalized peak after scaling — keeps silent stretches visible. */
const PEAKS_FLOOR = 0.08

/**
 * LRU cache of decoded peaks, keyed by the media URL (`src`). Module-level
 * by design: results survive bubble mount/unmount and are shared by every
 * VoicePlayer. A Map keeps insertion order, so evicting the "oldest" entry
 * is deleting the first key; reads re-insert to refresh recency.
 */
const peaksCache = new Map<string, WavePeaks>()

/** In-flight decodes by src — dedupes concurrent requests for one track. */
const peaksInFlight = new Map<string, Promise<WavePeaks | null>>()

/**
 * Tail of the decode chain — every new decode waits on the previous one,
 * guaranteeing at most one track decodes at a time (decodeAudioData is
 * native and CPU-bound; serializing keeps scroll jank away).
 */
let peaksDecodeTail: Promise<unknown> = Promise.resolve()

type AudioCtxCtor = new () => AudioContext

/**
 * One shared, lazily created AudioContext used ONLY for decoding. A
 * suspended context still decodes — no user gesture is required, and on
 * iOS Safari decodeAudioData on a plain AudioContext is fine. Falls back
 * through the legacy webkit prefix and OfflineAudioContext.
 */
let sharedAudioCtx: AudioContext | null = null

function getSharedAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (sharedAudioCtx) return sharedAudioCtx
  try {
    const w = window as unknown as {
      AudioContext?: AudioCtxCtor
      webkitAudioContext?: AudioCtxCtor
      OfflineAudioContext?: AudioCtxCtor
    }
    const Ctor = w.AudioContext ?? w.webkitAudioContext ?? w.OfflineAudioContext
    if (!Ctor) return null
    sharedAudioCtx = new Ctor()
  } catch {
    sharedAudioCtx = null
  }
  return sharedAudioCtx
}

/**
 * decodeAudioData via the callback form — older iOS Safari doesn't support
 * the promise overload. Modern engines return a promise TOO; its rejection
 * is swallowed so the callback path stays the single source of failure.
 */
function decodeWithCallbacks(ctx: AudioContext, buf: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    const p = ctx.decodeAudioData(
      buf,
      (decoded: AudioBuffer) => resolve(decoded),
      (err: DOMException) =>
        reject(err instanceof Error ? err : new Error('decodeAudioData failed'))
    )
    if (p && typeof p.catch === 'function') p.catch(() => undefined)
  })
}

/**
 * Downmix an AudioBuffer to mono and reduce it to `bucketCount` peak
 * buckets: max |sample| per bucket (channel-averaged), then normalize to
 * 0..1 by the global max with a small floor so near-silent tracks still
 * render visible bars. Very long files are scanned with a stride — this is
 * visualization, not analysis, so a strided max is visually identical while
 * keeping decode time bounded.
 */
function extractPeaks(audio: AudioBuffer, bucketCount: number): number[] {
  const peaks = new Array<number>(bucketCount).fill(0)
  const len = audio.length
  if (len === 0) return peaks
  const chans = audio.numberOfChannels
  const data: Float32Array[] = []
  for (let c = 0; c < chans; c++) data.push(audio.getChannelData(c))
  const per = len / bucketCount
  const stride = Math.max(1, Math.floor(per / 8192))
  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor(b * per)
    const end = Math.min(len, Math.ceil((b + 1) * per))
    let max = 0
    for (let i = start; i < end; i += stride) {
      let v = 0
      for (let c = 0; c < chans; c++) v += data[c][i]
      v /= chans // downmix: average channels to mono
      const a = v < 0 ? -v : v
      if (a > max) max = a
    }
    peaks[b] = max
  }
  let top = 0
  for (const v of peaks) if (v > top) top = v
  const scale = top > 0 ? 1 / top : 0
  return peaks.map((v) => {
    const n = v * scale
    return n < PEAKS_FLOOR ? PEAKS_FLOOR : n > 1 ? 1 : n
  })
}

function cachePeaks(src: string, peaks: WavePeaks): void {
  peaksCache.delete(src) // re-inserted below → refreshes LRU recency
  peaksCache.set(src, peaks)
  if (peaksCache.size > PEAKS_CACHE_MAX) {
    const oldest = peaksCache.keys().next()
    if (!oldest.done) peaksCache.delete(oldest.value)
  }
}

/** Cached peaks for `src`, or null when not decoded (yet). Never decodes. */
export function getCachedPeaks(src: string): WavePeaks | null {
  return peaksCache.get(src) ?? null
}

/**
 * Decode (or fetch from cache) the normalized peak buckets for the media at
 * `src`. Resolves null on ANY failure (network, unsupported codec, no Web
 * Audio) — callers keep their fallback bars. Safe to call repeatedly:
 * cached results resolve instantly and in-flight decodes are deduped.
 */
export function requestPeaks(src: string): Promise<WavePeaks | null> {
  if (typeof window === 'undefined' || !src) return Promise.resolve(null)
  const hit = peaksCache.get(src)
  if (hit) {
    peaksCache.delete(src)
    peaksCache.set(src, hit) // LRU refresh on read
    return Promise.resolve(hit)
  }
  const inFlight = peaksInFlight.get(src)
  if (inFlight) return inFlight

  const task: Promise<WavePeaks | null> = peaksDecodeTail.then(
    async (): Promise<WavePeaks | null> => {
      try {
        // Another caller may have filled the cache while we were queued.
        const raced = peaksCache.get(src)
        if (raced) return raced
        const res = await fetch(src)
        if (!res.ok) return null
        const buf = await res.arrayBuffer()
        const ctx = getSharedAudioCtx()
        if (!ctx) return null
        const decoded = await decodeWithCallbacks(ctx, buf)
        const peaks = extractPeaks(decoded, WAVE_PEAK_COUNT)
        cachePeaks(src, peaks)
        return peaks
      } catch {
        // Unsupported codec (e.g. OGG/Opus on old iOS), network error, …
        return null
      } finally {
        peaksInFlight.delete(src)
      }
    }
  )
  // Keep the serialization chain alive no matter what.
  peaksDecodeTail = task.then(
    () => undefined,
    () => undefined
  )
  peaksInFlight.set(src, task)
  return task
}
