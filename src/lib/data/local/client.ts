'use client'

/**
 * LocalDataClient — the on-device implementation of the DataClient seam.
 *
 * Everything here runs with zero network: rows live in a SQLite-WASM
 * database (see engine.ts), media blobs in IndexedDB (see media.ts). The
 * SQL surface mirrors the Prisma queries used by /api routes so behavior
 * (ordering, aggregate recomputation, reply resolution) matches the server
 * exactly — Phase 2 can swap transports without visual changes.
 */

import type {
  ChatDetail,
  ChatMessage,
  ChatSummary,
} from '@/components/whatsapp/types'
import { buildPreview, type MessageType } from '@/lib/whatsapp-parser'
import { isAudioName, isVideoName } from '@/lib/media-kinds'
import {
  DataError,
  type AllMediaItem,
  type BackupImportResult,
  type DataClient,
  type DeviceStatus,
  type ImportParsedInput,
  type MemoryGroup,
  type MemoryItem,
  type MemoriesResult,
  type MediaItem,
  type ScheduledItem,
  type SearchResult,
  type SendMessageInput,
  type StarredItem,
  type TranscriptMessage,
} from '../types'
import { makeMsgKey } from '@/lib/import-dedup'
import { getEngine, type LocalEngine } from './engine'
// Post-import rolling snapshots (idea #14) — fire-and-forget, never breaks
// the import flow. Component-scoped store, safe to import here (no cycle:
// rolling-backups imports the ENGINE, not this client).
import { maybeAutoSnapshot } from '@/components/whatsapp/rolling-backups'
import {
  clearAllMedia,
  deleteMediaBlobs,
  deleteMediaForChat,
  getMediaBlob,
  mediaBytesByName,
  mediaStats,
  putMediaBlob,
} from './media'
import { MEDIA_TYPES, previewText } from './preview'
import { SAVED_CHAT_ID } from '@/components/whatsapp/types'

// ---- Row coercions (SQLite stores booleans as 0/1, dates as ISO text) ----

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v)
}
function nstr(v: unknown): string | null {
  return v == null ? null : String(v)
}
function bool(v: unknown): boolean {
  return v === 1 || v === true || v === '1'
}
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0)
}
function isoDate(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  const s = String(v)
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function newId(): string {
  return crypto.randomUUID()
}

/**
 * File → message kind, mirroring the server's typeFromMime (image/video/
 * audio/document from the MIME) with an extension fallback for browsers
 * that hand us empty MIME types.
 */
function mediaKindFromMime(mime: string, name: string): string {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (!mime) {
    if (isVideoName(name)) return 'video'
    if (isAudioName(name)) return 'audio'
  }
  return 'document'
}

function toIsoInput(v: Date | string | undefined): string {
  if (!v) return new Date().toISOString()
  return (v instanceof Date ? v : new Date(v)).toISOString()
}

function parseReactions(raw: unknown): Record<string, string[]> | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(String(raw))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    const out: Record<string, string[]> = {}
    let any = false
    for (const [emoji, senders] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (
        !emoji ||
        emoji === '__proto__' ||
        emoji === 'constructor' ||
        emoji === 'prototype'
      )
        continue
      if (!Array.isArray(senders)) continue
      const list = senders.filter(
        (s): s is string => typeof s === 'string' && s.length > 0
      )
      if (list.length === 0) continue
      out[emoji] = list
      any = true
    }
    return any ? out : null
  } catch {
    return null
  }
}

function parsePollOptions(raw: unknown): string[] | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(String(raw))
    if (!Array.isArray(parsed)) return null
    const list = parsed
      .filter((o): o is string => typeof o === 'string')
      .map((o) => o.slice(0, 100))
      .slice(0, 12)
    return list.length > 0 ? list : null
  } catch {
    return null
  }
}

// ---- Backup-file coercions (mirror /api/backup's sanitizers) ---------------

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function boolOr(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback
}

/** Poll options from untrusted backup JSON → compact column value. */
function jsonListColumn(v: unknown): string | null {
  let arr: unknown = v
  if (typeof v === 'string') {
    try {
      arr = JSON.parse(v)
    } catch {
      return null
    }
  }
  if (!Array.isArray(arr)) return null
  const list = arr
    .filter((o): o is string => typeof o === 'string' && o.length > 0)
    .slice(0, 12)
  return list.length ? JSON.stringify(list) : null
}

/** Reactions from untrusted backup JSON → compact column value. */
function jsonReactionsColumn(v: unknown): string | null {
  let raw: string | null = null
  if (typeof v === 'string') raw = v
  else if (v && typeof v === 'object' && !Array.isArray(v)) {
    try {
      raw = JSON.stringify(v)
    } catch {
      return null
    }
  }
  const parsed = parseReactions(raw)
  return parsed ? JSON.stringify(parsed) : null
}

// ---- Serialization (mirror of message-dto.ts / chats route) ---------------

interface MessageRowLike {
  id: unknown
  idx: unknown
  ts: unknown
  sender: unknown
  body: unknown
  type: unknown
  chatId: unknown
  mediaPath: unknown
  mediaName: unknown
  starred: unknown
  edited: unknown
  forwardedFrom: unknown
  pollOptions: unknown
  pinned: unknown
  reactions: unknown
  replyToId: unknown
}

function serializeMessage(
  m: MessageRowLike,
  replyToById?: Map<string, { id: string; sender: string; body: string; type: string }>
): ChatMessage {
  const replyToId = nstr(m.replyToId)
  return {
    id: str(m.id),
    idx: num(m.idx),
    ts: isoDate(m.ts) ?? new Date().toISOString(),
    sender: nstr(m.sender),
    body: str(m.body),
    type: str(m.type),
    chatId: str(m.chatId),
    mediaPath: nstr(m.mediaPath),
    mediaName: nstr(m.mediaName),
    starred: bool(m.starred),
    edited: bool(m.edited),
    forwardedFrom: nstr(m.forwardedFrom),
    pollOptions: parsePollOptions(m.pollOptions),
    pinned: bool(m.pinned),
    reactions: parseReactions(m.reactions),
    replyTo: replyToId
      ? (replyToById?.get(replyToId) ?? null)
      : null,
  }
}

interface ChatRowLike {
  id: unknown
  title: unknown
  isGroup: unknown
  messageCount: unknown
  mediaCount: unknown
  firstAt: unknown
  lastAt: unknown
  lastPreview: unknown
  lastSender: unknown
  lastType: unknown
  sourceFile: unknown
  pinned: unknown
  archived: unknown
}

function serializeChat(c: ChatRowLike): ChatSummary {
  return {
    id: str(c.id),
    title: str(c.title),
    isGroup: bool(c.isGroup),
    messageCount: num(c.messageCount),
    mediaCount: num(c.mediaCount),
    firstAt: isoDate(c.firstAt),
    lastAt: isoDate(c.lastAt),
    lastPreview: str(c.lastPreview),
    lastSender: nstr(c.lastSender),
    lastType: str(c.lastType),
    sourceFile: str(c.sourceFile),
    pinned: bool(c.pinned),
    archived: bool(c.archived),
  }
}

// ---- The client ------------------------------------------------------------

const SAVED_PREVIEW = 'Your personal space — notes, links & media'
const MAX_MESSAGES = 12000
const INSERT_CHUNK = 150

export class LocalDataClient implements DataClient {
  private engine: LocalEngine
  private urlCache = new Map<string, string>()

  constructor() {
    this.engine = getEngine()
  }

  private async db(): Promise<LocalEngine> {
    await this.engine.ready()
    return this.engine
  }

  whenReady(): Promise<void> {
    return this.engine.ready()
  }

  // ---- chats -------------------------------------------------------------

  /** Port of ensureSavedMessagesChat(). */
  private async ensureSavedMessages(e: LocalEngine): Promise<void> {
    const existing = await e.first('SELECT id FROM "Chat" WHERE id = ?', [
      SAVED_CHAT_ID,
    ])
    if (existing) return
    await e.runNoSave(
      `INSERT INTO "Chat"
        (id, title, isGroup, lastPreview, sourceFile, pinned, createdAt)
       VALUES (?, ?, 0, ?, 'local', 1, ?)`,
      [SAVED_CHAT_ID, 'Saved Messages', SAVED_PREVIEW, new Date().toISOString()]
    )
  }

  async listChats(): Promise<ChatSummary[]> {
    const e = await this.db()
    this.ensureSavedMessages(e)
    const rows = await e.all(
      `SELECT id, title, isGroup, messageCount, mediaCount, firstAt, lastAt,
              lastPreview, lastSender, lastType, sourceFile, pinned, archived
         FROM "Chat"
        ORDER BY lastAt DESC, createdAt DESC`
    )
    return rows.map((r) => serializeChat(r as unknown as ChatRowLike))
  }

  async getChatDetail(id: string): Promise<ChatDetail> {
    const e = await this.db()
    const chat = await e.first(
      `SELECT id, title, isGroup, messageCount, mediaCount, firstAt, lastAt,
              sourceFile
         FROM "Chat" WHERE id = ?`,
      [id]
    )
    if (!chat) throw new DataError('Chat not found')
    // Newest window wins when the chat exceeds the cap (mirrors the server
    // route) — reversed to ascending so the caller sees chronological order.
    const rows = await e.all(
      `SELECT id, chatId, idx, ts, sender, body, type, mediaPath, mediaName,
              starred, edited, forwardedFrom, pollOptions, pinned, reactions,
              replyToId
         FROM "Message" WHERE chatId = ?
        ORDER BY idx DESC LIMIT ${MAX_MESSAGES}`,
      [id]
    )
    rows.reverse()
    const messages = await this.withReplyTos(
      e,
      rows.map((r) => r as unknown as MessageRowLike)
    )
    return {
      chat: {
        id: str(chat.id),
        title: str(chat.title),
        isGroup: bool(chat.isGroup),
        messageCount: num(chat.messageCount),
        mediaCount: num(chat.mediaCount),
        firstAt: isoDate(chat.firstAt),
        lastAt: isoDate(chat.lastAt),
        sourceFile: str(chat.sourceFile),
      },
      messages,
    }
  }

  /**
   * Messages + pending scheduled sends merged, chronological (export parity
   * with the server route — the scheduled rows carry a "[Scheduled …]"
   * prefix when built into a .txt by buildWhatsAppText).
   */
  async getChatTranscript(id: string): Promise<TranscriptMessage[]> {
    const detail = await this.getChatDetail(id)
    let scheduled: ScheduledItem[] = []
    try {
      scheduled = (await this.listScheduled(id)).filter(
        (s) => s.status === 'pending'
      )
    } catch {
      /* scheduled rows are additive — never fail the export for them */
    }
    const rows: TranscriptMessage[] = detail.messages.map((m) => ({
      ts: m.ts,
      sender: m.sender,
      body: m.body,
      type: m.type,
      mediaName: m.mediaName,
      edited: !!m.edited,
      scheduledFor: null,
    }))
    for (const s of scheduled) {
      rows.push({
        ts: s.deliverAt,
        sender: s.sender,
        body: s.body,
        type: 'text',
        mediaName: null,
        edited: false,
        scheduledFor: s.deliverAt,
      })
    }
    return rows.sort((a, b) => a.ts.localeCompare(b.ts))
  }

  /** Port of withReplyTos(): batch-resolve quoted messages. */
  private async withReplyTos(
    e: LocalEngine,
    rows: MessageRowLike[]
  ): Promise<ChatMessage[]> {
    const ids = [
      ...new Set(
        rows
          .map((r) => nstr(r.replyToId))
          .filter((v): v is string => !!v && v.length > 0)
      ),
    ]
    if (ids.length === 0) {
      return rows.map((r) => serializeMessage(r))
    }
    const placeholders = ids.map(() => '?').join(',')
    const targets = await e.all(
      `SELECT id, sender, body, type FROM "Message" WHERE id IN (${placeholders})`,
      ids
    )
    const map = new Map(
      targets.map((t) => [
        str(t.id),
        {
          id: str(t.id),
          sender: nstr(t.sender) ?? '',
          body: str(t.body),
          type: str(t.type),
        },
      ])
    )
    return rows.map((r) => serializeMessage(r, map))
  }

  async createChat(input: {
    title: string
    isGroup?: boolean
    sourceFile?: string
    pinned?: boolean
    lastPreview?: string
  }): Promise<ChatSummary> {
    const e = await this.db()
    const id = newId()
    const now = new Date().toISOString()
    await e.run(
      `INSERT INTO "Chat"
         (id, title, isGroup, lastPreview, sourceFile, pinned, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.title.trim() || 'Imported Chat',
        input.isGroup ? 1 : 0,
        input.lastPreview ?? '',
        input.sourceFile ?? '',
        input.pinned ? 1 : 0,
        now,
      ]
    )
    const row = await e.first('SELECT * FROM "Chat" WHERE id = ?', [id])
    if (!row) throw new DataError('Could not create chat')
    return serializeChat(row as unknown as ChatRowLike)
  }

  async deleteChat(id: string): Promise<void> {
    const e = await this.db()
    await e.run('DELETE FROM "Message" WHERE chatId = ?', [id])
    await e.run('DELETE FROM "ScheduledMessage" WHERE chatId = ?', [id])
    await e.run('DELETE FROM "Chat" WHERE id = ?', [id])
    await deleteMediaForChat(id).catch(() => undefined)
    await this.engine.flush()
  }

  async setChatFlags(
    id: string,
    flags: { pinned?: boolean; archived?: boolean }
  ): Promise<void> {
    const e = await this.db()
    if (flags.pinned !== undefined) {
      await e.run('UPDATE "Chat" SET pinned = ? WHERE id = ?', [flags.pinned ? 1 : 0, id])
    }
    if (flags.archived !== undefined) {
      await e.run('UPDATE "Chat" SET archived = ? WHERE id = ?', [
        flags.archived ? 1 : 0,
        id,
      ])
    }
    await this.engine.flush()
  }

  // ---- messages ------------------------------------------------------------

  private async refreshAggregates(e: LocalEngine, chatId: string): Promise<void> {
    const messageCount = num(
      await e.scalar('SELECT COUNT(*) FROM "Message" WHERE chatId = ?', [chatId])
    )
    const typePlaceholders = [...MEDIA_TYPES].map(() => '?').join(',')
    // Media-typed messages, files or not — same broad definition as the
    // server (refreshChatAggregates in chat-service.ts).
    const mediaCount = num(
      await e.scalar(
        `SELECT COUNT(*) FROM "Message"
          WHERE chatId = ? AND type IN (${typePlaceholders})`,
        [chatId, ...MEDIA_TYPES]
      )
    )
    const first = await e.first(
      'SELECT ts, sender, type FROM "Message" WHERE chatId = ? ORDER BY idx ASC LIMIT 1',
      [chatId]
    )
    const last = await e.first(
      'SELECT body, mediaName, sender, type, ts FROM "Message" WHERE chatId = ? ORDER BY idx DESC LIMIT 1',
      [chatId]
    )
    const saved = chatId === SAVED_CHAT_ID
    await e.run(
      `UPDATE "Chat" SET messageCount = ?, mediaCount = ?, firstAt = ?,
              lastAt = ?, lastPreview = ?, lastSender = ?, lastType = ?
        WHERE id = ?`,
      [
        messageCount,
        mediaCount,
        first ? isoDate(first.ts) : null,
        last ? isoDate(last.ts) : null,
        last
          ? previewText(str(last.type), str(last.body), nstr(last.mediaName))
          : saved
            ? SAVED_PREVIEW
            : '',
        last ? nstr(last.sender) : null,
        last ? str(last.type) : 'text',
        chatId,
      ]
    )
  }

  async sendMessage(
    chatId: string,
    input: SendMessageInput
  ): Promise<ChatMessage> {
    const e = await this.db()
    const chat = await e.first('SELECT id FROM "Chat" WHERE id = ?', [chatId])
    if (!chat) throw new DataError('Chat not found')

    // Media attachment: store the blob first (mirrors the server's multipart
    // path, which saves the file before creating the row).
    let storedMediaPath: string | null = input.mediaPath ?? null
    let storedMediaName = input.mediaName ? input.mediaName.slice(0, 255) : null
    let type = input.type || 'text'
    if (input.media && input.media.size > 0) {
      const name = input.mediaName || (input.media instanceof File ? input.media.name : 'attachment')
      storedMediaPath = await putMediaBlob(chatId, name, input.media)
      storedMediaName = storedMediaPath.split('/').pop() ?? storedMediaPath
      if (!input.type || input.type === 'text') {
        type = mediaKindFromMime(input.media.type || '', storedMediaName)
      } else {
        type = input.type
      }
    }

    const idx =
      num(
        await e.scalar(
          'SELECT MAX(idx) FROM "Message" WHERE chatId = ?',
          [chatId]
        )
      ) + 1
    const id = newId()
    const sender = ((input.sender ?? 'You') || 'You').trim().slice(0, 80) || 'You'
    const body = (input.body ?? '').slice(0, 8000)

    // replyToId must reference a message of the same chat (else ignored —
    // mirrors the server route).
    let replyToId: string | null = null
    if (typeof input.replyToId === 'string' && input.replyToId.trim()) {
      const target = await e.first(
        'SELECT id FROM "Message" WHERE id = ? AND chatId = ?',
        [input.replyToId.trim(), chatId]
      )
      if (target) replyToId = str(target.id)
    }

    await e.run(
      `INSERT INTO "Message"
         (id, chatId, idx, ts, sender, body, type, mediaPath, mediaName,
          forwardedFrom, pollOptions, replyToId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        chatId,
        idx,
        toIsoInput(input.ts),
        sender,
        body,
        type,
        storedMediaPath,
        storedMediaName,
        input.forwardedFrom ? input.forwardedFrom.trim().slice(0, 120) || null : null,
        input.pollOptions?.length ? JSON.stringify(input.pollOptions.slice(0, 12)) : null,
        replyToId,
      ]
    )
    await this.refreshAggregates(e, chatId)
    await this.engine.flush()

    const row = await e.first(
      `SELECT id, chatId, idx, ts, sender, body, type, mediaPath, mediaName,
              starred, edited, forwardedFrom, pollOptions, pinned, reactions,
              replyToId
         FROM "Message" WHERE id = ?`,
      [id]
    )
    const hydrated = await this.withReplyTos(e, [row as unknown as MessageRowLike])
    return hydrated[0]
  }

  /**
   * Insert a parsed transcript. Fresh imports create the chat (or attach to
   * the caller-created `chatId`) exactly as before.
   *
   * B1 — merge mode (`merge: true` + `chatId`): the existing transcript is
   * fingerprinted with makeMsgKey (ts|sender|body|type) and only genuinely
   * new messages are appended; self-duplicates inside the incoming batch are
   * dropped too. Rows continue after the current max idx, and if any incoming
   * message is older than existing rows the chat is re-indexed by timestamp
   * (stable for ties) so the transcript stays chronological. Aggregates are
   * then recomputed from the table — the existing chat's title, isGroup and
   * sourceFile are preserved.
   *
   * Returns the chat id plus merge stats (`added` = rows written,
   * `duplicatesSkipped` = exact duplicates dropped; both 0-adjacent values on
   * fresh imports keep the old shape fully backward-compatible).
   */
  async importParsed(
    input: ImportParsedInput & {
      /** B1: merge into the existing `chatId` with message dedup. */
      merge?: boolean
    }
  ): Promise<{ chatId: string; added: number; duplicatesSkipped: number }> {
    const e = await this.db()
    const now = new Date().toISOString()
    const mediaMap = input.mediaMap ?? new Map<string, string>()

    // Reuse the caller-created chat row when given (device import attaches
    // media to that id first); otherwise create a fresh chat.
    const chatId = input.chatId ?? newId()
    if (!input.chatId) {
      await e.runNoSave(
        `INSERT INTO "Chat" (id, title, isGroup, sourceFile, createdAt)
         VALUES (?, ?, ?, ?, ?)`,
        [chatId, input.title.trim() || 'Imported Chat', input.isGroup ? 1 : 0, input.sourceFile, now]
      )
    }

    // B1 — fingerprint the existing transcript and keep only new messages.
    // makeMsgKey normalizes ts to ISO and caps the body at the insert-time
    // slice, so parsed-export keys match keys recomputed from stored rows.
    const merge = input.merge === true && !!input.chatId
    let duplicatesSkipped = 0
    let incoming = input.messages
    let oldestIncomingMs = Number.POSITIVE_INFINITY
    let maxExistingMs = Number.NEGATIVE_INFINITY
    if (merge) {
      const existing = await e.all(
        'SELECT ts, sender, body, type FROM "Message" WHERE chatId = ?',
        [chatId]
      )
      const keys = new Set<string>()
      for (const r of existing) {
        keys.add(
          makeMsgKey({
            ts: str(r.ts),
            sender: nstr(r.sender),
            body: str(r.body),
            type: str(r.type),
          })
        )
        const t = Date.parse(str(r.ts))
        if (Number.isFinite(t) && t > maxExistingMs) maxExistingMs = t
      }
      incoming = []
      for (const m of input.messages) {
        const key = makeMsgKey(m)
        if (keys.has(key)) {
          duplicatesSkipped++
          continue
        }
        keys.add(key)
        const t = m.ts instanceof Date ? m.ts.getTime() : Date.parse(m.ts)
        if (Number.isFinite(t) && t < oldestIncomingMs) oldestIncomingMs = t
        incoming.push(m)
      }
      if (incoming.length === 0) {
        // Nothing new — still refresh aggregates so the row stays honest.
        await this.refreshAggregates(e, chatId)
        await this.engine.flush()
        maybeAutoSnapshot()
        return { chatId, added: 0, duplicatesSkipped }
      }
    }

    // Broad media definition: every media-typed incoming message counts,
    // even when its file wasn't included in the export.
    const mediaCount = incoming.filter((m) => MEDIA_TYPES.has(m.type)).length
    // Fresh chats restart idx at 0; merges continue after the current max.
    const baseIdx = merge
      ? num(
          await e.scalar(
            'SELECT COALESCE(MAX(idx), -1) FROM "Message" WHERE chatId = ?',
            [chatId]
          )
        ) + 1
      : 0
    const rows = incoming.map((m, i) => {
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
        id: newId(),
        chatId,
        idx: baseIdx + i,
        ts: (m.ts instanceof Date ? m.ts : new Date(m.ts)).toISOString(),
        sender: m.sender,
        body: m.body.slice(0, 8000),
        type: m.type,
        mediaPath,
        mediaName: mediaName ? mediaName.slice(0, 255) : null,
        pollOptions: m.pollOptions?.length ? JSON.stringify(m.pollOptions.slice(0, 12)) : null,
      }
    })

    const cols =
      '(id, chatId, idx, ts, sender, body, type, mediaPath, mediaName, pollOptions)'
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      const chunk = rows.slice(i, i + INSERT_CHUNK)
      const valuesSql = chunk
        .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .join(',')
      const params: unknown[] = []
      for (const r of chunk) {
        params.push(
          r.id,
          r.chatId,
          r.idx,
          r.ts,
          r.sender,
          r.body,
          r.type,
          r.mediaPath,
          r.mediaName,
          r.pollOptions
        )
      }
      await e.runNoSave(
        `INSERT INTO "Message" ${cols} VALUES ${valuesSql}`,
        params
      )
    }

    // B1 (merge): keep the transcript chronological. Appends already start
    // after the current max idx — when any incoming message is OLDER than the
    // newest existing row, re-index the whole chat by timestamp. The sort is
    // stable (ES2019+), so equal timestamps keep their previous relative
    // order. Skipped entirely on the common append-only path.
    if (merge && oldestIncomingMs < maxExistingMs) {
      const order = await e.all(
        'SELECT id, idx, ts FROM "Message" WHERE chatId = ? ORDER BY idx ASC',
        [chatId]
      )
      order.sort(
        (a, b) => Date.parse(str(a.ts)) - Date.parse(str(b.ts))
      )
      for (let i = 0; i < order.length; i++) {
        if (num(order[i].idx) !== i) {
          await e.runNoSave('UPDATE "Message" SET idx = ? WHERE id = ?', [
            i,
            str(order[i].id),
          ])
        }
      }
    }

    if (merge) {
      // Merged transcript: recompute every aggregate from the table so
      // counts/first/last reflect the FULL chat (imported rows + existing).
      // The existing chat's title, isGroup and sourceFile are preserved.
      await this.refreshAggregates(e, chatId)
    } else {
      // Import-time aggregates mirror persistParsedChat(): preview from the
      // parser's buildPreview (label style), counts from the parsed rows.
      const last = input.messages.at(-1) ?? null
      const first = input.messages[0] ?? null
      await e.runNoSave(
        `UPDATE "Chat" SET title = ?, isGroup = ?, sourceFile = ?,
                messageCount = ?, mediaCount = ?, firstAt = ?, lastAt = ?,
                lastPreview = ?, lastSender = ?, lastType = ?
          WHERE id = ?`,
        [
          input.title.trim() || 'Imported Chat',
          input.isGroup ? 1 : 0,
          input.sourceFile,
          input.messages.length,
          mediaCount,
          first ? (first.ts instanceof Date ? first.ts : new Date(first.ts)).toISOString() : null,
          last ? (last.ts instanceof Date ? last.ts : new Date(last.ts)).toISOString() : null,
          last
            ? buildPreview({ body: last.body, type: last.type as MessageType }).slice(0, 300)
            : '',
          last?.sender ?? null,
          last?.type ?? 'text',
          chatId,
        ]
      )
    }
    await this.engine.flush()
    // Idea #14: rolling on-device snapshot after every import (throttled).
    maybeAutoSnapshot()
    return { chatId, added: rows.length, duplicatesSkipped }
  }

  async deleteMessage(id: string): Promise<void> {
    const e = await this.db()
    const row = await e.first('SELECT chatId FROM "Message" WHERE id = ?', [id])
    if (!row) return
    await e.run('DELETE FROM "Message" WHERE id = ?', [id])
    await this.refreshAggregates(e, str(row.chatId))
    await this.engine.flush()
  }

  /**
   * Bulk media deletion (media hub). Removes the stored blobs from
   * IndexedDB and marks the rows `type='deleted'` ("Media deleted: <name>")
   * so the transcript keeps a WhatsApp-style placeholder. Ids without
   * media are ignored. Returns how many messages were updated.
   */
  async deleteMessageMedia(ids: string[]): Promise<number> {
    const e = await this.db()
    const clean = ids
      .filter((x) => typeof x === 'string' && x.length > 0 && x.length <= 128)
      .slice(0, 500)
    if (clean.length === 0) return 0
    const ph = clean.map(() => '?').join(',')
    const rows = await e.all(
      `SELECT id, chatId, mediaPath, mediaName FROM "Message"
       WHERE id IN (${ph}) AND mediaPath IS NOT NULL`,
      clean
    ) as unknown as Array<{
      id: string
      chatId: string
      mediaPath: string
      mediaName: string | null
    }>
    if (rows.length === 0) return 0

    // Remove blobs grouped per chat.
    const byChat = new Map<string, string[]>()
    for (const r of rows) {
      const list = byChat.get(r.chatId) ?? []
      list.push(r.mediaPath)
      byChat.set(r.chatId, list)
    }
    await Promise.all(
      [...byChat].map(([chatId, names]) => deleteMediaBlobs(chatId, names))
    )

    for (const r of rows) {
      await e.run(
        `UPDATE "Message" SET type = 'deleted', body = ?, mediaPath = NULL,
         mediaName = NULL WHERE id = ?`,
        [`Media deleted: ${r.mediaName || r.mediaPath}`, r.id]
      )
    }
    const touched = [...new Set(rows.map((r) => r.chatId))]
    for (const chatId of touched) await this.refreshAggregates(e, chatId)
    await this.engine.flush()
    return rows.length
  }

  async toggleStar(id: string, starred?: boolean): Promise<boolean> {
    const e = await this.db()
    const row = await e.first('SELECT starred FROM "Message" WHERE id = ?', [id])
    if (!row) throw new DataError('Message not found')
    const next = starred === undefined ? !bool(row.starred) : Boolean(starred)
    await e.run('UPDATE "Message" SET starred = ? WHERE id = ?', [next ? 1 : 0, id])
    await this.engine.flush()
    return next
  }

  async setMessagePinned(id: string, pinned: boolean): Promise<void> {
    const e = await this.db()
    await e.run('UPDATE "Message" SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, id])
    await this.engine.flush()
  }

  private async serializedById(
    e: LocalEngine,
    id: string
  ): Promise<ChatMessage | null> {
    const row = await e.first(
      `SELECT id, chatId, idx, ts, sender, body, type, mediaPath, mediaName,
              starred, edited, forwardedFrom, pollOptions, pinned, reactions,
              replyToId
         FROM "Message" WHERE id = ?`,
      [id]
    )
    if (!row) return null
    return this.withReplyTos(e, [row as unknown as MessageRowLike])[0]
  }

  async setReactions(
    id: string,
    reactions: Record<string, string[]> | null
  ): Promise<ChatMessage | null> {
    const e = await this.db()
    await e.run('UPDATE "Message" SET reactions = ? WHERE id = ?', [
      reactions && Object.keys(reactions).length > 0
        ? JSON.stringify(reactions)
        : null,
      id,
    ])
    await this.engine.flush()
    return this.serializedById(e, id)
  }

  async markMessageEdited(id: string, body: string): Promise<ChatMessage | null> {
    const e = await this.db()
    const row = await e.first('SELECT chatId FROM "Message" WHERE id = ?', [id])
    if (!row) return null
    await e.run('UPDATE "Message" SET body = ?, edited = 1 WHERE id = ?', [
      body.slice(0, 8000),
      id,
    ])
    await this.refreshAggregates(e, str(row.chatId))
    await this.engine.flush()
    return this.serializedById(e, id)
  }

  /**
   * Unsend → WhatsApp-style tombstone (not a hard delete): the row stays in
   * place so the transcript keeps an audit trail, exactly like the parser's
   * "This message was deleted" handling. Any stored media blob is dropped.
   */
  async unsendMessage(id: string): Promise<ChatMessage | null> {
    const e = await this.db()
    const row = await e.first(
      'SELECT chatId, mediaPath FROM "Message" WHERE id = ?',
      [id]
    ) as unknown as { chatId: string; mediaPath: string | null } | undefined
    if (!row) return null
    const chatId = str(row.chatId)
    if (row.mediaPath) {
      try {
        await deleteMediaBlobs(chatId, [row.mediaPath])
      } catch {
        /* blob already gone — the tombstone still applies */
      }
    }
    await e.run(
      `UPDATE "Message" SET
         body = 'This message was deleted',
         type = 'deleted',
         mediaPath = NULL,
         mediaName = NULL,
         edited = 0,
         starred = 0,
         pinned = 0,
         reactions = NULL
       WHERE id = ?`,
      [id]
    )
    await this.refreshAggregates(e, chatId)
    await this.engine.flush()
    return this.serializedById(e, id)
  }

  // ---- media ----------------------------------------------------------------

  async putMedia(
    chatId: string,
    originalName: string,
    blob: Blob
  ): Promise<string> {
    await this.whenReady()
    return putMediaBlob(chatId, originalName, blob)
  }

  async mediaUrl(chatId: string, name: string): Promise<string | null> {
    const key = `${chatId}/${name}`
    const cached = this.urlCache.get(key)
    if (cached) return cached
    const rec = await getMediaBlob(chatId, name).catch(() => null)
    if (!rec) return null
    const url = URL.createObjectURL(rec.blob)
    this.urlCache.set(key, url)
    return url
  }

  releaseMediaUrl(url: string): void {
    for (const [key, u] of this.urlCache) {
      if (u === url) {
        URL.revokeObjectURL(url)
        this.urlCache.delete(key)
        return
      }
    }
  }

  // ---- scheduled messages -----------------------------------------------------

  private serializeScheduled(r: Record<string, unknown>): ScheduledItem {
    return {
      id: str(r.id),
      chatId: str(r.chatId),
      body: str(r.body),
      sender: str(r.sender),
      deliverAt: isoDate(r.deliverAt) ?? new Date().toISOString(),
      createdAt: isoDate(r.createdAt) ?? new Date().toISOString(),
      status: str(r.status),
    }
  }

  async listScheduled(chatId?: string): Promise<ScheduledItem[]> {
    const e = await this.db()
    const rows = chatId
      ? await e.all(
          'SELECT * FROM "ScheduledMessage" WHERE chatId = ? ORDER BY deliverAt ASC',
          [chatId]
        )
      : await e.all('SELECT * FROM "ScheduledMessage" ORDER BY deliverAt ASC')
    return rows.map((r) => this.serializeScheduled(r))
  }

  async createScheduled(input: {
    chatId: string
    body: string
    sender?: string
    deliverAt: Date | string
  }): Promise<ScheduledItem> {
    const e = await this.db()
    const chat = await e.first('SELECT id FROM "Chat" WHERE id = ?', [input.chatId])
    if (!chat) throw new DataError('Chat not found')
    const id = newId()
    const now = new Date().toISOString()
    await e.run(
      `INSERT INTO "ScheduledMessage" (id, chatId, body, sender, deliverAt, createdAt, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [
        id,
        input.chatId,
        input.body.slice(0, 4000),
        (input.sender ?? 'You').slice(0, 80) || 'You',
        toIsoInput(input.deliverAt),
        now,
      ]
    )
    await this.engine.flush()
    const row = await e.first('SELECT * FROM "ScheduledMessage" WHERE id = ?', [id])
    return this.serializeScheduled(row!)
  }

  async cancelScheduled(id: string): Promise<void> {
    const e = await this.db()
    await e.run("DELETE FROM \"ScheduledMessage\" WHERE id = ? AND status = 'pending'", [id])
    await this.engine.flush()
  }

  async setScheduledStatus(id: string, status: string): Promise<void> {
    const e = await this.db()
    await e.run('UPDATE "ScheduledMessage" SET status = ? WHERE id = ?', [status, id])
    await this.engine.flush()
  }

  // ---- app settings -----------------------------------------------------------

  async getSetting(key: string): Promise<string | null> {
    const e = await this.db()
    const row = await e.first('SELECT value FROM "AppSetting" WHERE key = ?', [key])
    return row ? str(row.value) : null
  }

  async setSetting(key: string, value: string): Promise<void> {
    const e = await this.db()
    await e.run(
      `INSERT INTO "AppSetting" (key, value, updatedAt) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
         updatedAt = excluded.updatedAt`,
      [key, value, new Date().toISOString()]
    )
    await this.engine.flush()
  }

  async deleteSetting(key: string): Promise<void> {
    const e = await this.db()
    await e.run('DELETE FROM "AppSetting" WHERE key = ?', [key])
    await this.engine.flush()
  }

  // ---- lifecycle / diagnostics --------------------------------------------------

  async deviceStatus(): Promise<DeviceStatus> {
    await this.whenReady()
    const e = this.engine
    const media = await mediaStats().catch(() => ({ files: 0, bytes: 0 }))
    return {
      ready: true,
      engine: e.getPersistence() === 'native' ? 'sqlite-native' : 'sqlite-wasm',
      persistence: e.getPersistence(),
      dbBytes: await e.dbBytes(),
      chats: num(await e.scalar('SELECT COUNT(*) FROM "Chat"')),
      messages: num(await e.scalar('SELECT COUNT(*) FROM "Message"')),
      scheduled: num(await e.scalar('SELECT COUNT(*) FROM "ScheduledMessage"')),
      mediaFiles: media.files,
      mediaBytes: media.bytes,
      lastSavedAt: e.getLastSavedAt(),
    }
  }

  async flush(): Promise<void> {
    await this.whenReady()
    await this.engine.flush()
  }

  async wipe(): Promise<void> {
    for (const url of this.urlCache.values()) URL.revokeObjectURL(url)
    this.urlCache.clear()
    await clearAllMedia().catch(() => undefined)
    await this.engine.reset()
  }

  // ---- forward (Phase 2) -----------------------------------------------------
  // Mirrors POST /api/messages/:id/forward: copy into the target chat,
  // attributed to "You", with a "Forwarded from <sender>" marker; the media
  // blob is copied into the target chat's media store so the new row is
  // self-contained (the server copies the file on disk the same way).

  async forwardMessage(id: string, targetChatId: string): Promise<ChatMessage | null> {
    const e = await this.db()
    const source = await e.first(
      `SELECT id, chatId, sender, body, type, mediaPath, mediaName, forwardedFrom, pollOptions
         FROM "Message" WHERE id = ?`,
      [id]
    )
    if (!source) throw new DataError('Message not found')

    const target = await e.first('SELECT id FROM "Chat" WHERE id = ?', [targetChatId])
    if (!target) throw new DataError('Target chat not found')

    // Copy media into the target chat's store when present.
    let mediaPath: string | null = null
    let mediaName: string | null = nstr(source.mediaName)
    if (nstr(source.mediaPath)) {
      const rec = await getMediaBlob(str(source.chatId), str(source.mediaPath)).catch(
        () => null
      )
      if (rec) {
        const stored = await putMediaBlob(
          targetChatId,
          mediaName ?? str(source.mediaPath),
          rec.blob
        )
        mediaPath = stored
        mediaName = stored.split('/').pop() ?? stored
      }
    }

    const idx =
      num(
        await e.scalar('SELECT MAX(idx) FROM "Message" WHERE chatId = ?', [targetChatId])
      ) + 1
    const newMsgId = newId()
    const forwardedFrom =
      str(source.chatId) === targetChatId
        ? nstr(source.forwardedFrom) ?? nstr(source.sender)
        : nstr(source.sender)

    await e.run(
      `INSERT INTO "Message"
         (id, chatId, idx, ts, sender, body, type, mediaPath, mediaName,
          forwardedFrom, pollOptions)
       VALUES (?, ?, ?, ?, 'You', ?, ?, ?, ?, ?, ?)`,
      [
        newMsgId,
        targetChatId,
        idx,
        new Date().toISOString(),
        str(source.body),
        str(source.type),
        mediaPath,
        mediaName,
        forwardedFrom,
        nstr(source.pollOptions),
      ]
    )
    await this.refreshAggregates(e, targetChatId)
    await this.engine.flush()
    return this.serializedById(e, newMsgId)
  }

  // ---- scheduled dispatch (Phase 2) -------------------------------------------
  // Mirrors POST /api/scheduled/dispatch: claim pending→sent atomically, then
  // insert a real message stamped with the SCHEDULED time.

  async dispatchScheduled(): Promise<{ delivered: number; chatIds: string[] }> {
    const e = await this.db()
    const due = await e.all(
      `SELECT id, chatId, body, sender, deliverAt FROM "ScheduledMessage"
        WHERE status = 'pending' AND deliverAt <= ?
        ORDER BY deliverAt ASC LIMIT 50`,
      [new Date().toISOString()]
    )

    const chatIds = new Set<string>()
    let delivered = 0
    for (const item of due) {
      await e.run(
        `UPDATE "ScheduledMessage" SET status = 'sent'
          WHERE id = ? AND status = 'pending'`,
        [str(item.id)]
      )
      // Claim check — a row already claimed by another tick is skipped.
      const claimed = num(await e.scalar('SELECT changes()'))
      if (claimed !== 1) continue

      const chat = await e.first('SELECT id FROM "Chat" WHERE id = ?', [str(item.chatId)])
      if (!chat) {
        // Chat vanished since scheduling — drop the item instead of delivering.
        await e.run(`UPDATE "ScheduledMessage" SET status = 'cancelled' WHERE id = ?`, [
          str(item.id),
        ])
        continue
      }
      const idx =
        num(
          await e.scalar('SELECT MAX(idx) FROM "Message" WHERE chatId = ?', [
            str(item.chatId),
          ])
        ) + 1
      await e.run(
        `INSERT INTO "Message" (id, chatId, idx, ts, sender, body, type)
         VALUES (?, ?, ?, ?, ?, ?, 'text')`,
        [
          newId(),
          str(item.chatId),
          idx,
          isoDate(item.deliverAt) ?? new Date().toISOString(),
          nstr(item.sender) ?? 'You',
          str(item.body).slice(0, 8000),
        ]
      )
      await this.refreshAggregates(e, str(item.chatId))
      chatIds.add(str(item.chatId))
      delivered++
    }
    if (delivered > 0) await this.engine.flush()
    return { delivered, chatIds: [...chatIds] }
  }

  // ---- discovery / reads (Phase 2) --------------------------------------------

  async searchAll(query: string): Promise<SearchResult> {
    const e = await this.db()
    const q = query.trim()
    if (!q) {
      return { query: '', totalChats: 0, totalHits: 0, truncated: false, chats: [] }
    }
    const like = `%${q}%`
    const rows = await e.all(
      `SELECT m.id, m.idx, m.ts, m.sender, m.body, m.type, m.chatId,
              c.title AS chatTitle, c.isGroup AS isGroup
         FROM "Message" m JOIN "Chat" c ON c.id = m.chatId
        WHERE m.body LIKE ?
        ORDER BY m.ts DESC
        LIMIT 200`,
      [like]
    )
    const countRows = await e.all(
      `SELECT chatId, COUNT(*) AS n FROM "Message" WHERE body LIKE ? GROUP BY chatId`,
      [like]
    )
    const counts = new Map(
      countRows.map((r) => [str(r.chatId), num(r.n)] as const)
    )

    const ordered: {
      id: string
      title: string
      isGroup: boolean
      count: number
      hits: SearchResult['chats'][number]['hits']
    }[] = []
    const byChat = new Map<string, (typeof ordered)[number]>()
    for (const r of rows) {
      const chatId = str(r.chatId)
      let entry = byChat.get(chatId)
      if (!entry) {
        entry = {
          id: chatId,
          title: str(r.chatTitle),
          isGroup: bool(r.isGroup),
          count: counts.get(chatId) ?? 0,
          hits: [],
        }
        byChat.set(chatId, entry)
        ordered.push(entry)
      }
      if (entry.hits.length < 20) {
        entry.hits.push({
          id: str(r.id),
          idx: num(r.idx),
          ts: isoDate(r.ts) ?? new Date(0).toISOString(),
          sender: nstr(r.sender),
          body: str(r.body),
          type: str(r.type),
        })
      }
    }
    return {
      query: q,
      totalChats: ordered.length,
      totalHits: rows.length,
      truncated: rows.length >= 200,
      chats: ordered,
    }
  }

  async listStarred(chatId: string): Promise<{ items: StarredItem[] }> {
    const e = await this.db()
    const rows = await e.all(
      `SELECT id, idx, ts, sender, body, type, mediaPath, mediaName
         FROM "Message" WHERE chatId = ? AND starred = 1
        ORDER BY idx ASC`,
      [chatId]
    )
    return {
      items: rows.map((r) => ({
        id: str(r.id),
        idx: num(r.idx),
        ts: isoDate(r.ts) ?? new Date(0).toISOString(),
        sender: nstr(r.sender),
        body: str(r.body),
        type: str(r.type),
        mediaPath: nstr(r.mediaPath),
        mediaName: nstr(r.mediaName),
      })),
    }
  }

  async listChatMedia(chatId: string): Promise<{ items: MediaItem[] }> {
    const e = await this.db()
    const placeholders = [...MEDIA_TYPES].map(() => '?').join(',')
    const rows = await e.all(
      `SELECT id, idx, ts, sender, body, type, mediaPath, mediaName
         FROM "Message"
        WHERE chatId = ? AND type IN (${placeholders}) AND mediaPath IS NOT NULL
        ORDER BY ts DESC, idx DESC`,
      [chatId, ...MEDIA_TYPES]
    )
    const sizes = await mediaBytesByName(chatId).catch(() => new Map<string, number>())
    return {
      items: rows.map((r) => {
        const mediaPath = nstr(r.mediaPath)
        const bytes = mediaPath ? (sizes.get(mediaPath) ?? null) : null
        return {
          id: str(r.id),
          idx: num(r.idx),
          ts: isoDate(r.ts) ?? new Date(0).toISOString(),
          sender: nstr(r.sender),
          body: str(r.body),
          type: str(r.type),
          mediaPath,
          mediaName: nstr(r.mediaName),
          bytes,
        }
      }),
    }
  }

  async listAllMedia(): Promise<{ items: AllMediaItem[]; truncated?: boolean }> {
    const e = await this.db()
    const placeholders = [...MEDIA_TYPES].map(() => '?').join(',')
    const rows = await e.all(
      `SELECT m.id, m.idx, m.ts, m.sender, m.body, m.type,
              m.mediaPath, m.mediaName, m.starred, m.chatId, c.title AS chatTitle
         FROM "Message" m
         JOIN "Chat" c ON c.id = m.chatId
        WHERE m.type IN (${placeholders}) AND m.mediaPath IS NOT NULL
        ORDER BY m.ts DESC, m.idx DESC
        LIMIT 5000`,
      [...MEDIA_TYPES]
    )
    const truncated = rows.length >= 5000
    // Group byte lookups per chat (one IndexedDB pass per chat with hits).
    const byChat = new Map<string, AllMediaItem[]>()
    for (const r of rows) {
      const chatId = str(r.chatId)
      const list = byChat.get(chatId) ?? []
      list.push({
        id: str(r.id),
        idx: num(r.idx),
        ts: isoDate(r.ts) ?? new Date(0).toISOString(),
        sender: nstr(r.sender),
        body: str(r.body),
        type: str(r.type),
        mediaPath: nstr(r.mediaPath),
        mediaName: nstr(r.mediaName),
        bytes: null,
        chatId,
        chatTitle: str(r.chatTitle),
        starred: num(r.starred) === 1,
      })
      byChat.set(chatId, list)
    }
    await Promise.all(
      [...byChat.keys()].map(async (chatId) => {
        const sizes = await mediaBytesByName(chatId).catch(
          () => new Map<string, number>()
        )
        for (const item of byChat.get(chatId) ?? []) {
          item.bytes = item.mediaPath ? (sizes.get(item.mediaPath) ?? null) : null
        }
      })
    )
    // Flatten back to newest-first (each group preserves its own order).
    const items = [...byChat.values()].flat()
    items.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : b.idx - a.idx))
    return { items, truncated }
  }

  async chatMediaZip(chatId: string): Promise<Blob | null> {
    const e = await this.db()
    const placeholders = [...MEDIA_TYPES].map(() => '?').join(',')
    const rows = await e.all(
      `SELECT mediaPath FROM "Message"
        WHERE chatId = ? AND type IN (${placeholders}) AND mediaPath IS NOT NULL`,
      [chatId, ...MEDIA_TYPES]
    )
    const names = [
      ...new Set(rows.map((r) => nstr(r.mediaPath)).filter((v): v is string => !!v)),
    ]
    if (names.length === 0) return null
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    let added = 0
    for (const name of names) {
      const rec = await getMediaBlob(chatId, name).catch(() => null)
      if (!rec) continue
      zip.file(name, rec.blob)
      added++
    }
    if (added === 0) return null
    return zip.generateAsync({ type: 'blob' })
  }

  async memories(mmd?: string): Promise<MemoriesResult> {
    const e = await this.db()
    const MMD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
    let target: string
    if (mmd != null) {
      if (!MMD_RE.test(mmd)) throw new DataError('Invalid mmd — expected MM-DD')
      target = mmd
    } else {
      const now = new Date()
      target = `${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(
        now.getUTCDate()
      ).padStart(2, '0')}`
    }
    const startOfToday = new Date()
    startOfToday.setUTCHours(0, 0, 0, 0)

    // Local rows store ts as ISO text — substr gives the calendar parts the
    // same way the server route's strftime('%m-%d') does on epoch ms.
    const rows = await e.all(
      `SELECT m.id, m.chatId, m.ts, m.sender, m.body, m.type,
              m.mediaPath, m.mediaName,
              c.title AS chatTitle, c.isGroup AS isGroup
         FROM "Message" m JOIN "Chat" c ON c.id = m.chatId
        WHERE m.type != 'system' AND substr(m.ts, 6, 5) = ? AND m.ts < ?
        ORDER BY m.ts DESC
        LIMIT 120`,
      [target, startOfToday.toISOString()]
    )

    const currentYear = new Date().getUTCFullYear()
    const byYear = new Map<number, MemoryItem[]>()
    for (const r of rows) {
      const ts = isoDate(r.ts) ?? new Date(0).toISOString()
      const year = Number.isNaN(new Date(ts).getUTCFullYear())
        ? 1970
        : new Date(ts).getUTCFullYear()
      const hasMedia = MEDIA_TYPES.has(str(r.type))
      const item: MemoryItem = {
        id: str(r.id),
        chatId: str(r.chatId),
        chatTitle: str(r.chatTitle),
        isGroup: bool(r.isGroup),
        sender: nstr(r.sender),
        ts,
        type: str(r.type),
        preview: hasMedia ? '' : str(r.body).trim().slice(0, 200),
        hasMedia,
      }
      const mediaName = nstr(r.mediaName)
      if (mediaName) item.mediaName = mediaName
      const bucket = byYear.get(year)
      if (bucket) bucket.push(item)
      else byYear.set(year, [item])
    }

    const relativeLabel = (diff: number): string => {
      if (diff <= 0) return 'Earlier this year'
      if (diff === 1) return 'Last year'
      return `${diff} years ago`
    }
    const groups: MemoryGroup[] = [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, items]) => ({
        key: String(year),
        label: `${year} · ${relativeLabel(currentYear - year)}`,
        items,
      }))
    return { date: target, groups }
  }

  // ---- backup (Phase 2) ---------------------------------------------------------
  // Same JSON shape as GET /api/backup so a file produced on-device restores
  // on the server and vice versa. Media files are excluded on both sides.

  async exportBackup(): Promise<Blob> {
    const e = await this.db()
    const chats = await e.all(
      `SELECT id, title, isGroup, messageCount, mediaCount, firstAt, lastAt,
              lastPreview, lastSender, lastType, sourceFile, pinned, archived, createdAt
         FROM "Chat" ORDER BY createdAt ASC`
    )
    const messages = await e.all(
      `SELECT id, chatId, idx, ts, sender, body, type, mediaPath, mediaName,
              starred, edited, forwardedFrom, pollOptions, pinned, reactions, replyToId
         FROM "Message" ORDER BY chatId ASC, idx ASC`
    )
    const byChat = new Map<string, Record<string, unknown>[]>()
    for (const m of messages) {
      const chatId = str(m.chatId)
      let list = byChat.get(chatId)
      if (!list) {
        list = []
        byChat.set(chatId, list)
      }
      list.push({
        id: str(m.id),
        idx: num(m.idx),
        ts: isoDate(m.ts) ?? new Date(0).toISOString(),
        sender: nstr(m.sender),
        body: str(m.body),
        type: str(m.type),
        mediaPath: nstr(m.mediaPath),
        mediaName: nstr(m.mediaName),
        starred: bool(m.starred),
        edited: bool(m.edited),
        forwardedFrom: nstr(m.forwardedFrom),
        pollOptions: parsePollOptions(m.pollOptions),
        pinned: bool(m.pinned),
        reactions: parseReactions(m.reactions),
        replyToId: nstr(m.replyToId),
      })
    }
    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      mediaNote: 'Media files are not included in JSON backups',
      chats: chats.map((c) => ({
        id: str(c.id),
        title: str(c.title),
        isGroup: bool(c.isGroup),
        messageCount: num(c.messageCount),
        mediaCount: num(c.mediaCount),
        firstAt: isoDate(c.firstAt),
        lastAt: isoDate(c.lastAt),
        lastPreview: str(c.lastPreview),
        lastSender: nstr(c.lastSender),
        lastType: str(c.lastType),
        sourceFile: str(c.sourceFile),
        pinned: bool(c.pinned),
        archived: bool(c.archived),
        createdAt: isoDate(c.createdAt) ?? new Date().toISOString(),
        messages: byChat.get(str(c.id)) ?? [],
      })),
    }
    return new Blob([JSON.stringify(payload)], { type: 'application/json' })
  }

  async importBackup(file: File): Promise<BackupImportResult> {
    const text = await file.text()
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      throw new DataError('Invalid JSON')
    }
    const { chats } = (payload ?? {}) as { chats?: unknown }
    if (!Array.isArray(chats)) throw new DataError('Field "chats" must be an array')

    const e = await this.db()
    let chatsCreated = 0
    let messagesImported = 0

    for (const raw of chats) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const c = raw as Record<string, unknown>
      if (typeof c.title !== 'string' || !c.title.trim()) continue

      const candidateId = strOrNull(c.id)
      const sourceFile = typeof c.sourceFile === 'string' ? c.sourceFile : ''
      // Duplicate guard: same id OR same title+sourceFile (server parity).
      const dup = candidateId
        ? await e.first(
            'SELECT id FROM "Chat" WHERE id = ? OR (title = ? AND sourceFile = ?)',
            [candidateId, c.title.trim(), sourceFile]
          )
        : await e.first('SELECT id FROM "Chat" WHERE title = ? AND sourceFile = ?', [
            c.title.trim(),
            sourceFile,
          ])
      if (dup) continue

      let chatId: string | null = null
      if (candidateId) {
        const taken = await e.first('SELECT id FROM "Chat" WHERE id = ?', [candidateId])
        if (!taken) {
          await e.runNoSave(
            `INSERT INTO "Chat" (id, title, isGroup, sourceFile, pinned, archived, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              candidateId,
              c.title.trim().slice(0, 300),
              boolOr(c.isGroup) ? 1 : 0,
              sourceFile,
              boolOr(c.pinned) ? 1 : 0,
              boolOr(c.archived) ? 1 : 0,
              isoDate(c.createdAt) ?? new Date().toISOString(),
            ]
          )
          chatId = candidateId
        }
      }
      if (!chatId) {
        chatId = newId()
        await e.runNoSave(
          `INSERT INTO "Chat" (id, title, isGroup, sourceFile, pinned, archived, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            chatId,
            c.title.trim().slice(0, 300),
            boolOr(c.isGroup) ? 1 : 0,
            sourceFile,
            boolOr(c.pinned) ? 1 : 0,
            boolOr(c.archived) ? 1 : 0,
            isoDate(c.createdAt) ?? new Date().toISOString(),
          ]
        )
      }
      chatsCreated++

      const messages = Array.isArray(c.messages) ? c.messages : []
      for (const rawMsg of messages) {
        if (!rawMsg || typeof rawMsg !== 'object' || Array.isArray(rawMsg)) continue
        const m = rawMsg as Record<string, unknown>
        const msgId = strOrNull(m.id)
        if (msgId && await e.first('SELECT id FROM "Message" WHERE id = ?', [msgId])) continue
        const ts = isoDate(m.ts)
        if (!ts) continue // invalid dates are dropped (server parity)
        // Media references from a backup are untrusted — basename only.
        let mediaPath = strOrNull(m.mediaPath)
        if (mediaPath) {
          const base = mediaPath.split(/[/\\]/).pop() ?? ''
          mediaPath = base && base !== '.' && base !== '..' ? base.slice(0, 255) : null
        }
        const finalId = msgId ?? newId()
        await e.runNoSave(
          `INSERT INTO "Message"
             (id, chatId, idx, ts, sender, body, type, mediaPath, mediaName,
              starred, edited, forwardedFrom, pollOptions, pinned, reactions, replyToId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            finalId,
            chatId,
            num(m.idx),
            ts,
            strOrNull(m.sender),
            typeof m.body === 'string' ? m.body.slice(0, 8000) : '',
            typeof m.type === 'string' && m.type ? m.type.slice(0, 40) : 'text',
            mediaPath,
            strOrNull(m.mediaName),
            boolOr(m.starred) ? 1 : 0,
            boolOr(m.edited) ? 1 : 0,
            strOrNull(m.forwardedFrom),
            jsonListColumn(m.pollOptions),
            boolOr(m.pinned) ? 1 : 0,
            jsonReactionsColumn(m.reactions),
            strOrNull(m.replyToId)?.slice(0, 64) ?? null,
          ]
        )
        messagesImported++
      }
      await this.refreshAggregates(e, chatId)
    }
    if (chatsCreated > 0) await this.engine.flush()
    // Idea #14: rolling on-device snapshot after backup restores too.
    if (chatsCreated > 0) maybeAutoSnapshot()
    return { chats: chatsCreated, messages: messagesImported }
  }
}

/** Client-side singleton. */
let client: LocalDataClient | null = null

export function getLocalClient(): LocalDataClient {
  if (!client) {
    client = new LocalDataClient()
    // Best-effort: never lose the last mutation when the tab/app closes.
    void client
      .whenReady()
      .then(() => getEngine().installLifecycleHooks())
      .catch(() => undefined)
  }
  return client
}
