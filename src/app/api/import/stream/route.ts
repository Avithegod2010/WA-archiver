import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { db } from '@/lib/db'
import { parseWhatsAppText, guessTitleFromFilename } from '@/lib/whatsapp-parser'
import type { ParsedMessage } from '@/lib/whatsapp-parser'
import { refreshChatAggregates, MEDIA_TYPES } from '@/lib/chat-service'
import {
  saveMediaFile,
  removeChatMedia,
  generateVideoPoster,
  isVideoName,
  isAudioName,
} from '@/lib/media-store'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_FILE_BYTES = 400 * 1024 * 1024 // total upload
const MAX_ENTRY_BYTES = 80 * 1024 * 1024 // single media entry
const MAX_MEDIA_FILES = 2000
const PERSIST_CHUNK = 200 // messages per createMany batch
const EMIT_INTERVAL_MS = 25 // ~40 NDJSON message lines per second max

const NDJSON_HEADERS = {
  'Content-Type': 'application/x-ndjson',
  'Cache-Control': 'no-store',
  'X-Accel-Buffering': 'no',
}

function ndjsonError(status: number, message: string): NextResponse {
  return new NextResponse(JSON.stringify({ type: 'error', message }) + '\n', {
    status,
    headers: NDJSON_HEADERS,
  })
}

function pickChatTxtEntry(names: string[]): string | null {
  const txts = names.filter((n) => /\.txt$/i.test(n))
  if (txts.length === 0) return null
  const base = (n: string) => n.split('/').pop() ?? n
  const preferred =
    txts.find((n) => /^whatsapp chat/i.test(base(n))) ??
    txts.find((n) => base(n) === '_chat.txt')
  return preferred ?? txts[0]
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** "HH:MM, DD MMM" — e.g. "14:32, 06 Jun". */
function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${hh}:${mm}, ${dd} ${MONTHS[d.getMonth()]}`
}

/** First 80 chars of the message, whitespace-stripped. */
function snippet(m: ParsedMessage): string {
  const raw = m.body || m.mediaName || ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, 80)
}

export async function POST(req: NextRequest) {
  // ------------------------------------------------------------------
  // Phase 1 — read the body fully, validate, parse (pre-stream).
  // Any failure here responds with a single NDJSON error line + status.
  // ------------------------------------------------------------------
  let file: File | null = null
  let includeAudio = true
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
    // "Include audio files" option (ImportPanel switch / includeAudio=0 form
    // field, same as /api/import): when off, voice-note files are NOT saved
    // to db/media — the audio messages are still created so the transcript
    // stays complete.
    includeAudio = form.get('includeAudio') !== '0'
  } catch {
    return ndjsonError(400, 'Upload could not be read. Please try again.')
  }

  if (!file) {
    return ndjsonError(
      400,
      'No file provided. Attach a .zip or .txt WhatsApp export.'
    )
  }
  if (file.size > MAX_FILE_BYTES) {
    return ndjsonError(413, 'File too large (max 400 MB).')
  }

  const name = file.name
  const isZip = /\.zip$/i.test(name)
  const isTxt = /\.txt$/i.test(name)
  if (!isZip && !isTxt) {
    return ndjsonError(
      415,
      'Unsupported file type. Upload a WhatsApp export (.zip or .txt).'
    )
  }

  const buf = Buffer.from(await file.arrayBuffer())

  let chatText: string
  let txtName: string | null = null
  const fileEntries: { name: string; entry: JSZip.JSZipObject }[] = []

  if (isZip) {
    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(buf)
    } catch {
      return ndjsonError(
        400,
        'Could not read the ZIP archive. Is it a valid WhatsApp export?'
      )
    }

    zip.forEach((path, entry) => {
      if (entry.dir) return
      if (/__MACOSX|\.DS_Store|\.nomedia/i.test(path)) return
      fileEntries.push({ name: path, entry })
    })

    txtName = pickChatTxtEntry(fileEntries.map((f) => f.name))
    if (!txtName) {
      return ndjsonError(
        400,
        'No chat .txt file found inside the ZIP. Please export the chat again and include the .txt file.'
      )
    }

    chatText = await zip.file(txtName)!.async('string')
  } else {
    chatText = buf.toString('utf8')
  }

  const parsed = parseWhatsAppText(chatText)
  if (parsed.messages.length === 0) {
    return ndjsonError(
      422,
      'Could not parse any messages from this file. Make sure it is an unmodified WhatsApp chat export.'
    )
  }

  const title =
    (isZip && txtName ? guessTitleFromFilename(txtName) : '') ||
    guessTitleFromFilename(name)

  // ------------------------------------------------------------------
  // Phase 2 — persist + stream progress as NDJSON while saving.
  // ------------------------------------------------------------------
  let aborted = false
  req.signal.addEventListener('abort', () => {
    aborted = true
  })

  const total = parsed.messages.length
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (obj: Record<string, unknown>) => {
        if (closed || aborted) return
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
        } catch {
          closed = true
        }
      }

      let chatId: string | null = null
      let persisted = 0

      try {
        send({ type: 'start', name, chats: 1, messages: total })

        const chat = await db.chat.create({
          data: { title, isGroup: parsed.isGroup, sourceFile: name },
        })
        chatId = chat.id

        // Extract media files (ZIP exports) — same handling as /api/import.
        const mediaMap = new Map<string, string>()
        if (isZip) {
          const mediaCandidates = fileEntries.filter(
            (f) => f.name !== txtName && !/\.txt$/i.test(f.name)
          )
          for (const f of mediaCandidates.slice(0, MAX_MEDIA_FILES)) {
            if (aborted) break
            // Skip voice notes entirely when audio is excluded
            const base = f.name.split('/').pop() ?? f.name
            if (!includeAudio && isAudioName(base)) continue
            try {
              const data = await f.entry.async('nodebuffer')
              if (!data || data.length === 0 || data.length > MAX_ENTRY_BYTES) {
                continue
              }
              const stored = await saveMediaFile(chat.id, base, data)
              mediaMap.set(base.toLowerCase(), stored)
              // Warm the video poster thumbnail (best effort, non-fatal)
              if (isVideoName(stored)) {
                await generateVideoPoster(chat.id, stored).catch(
                  () => undefined
                )
              }
            } catch {
              // Skip unreadable entries
            }
          }
        }

        // Persist message rows chunk-by-chunk while streaming lines.
        // Audio-excluded imports blank the media reference of skipped files
        // (mediaPath/mediaName end up null) but keep every message row.
        const persistedMessages = includeAudio
          ? parsed.messages
          : parsed.messages.map((m: ParsedMessage) =>
              m.mediaName && isAudioName(m.mediaName)
                ? { ...m, mediaName: null }
                : m
            )
        const rows = persistedMessages.map((m: ParsedMessage, i: number) => {
          let mediaPath: string | null = null
          let mediaName: string | null = m.mediaName

          if (mediaName) {
            const stored = mediaMap.get(mediaName.toLowerCase())
            if (stored) {
              mediaPath = stored
              mediaName = stored.split('/').pop() ?? stored
            }
          }

          return {
            chatId: chat.id,
            idx: i,
            ts: m.ts,
            sender: m.sender,
            body: m.body.slice(0, 8000),
            type: m.type,
            mediaPath,
            mediaName: mediaName ? mediaName.slice(0, 255) : null,
            pollOptions: m.pollOptions?.length
              ? JSON.stringify(m.pollOptions)
              : null,
            isMedia: MEDIA_TYPES.has(m.type) && !!mediaPath,
          }
        })

        let lastEmit = 0
        for (let i = 0; i < rows.length; i += PERSIST_CHUNK) {
          if (aborted) break
          const chunk = rows
            .slice(i, i + PERSIST_CHUNK)
            .map(({ isMedia: _isMedia, ...r }) => r)
          await db.message.createMany({ data: chunk })

          for (let j = 0; j < chunk.length; j++) {
            persisted++
            const now = Date.now()
            const isLast = persisted === total
            // Throttle to ~40 lines/sec; always emit the final message.
            if (isLast || now - lastEmit >= EMIT_INTERVAL_MS) {
              lastEmit = now
              const m = persistedMessages[i + j]
              send({ type: 'progress', parsed: persisted })
              send({
                type: 'message',
                chat: title,
                sender: m.sender,
                time: formatTime(m.ts),
                body: snippet(m),
                kind: m.type,
              })
            }
          }

          // Yield to the event loop so flushed chunks reach the client.
          await new Promise((r) => setTimeout(r, 0))
        }

        await refreshChatAggregates(chat.id)

        if (aborted) return // client is gone — nothing left to stream
        send({ type: 'done', chatIds: [chat.id], count: persisted })
      } catch (err) {
        // Clean up half-imported chat on failure
        if (chatId) {
          try {
            await db.chat.delete({ where: { id: chatId } })
            await removeChatMedia(chatId)
          } catch {
            /* ignore */
          }
        }
        console.error('Streamed import failed:', err)
        send({
          type: 'error',
          message: 'Import failed. Please check the file and try again.',
        })
      } finally {
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      aborted = true
    },
  })

  return new Response(stream, { headers: NDJSON_HEADERS })
}
