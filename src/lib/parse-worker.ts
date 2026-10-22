/**
 * W1 — Web Worker: WhatsApp transcript parsing off the main thread.
 *
 * Device-mode imports used to run `parseWhatsAppText` (and the ZIP listing +
 * transcript decompression for .zip exports) on the main thread, freezing the
 * UI for large exports. This worker owns the CPU-bound part of the PREVIEW
 * phase only.
 *
 * ── Threading boundary (W1 contract) ────────────────────────────────────────
 *   MOVES to this worker:  text parsing (`parseWhatsAppText`), ZIP opening +
 *   entry listing + transcript (.txt) entry decompression, media-candidate
 *   census (count/bytes — metadata only, nothing is decompressed).
 *   STAYS on the main thread: File → ArrayBuffer reading, everything in
 *   `commitDeviceImport` — media extraction (JSZip `entry.async('blob')` →
 *   IndexedDB via the media store) and all SQLite writes — because those need
 *   DOM/IndexedDB access that workers don't have. See parse-worker-client.ts.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Protocol (request → response, matched by `id`):
 *   { id, type: 'parse-text', fileName, text }   → { id, ok: true, result: ParseResult }
 *                                                  | { id, ok: false, error }
 *   { id, type: 'parse-zip',  fileName, buffer } → { id, ok: true, results: [...] }
 *                                                  | { id, ok: false, error }
 *
 * `results` is an array of { txtName, parsed, mediaCandidates,
 * mediaCandidatesBytes }. Entry selection replicates the main-thread rules
 * (pickChatTxtEntry in src/lib/data/local/import.ts) which pick ONE
 * transcript entry per export, so the array currently always holds exactly
 * one element; the array shape keeps the protocol open for multi-transcript
 * archives without a breaking change.
 *
 * No DOM access here: the parser is pure and JSZip runs fine on typed arrays.
 * Responses are plain structured-cloneable data (ParseResult carries Date
 * objects, which clone natively), so no transfer list is needed on replies.
 */

import JSZip from 'jszip'
import { parseWhatsAppText, type ParseResult } from './whatsapp-parser'

// ---- Guards replicated from src/lib/data/local/import.ts (keep in sync) ----
/** Max uncompressed size of the transcript entry inside a ZIP. */
const MAX_TXT_BYTES = 20 * 1024 * 1024
/** Cap for the media-candidate count reported in the preview summary. */
const MAX_MEDIA_FILES = 2000

// ---- Protocol types (imported type-only by parse-worker-client.ts) ---------

export interface ParseTextRequest {
  id: number
  type: 'parse-text'
  fileName: string
  /** Decoded transcript content (client does `TextDecoder().decode`). */
  text: string
}

export interface ParseZipRequest {
  id: number
  type: 'parse-zip'
  fileName: string
  /** Raw ZIP bytes; transferred (not copied) from the client. */
  buffer: ArrayBuffer
}

export type ParseWorkerRequest = ParseTextRequest | ParseZipRequest

/** One parsed transcript entry from a ZIP export. */
export interface ParseZipEntryResult {
  /** ZIP-internal path of the transcript entry (client derives the title). */
  txtName: string
  parsed: ParseResult
  /** Non-transcript entries the chat could reference (capped, count only). */
  mediaCandidates: number
  /** Their combined uncompressed size (metadata from the central directory). */
  mediaCandidatesBytes: number
}

export interface ParseTextOk {
  id: number
  ok: true
  result: ParseResult
}

export interface ParseZipOk {
  id: number
  ok: true
  results: ParseZipEntryResult[]
}

export interface ParseWorkerError {
  id: number
  ok: false
  error: string
}

export type ParseWorkerResponse = ParseTextOk | ParseZipOk | ParseWorkerError

/**
 * Minimal DedicatedWorkerGlobalScope surface we need, declared locally so the
 * file type-checks under the app's DOM lib without pulling in
 * `lib.webworker` (which conflicts with DOM declarations).
 */
interface WorkerScopeLike {
  postMessage(message: ParseWorkerResponse, transfer?: Transferable[]): void
  addEventListener(
    type: 'message',
    listener: (ev: MessageEvent<ParseWorkerRequest>) => void
  ): void
}

const ctx = self as unknown as WorkerScopeLike

// ---- Entry-selection logic replicated from src/lib/data/local/import.ts ----

/** Pick the chat transcript entry — same preference rules as the main thread. */
function pickChatTxtEntry(names: string[]): string | null {
  const txts = names.filter((n) => /\.txt$/i.test(n))
  if (txts.length === 0) return null
  const base = (n: string) => n.split('/').pop() ?? n
  const preferred =
    txts.find((n) => /^whatsapp chat/i.test(base(n))) ??
    txts.find((n) => base(n) === '_chat.txt')
  return preferred ?? txts[0]
}

function entrySize(entry: JSZip.JSZipObject): number {
  const d = (
    entry as unknown as { _data?: { uncompressedSize?: number } }
  )._data
  return typeof d?.uncompressedSize === 'number' ? d.uncompressedSize : -1
}

// ---- Parse implementations --------------------------------------------------

/**
 * Open a ZIP export, locate + decompress the transcript entry and parse it.
 * Only the ONE .txt entry is decompressed (≤ MAX_TXT_BYTES, checked via the
 * central directory before inflate) — media entries are never touched here,
 * the main thread re-opens the ZIP for them during commit.
 */
async function parseZipExport(buffer: ArrayBuffer): Promise<ParseZipOk['results']> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new Error(
      'Could not read the ZIP archive. Is it a valid WhatsApp export?'
    )
  }

  const fileEntries: { name: string; entry: JSZip.JSZipObject }[] = []
  zip.forEach((path, entry) => {
    if (entry.dir) return
    if (/__MACOSX|\.DS_Store|\.nomedia/i.test(path)) return
    fileEntries.push({ name: path, entry })
  })

  const txtName = pickChatTxtEntry(fileEntries.map((f) => f.name))
  if (!txtName) {
    throw new Error(
      'No chat .txt file found inside the ZIP. Please export the chat again and include the .txt file.'
    )
  }

  const txtEntry = zip.file(txtName)!
  if (entrySize(txtEntry) > MAX_TXT_BYTES) {
    throw new Error(
      'Chat transcript inside the ZIP is too large (max 20 MB uncompressed).'
    )
  }

  const chatText: string = await txtEntry.async('string')
  const parsed = parseWhatsAppText(chatText)
  if (parsed.messages.length === 0) {
    throw new Error(
      'Could not parse any messages from this export. Make sure it is an unmodified WhatsApp chat export.'
    )
  }

  // Media census — central-directory metadata only (no decompression).
  const mediaCandidates = fileEntries.filter(
    (f) => f.name !== txtName && !/\.txt$/i.test(f.name)
  )
  const bytes = mediaCandidates.reduce(
    (sum, f) => sum + Math.max(0, entrySize(f.entry)),
    0
  )

  return [
    {
      txtName,
      parsed,
      mediaCandidates: Math.min(mediaCandidates.length, MAX_MEDIA_FILES),
      mediaCandidatesBytes: bytes,
    },
  ]
}

function errorString(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Message loop — every request gets exactly one response, even on internal
 * failure, so the client never waits for its timeout unnecessarily.
 */
ctx.addEventListener('message', (ev) => {
  const req = ev.data
  if (!req || typeof req.id !== 'number') return
  const reqId = req.id
  void (async () => {
    try {
      switch (req.type) {
        case 'parse-text': {
          const result = parseWhatsAppText(req.text)
          if (result.messages.length === 0) {
            // Mirror the main-thread error so a fallback re-parse would
            // deterministically produce the same message.
            throw new Error(
              'Could not parse any messages from this file. Make sure it is an unmodified WhatsApp chat export.'
            )
          }
          ctx.postMessage({ id: reqId, ok: true, result } satisfies ParseTextOk)
          break
        }
        case 'parse-zip': {
          const results = await parseZipExport(req.buffer)
          ctx.postMessage({ id: reqId, ok: true, results } satisfies ParseZipOk)
          break
        }
        default:
          ctx.postMessage({
            id: reqId,
            ok: false,
            error: `Unknown parse worker request: ${String(
              (req as { type?: unknown }).type
            )}`,
          } satisfies ParseWorkerError)
      }
    } catch (error) {
      ctx.postMessage({
        id: reqId,
        ok: false,
        error: errorString(error),
      } satisfies ParseWorkerError)
    }
  })()
})
