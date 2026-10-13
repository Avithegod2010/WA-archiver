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
 */

import JSZip from 'jszip'
import {
  guessTitleFromFilename,
  isMediaFilename,
  parseWhatsAppText,
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
}

export class LocalImportError extends Error {}

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

/**
 * Import a WhatsApp export (.zip or .txt File) into the on-device database.
 * Progress is reported through `onProgress` so the UI can show a live bar.
 */
export async function importFileToDevice(
  file: File,
  opts: {
    includeAudio?: boolean
    onProgress?: (p: LocalImportProgress) => void
  } = {}
): Promise<LocalImportResult> {
  const includeAudio = opts.includeAudio !== false
  const report = (p: LocalImportProgress) => opts.onProgress?.(p)
  const client = getLocalClient()

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

  let parsed: ParseResult
  let title: string

  if (!isZip) {
    if (file.size > MAX_TXT_BYTES) {
      throw new LocalImportError(
        'Chat transcript too large (max 20 MB uncompressed).'
      )
    }
    const text = new TextDecoder().decode(buf)
    parsed = parseWhatsAppText(text)
    if (parsed.messages.length === 0) {
      throw new LocalImportError(
        'Could not parse any messages from this file. Make sure it is an unmodified WhatsApp chat export.'
      )
    }
    title = guessTitleFromFilename(file.name)

    report({ phase: 'inserting', processed: 0, total: 0 })
    const { chatId } = await client.importParsed({
      title,
      sourceFile: file.name,
      isGroup: parsed.isGroup,
      messages: parsed.messages,
    })
    report({ phase: 'done', processed: 0, total: 0 })
    return {
      chatId,
      title,
      messages: parsed.messages.length,
      mediaFiles: 0,
      participants: parsed.participants.length,
      isGroup: parsed.isGroup,
    }
  }

  // ---- .zip export -------------------------------------------------------
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
  parsed = parseWhatsAppText(chatText)
  if (parsed.messages.length === 0) {
    throw new LocalImportError(
      'Could not parse any messages from this export. Make sure it is an unmodified WhatsApp chat export.'
    )
  }
  title = guessTitleFromFilename(txtName) || guessTitleFromFilename(file.name)

  // Create the chat row first so media blobs have an owner to key off.
  const chat = await client.createChat({
    title,
    isGroup: parsed.isGroup,
    sourceFile: file.name,
  })
  const chatId = chat.id

  try {
    // ---- media extraction (browser blobs → IndexedDB) -------------------
    const mediaMap = new Map<string, string>()
    const candidates = fileEntries.filter(
      (f) => f.name !== txtName && !/\.txt$/i.test(f.name)
    )
    const chosen = candidates.slice(0, MAX_MEDIA_FILES)
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
        // Only keep files the transcript can reference (any media-ish name
        // matches the server behavior: it stores every non-txt entry).
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
      ? parsed.messages
      : parsed.messages.map((m) =>
          m.mediaName && isAudioName(m.mediaName)
            ? { ...m, mediaName: null }
            : m
        )
    await client.importParsed({
      chatId,
      title,
      sourceFile: file.name,
      isGroup: parsed.isGroup,
      messages,
      mediaMap,
    })

    report({ phase: 'done', processed: 0, total: 0 })
    return {
      chatId,
      title,
      messages: parsed.messages.length,
      mediaFiles: mediaFileCount,
      participants: parsed.participants.length,
      isGroup: parsed.isGroup,
    }
  } catch (err) {
    // Clean up a half-imported chat (mirror of the server's rollback)
    await client.deleteChat(chatId).catch(() => undefined)
    throw err
  }
}

/**
 * True when the file looks like a WhatsApp export we can parse locally —
 * used by the UI to decide between device import and server import.
 */
export function looksLikeLocalExport(name: string): boolean {
  return /\.(zip|txt)$/i.test(name) && !isMediaFilename(name)
}
