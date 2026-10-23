/**
 * ServerDataClient — the REST transport of the DataClient seam.
 *
 * Wraps the existing `/api/*` routes with the same contracts the UI used to
 * call directly, so rewiring a component from `fetch(...)` to
 * `useData().listChats()` is a transport change only — zero behavior change
 * in server mode.
 *
 * Methods that only make sense on-device (putMedia/deviceStatus/wipe,
 * importParsed) either throw a DataError or no-op; the UI never reaches them
 * in server mode (imports branch to the multipart /api/import flow instead).
 */

import type {
  ChatDetail,
  ChatMessage,
  ChatSummary,
} from '@/components/whatsapp/types'
import {
  DataError,
  type AllMediaItem,
  type BackupImportResult,
  type DataClient,
  type DeviceStatus,
  type MemoriesResult,
  type MediaItem,
  type ScheduledItem,
  type SearchHit,
  type SearchResult,
  type SendMessageInput,
  type StarredItem,
  type TranscriptMessage,
} from './types'

const SAVED_CHAT_ID = 'saved-messages'

async function json<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => null)) as T | null
  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error?: unknown }).error)
        : `Request failed (${res.status})`
    throw new DataError(message)
  }
  if (data === null) throw new DataError('Invalid server response')
  return data
}

function get(url: string): Promise<Response> {
  return fetch(url, { cache: 'no-store' })
}

export class ServerDataClient implements DataClient {
  // ---- chats -------------------------------------------------------------

  async listChats(): Promise<ChatSummary[]> {
    const data = await json<{ chats?: ChatSummary[] }>(await get('/api/chats'))
    return data.chats ?? []
  }

  async getChatDetail(id: string): Promise<ChatDetail> {
    return json<ChatDetail>(await get(`/api/chats/${encodeURIComponent(id)}/messages`))
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

  async createChat(input: {
    title: string
    isGroup?: boolean
    sourceFile?: string
    pinned?: boolean
    lastPreview?: string
  }): Promise<ChatSummary> {
    const res = await fetch('/api/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const data = await json<{ chat: ChatSummary }>(res)
    return data.chat
  }

  async deleteChat(id: string): Promise<void> {
    await json(await fetch(`/api/chats/${encodeURIComponent(id)}`, { method: 'DELETE' }))
  }

  async setChatFlags(
    id: string,
    flags: { pinned?: boolean; archived?: boolean }
  ): Promise<void> {
    const res = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(flags),
    })
    await json(res)
  }

  // ---- messages ------------------------------------------------------------

  async sendMessage(chatId: string, input: SendMessageInput): Promise<ChatMessage> {
    const base = `/api/chats/${encodeURIComponent(chatId)}/messages`
    let res: Response
    if (input.media) {
      // Multipart upload — the server infers the type from the file.
      const form = new FormData()
      form.append('file', input.media, input.mediaName || 'attachment')
      if (input.body) form.append('caption', input.body)
      if (input.replyToId) form.append('replyToId', input.replyToId)
      res = await fetch(base, { method: 'POST', body: form })
    } else {
      res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: input.type,
          body: input.body,
          sender: input.sender,
          replyToId: input.replyToId,
          forwardedFrom: input.forwardedFrom,
          pollOptions: input.pollOptions,
          ts: input.ts,
        }),
      })
    }
    const data = await json<{ message?: ChatMessage }>(res)
    if (!data.message) throw new DataError('Server returned no message')
    return data.message
  }

  /** Server imports take files (multipart) — parsed payloads are device-only. */
  async importParsed(): Promise<{ chatId: string }> {
    throw new DataError('Parsed imports run on-device; use the file import flow')
  }

  async deleteMessage(id: string): Promise<void> {
    await json(await fetch(`/api/messages/${encodeURIComponent(id)}`, { method: 'DELETE' }))
  }

  async deleteMessageMedia(ids: string[]): Promise<number> {
    const res = await json<{ deleted?: number }>(
      await fetch('/api/messages/delete-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
    )
    return res.deleted ?? 0
  }

  async toggleStar(id: string, starred: boolean): Promise<boolean> {
    await json(
      await fetch(`/api/messages/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ starred }),
      })
    )
    return starred
  }

  async setMessagePinned(id: string, pinned: boolean): Promise<void> {
    await json(
      await fetch(`/api/messages/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned }),
      })
    )
  }

  async setReactions(
    id: string,
    reactions: Record<string, string[]> | null
  ): Promise<ChatMessage | null> {
    const res = await fetch(`/api/messages/${encodeURIComponent(id)}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reactions: reactions ?? {} }),
    })
    const data = await json<{ message?: ChatMessage | null }>(res)
    return data.message ?? null
  }

  async markMessageEdited(id: string, body: string): Promise<ChatMessage | null> {
    const res = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    })
    const data = await json<{ message?: ChatMessage | null }>(res)
    return data.message ?? null
  }

  /** Unsend → tombstone via the shared PATCH route ({ unsend: true }). */
  async unsendMessage(id: string): Promise<ChatMessage | null> {
    const res = await fetch(`/api/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unsend: true }),
    })
    const data = await json<{ message?: ChatMessage | null }>(res)
    return data.message ?? null
  }

  async forwardMessage(id: string, targetChatId: string): Promise<ChatMessage | null> {
    const res = await fetch(`/api/messages/${encodeURIComponent(id)}/forward`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetChatId }),
    })
    const data = await json<{ message?: ChatMessage | null }>(res)
    return data.message ?? null
  }

  // ---- media ---------------------------------------------------------------

  /** Media never pre-stores on the server transport; sends take the Blob. */
  async putMedia(): Promise<string> {
    throw new DataError('Direct media storage is device-only')
  }

  async mediaUrl(chatId: string, name: string): Promise<string | null> {
    return `/api/media/${encodeURIComponent(chatId)}/${encodeURIComponent(name)}`
  }

  releaseMediaUrl(): void {
    /* nothing to release — server URLs are not object URLs */
  }

  // ---- scheduled messages ----------------------------------------------------

  async listScheduled(chatId?: string): Promise<ScheduledItem[]> {
    const url = chatId
      ? `/api/scheduled?chatId=${encodeURIComponent(chatId)}`
      : '/api/scheduled'
    const data = await json<{ items?: ScheduledItem[] }>(await get(url))
    return data.items ?? []
  }

  async createScheduled(input: {
    chatId: string
    body: string
    sender?: string
    deliverAt: Date | string
  }): Promise<ScheduledItem> {
    const res = await fetch('/api/scheduled', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: input.chatId,
        body: input.body,
        sender: input.sender,
        deliverAt:
          input.deliverAt instanceof Date
            ? input.deliverAt.toISOString()
            : input.deliverAt,
      }),
    })
    const data = await json<{ item?: ScheduledItem }>(res)
    if (!data.item) throw new DataError('Server returned no scheduled item')
    return data.item
  }

  async cancelScheduled(id: string): Promise<void> {
    await json(
      await fetch(`/api/scheduled/${encodeURIComponent(id)}`, { method: 'DELETE' })
    )
  }

  /** Server dispatch owns status transitions; direct writes are device-only. */
  async setScheduledStatus(): Promise<void> {
    throw new DataError('Scheduled status is managed by the server dispatcher')
  }

  async dispatchScheduled(): Promise<{ delivered: number; chatIds: string[] }> {
    const res = await fetch('/api/scheduled/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const data = await json<{ delivered?: number; chatIds?: string[] }>(res)
    return {
      delivered: typeof data.delivered === 'number' ? data.delivered : 0,
      chatIds: Array.isArray(data.chatIds) ? data.chatIds : [],
    }
  }

  // ---- discovery / reads ------------------------------------------------------

  async searchAll(query: string): Promise<SearchResult> {
    const q = query.trim()
    if (!q) {
      return { query: '', totalChats: 0, totalHits: 0, truncated: false, chats: [] }
    }
    const data = await json<Partial<SearchResult>>(await get(`/api/search?q=${encodeURIComponent(q)}`))
    return {
      query: data.query ?? q,
      totalChats: data.totalChats ?? 0,
      totalHits: data.totalHits ?? 0,
      truncated: Boolean(data.truncated),
      chats: data.chats ?? [],
    }
  }

  async listStarred(chatId: string): Promise<{ items: StarredItem[] }> {
    const data = await json<{ items?: StarredItem[] }>(
      await get(`/api/chats/${encodeURIComponent(chatId)}/starred`)
    )
    return { items: data.items ?? [] }
  }

  async listChatMedia(chatId: string): Promise<{ items: MediaItem[] }> {
    const data = await json<{ items?: MediaItem[] }>(
      await get(`/api/chats/${encodeURIComponent(chatId)}/media`)
    )
    return { items: data.items ?? [] }
  }

  async listAllMedia(): Promise<{ items: AllMediaItem[]; truncated?: boolean }> {
    const data = await json<{ items?: AllMediaItem[]; truncated?: boolean }>(
      await get('/api/media-index')
    )
    return { items: data.items ?? [], truncated: data.truncated }
  }

  async chatMediaZip(chatId: string): Promise<Blob | null> {
    const res = await get(`/api/chats/${encodeURIComponent(chatId)}/media-zip`)
    if (!res.ok) return null
    return res.blob()
  }

  async memories(mmd?: string): Promise<MemoriesResult> {
    const url = mmd ? `/api/memories?mmd=${encodeURIComponent(mmd)}` : '/api/memories'
    return json<MemoriesResult>(await get(url))
  }

  // ---- app settings ---------------------------------------------------------
  // The generic key/value store is device-only; server-side lock settings are
  // managed through /api/auth/lock by the lock client.

  async getSetting(): Promise<string | null> {
    return null
  }

  async setSetting(): Promise<void> {
    /* no-op on the server transport */
  }

  async deleteSetting(): Promise<void> {
    /* no-op on the server transport */
  }

  // ---- lifecycle / diagnostics -------------------------------------------------

  async whenReady(): Promise<void> {
    /* server transport is always "ready" */
  }

  async deviceStatus(): Promise<DeviceStatus> {
    throw new DataError('Device status is available on-device only')
  }

  async flush(): Promise<void> {
    /* nothing to persist */
  }

  async wipe(): Promise<void> {
    throw new DataError('Wiping the server database is not supported from the client')
  }

  // ---- backup ----------------------------------------------------------------

  async exportBackup(): Promise<Blob> {
    const res = await get('/api/backup')
    if (!res.ok) throw new DataError('Backup failed')
    return res.blob()
  }

  async importBackup(file: File): Promise<BackupImportResult> {
    const text = await file.text()
    JSON.parse(text) // fail fast on invalid JSON before the request
    const res = await fetch('/api/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text,
    })
    const data = await json<{
      chatsCreated?: number
      chatsSkipped?: number
      messagesImported?: number
    }>(res)
    return {
      chats: data.chatsCreated ?? 0,
      messages: data.messagesImported ?? 0,
    }
  }
}

/** Stateless singleton — the server transport holds no connections. */
export const serverDataClient = new ServerDataClient()

/** Re-export so transport-agnostic code can reference the constant safely. */
export { SAVED_CHAT_ID as SERVER_SAVED_CHAT_ID }

/** Type-only helper used by tests/tools to enumerate the SearchHit shape. */
export type { SearchHit }
