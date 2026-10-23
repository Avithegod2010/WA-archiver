/**
 * Local persistence for chat folders, favorite chats and read-state ("seen").
 *
 * Plain module — no React. ChatList consumes it via useSyncExternalStore,
 * WhatsAppApp calls markChatRead() when a chat is opened.
 *
 * SSR-safe: no accessor ever touches localStorage on the server; client
 * snapshots are cached so useSyncExternalStore gets stable identities.
 */

export interface ChatFolder {
  id: string
  name: string
  emoji: string
  chatIds: string[]
}

export interface SeenEntry {
  lastAt: string
  count: number
}

export type SeenMap = Record<string, SeenEntry>

/** Minimal chat shape the unread math needs (ChatSummary satisfies it). */
export interface ChatSummaryLike {
  id: string
  messageCount: number
  lastAt: string | null
}

// ---------------------------------------------------------------------------
// Smart collections — auto-computed read-only folders (v1.8). Unlike custom
// folders they need no persistence: they derive from the live chat list.
// ---------------------------------------------------------------------------

export const SMART_MEDIA_ID = '__smart_media'
export const SMART_ACTIVE_ID = '__smart_active'
export const SMART_BIG_ID = '__smart_big'

/** Chats with at least one photo/video/voice/doc attached. */
export const SMART_MEDIA = {
  id: SMART_MEDIA_ID,
  name: 'Media',
  emoji: '🖼️',
} as const

/** Chats whose latest message is within the last 7 days. */
export const SMART_ACTIVE = {
  id: SMART_ACTIVE_ID,
  name: 'Active this week',
  emoji: '⏱️',
} as const

/** Top 5 chats by message volume (minimum 20 messages). */
export const SMART_BIG = {
  id: SMART_BIG_ID,
  name: 'Biggest',
  emoji: '📊',
} as const

export interface SmartChatLike {
  id: string
  messageCount: number
  mediaCount: number
  lastAt: string | null
}

export const SMART_FOLDERS = [SMART_MEDIA, SMART_ACTIVE, SMART_BIG] as const

const SMART_IDS = new Set<string>([SMART_MEDIA_ID, SMART_ACTIVE_ID, SMART_BIG_ID])

export function isSmartFolderId(id: string): boolean {
  return SMART_IDS.has(id)
}

/** Chat-id sets per smart folder, computed from the current chat list. */
export function computeSmartFolders(
  chats: SmartChatLike[]
): Record<string, string[]> {
  const weekCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  const media: string[] = []
  const active: string[] = []
  for (const c of chats) {
    if (c.mediaCount > 0) media.push(c.id)
    if (c.lastAt && new Date(c.lastAt).getTime() >= weekCutoff) active.push(c.id)
  }
  const big = chats
    .filter((c) => c.messageCount >= 20)
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 5)
    .map((c) => c.id)
  return { [SMART_MEDIA_ID]: media, [SMART_ACTIVE_ID]: active, [SMART_BIG_ID]: big }
}

export const FOLDERS_KEY = 'wa-viewer:folders'
export const FAVS_KEY = 'wa-viewer:fav-chats'
export const SEEN_KEY = 'wa-viewer:seen-chats'
export const ACTIVE_FOLDER_KEY = 'wa-viewer:active-folder'

const FOLDERS_EVENT = 'wa-folders-changed'
const FAVS_EVENT = 'wa-favs-changed'
const SEEN_EVENT = 'wa-seen-changed'
const ACTIVE_FOLDER_EVENT = 'wa-active-folder-changed'

/** Used when a chat is marked read without count info — zeroes any badge. */
const READ_ALL_COUNT = 9e15

const EMPTY_FOLDERS: ChatFolder[] = []
const EMPTY_FAVS: string[] = []
const EMPTY_SEEN: SeenMap = {}

/** Safe snapshots for useSyncExternalStore's getServerSnapshot (stable refs). */
export const EMPTY_FOLDERS_SNAPSHOT = EMPTY_FOLDERS
export const EMPTY_FAVS_SNAPSHOT = EMPTY_FAVS
export const EMPTY_SEEN_SNAPSHOT = EMPTY_SEEN

// ---------------------------------------------------------------------------
// Snapshot caches (identity-stable between writes)
// ---------------------------------------------------------------------------

let foldersCache: ChatFolder[] | null = null
let favsCache: string[] | null = null
let seenCache: SeenMap | null = null

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function invalidateCaches(key: string | null): void {
  if (key === null || key === FOLDERS_KEY) foldersCache = null
  if (key === null || key === FAVS_KEY) favsCache = null
  if (key === null || key === SEEN_KEY) seenCache = null
}

// ---------------------------------------------------------------------------
// Sanitizers (localStorage content is untrusted)
// ---------------------------------------------------------------------------

function sanitizeFolders(raw: unknown): ChatFolder[] {
  if (!Array.isArray(raw)) return []
  const out: ChatFolder[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    if (!id || !name) continue
    const emoji = typeof o.emoji === 'string' && o.emoji ? o.emoji : '📁'
    const chatIds = Array.isArray(o.chatIds)
      ? o.chatIds.filter((x): x is string => typeof x === 'string')
      : []
    out.push({ id, name, emoji, chatIds })
  }
  return out
}

function sanitizeIds(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === 'string')
    : []
}

function sanitizeSeen(raw: unknown): SeenMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: SeenMap = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    const lastAt = typeof o.lastAt === 'string' ? o.lastAt : ''
    const count =
      typeof o.count === 'number' && Number.isFinite(o.count) ? o.count : 0
    out[k] = { lastAt, count }
  }
  return out
}

// ---------------------------------------------------------------------------
// Notifications (same-tab: custom event; cross-tab: real storage event)
// ---------------------------------------------------------------------------

function notify(key: string, eventName: string): void {
  try {
    window.dispatchEvent(new StorageEvent('storage', { key }))
  } catch {
    // StorageEvent construction can be restricted — custom event still fires
  }
  window.dispatchEvent(new CustomEvent(eventName))
}

function makeSubscribe(key: string, eventName: string) {
  return function subscribe(cb: () => void): () => void {
    if (typeof window === 'undefined') return () => {}
    const onStorage = (e: StorageEvent): void => {
      if (e.key === key || e.key === null) {
        invalidateCaches(key)
        cb()
      }
    }
    const onCustom = (): void => {
      invalidateCaches(key)
      cb()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(eventName, onCustom)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(eventName, onCustom)
    }
  }
}

export const subscribeFolders = makeSubscribe(FOLDERS_KEY, FOLDERS_EVENT)
export const subscribeFavChats = makeSubscribe(FAVS_KEY, FAVS_EVENT)
export const subscribeSeen = makeSubscribe(SEEN_KEY, SEEN_EVENT)

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export function getFolders(): ChatFolder[] {
  if (foldersCache !== null) return foldersCache
  foldersCache = sanitizeFolders(readJSON<unknown>(FOLDERS_KEY, []))
  return foldersCache
}

export function setFolders(folders: ChatFolder[]): void {
  if (typeof window === 'undefined') return
  const clean = sanitizeFolders(folders)
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(clean))
  } catch {
    return
  }
  foldersCache = clean
  notify(FOLDERS_KEY, FOLDERS_EVENT)
}

// ---------------------------------------------------------------------------
// Favorite chats
// ---------------------------------------------------------------------------

export function getFavChats(): string[] {
  if (favsCache !== null) return favsCache
  favsCache = sanitizeIds(readJSON<unknown>(FAVS_KEY, []))
  return favsCache
}

export function toggleFavChat(id: string): void {
  if (typeof window === 'undefined' || !id) return
  const prev = getFavChats()
  const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
  try {
    localStorage.setItem(FAVS_KEY, JSON.stringify(next))
  } catch {
    return
  }
  favsCache = next
  notify(FAVS_KEY, FAVS_EVENT)
}

// ---------------------------------------------------------------------------
// Seen / read-state
// ---------------------------------------------------------------------------

export function getSeenMap(): SeenMap {
  if (seenCache !== null) return seenCache
  seenCache = sanitizeSeen(readJSON<unknown>(SEEN_KEY, {}))
  return seenCache
}

function writeSeen(next: SeenMap): void {
  try {
    // Cap growth: one entry per chat ever opened would otherwise accumulate
    // forever (incl. chats deleted long ago). Keep the most recent 500.
    const entries = Object.entries(next)
    if (entries.length > 500) {
      entries.sort((a, b) => (b[1].lastAt ?? '').localeCompare(a[1].lastAt ?? ''))
      next = Object.fromEntries(entries.slice(0, 500))
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(next))
  } catch {
    return
  }
  seenCache = next
  notify(SEEN_KEY, SEEN_EVENT)
}

/**
 * Record a chat as read up to its current state. Tolerant: the chat object is
 * optional / partial — missing counts fall back to a sentinel that zeroes the
 * badge, missing lastAt is stored as '' so null-lastAt chats still compare equal.
 */
export function markChatRead(
  chatId: string,
  chat?: {
    id?: string
    messageCount?: number
    lastAt?: string | null
  } | null
): void {
  if (typeof window === 'undefined' || !chatId) return
  const seen = getSeenMap()
  const lastAt = typeof chat?.lastAt === 'string' ? chat.lastAt : ''
  const count =
    typeof chat?.messageCount === 'number' ? chat.messageCount : READ_ALL_COUNT
  const prev = seen[chatId]
  if (prev && prev.lastAt === lastAt && prev.count === count) return
  writeSeen({ ...seen, [chatId]: { lastAt, count } })
}

export function markAllRead(
  chats: {
    id: string
    messageCount: number
    lastAt: string | null
  }[]
): void {
  if (typeof window === 'undefined') return
  const seen = getSeenMap()
  const next: SeenMap = { ...seen }
  let changed = false
  for (const c of chats) {
    if (!c || typeof c.id !== 'string' || !c.id) continue
    const lastAt = typeof c.lastAt === 'string' ? c.lastAt : ''
    const count =
      typeof c.messageCount === 'number' ? c.messageCount : READ_ALL_COUNT
    const prev = next[c.id]
    if (prev && prev.lastAt === lastAt && prev.count === count) continue
    next[c.id] = { lastAt, count }
    changed = true
  }
  if (!changed) return
  writeSeen(next)
}

/**
 * Unread count for one chat. A chat never opened on this device (no seen
 * entry) is never "unread" — we don't spam badges for old imports. Once a
 * seen entry exists, new messages are messageCount - seen.count.
 */
export function unreadFor(chat: ChatSummaryLike, seen: SeenMap): number {
  const entry = seen[chat.id]
  if (!entry) return 0
  const lastAt = chat.lastAt ?? ''
  if (lastAt !== entry.lastAt) {
    const count =
      typeof chat.messageCount === 'number' ? chat.messageCount : 0
    return Math.max(0, count - entry.count)
  }
  return 0
}

// ---------------------------------------------------------------------------
// Active folder (persisted selection)
// ---------------------------------------------------------------------------

export function getActiveFolderId(): string {
  if (typeof window === 'undefined') return 'all'
  try {
    return window.localStorage.getItem(ACTIVE_FOLDER_KEY) ?? 'all'
  } catch {
    return 'all'
  }
}

export function setActiveFolderId(id: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ACTIVE_FOLDER_KEY, id)
  } catch {
    // storage unavailable — selection just won't persist
    return
  }
  try {
    window.dispatchEvent(new CustomEvent(ACTIVE_FOLDER_EVENT))
  } catch {
    // ignore
  }
}

/**
 * Subscription for the persisted active-folder id. Feed to useSyncExternalStore
 * with getActiveFolderId as getSnapshot and a CONSTANT (e.g. () => 'all') as
 * getServerSnapshot — getServerSnapshot also runs on the client during
 * hydration, so it must never touch localStorage.
 */
export function subscribeActiveFolder(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent): void => {
    if (e.key === ACTIVE_FOLDER_KEY || e.key === null) cb()
  }
  const onCustom = (): void => {
    cb()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(ACTIVE_FOLDER_EVENT, onCustom)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(ACTIVE_FOLDER_EVENT, onCustom)
  }
}
