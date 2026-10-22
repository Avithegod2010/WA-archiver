import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { db } from '@/lib/db'
import { parseWhatsAppText, guessTitleFromFilename } from '@/lib/whatsapp-parser'
import { persistParsedChat } from '@/lib/chat-service'
import { mergeParsedIntoChat } from '@/lib/chat-merge'
import {
  saveMediaFile,
  removeChatMedia,
  generateVideoPoster,
  isVideoName,
  isAudioName,
  zipEntrySize,
} from '@/lib/media-store'
import { assertAppUnlocked } from '@/lib/server-lock'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * B1 — merge/dedup: when the multipart form carries `mergeIntoChatId`, the
 * parsed transcript is deduplicated against that existing chat (makeMsgKey
 * fingerprints) and only genuinely-new messages are appended — no duplicate
 * chat, no duplicated rows. Without the field the route behaves exactly as
 * before (always a fresh chat). Merge errors never delete the target chat:
 * the rollback guard below only fires for chats this request created.
 */

const MAX_FILE_BYTES = 400 * 1024 * 1024 // total upload
const MAX_ENTRY_BYTES = 80 * 1024 * 1024 // single media entry
const MAX_MEDIA_FILES = 2000
const MAX_TOTAL_EXTRACT_BYTES = 600 * 1024 * 1024 // zip-bomb total budget
const MAX_TXT_BYTES = 20 * 1024 * 1024 // decompressed chat .txt cap

function pickChatTxtEntry(names: string[]): string | null {
  const txts = names.filter((n) => /\.txt$/i.test(n))
  if (txts.length === 0) return null
  const base = (n: string) => n.split('/').pop() ?? n
  const preferred =
    txts.find((n) => /^whatsapp chat/i.test(base(n))) ??
    txts.find((n) => base(n) === '_chat.txt')
  return preferred ?? txts[0]
}

export async function POST(req: NextRequest) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  let createdChatId: string | null = null
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file provided. Attach a .zip or .txt WhatsApp export.' },
        { status: 400 }
      )
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: 'File too large (max 400 MB).' },
        { status: 413 }
      )
    }

    const name = file.name
    // "Include audio files" option (ImportPanel switch / includeAudio=0 form
    // field): when off, voice-note files are NOT saved to db/media — the
    // audio messages are still created so the transcript stays complete.
    const includeAudio = form.get('includeAudio') !== '0'
    // B1 — optional merge target. Only accepted when the chat still exists;
    // a stale id is a hard 404 so callers never silently duplicate.
    const mergeField = form.get('mergeIntoChatId')
    const mergeIntoChatId =
      typeof mergeField === 'string' &&
      mergeField.length > 0 &&
      mergeField.length <= 128
        ? mergeField
        : null
    let targetChat: {
      id: string
      title: string
      isGroup: boolean
      sourceFile: string
    } | null = null
    if (mergeIntoChatId) {
      const found = await db.chat.findUnique({
        where: { id: mergeIntoChatId },
        select: { id: true, title: true, isGroup: true, sourceFile: true },
      })
      if (!found) {
        return NextResponse.json(
          { error: 'The chat to merge into no longer exists.' },
          { status: 404 }
        )
      }
      targetChat = found
    }
    const buf = Buffer.from(await file.arrayBuffer())
    const isZip = /\.zip$/i.test(name)
    const isTxt = /\.txt$/i.test(name)

    if (!isZip && !isTxt) {
      return NextResponse.json(
        { error: 'Unsupported file type. Upload a WhatsApp export (.zip or .txt).' },
        { status: 415 }
      )
    }

    if (isZip) {
      let zip: JSZip
      try {
        zip = await JSZip.loadAsync(buf)
      } catch {
        return NextResponse.json(
          { error: 'Could not read the ZIP archive. Is it a valid WhatsApp export?' },
          { status: 400 }
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
        return NextResponse.json(
          {
            error:
              'No chat .txt file found inside the ZIP. Please export the chat again and include the .txt file.',
          },
          { status: 400 }
        )
      }

      const txtEntry = zip.file(txtName)!
      const txtSize = zipEntrySize(txtEntry)
      if (txtSize > MAX_TXT_BYTES) {
        return NextResponse.json(
          { error: 'Chat transcript inside the ZIP is too large (max 20 MB uncompressed).' },
          { status: 413 }
        )
      }
      const chatText: string = await txtEntry.async('string')
      const parsed = parseWhatsAppText(chatText)
      if (parsed.messages.length === 0) {
        return NextResponse.json(
          {
            error:
              'Could not parse any messages from this export. Make sure it is an unmodified WhatsApp chat export.',
          },
          { status: 422 }
        )
      }

      const title = guessTitleFromFilename(txtName) || guessTitleFromFilename(name)
      // B1: when merging, media + rows attach to the EXISTING chat — no new
      // row is created, and the rollback guard below must not fire for it.
      const chat = targetChat
        ? { id: targetChat.id }
        : await db.chat.create({
            data: { title, isGroup: parsed.isGroup, sourceFile: name },
          })
      createdChatId = targetChat ? null : chat.id

      // Extract media files under the chat folder and map basename -> stored name
      const mediaMap = new Map<string, string>()
      let mediaFileCount = 0
      let totalExtracted = 0 // zip-bomb guard: cumulative uncompressed bytes
      const mediaCandidates = fileEntries.filter(
        (f) => f.name !== txtName && !/\.txt$/i.test(f.name)
      )
      for (const f of mediaCandidates.slice(0, MAX_MEDIA_FILES)) {
        const base = f.name.split('/').pop() ?? f.name
        // Skip voice notes entirely when audio is excluded
        if (!includeAudio && isAudioName(base)) continue
        // Reject oversized entries BEFORE decompressing them into memory.
        const declared = zipEntrySize(f.entry)
        if (declared >= 0 && declared > MAX_ENTRY_BYTES) continue
        if (declared >= 0 && totalExtracted + declared > MAX_TOTAL_EXTRACT_BYTES) break
        try {
          const data = await f.entry.async('nodebuffer')
          if (!data || data.length === 0 || data.length > MAX_ENTRY_BYTES) continue
          totalExtracted += data.length
          if (totalExtracted > MAX_TOTAL_EXTRACT_BYTES) break
          const stored = await saveMediaFile(chat.id, base, data)
          mediaMap.set(base.toLowerCase(), stored)
          mediaFileCount++
          // Warm the video poster thumbnail (best effort, non-fatal)
          if (isVideoName(stored)) {
            await generateVideoPoster(chat.id, stored).catch(() => undefined)
          }
        } catch {
          // Skip unreadable entries
        }
      }

      // Audio-excluded imports blank the media reference of skipped files
      // (mediaPath/mediaName end up null) but keep every message row.
      const effectiveParsed = includeAudio
        ? parsed
        : {
            ...parsed,
            messages: parsed.messages.map((m) =>
              m.mediaName && isAudioName(m.mediaName)
                ? { ...m, mediaName: null }
                : m
            ),
          }

      // B1 — merge path: dedup against the existing transcript, append only
      // genuinely-new rows, recompute aggregates. Returns merge stats.
      if (targetChat) {
        const merge = await mergeParsedIntoChat({
          chatId: chat.id,
          parsed: effectiveParsed,
          mediaMap,
        })
        return NextResponse.json({
          ok: true,
          chatId: merge.chatId,
          mediaFiles: mediaFileCount,
          messages: merge.added,
          added: merge.added,
          duplicatesSkipped: merge.duplicatesSkipped,
          merged: true,
          participants: parsed.participants.length,
        })
      }

      const chatId = await persistParsedChat({
        title,
        sourceFile: name,
        parsed: effectiveParsed,
        mediaMap,
        chatId: chat.id,
      })

      return NextResponse.json({
        ok: true,
        chatId,
        mediaFiles: mediaFileCount,
        messages: parsed.messages.length,
        participants: parsed.participants.length,
      })
    }

    // Plain .txt upload
    if (file.size > MAX_TXT_BYTES) {
      return NextResponse.json(
        { error: 'Chat transcript too large (max 20 MB uncompressed).' },
        { status: 413 }
      )
    }
    const chatText = buf.toString('utf8')
    const title = guessTitleFromFilename(name)
    const parsed = parseWhatsAppText(chatText)
    if (parsed.messages.length === 0) {
      return NextResponse.json(
        {
          error:
            'Could not parse any messages from this file. Make sure it is an unmodified WhatsApp chat export.',
        },
        { status: 422 }
      )
    }
    // B1 — merge path for plain .txt uploads.
    if (targetChat) {
      const merge = await mergeParsedIntoChat({
        chatId: targetChat.id,
        parsed,
      })
      return NextResponse.json({
        ok: true,
        chatId: merge.chatId,
        mediaFiles: 0,
        messages: merge.added,
        added: merge.added,
        duplicatesSkipped: merge.duplicatesSkipped,
        merged: true,
        participants: parsed.participants.length,
      })
    }
    const chatId = await persistParsedChat({ title, sourceFile: name, parsed })
    createdChatId = chatId

    return NextResponse.json({
      ok: true,
      chatId,
      mediaFiles: 0,
      messages: parsed.messages.length,
      participants: parsed.participants.length,
    })
  } catch (err) {
    // Clean up half-imported chat on failure
    if (createdChatId) {
      try {
        await db.chat.delete({ where: { id: createdChatId } })
        await removeChatMedia(createdChatId)
      } catch {
        /* ignore */
      }
    }
    console.error('Import failed:', err)
    return NextResponse.json(
      { error: 'Import failed. Please check the file and try again.' },
      { status: 500 }
    )
  }
}