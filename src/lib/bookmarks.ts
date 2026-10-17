'use client'

/**
 * Per-chat message bookmarks. Local-only (localStorage), matching the
 * wallpaper / chat-theme stores: survives reloads under both the 'server'
 * and 'device' transports without extra schema or API surface.
 *
 * Storage shape: { [chatId]: BookmarkEntry[] } under `wa-viewer:bookmarks:v1`.
 * Every mutation replaces the per-chat array (stable snapshot refs for
 * useSyncExternalStore) and dispatches a window event so all open surfaces
 * (menu badge, dialog) stay in sync.
 */

export interface BookmarkEntry {
  id: string
  /** Target message id within the chat. */
  messageId: string
  /** User-editable name (defaults to a body preview). */
  label: string
  /** Short excerpt captured at save time (survives message edits). */
  excerpt: string
  /** Message timestamp (ISO string) captured at save time. */
  ts: string
  /** When the bookmark was created. */
  createdAt: string
}

type BookmarkMap = Record<string, BookmarkEntry[]>

const KEY = 'wa-viewer:bookmarks:v1'
const EVENT = 'wa-bookmarks-changed'

const EMPTY: BookmarkEntry[] = []
let cache: BookmarkMap | null = null

function readAll(): BookmarkMap {
  if (cache) return cache
  if (typeof window === 'undefined') return {}
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    cache = parsed && typeof parsed === 'object' ? (parsed as BookmarkMap) : {}
  } catch {
    cache = {}
  }
  return cache
}

function writeAll(map: BookmarkMap) {
  cache = map
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    // Storage unavailable — the in-memory copy still serves this session.
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

/** Stable-ref subscription for useSyncExternalStore. */
export function subscribeBookmarks(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, fn)
  window.addEventListener('storage', fn)
  return () => {
    window.removeEventListener(EVENT, fn)
    window.removeEventListener('storage', fn)
  }
}

/** Snapshot getter — always returns a stable reference until a mutation. */
export function getBookmarksSnapshot(chatId: string): BookmarkEntry[] {
  return readAll()[chatId] ?? EMPTY
}

export function loadBookmarks(chatId: string): BookmarkEntry[] {
  return getBookmarksSnapshot(chatId)
}

/** The bookmark pointing at `messageId`, if any (upsert lookup). */
export function bookmarkFor(
  chatId: string,
  messageId: string
): BookmarkEntry | undefined {
  return getBookmarksSnapshot(chatId).find((b) => b.messageId === messageId)
}

/** Create or update (by messageId) a bookmark; returns the stored entry. */
export function saveBookmark(
  chatId: string,
  entry: Omit<BookmarkEntry, 'id' | 'createdAt'>
): BookmarkEntry {
  const map = readAll()
  const list = map[chatId] ?? []
  const existing = list.find((b) => b.messageId === entry.messageId)
  if (existing) {
    existing.label = entry.label
    existing.excerpt = entry.excerpt
    existing.ts = entry.ts
    writeAll({ ...map, [chatId]: [...list] })
    return existing
  }
  const created: BookmarkEntry = {
    ...entry,
    id: `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  }
  writeAll({ ...map, [chatId]: [...list, created] })
  return created
}

export function removeBookmark(chatId: string, bookmarkId: string) {
  const map = readAll()
  const list = map[chatId]
  if (!list) return
  const next = list.filter((b) => b.id !== bookmarkId)
  writeAll({ ...map, [chatId]: next })
}
