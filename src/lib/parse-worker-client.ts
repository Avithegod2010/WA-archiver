/**
 * W1 — main-thread client for `parse-worker.ts`.
 *
 * Runs the CPU-bound part of a device-mode import preview (WhatsApp text
 * parsing, and for .zip exports the ZIP listing + transcript decompression)
 * inside a Web Worker, with a graceful main-thread fallback:
 *
 *   • The worker is created lazily, ONCE (singleton). Creation failures
 *     (CSP, `file://`, missing Worker support) mark it permanently broken →
 *     every request falls back immediately.
 *   • Requests are promise-based and matched by id, with a 120 s timeout
 *     (timeout ⇒ the stuck worker is terminated; a fresh one is created for
 *     the next request — not treated as permanently broken).
 *   • A crashing worker (script load error / runtime error / clone error)
 *     rejects every pending request; after repeated hard errors the worker
 *     is marked broken for the session.
 *   • `parseExportFile` — the single entry point used by ImportPanel —
 *     catches ANY failure (no Worker, timeout, crash, worker error response)
 *     and transparently re-runs the ORIGINAL main-thread code path
 *     (`previewDeviceImport` from src/lib/data/local/import.ts), so behavior
 *     is byte-identical to pre-worker builds whenever the worker can't help.
 *
 * ── Threading boundary (W1 contract) ────────────────────────────────────────
 *   In the worker: text parsing + ZIP listing/reading of .txt entries +
 *   media-candidate census (metadata only).
 *   On THIS thread: `file.arrayBuffer()`, everything inside
 *   `commitDeviceImport` — media extraction (JSZip blob → IndexedDB media
 *   store) and SQLite writes — because workers have no DOM/IndexedDB. The
 *   ZIP is re-opened there from the kept `File` exactly as before, so the
 *   media path is untouched. The summary census (`summarizeExport` below)
 *   is replicated from import.ts's private `summarize` (this file may not
 *   edit that module) — keep the two in sync.
 * ────────────────────────────────────────────────────────────────────────────
 */

import {
  guessTitleFromFilename,
  type MessageType,
  type ParseResult,
} from './whatsapp-parser'
import {
  LocalImportError,
  previewDeviceImport,
  type ImportPreviewData,
  type ImportPreviewSummary,
  type LocalImportProgress,
} from '@/lib/data/local/import'
import type {
  ParseTextOk,
  ParseTextRequest,
  ParseWorkerResponse,
  ParseZipEntryResult,
  ParseZipOk,
  ParseZipRequest,
} from './parse-worker'

// ---- Guards replicated from src/lib/data/local/import.ts (keep in sync) ----
const MAX_FILE_BYTES = 400 * 1024 * 1024
const MAX_TXT_BYTES = 20 * 1024 * 1024

/** Per-request timeout — generous; huge exports parse in seconds, not minutes. */
const PARSE_TIMEOUT_MS = 120_000
/** Hard errors (crash/creation) tolerated before the worker is shelved. */
const MAX_CONSECUTIVE_FAILURES = 2

let workerInstance: Worker | null = null
let consecutiveFailures = 0
let workerBroken = false
let nextRequestId = 1

interface PendingRequest {
  resolve: (msg: ParseTextOk | ParseZipOk) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<number, PendingRequest>()

function killWorker(worker: Worker): void {
  try {
    worker.terminate()
  } catch {
    /* already dead */
  }
}

/** Terminate the current instance; the next request lazily recreates it. */
function recycleWorker(): void {
  if (workerInstance) {
    killWorker(workerInstance)
    workerInstance = null
  }
}

/**
 * A hard worker error (script failed to load, uncaught exception inside the
 * worker, reply failed to deserialize): reject everything pending so callers
 * fall back immediately, recreate on the next request, and after repeated
 * failures stop trying for this session.
 */
function handleWorkerCrash(): void {
  recycleWorker()
  consecutiveFailures += 1
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) workerBroken = true
  for (const entry of pending.values()) {
    clearTimeout(entry.timer)
    entry.reject(new Error('Parse worker crashed — falling back to the main thread.'))
  }
  pending.clear()
}

/**
 * Lazy singleton. Returns `null` when workers can't be used (SSR pass,
 * missing support, CSP/file:// restrictions, or repeated past failures) —
 * callers then use the main-thread path.
 */
function getWorker(): Worker | null {
  if (workerBroken) return null
  if (workerInstance) return workerInstance
  if (typeof Worker === 'undefined') {
    workerBroken = true
    return null
  }
  try {
    // Standard bundler-compatible worker syntax: webpack AND turbopack
    // rewrite this to the emitted worker chunk, and the asset URL inherits
    // the deployed base (works under `basePath` static export and inside
    // the Capacitor shell). If the chunk 404s, `onerror` → graceful
    // main-thread fallback below.
    const worker = new Worker(new URL('./parse-worker.ts', import.meta.url))
    worker.onmessage = (ev: MessageEvent<ParseWorkerResponse>) => {
      const msg = ev.data
      const entry = msg ? pending.get(msg.id) : undefined
      if (!entry) return
      pending.delete(msg.id)
      clearTimeout(entry.timer)
      if (msg.ok) {
        consecutiveFailures = 0 // any success resets the failure streak
        entry.resolve(msg)
      } else {
        entry.reject(new Error(msg.error || 'Parse worker reported a failure.'))
      }
    }
    worker.onerror = () => handleWorkerCrash()
    worker.onmessageerror = () => handleWorkerCrash()
    workerInstance = worker
    return worker
  } catch {
    // Worker construction threw — permanent fallback for this session.
    workerBroken = true
    return null
  }
}

/** Send one request, resolve with the ok-response, reject on error/timeout. */
function requestRaw(
  send: (worker: Worker, id: number) => void
): Promise<ParseTextOk | ParseZipOk> {
  return new Promise((resolve, reject) => {
    const worker = getWorker()
    if (!worker) {
      reject(new Error('Parse worker unavailable.'))
      return
    }
    const id = nextRequestId++
    const timer = setTimeout(() => {
      pending.delete(id)
      // Possibly stuck mid-parse — terminate so the next request starts
      // fresh. NOT marked permanently broken: a timeout can legitimately
      // happen for a gigantic export, and the fallback re-runs the work.
      recycleWorker()
      reject(
        new Error(`Parse worker timed out after ${PARSE_TIMEOUT_MS / 1000}s.`)
      )
    }, PARSE_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    try {
      send(worker, id)
    } catch (err) {
      pending.delete(id)
      clearTimeout(timer)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

/** Parse a plain-text transcript in the worker. Rejects on any failure. */
export async function requestParseText(
  fileName: string,
  text: string
): Promise<ParseResult> {
  const msg = await requestRaw((worker, id) =>
    worker.postMessage({ id, type: 'parse-text', fileName, text } satisfies ParseTextRequest)
  )
  if ('result' in msg) return msg.result
  throw new Error('Unexpected parse worker response for parse-text.')
}

/**
 * Parse a .zip export in the worker (listing + transcript extraction +
 * parse). The buffer is TRANSFERRED (zero-copy) and detached afterwards —
 * callers must not reuse it (fallbacks re-read the File instead).
 */
export async function requestParseZip(
  fileName: string,
  buffer: ArrayBuffer
): Promise<ParseZipEntryResult[]> {
  const msg = await requestRaw((worker, id) =>
    worker.postMessage(
      { id, type: 'parse-zip', fileName, buffer } satisfies ParseZipRequest,
      [buffer]
    )
  )
  if ('results' in msg) return msg.results
  throw new Error('Unexpected parse worker response for parse-zip.')
}

/**
 * Summary census — replicated from the private `summarize` in
 * src/lib/data/local/import.ts (byte-for-byte; keep in sync) so the worker
 * path produces an identical ImportPreviewSummary.
 */
function summarizeExport(
  file: File,
  parsed: ParseResult,
  title: string,
  media: { candidates: number; bytes: number }
): ImportPreviewSummary {
  const senders = new Map<string, number>()
  const types = new Map<MessageType, number>()
  let systemCount = 0
  let firstAt = ''
  let lastAt = ''

  for (const m of parsed.messages) {
    if (m.sender === null) {
      systemCount += 1
    } else {
      senders.set(m.sender, (senders.get(m.sender) ?? 0) + 1)
    }
    types.set(m.type, (types.get(m.type) ?? 0) + 1)
    const at = m.ts.getTime()
    if (Number.isFinite(at)) {
      if (!firstAt || at < Date.parse(firstAt)) firstAt = m.ts.toISOString()
      if (!lastAt || at > Date.parse(lastAt)) lastAt = m.ts.toISOString()
    }
  }

  return {
    fileName: file.name,
    title,
    isGroup: parsed.isGroup,
    totalMessages: parsed.messages.length,
    firstAt,
    lastAt,
    senders: [...senders.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    systemCount,
    typeCounts: [...types.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    mediaCandidates: media.candidates,
    mediaCandidatesBytes: media.bytes,
  }
}

/**
 * Unified device-import PREVIEW parse: .txt vs .zip is detected from the
 * extension (mirroring the main-thread detection), the CPU-bound parse runs
 * in the worker when available, and ANY failure falls back to the original
 * main-thread `previewDeviceImport` — the exact code path ImportPanel used
 * before W1 — so errors and results stay identical.
 *
 * Returns the same `ImportPreviewData` as `previewDeviceImport`; the commit
 * phase (selection filters, merge/dedup, media extraction) is untouched.
 */
export async function parseExportFile(
  file: File,
  opts: {
    onProgress?: (p: LocalImportProgress) => void
  } = {}
): Promise<ImportPreviewData> {
  // Deterministic guards mirror previewDeviceImport (same messages, same
  // order) so the error surface is unchanged whether or not a worker runs.
  if (file.size > MAX_FILE_BYTES) {
    throw new LocalImportError('File too large (max 400 MB).')
  }
  const isZip = /\.zip$/i.test(file.name)
  const isTxt = /\.txt$/i.test(file.name)
  if (!isZip && !isTxt) {
    throw new LocalImportError(
      'Unsupported file type. Upload a WhatsApp export (.zip or .txt).'
    )
  }

  try {
    opts.onProgress?.({ phase: 'reading', processed: 0, total: 0 })
    const buf = await file.arrayBuffer()

    if (isTxt) {
      if (file.size > MAX_TXT_BYTES) {
        throw new LocalImportError(
          'Chat transcript too large (max 20 MB uncompressed).'
        )
      }
      opts.onProgress?.({ phase: 'parsing', processed: 0, total: 0 })
      const text = new TextDecoder().decode(buf)
      const parsed = await requestParseText(file.name, text)
      const title = guessTitleFromFilename(file.name)
      return {
        parsed,
        file,
        summary: summarizeExport(file, parsed, title, {
          candidates: 0,
          bytes: 0,
        }),
      }
    }

    // ---- .zip export (transferred buffer is detached after this call) ----
    opts.onProgress?.({ phase: 'parsing', processed: 0, total: 0 })
    const results = await requestParseZip(file.name, buf)
    const entry = results[0]
    if (!entry) {
      throw new Error('Parse worker returned no transcript for the ZIP.')
    }
    const title =
      guessTitleFromFilename(entry.txtName) || guessTitleFromFilename(file.name)
    return {
      parsed: entry.parsed,
      file,
      summary: summarizeExport(file, entry.parsed, title, {
        candidates: entry.mediaCandidates,
        bytes: entry.mediaCandidatesBytes,
      }),
    }
  } catch {
    // Worker missing/unavailable, timeout, crash, or an error response —
    // transparently re-run the original main-thread path (which also throws
    // the canonical LocalImportError for genuinely bad exports).
    return previewDeviceImport(file, opts)
  }
}
