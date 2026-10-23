/**
 * DataClient — the storage seam for the local-first refactor (Phase 1).
 *
 * Everything the UI needs from "the data layer" is expressed here. Two
 * implementations exist / are planned:
 *
 *   • ServerDataClient — wraps the existing REST API (`/api/*`).
 *     (Phase 2 wires it in; today components still call fetch directly.)
 *
 *   • LocalDataClient — a fully on-device engine (src/lib/data/local/):
 *     SQLite compiled to WebAssembly, persisted to OPFS (IndexedDB
 *     fallback), media as Blobs in IndexedDB. Zero network.
 *
 * Phase 2 swaps the feature modules over to a DataClient one by one while
 * the app keeps working; Phase 3 bundles the local client into the APK so
 * the whole app runs with no internet and no server.
 *
 * The DTO shapes intentionally reuse the UI's own types
 * (`@/components/whatsapp/types`) so a swap is a transport change only —
 * rendering code stays untouched.
 */

import type {
  ChatDetail,
  ChatMessage,
  ChatSummary,
} from '@/components/whatsapp/types'

/** Payload for creating a new message row (text, note, location, …). */
export interface SendMessageInput {
  type: string
  body?: string
  sender?: string | null
  /** Media already stored with the client — stored name inside the media store. */
  mediaPath?: string | null
  mediaName?: string | null
  /**
   * Raw media to attach (browser File/Blob). Implementations store it
   * themselves — server transport uploads multipart, device transport writes
   * into the IndexedDB media store — and infer the message type from the
   * file name when `type` is absent or generic.
   */
  media?: Blob | null
  replyToId?: string | null
  forwardedFrom?: string | null
  pollOptions?: string[] | null
  /** Wall-clock override (import paths use parsed timestamps). */
  ts?: Date | string
}

/** Payload for importing a parsed WhatsApp export. */
export interface ImportParsedInput {
  /**
   * When provided, messages attach to this existing chat (the import path
   * creates the chat first so media blobs have an owner). Otherwise a new
   * chat row is created — mirrors persistParsedChat(chatId?).
   */
  chatId?: string
  title: string
  sourceFile: string
  isGroup: boolean
  messages: {
    ts: Date
    sender: string | null
    body: string
    type: string
    mediaName: string | null
    pollOptions?: string[] | null
  }[]
  /**
   * lowercase original basename → stored media name. Files referenced by
   * messages must already be persisted via `putMedia`.
   */
  mediaMap?: Map<string, string>
}

/** A scheduled (auto-send later) message row. */
export interface ScheduledItem {
  id: string
  chatId: string
  body: string
  sender: string
  deliverAt: string
  createdAt: string
  status: string
}

// ---- Cross-transport DTOs (mirror the /api JSON responses) -----------------

/** One hit inside GlobalSearch (mirrors GET /api/search chats[].hits[]). */
export interface SearchHit {
  id: string
  idx: number
  ts: string
  sender: string | null
  body: string
  type: string
}

/** Per-chat bucket of search results (mirrors GET /api/search chats[]). */
export interface SearchChatGroup {
  id: string
  title: string
  isGroup: boolean
  count: number
  hits: SearchHit[]
}

export interface SearchResult {
  query: string
  totalChats: number
  totalHits: number
  truncated: boolean
  chats: SearchChatGroup[]
}

/** Starred list row (mirrors GET /api/chats/:id/starred items[]). */
export interface StarredItem {
  id: string
  idx: number
  ts: string
  sender: string | null
  body: string
  type: string
  mediaPath: string | null
  mediaName: string | null
}

/** Media gallery row (mirrors GET /api/chats/:id/media items[]). */
export interface MediaItem extends StarredItem {
  /** File size in bytes when known (null when the blob is missing). */
  bytes: number | null
}

/** Global media-hub row (mirrors GET /api/media-index items[]). */
export interface AllMediaItem extends MediaItem {
  /** Owning chat (the hub groups/filters across every chat). */
  chatId: string
  chatTitle: string
  /** Reuses the message-level star as the media "favorite". */
  starred: boolean
}

/** One "On this day" card (mirrors GET /api/memories groups[].items[]). */
export interface MemoryItem {
  id: string
  chatId: string
  chatTitle: string
  isGroup: boolean
  sender: string | null
  ts: string
  type: string
  preview: string
  hasMedia: boolean
  mediaName?: string
}

export interface MemoryGroup {
  key: string
  label: string
  items: MemoryItem[]
}

export interface MemoriesResult {
  date: string
  groups: MemoryGroup[]
}

/** Result envelope for local backup import. */
export interface BackupImportResult {
  chats: number
  messages: number
}

/** Live status of the on-device database (drives the Device storage card). */
export interface DeviceStatus {
  ready: boolean
  /** null until the engine finished loading. */
  engine: 'sqlite-wasm' | 'sqlite-native' | null
  /** Where the SQLite file itself is persisted. */
  persistence: 'opfs' | 'indexeddb' | 'native' | null
  /** Size of the SQLite database file in bytes (0 when fresh). */
  dbBytes: number
  /** Row counts from the local database. */
  chats: number
  messages: number
  scheduled: number
  /** Media blobs living in the IndexedDB media store. */
  mediaFiles: number
  mediaBytes: number
  /** Last successful flush of the database file to disk (ISO string). */
  lastSavedAt: string | null
}

/** Errors the UI can show directly (already human-readable English). */
export class DataError extends Error {}

/**
 * The seam. Every method is async and UI-safe (no Prisma, no fs, no node
 * built-ins may be referenced by implementations).
 */
export interface DataClient {
  // ---- chats ------------------------------------------------------------
  listChats(): Promise<ChatSummary[]>
  getChatDetail(id: string): Promise<ChatDetail>
  createChat(input: {
    title: string
    isGroup?: boolean
    sourceFile?: string
    pinned?: boolean
    lastPreview?: string
  }): Promise<ChatSummary>
  deleteChat(id: string): Promise<void>
  setChatFlags(
    id: string,
    flags: { pinned?: boolean; archived?: boolean }
  ): Promise<void>

  // ---- messages ---------------------------------------------------------
  sendMessage(chatId: string, input: SendMessageInput): Promise<ChatMessage>
  /** Import a parsed export (creates the chat row + all messages). */
  importParsed(input: ImportParsedInput): Promise<{ chatId: string }>
  deleteMessage(id: string): Promise<void>
  /**
   * Bulk media deletion (media hub). Deletes the stored file behind each
   * message and marks the row `type='deleted'` ("Media deleted: <name>") —
   * the message stays in the transcript, the bytes go. Ids without media
   * are ignored. Returns how many messages were updated.
   */
  deleteMessageMedia(ids: string[]): Promise<number>
  /**
   * Apply a star state; resolves to the applied value. Callers pass the
   * explicit target state (the UI computes it before calling).
   */
  toggleStar(id: string, starred: boolean): Promise<boolean>
  setMessagePinned(id: string, pinned: boolean): Promise<void>
  /**
   * Store the given absolute reaction map (null clears). The UI computes the
   * toggled map locally so both transports behave identically.
   */
  setReactions(
    id: string,
    reactions: Record<string, string[]> | null
  ): Promise<ChatMessage | null>
  markMessageEdited(id: string, body: string): Promise<ChatMessage | null>
  /**
   * Unsend a message: replace it with a WhatsApp-style tombstone
   * ("This message was deleted") instead of hard-deleting the row, so the
   * transcript keeps an audit trail. Drops any stored media behind it.
   */
  unsendMessage(id: string): Promise<ChatMessage | null>
  /** Copy a message (incl. its media blob) into another chat. */
  forwardMessage(id: string, targetChatId: string): Promise<ChatMessage | null>

  // ---- media (device-local blob store) -----------------------------------
  /** Persist one media blob; returns the unique stored name. */
  putMedia(
    chatId: string,
    originalName: string,
    blob: Blob
  ): Promise<string>
  /** A same-origin URL for rendering, or null when the file is missing. */
  mediaUrl(chatId: string, name: string): Promise<string | null>
  /** Release a URL obtained from mediaUrl (object URL revocation). */
  releaseMediaUrl(url: string): void

  // ---- scheduled messages -------------------------------------------------
  listScheduled(chatId?: string): Promise<ScheduledItem[]>
  createScheduled(input: {
    chatId: string
    body: string
    sender?: string
    deliverAt: Date | string
  }): Promise<ScheduledItem>
  cancelScheduled(id: string): Promise<void>
  setScheduledStatus(id: string, status: string): Promise<void>
  /**
   * Deliver every due pending scheduled message now (same contract as
   * POST /api/scheduled/dispatch). Idempotent.
   */
  dispatchScheduled(): Promise<{ delivered: number; chatIds: string[] }>

  // ---- discovery / reads (ported server analytics) --------------------------
  searchAll(query: string): Promise<SearchResult>
  listStarred(chatId: string): Promise<{ items: StarredItem[] }>
  listChatMedia(chatId: string): Promise<{ items: MediaItem[] }>
  /**
   * Global media index across every chat, newest first (media hub).
   * Capped server-side; `truncated` is true when older rows were dropped.
   */
  listAllMedia(): Promise<{ items: AllMediaItem[]; truncated?: boolean }>
  /** A downloadable zip of the chat's media (blob), or null when empty. */
  chatMediaZip(chatId: string): Promise<Blob | null>
  memories(mmd?: string): Promise<MemoriesResult>

  // ---- app settings (key/value, on-device) --------------------------------
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
  deleteSetting(key: string): Promise<void>

  // ---- lifecycle / diagnostics --------------------------------------------
  /** Wait for the engine to be ready (idempotent). */
  whenReady(): Promise<void>
  deviceStatus(): Promise<DeviceStatus>
  /** Persist the SQLite file right now (used before unload / after import). */
  flush(): Promise<void>
  /** Delete the whole on-device database + media store. */
  wipe(): Promise<void>

  // ---- backup (JSON snapshot, same shape as GET /api/backup) ---------------
  /** Build the full JSON backup blob (media excluded, like the server). */
  exportBackup(): Promise<Blob>
  /** Restore from a backup file produced by exportBackup or GET /api/backup. */
  importBackup(file: File): Promise<BackupImportResult>
}
