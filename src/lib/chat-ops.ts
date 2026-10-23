/**
 * Bulk chat operations (B2 — chat multi-select).
 *
 * Every op is a loop over the app's EXISTING per-chat data methods — no new
 * storage surfaces:
 *   • delete           → DataClient.deleteChat(id)
 *   • pin / unpin      → DataClient.setChatFlags(id, { pinned })
 *   • favorite         → chat-folders toggleFavChat(id)  (localStorage store)
 *   • move to folder   → chat-folders getFolders / setFolders (same store the
 *                        FolderManagerDialog reads/writes)
 *   • .txt export      → DataClient.getChatTranscript(id) + buildWhatsAppText
 *                        (the same transcript builder the per-chat export
 *                        route uses, scheduled sends included), falling back
 *                        to getChatDetail / the per-chat API route
 *                        GET /api/chats/:id/export when the DataClient cannot
 *                        serve the chat's messages.
 *
 * Each op collects per-chat outcomes and returns { ok, failed } (chat ids) so
 * the UI can toast summaries like "Deleted 3 chats" / "Moved 5 chats to
 * Family" and auto-exit selection when it becomes empty.
 *
 * Client-only module: imported by ChatList (never from server code).
 */

import type { DataClient, TranscriptMessage } from '@/lib/data'
import { buildWhatsAppText, type ExportMessage } from '@/lib/export-text'
import type { ChatMessage } from '@/components/whatsapp/types'
import {
  getFavChats,
  getFolders,
  setFolders,
  toggleFavChat,
} from '@/components/whatsapp/chat-folders'

/** Per-chat outcomes of a bulk operation (chat ids, not indexes). */
export interface BulkResult {
  ok: string[]
  failed: string[]
}

/** Run one per-chat async step, recording the id under ok or failed. */
async function settle(
  r: BulkResult,
  id: string,
  step: () => Promise<void>
): Promise<void> {
  try {
    await step()
    r.ok.push(id)
  } catch {
    r.failed.push(id)
  }
}

/**
 * Delete every given chat through the existing per-chat delete method.
 * No per-chat confirmations are raised here — the UI confirms once for the
 * whole batch before calling this.
 */
export async function bulkDeleteChats(
  data: DataClient,
  ids: string[]
): Promise<BulkResult> {
  const r: BulkResult = { ok: [], failed: [] }
  for (const id of ids) {
    await settle(r, id, () => data.deleteChat(id))
  }
  return r
}

/** Pin / unpin every given chat via the existing per-chat flags method. */
export async function bulkSetChatPin(
  data: DataClient,
  ids: string[],
  pinned: boolean
): Promise<BulkResult> {
  const r: BulkResult = { ok: [], failed: [] }
  for (const id of ids) {
    await settle(r, id, () => data.setChatFlags(id, { pinned }))
  }
  return r
}

/**
 * Favorite / unfavorite chats. The store only exposes a TOGGLE, so each id is
 * flipped only when its current state differs from the target — toggleFavChat
 * re-reads the (synchronously updated) store on every call, so sequential
 * toggles are safe.
 */
export function bulkSetChatFavorite(
  ids: string[],
  favorite: boolean
): BulkResult {
  const r: BulkResult = { ok: [], failed: [] }
  for (const id of ids) {
    try {
      if (getFavChats().includes(id) !== favorite) toggleFavChat(id)
      r.ok.push(id)
    } catch {
      r.failed.push(id)
    }
  }
  return r
}

/**
 * Move chats into a custom folder. Union semantics: ids are ADDED to the
 * target folder's membership and other folders are left untouched — the same
 * store shape FolderManagerDialog edits. Unknown folder id → everything fails.
 */
export function bulkMoveChatsToFolder(
  ids: string[],
  folderId: string
): BulkResult {
  const folders = getFolders()
  const target = folders.find((f) => f.id === folderId)
  if (!target) return { ok: [], failed: [...ids] }
  const merged = new Set(target.chatIds)
  for (const id of ids) merged.add(id)
  setFolders(
    folders.map((f) =>
      f.id === folderId ? { ...f, chatIds: [...merged] } : f
    )
  )
  return { ok: [...ids], failed: [] }
}

export interface BulkExportResult extends BulkResult {
  /** The combined .txt blob (null when nothing exported). */
  blob: Blob | null
  /** Suggested download name: WA-Archiver-export-<YYYY-MM-DD>.txt */
  filename: string
}

/** Locale-independent YYYY-MM-DD stamp for the export filename. */
function exportDateStamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** ChatMessage (ISO ts) → ExportMessage (Date ts) for buildWhatsAppText. */
function toExportMessage(m: ChatMessage): ExportMessage {
  const d = new Date(m.ts)
  return {
    ts: Number.isNaN(d.getTime()) ? new Date(0) : d,
    sender: m.sender,
    body: m.body,
    type: m.type,
    mediaName: m.mediaName,
    edited: !!m.edited,
    reactions: m.reactions ?? null,
    replyTo: m.replyTo
      ? { sender: m.replyTo.sender, body: m.replyTo.body }
      : null,
  }
}

/** Transcript row (incl. pending scheduled sends) → ExportMessage. */
function fromTranscript(r: TranscriptMessage): ExportMessage {
  const d = new Date(r.ts)
  const sched = r.scheduledFor ? new Date(r.scheduledFor) : null
  return {
    ts: Number.isNaN(d.getTime()) ? new Date(0) : d,
    sender: r.sender,
    body: r.body,
    type: r.type,
    mediaName: r.mediaName,
    edited: r.edited,
    scheduledFor: sched && !isNaN(sched.getTime()) ? sched : null,
    reactions: r.reactions ?? null,
    replyTo: r.replyTo
      ? { sender: r.replyTo.sender, body: r.replyTo.body }
      : null,
  }
}

/**
 * Build ONE combined WhatsApp-format .txt for all selected chats, with a
 * "== <chat title> ==" header per chat. Primary path: DataClient
 * getChatDetail (works in BOTH transports — server REST and on-device
 * engine) + the shared buildWhatsAppText builder. Fallback when a chat's
 * messages are not reachable client-side: fetch the per-chat server route
 * GET /api/chats/:id/export and use its plain-text response.
 */
export async function bulkExportChatsText(
  data: DataClient,
  chats: { id: string; title: string }[]
): Promise<BulkExportResult> {
  const sections: string[] = []
  const ok: string[] = []
  const failed: string[] = []

  for (const chat of chats) {
    let text: string | null = null
    try {
      try {
        // Preferred: the full transcript (messages + pending scheduled sends,
        // same merge the server export route does) so bulk .txt exports are
        // identical across transports.
        let rows: TranscriptMessage[] | null = null
        try {
          rows = await data.getChatTranscript(chat.id)
        } catch {
          rows = null
        }
        if (rows) {
          text = buildWhatsAppText(rows.map(fromTranscript))
        } else {
          const detail = await data.getChatDetail(chat.id)
          text = buildWhatsAppText(detail.messages.map(toExportMessage))
        }
      } catch {
        // DataClient could not serve this chat — try the per-chat API route
        const res = await fetch(
          `/api/chats/${encodeURIComponent(chat.id)}/export`
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        text = await res.text()
      }
    } catch {
      text = null
    }
    if (text === null) {
      failed.push(chat.id)
      continue
    }
    sections.push(`== ${chat.title} ==\n\n${text}`)
    ok.push(chat.id)
  }

  return {
    ok,
    failed,
    blob:
      ok.length > 0
        ? new Blob([sections.join('\n')], {
            type: 'text/plain;charset=utf-8',
          })
        : null,
    filename: `WA-Archiver-export-${exportDateStamp()}.txt`,
  }
}
