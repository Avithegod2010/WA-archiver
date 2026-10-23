'use client'

/**
 * Client-side WhatsApp export import — the local-first twin of
 * /api/import. The zip is parsed entirely in the browser: the transcript is
 * read with the same parser as the server, media entries are stored as
 * blobs in the device media store, and rows are inserted into the on-device
 * SQLite database. Nothing is uploaded anywhere.
 *
 * Guards mirror the server route (zip-bomb budget, per-entry cap, txt cap,
 * media file cap) so a malicious archive can't blow up the tab.
 *
 * Idea #13 — selective import preview: the flow is split into two phases.
 * `previewDeviceImport` reads + parses the export WITHOUT touching the
 * database and returns a summary (date span, per-sender counts, media type
 * counts) plus the parsed transcript. `commitDeviceImport` then applies an
 * optional `ImportSelection` (date range, senders, media types) and writes
 * only the matching rows — extracting only media that survived the filter.
 * `importFileToDevice` remains as preview + full commit for callers that
 * don't need the preview step.
 *
 * B1 — merge/dedup for re-imports: `commitDeviceImport` accepts
 * `mergeIntoChatId`. The selection filter runs FIRST (applyImportSelection),
 * exact-duplicate dedup runs SECOND (makeMsgKey fingerprints inside
 * LocalDataClient.importParsed), so selective filters compose with merging.
 * The result carries `{ added, duplicatesSkipped, merged }` stats for the
 * success toast.
 */

import JSZip from 'jszip'
import {
  guessTitleFromFilename,
  isMediaFilename,
  parseWhatsAppText,
  type MessageType,
  type ParseResult,
} from '@/lib/whatsapp-parser'
import { isAudioName } from '@/lib/media-kinds'
import { getLocalClient } from './client'

const MAX_FILE_BYTES = 400 * 1024 * 1024
const MAX_ENTRY_BYTES = 80 * 1024 * 1024
const MAX_MEDIA_FILES = 2000
const MAX_TOTAL_EXTRACT_BYTES = 600 * 1024 * 1024
const MAX_TXT_BYTES = 20 * 1024 * 1024

export interface LocalImportProgress {
  phase: 'reading' | 'parsing' | 'media' | 'inserting' | 'done'
  /** Media files processed so far (during 'media'). */
  processed: number
  /** Media files discovered (during 'media'). */
  total: number
}

export interface LocalImportResult {
  chatId: string
  title: string
  messages: number
  mediaFiles: number
  participants: number
  isGroup: boolean
  /** B1: messages actually written (differs from `messages` when dedup drops rows). */
  added: number
  /** B1: exact duplicates skipped (merge mode only; 0 for fresh imports). */
  duplicatesSkipped: number
  /** B1: true when rows were merged into an existing chat. */
  merged: boolean
}

export class LocalImportError extends Error {}

/** Per-sender message count (system notices are reported separately). */
export interface ImportSenderCount {
  name: string
  count: number
}

export interface ImportPreviewSummary {
  fileName: string
  title: string
  isGroup: boolean
  totalMessages: number
  /** ISO timestamps of the first/last datable message. */
  firstAt: string
  lastAt: string
  /** Sorted by count desc, then name. */
  senders: ImportSenderCount[]
  systemCount: number
  /** Message-type census, sorted desc, zero-count types omitted. */
  typeCounts: { type: MessageType; count: number }[]
  /** ZIP only: non-transcript entries the chat could reference. */
  mediaCandidates: number
  mediaCandidatesBytes: number
}

/** Everything commit needs, held in memory while the user picks a filter. */
export interface ImportPreviewData {
  summary: ImportPreviewSummary
  parsed: ParseResult
  file: File
}

/**
 * What to keep when committing a previewed import. `null` selection (no
 * object) means "import everything". System notices are always kept —
 * they document export structure, not conversation content.
 */
export interface ImportSelection {
  /** Inclusive lower bound (ms since epoch, local midnight). */
  fromMs: number | null
  /** Inclusive upper bound (ms since epoch, local end of day). */
  toMs: number | null
  /** `null` = keep every sender; otherwise only these senders. */
  senders: string[] | null
  /** Content types to drop (e.g. ['sticker','gif']); text/system immune. */
  excludedTypes: string[]
}

/** Pick the chat transcript entry — same preference rules as the server. */
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

/** Census + date span for a parsed transcript. */
function summarize(
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
 * Phase A — read + parse an export WITHOUT writing anything. Safe to call
 * for any size the guards allow; the parsed transcript is kept in memory
 * until commit (or until the preview is discarded).
 */
export async function previewDeviceImport(
  file: File,
  opts: {
    onProgress?: (p: LocalImportProgress) => void
  } = {}
): Promise<ImportPreviewData> {
  const report = (p: LocalImportProgress) => opts.onProgress?.(p)

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

  report({ phase: 'reading', processed: 0, total: 0 })
  const buf = await file.arrayBuffer()

  if (!isTxt) {
    // ---- .zip export ------------------------------------------------------
    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(buf)
    } catch {
      throw new LocalImportError(
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
      throw new LocalImportError(
        'No chat .txt file found inside the ZIP. Please export the chat again and include the .txt file.'
      )
    }

    const txtEntry = zip.file(txtName)!
    if (entrySize(txtEntry) > MAX_TXT_BYTES) {
      throw new LocalImportError(
        'Chat transcript inside the ZIP is too large (max 20 MB uncompressed).'
      )
    }

    report({ phase: 'parsing', processed: 0, total: 0 })
    const chatText: string = await txtEntry.async('string')
    const parsed = parseWhatsAppText(chatText)
    if (parsed.messages.length === 0) {
      throw new LocalImportError(
        'Could not parse any messages from this export. Make sure it is an unmodified WhatsApp chat export.'
      )
    }
    const title =
      guessTitleFromFilename(txtName) || guessTitleFromFilename(file.name)

    const mediaCandidates = fileEntries.filter(
      (f) => f.name !== txtName && !/\.txt$/i.test(f.name)
    )
    const bytes = mediaCandidates.reduce(
      (sum, f) => sum + Math.max(0, entrySize(f.entry)),
      0
    )

    return {
      parsed,
      file,
      summary: summarize(file, parsed, title, {
        candidates: Math.min(mediaCandidates.length, MAX_MEDIA_FILES),
        bytes,
      }),
    }
  }

  // ---- plain .txt ---------------------------------------------------------
  if (file.size > MAX_TXT_BYTES) {
    throw new LocalImportError(
      'Chat transcript too large (max 20 MB uncompressed).'
    )
  }
  report({ phase: 'parsing', processed: 0, total: 0 })
  const text = new TextDecoder().decode(buf)
  const parsed = parseWhatsAppText(text)
  if (parsed.messages.length === 0) {
    throw new LocalImportError(
      'Could not parse any messages from this file. Make sure it is an unmodified WhatsApp chat export.'
    )
  }
  const title = guessTitleFromFilename(file.name)

  return {
    parsed,
    file,
    summary: summarize(file, parsed, title, { candidates: 0, bytes: 0 }),
  }
}

/** Apply a selection to parsed messages (order preserved). */
export function applyImportSelection(
  messages: ParseResult['messages'],
  selection: ImportSelection | null
): ParseResult['messages'] {
  if (!selection) return messages
  const { fromMs, toMs, senders, excludedTypes } = selection
  const sendersSet = senders === null ? null : new Set(senders)
  const excluded = new Set(excludedTypes)
  if (sendersSet === null && excluded.size === 0 && fromMs === null && toMs === null) {
    return messages
  }
  return messages.filter((m) => {
    const at = m.ts.getTime()
    if (fromMs !== null && at < fromMs) return false
    if (toMs !== null && at > toMs) return false
    if (sendersSet !== null && m.sender !== null && !sendersSet.has(m.sender)) {
      return false
    }
    if (
      excluded.size > 0 &&
      m.type !== 'text' &&
      m.type !== 'system' &&
      excluded.has(m.type)
    ) {
      return false
    }
    return true
  })
}

/**
 * Phase B — write the (optionally filtered) transcript to the device
 * database. Re-opens the ZIP from the kept File so the preview holds no
 * decompressed data; media extraction only stores files the filtered
 * transcript still references.
 *
 * B1 — `opts.mergeIntoChatId` merges the filtered transcript into an
 * existing chat instead of creating one: applyImportSelection runs first,
 * makeMsgKey dedup second, then only genuinely-new messages are appended
 * (chronologically re-indexed when needed) and the chat's aggregates are
 * recomputed. An empty filtered set is allowed when merging — it reports
 * 0 added rather than failing — so a mis-tuned filter can never destroy
 * an existing chat.
 */
export async function commitDeviceImport(
  preview: ImportPreviewData,
  selection: ImportSelection | null,
  opts: {
    includeAudio?: boolean
    /** B1: merge into this existing chat (dedup + append) instead of a new one. */
    mergeIntoChatId?: string
    onProgress?: (p: LocalImportProgress) => void
  } = {}
): Promise<LocalImportResult> {
  const includeAudio = opts.includeAudio !== false
  const mergeIntoChatId = opts.mergeIntoChatId
  const report = (p: LocalImportProgress) => opts.onProgress?.(p)
  const client = getLocalClient()
  const { parsed, file, summary } = preview

  const filtered = applyImportSelection(parsed.messages, selection)
  if (filtered.length === 0 && !mergeIntoChatId) {
    throw new LocalImportError(
      'The selected filters match no messages — loosen the date range, senders or media types and try again.'
    )
  }

  // B1: merge with filters that dropped everything — allowed, reports 0 added.
  if (filtered.length === 0 && mergeIntoChatId) {
    report({ phase: 'done', processed: 0, total: 0 })
    return {
      chatId: mergeIntoChatId,
      title: summary.title,
      messages: 0,
      mediaFiles: 0,
      participants: parsed.participants.length,
      isGroup: parsed.isGroup,
      added: 0,
      duplicatesSkipped: 0,
      merged: true,
    }
  }

  const isZip = /\.zip$/i.test(file.name)

  if (!isZip) {
    report({ phase: 'inserting', processed: 0, total: 0 })
    const { chatId, added, duplicatesSkipped } = await client.importParsed({
      title: summary.title,
      sourceFile: file.name,
      isGroup: parsed.isGroup,
      messages: filtered,
      ...(mergeIntoChatId ? { chatId: mergeIntoChatId, merge: true } : {}),
    })
    report({ phase: 'done', processed: 0, total: 0 })
    return {
      chatId,
      title: summary.title,
      messages: filtered.length,
      mediaFiles: 0,
      participants: parsed.participants.length,
      isGroup: parsed.isGroup,
      added,
      duplicatesSkipped,
      merged: Boolean(mergeIntoChatId),
    }
  }

  // ---- .zip export --------------------------------------------------------
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer())
  } catch {
    throw new LocalImportError(
      'Could not re-read the ZIP archive. Was the file moved or changed?'
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
    throw new LocalImportError(
      'No chat .txt file found inside the ZIP. Please export the chat again and include the .txt file.'
    )
  }

  // Create the chat row first so media blobs have an owner to key off.
  // B1: when merging, media blobs attach to the EXISTING chat instead —
  // no new row is created and a failure must never delete it.
  const createdChat = mergeIntoChatId
    ? null
    : await client.createChat({
        title: summary.title,
        isGroup: parsed.isGroup,
        sourceFile: file.name,
      })
  const chatId = mergeIntoChatId ?? createdChat!.id

  try {
    // ---- media extraction (browser blobs → IndexedDB) --------------------
    const wanted = new Set<string>()
    for (const m of filtered) {
      if (m.mediaName) wanted.add(m.mediaName.toLowerCase())
    }

    const mediaMap = new Map<string, string>()
    const candidates = fileEntries.filter(
      (f) => f.name !== txtName && !/\.txt$/i.test(f.name)
    )
    const chosen = candidates
      .slice(0, MAX_MEDIA_FILES)
      .filter((f) => wanted.has((f.name.split('/').pop() ?? f.name).toLowerCase()))
    report({ phase: 'media', processed: 0, total: chosen.length })

    let totalExtracted = 0
    let mediaFileCount = 0
    for (let i = 0; i < chosen.length; i++) {
      const f = chosen[i]
      const base = f.name.split('/').pop() ?? f.name
      if (!includeAudio && isAudioName(base)) continue
      const declared = entrySize(f.entry)
      if (declared >= 0 && declared > MAX_ENTRY_BYTES) continue
      if (
        declared >= 0 &&
        totalExtracted + declared > MAX_TOTAL_EXTRACT_BYTES
      )
        break
      try {
        // 'blob' keeps the file out of the JS heap as one copied Uint8Array.
        const blob = await f.entry.async('blob')
        if (!blob || blob.size === 0 || blob.size > MAX_ENTRY_BYTES) continue
        totalExtracted += blob.size
        if (totalExtracted > MAX_TOTAL_EXTRACT_BYTES) break
        const stored = await client.putMedia(chatId, base, blob)
        mediaMap.set(base.toLowerCase(), stored)
        mediaFileCount++
      } catch {
        // Skip unreadable entries (same as the server import)
      }
      report({ phase: 'media', processed: i + 1, total: chosen.length })
    }

    // ---- messages --------------------------------------------------------
    report({ phase: 'inserting', processed: 0, total: 0 })
    const messages = includeAudio
      ? filtered
      : filtered.map((m) =>
          m.mediaName && isAudioName(m.mediaName)
            ? { ...m, mediaName: null }
            : m
        )
    const { added, duplicatesSkipped } = await client.importParsed({
      chatId,
      merge: Boolean(mergeIntoChatId),
      title: summary.title,
      sourceFile: file.name,
      isGroup: parsed.isGroup,
      messages,
      mediaMap,
    })

    report({ phase: 'done', processed: 0, total: 0 })
    return {
      chatId,
      title: summary.title,
      messages: filtered.length,
      mediaFiles: mediaFileCount,
      participants: parsed.participants.length,
      isGroup: parsed.isGroup,
      added,
      duplicatesSkipped,
      merged: Boolean(mergeIntoChatId),
    }
  } catch (err) {
    // Clean up a half-imported chat (mirror of the server's rollback).
    // B1: never delete an existing chat we were only merging INTO.
    if (!mergeIntoChatId) {
      await client.deleteChat(chatId).catch(() => undefined)
    }
    throw err
  }
}

/**
 * Import a WhatsApp export (.zip or .txt File) into the on-device database
 * in one go (preview + unfiltered commit). Kept for drag-and-drop quick
 * imports; the ImportPanel uses the two-phase flow to offer a preview.
 */
export async function importFileToDevice(
  file: File,
  opts: {
    includeAudio?: boolean
    /** B1: merge into this existing chat (dedup + append) instead of a new one. */
    mergeIntoChatId?: string
    onProgress?: (p: LocalImportProgress) => void
  } = {}
): Promise<LocalImportResult> {
  const preview = await previewDeviceImport(file, {
    onProgress: opts.onProgress,
  })
  return commitDeviceImport(preview, null, opts)
}

/**
 * True when the file looks like a WhatsApp export we can parse locally —
 * used by the UI to decide between device import and server import.
 */
export function looksLikeLocalExport(name: string): boolean {
  return /\.(zip|txt)$/i.test(name) && !isMediaFilename(name)
}
