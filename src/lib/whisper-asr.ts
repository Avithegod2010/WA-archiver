'use client'

import { assetUrl } from '@/lib/asset-base'

/**
 * On-device speech-to-text (Phase 4 — offline polish).
 *
 * Runs OpenAI's Whisper (tiny, quantized, multilingual) fully in the browser
 * via transformers.js + ONNX Runtime WebAssembly — no server, no API key.
 * In the standalone APK this makes voice-note transcription work with zero
 * internet, closing the one feature the device transport was missing.
 *
 * Runtime loading follows the same bundler-free pattern as the SQLite WASM
 * engine (src/lib/data/local/engine.ts): scripts/copy-whisper.mjs vendors
 * the prebuilt transformers.js ES module + ORT wasm binaries into
 * public/whisper/ and this module injects a <script type="module"> lazily,
 * the first time ASR is actually used. Nothing is downloaded until then.
 *
 * Model files (~45 MB, one time) come from the Hugging Face CDN and are kept
 * by the browser Cache API; after the first download everything works
 * offline. Transcripts are cached in localStorage per message id.
 *
 * Note on imports: @xenova/transformers stays a devDependency-style vendor
 * asset — the types below describe the small surface this module uses.
 */

// ---- Public surface --------------------------------------------------------

export const ASR_MODEL_ID = 'Xenova/whisper-tiny'
/** Rough total download size of the quantized tiny model (shown in the UI). */
export const ASR_MODEL_MB = 45

export interface AsrProgress {
  phase: 'download' | 'transcribing'
  /** 0..100, only meaningful while downloading model files. */
  pct?: number
}

/** True once the model has been fully downloaded at least once. */
export function asrModelReady(): boolean {
  try {
    return localStorage.getItem(READY_KEY) === '1'
  } catch {
    return false
  }
}

/** Cached transcript for a message id, or null. */
export function cachedTranscript(messageId: string): string | null {
  try {
    const raw = localStorage.getItem(TRANSCRIPT_PREFIX + messageId)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'string' && parsed.trim() ? parsed : null
  } catch {
    return null
  }
}

/** Drop every cached transcript (model files are unaffected). */
export function clearTranscriptCache(): number {
  let n = 0
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(TRANSCRIPT_PREFIX)) keys.push(k)
    }
    for (const k of keys) {
      localStorage.removeItem(k)
      n++
    }
  } catch {
    /* storage unavailable */
  }
  return n
}

/**
 * Download the ASR model now (Settings button). Resolves when the pipeline
 * is ready; throws a user-friendly Error on failure. Concurrent calls share
 * one pipeline build.
 */
export async function prepareAsrModel(
  onProgress?: (p: AsrProgress) => void
): Promise<void> {
  await getPipeline(onProgress)
}

/** Remove the downloaded model files + readiness flag. */
export async function resetAsrModel(): Promise<void> {
  pipelinePromise = null
  try {
    localStorage.removeItem(READY_KEY)
  } catch {
    /* ignore */
  }
  try {
    if (typeof caches !== 'undefined') {
      // transformers.js v2 caches model files under this Cache-API bucket.
      await caches.delete('transformers-cache')
    }
  } catch {
    /* cache API unavailable */
  }
}

/**
 * Transcribe a voice-note blob on this device. The model is downloaded on
 * first use (~45 MB); later runs are fully offline. Results are cached in
 * localStorage under the message id.
 */
export async function transcribeAudio(
  blob: Blob,
  opts?: { messageId?: string; onProgress?: (p: AsrProgress) => void }
): Promise<string> {
  const messageId = opts?.messageId
  if (messageId) {
    const hit = cachedTranscript(messageId)
    if (hit !== null) return hit
  }

  // Serialize: the WASM pipeline is heavy — run one transcription at a time.
  const run = queueTail.then(async () => {
    const onProgress = opts?.onProgress
    onProgress?.({ phase: 'download', pct: asrModelReady() ? 100 : 0 })

    const pcm = await decodeTo16kMono(blob)
    onProgress?.({ phase: 'transcribing' })

    const asr = await getPipeline((p) => onProgress?.(p))
    let out: { text?: string } | Array<{ text?: string }>
    try {
      out = (await asr(pcm, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
      })) as { text?: string } | Array<{ text?: string }>
    } catch (err) {
      throw new Error(runningError(err))
    }

    const text = String(
      (Array.isArray(out) ? out[0]?.text : out?.text) ?? ''
    ).trim()
    // Non-speech audio (tones, silence) — require a letter or digit.
    if (!text || !/\p{L}|\p{N}/u.test(text)) {
      throw new Error('No speech detected in this voice note')
    }
    const trimmed = text.slice(0, TRANSCRIPT_MAX_CHARS)
    if (messageId) storeTranscript(messageId, trimmed)
    return trimmed
  })
  // Keep the queue alive even if this run fails; the caller gets the real
  // result (errors included) from `run` itself.
  queueTail = run.catch(() => undefined)
  return run
}

// ---- Module internals ------------------------------------------------------

const READY_KEY = 'wa-viewer:asr-ready'
const TRANSCRIPT_PREFIX = 'wa-viewer:transcript:'
const TRANSCRIPT_MAX_CHARS = 20_000
const TRANSCRIPT_MAX_ENTRIES = 300
const TRANSFORMERS_URL = assetUrl('/whisper/transformers.min.js')
const WASM_DIR = assetUrl('/whisper/')

/** Minimal typing of the vendored transformers.js surface we use. */
interface TransformersModule {
  env: {
    allowLocalModels: boolean
    backends: {
      onnx: { wasm: { wasmPaths: string; numThreads: number } }
    }
  }
  pipeline: (
    task: string,
    model: string,
    opts?: Record<string, unknown>
  ) => Promise<AsrPipeline>
}
type AsrPipeline = (
  audio: Float32Array,
  opts?: Record<string, unknown>
) => Promise<{ text?: string } | Array<{ text?: string }>>

declare global {
  interface Window {
    __waTransformers?: TransformersModule
  }
}

let pipelinePromise: Promise<AsrPipeline> | null = null
/** Serialized transcription runs (the WASM pipeline is single-instance). */
let queueTail: Promise<unknown> = Promise.resolve()
const runningError = (err: unknown) =>
  err instanceof Error && err.message
    ? err.message
    : 'Transcription failed on this device'

function storeTranscript(messageId: string, text: string): void {
  try {
    localStorage.setItem(
      TRANSCRIPT_PREFIX + messageId,
      JSON.stringify(text.slice(0, TRANSCRIPT_MAX_CHARS))
    )
    pruneTranscripts()
  } catch {
    /* storage unavailable */
  }
}

/** Keep at most TRANSCRIPT_MAX_ENTRIES cached transcripts (oldest out). */
function pruneTranscripts(): void {
  try {
    const entries: { key: string; ts: number }[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(TRANSCRIPT_PREFIX)) continue
      let ts = 0
      try {
        const v = JSON.parse(localStorage.getItem(k) ?? '""') as unknown
        if (typeof v === 'string') ts = v.length
      } catch {
        /* unreadable — treat as oldest */
      }
      entries.push({ key: k, ts })
    }
    if (entries.length <= TRANSCRIPT_MAX_ENTRIES) return
    entries.sort((a, b) => a.ts - b.ts)
    for (const e of entries.slice(0, entries.length - TRANSCRIPT_MAX_ENTRIES)) {
      localStorage.removeItem(e.key)
    }
  } catch {
    /* ignore */
  }
}

// ---- transformers.js loader (script-tag pattern, like sql.js) --------------

let transformersPromise: Promise<TransformersModule> | null = null

function loadTransformers(): Promise<TransformersModule> {
  if (window.__waTransformers) return Promise.resolve(window.__waTransformers)
  if (transformersPromise) return transformersPromise

  transformersPromise = new Promise<TransformersModule>((resolve, reject) => {
    const done = (err?: Error) => {
      window.removeEventListener('wa-transformers-ready', onReady)
      window.removeEventListener('wa-transformers-error', onError)
      if (err) reject(err)
      else if (window.__waTransformers) resolve(window.__waTransformers)
      else reject(new Error('The transcription engine failed to load'))
    }
    const onReady = () => done()
    const onError = () =>
      done(new Error('The transcription engine failed to load'))
    window.addEventListener('wa-transformers-ready', onReady, { once: true })
    window.addEventListener('wa-transformers-error', onError, { once: true })

    // Inline module script: imports the vendored ES module and publishes it
    // on window. No bundler involvement — same-origin static asset, so it
    // works identically in dev, production and the Capacitor APK shell.
    const s = document.createElement('script')
    s.type = 'module'
    s.textContent = `
      try {
        const t = await import(${JSON.stringify(TRANSFORMERS_URL)});
        window.__waTransformers = t;
        window.dispatchEvent(new Event('wa-transformers-ready'));
      } catch (e) {
        window.dispatchEvent(new Event('wa-transformers-error'));
      }
    `
    s.onerror = onError
    document.head.appendChild(s)
  }).catch((err) => {
    transformersPromise = null // allow a retry on the next attempt
    throw err
  })
  return transformersPromise
}

// ---- Pipeline singleton with download progress -----------------------------

/** Bytes-based download progress across all model files. */
class DownloadTracker {
  private files = new Map<string, { loaded: number; total: number }>()

  update(file: string, loaded: number, total: number): number | undefined {
    if (!total) return undefined
    this.files.set(file, { loaded, total })
    let sumLoaded = 0
    let sumTotal = 0
    for (const f of this.files.values()) {
      sumLoaded += f.loaded
      sumTotal += f.total
    }
    return sumTotal > 0 ? Math.min(Math.round((sumLoaded / sumTotal) * 100), 100) : undefined
  }
}

function getPipeline(
  onProgress?: (p: AsrProgress) => void
): Promise<AsrPipeline> {
  if (pipelinePromise) return pipelinePromise
  pipelinePromise = (async () => {
    const t = await loadTransformers()
    // Runtime config: our own wasm copies, single-threaded (no
    // SharedArrayBuffer — the app is not cross-origin isolated).
    t.env.allowLocalModels = false
    t.env.backends.onnx.wasm.wasmPaths = WASM_DIR
    t.env.backends.onnx.wasm.numThreads = 1

    const tracker = new DownloadTracker()
    const built = await t.pipeline('automatic-speech-recognition', ASR_MODEL_ID, {
      quantized: true,
      progress_callback: (p: {
        status?: string
        file?: string
        loaded?: number
        total?: number
      }) => {
        if (p.status === 'progress' && p.file && typeof p.total === 'number') {
          const pct = tracker.update(
            p.file,
            typeof p.loaded === 'number' ? p.loaded : 0,
            p.total
          )
          if (pct !== undefined) onProgress?.({ phase: 'download', pct })
        }
      },
    })
    // The pipeline is usable — every model file is in the browser cache.
    // (Progress events alone can't be relied on: a cached model may produce
    // none at all.) Marking ready here also lets the UI skip the download
    // phase on every later run.
    try {
      localStorage.setItem(READY_KEY, '1')
    } catch {
      /* ignore */
    }
    return built
  })().catch((err) => {
    pipelinePromise = null // allow a retry
    throw new Error(downloadError(err))
  })
  return pipelinePromise
}

function downloadError(err: unknown): string {
  // The overwhelming cause: model files not reachable (offline, first run).
  if (!asrModelReady() && !navigator.onLine) {
    return (
      "The voice model isn't downloaded yet — connect to the internet once " +
      `(~${ASR_MODEL_MB} MB), then transcription works fully offline.`
    )
  }
  if (!asrModelReady()) {
    return (
      'Could not download the voice model — check your connection and try ' +
      'again. It is a one-time download, then everything works offline.'
    )
  }
  return err instanceof Error && err.message
    ? err.message
    : 'Transcription failed on this device'
}

// ---- Audio decoding → 16 kHz mono Float32 ----------------------------------

async function decodeTo16kMono(blob: Blob): Promise<Float32Array> {
  const TARGET = 16_000
  const buf = await blob.arrayBuffer()

  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!Ctx) {
    throw new Error('Audio decoding is not supported on this device')
  }

  // 1) decode to an AudioBuffer (context rate, e.g. 48 kHz, any channels)
  const decodeCtx = new Ctx()
  let decoded: AudioBuffer
  try {
    decoded = await decodeCtx.decodeAudioData(buf)
  } catch {
    throw new Error(
      "This voice note's audio format can't be decoded on this device"
    )
  } finally {
    void decodeCtx.close().catch(() => undefined)
  }

  // 2) downmix + resample to 16 kHz mono via an offline render
  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET))
  const OfflineCtx =
    window.OfflineAudioContext ??
    (
      window as unknown as {
        webkitOfflineAudioContext?: typeof OfflineAudioContext
      }
    ).webkitOfflineAudioContext
  if (!OfflineCtx) {
    throw new Error('Audio decoding is not supported on this device')
  }
  const off = new OfflineCtx(1, frames, TARGET)
  const src = off.createBufferSource()
  src.buffer = decoded
  src.connect(off.destination)
  src.start()
  const rendered = await off.startRendering()
  return rendered.getChannelData(0)
}
