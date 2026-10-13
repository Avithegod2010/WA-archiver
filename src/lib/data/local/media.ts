'use client'

/**
 * Device-local media store (IndexedDB).
 *
 * On the server, imported media lives on disk under db/media/<chatId>/ and
 * is served by /api/media/[chatId]/[name]. On the device it lives as Blobs
 * in IndexedDB, keyed "chatId/storedName", and is rendered through object
 * URLs handed out by the local DataClient. Stored names are produced by the
 * same collision-safe scheme as the server (see sanitizeName/uniquify).
 *
 * One DB ('wa-viewer-media'), one object store ('files') with an index on
 * the chatId part of the key for per-chat listing/counts/deletion.
 */

const DB_NAME = 'wa-viewer-media'
const STORE = 'files'
const CHAT_INDEX = 'chat'

export interface MediaRecord {
  blob: Blob
  /** Declared size in bytes (kept even if the blob loses its type). */
  size: number
  /** MIME type at store time. */
  type: string
  storedAt: string
}

function chatIdFromKey(key: string): string {
  const i = key.indexOf('/')
  return i === -1 ? key : key.slice(0, i)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE)
        os.createIndex(CHAT_INDEX, 'chatId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed'))
  })
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed'))
  })
}

/**
 * Strip filesystem-hostile characters (mirrors the server's sanitizeName,
 * minus the fs-specific length rule) and keep the bare basename.
 */
function sanitizeName(name: string): string {
  const base = (name.split(/[/\\]/).pop() ?? 'file').trim()
  return (
    base
      .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .replace(/[/\\?%*:|"<>\u0000-\u001f]/g, '_')
      .slice(-150) || 'file'
  )
}

/** Uniquify a stored name within a chat (same scheme as saveMediaFile). */
async function uniquify(chatId: string, safe: string): Promise<string> {
  if (!(await exists(chatId, safe))) return safe
  const dot = safe.lastIndexOf('.')
  const stem = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ''
  for (let i = 1; i < 500; i++) {
    const candidate = `${stem}_${i}${ext}`
    if (!(await exists(chatId, candidate))) return candidate
  }
  return `${stem}_${crypto.randomUUID().slice(0, 8)}${ext}`
}

async function exists(chatId: string, storedName: string): Promise<boolean> {
  const db = await openDb()
  try {
    const rec = await requestToPromise(
      db.transaction(STORE).objectStore(STORE).get(`${chatId}/${storedName}`)
    )
    return rec != null
  } finally {
    db.close()
  }
}

/** Save a blob under a chat; returns the unique stored name. */
export async function putMediaBlob(
  chatId: string,
  originalName: string,
  blob: Blob
): Promise<string> {
  const safe = sanitizeName(originalName)
  const stored = await uniquify(chatId, safe)
  const db = await openDb()
  try {
    const record: MediaRecord & { chatId: string } = {
      chatId,
      blob,
      size: blob.size,
      type: blob.type || 'application/octet-stream',
      storedAt: new Date().toISOString(),
    }
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(record, `${chatId}/${stored}`)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    })
    return stored
  } finally {
    db.close()
  }
}

export async function getMediaBlob(
  chatId: string,
  storedName: string
): Promise<MediaRecord | null> {
  const db = await openDb()
  try {
    const rec = await requestToPromise(
      db.transaction(STORE).objectStore(STORE).get(`${chatId}/${storedName}`)
    )
    if (!rec) return null
    const { blob, size, type, storedAt } = rec as MediaRecord & {
      chatId: string
    }
    return { blob, size: size ?? blob.size, type, storedAt }
  } finally {
    db.close()
  }
}

export async function deleteMediaForChat(chatId: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const keys = await requestToPromise(store.getAllKeys())
    for (const key of keys) {
      if (typeof key === 'string' && chatIdFromKey(key) === chatId) {
        store.delete(key)
      }
    }
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } finally {
    db.close()
  }
}

export async function clearAllMedia(): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } finally {
    db.close()
  }
}

export interface MediaStats {
  files: number
  bytes: number
}

export async function mediaStats(): Promise<MediaStats> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const records = (await requestToPromise(
      store.getAll()
    )) as (MediaRecord & { chatId: string })[]
    let bytes = 0
    for (const r of records ?? []) bytes += r.size ?? r.blob?.size ?? 0
    return { files: records?.length ?? 0, bytes }
  } finally {
    db.close()
  }
}

export async function mediaBytesForChat(chatId: string): Promise<MediaStats> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const index = tx.objectStore(STORE).index(CHAT_INDEX)
    const records = (await requestToPromise(
      index.getAll(chatId)
    )) as (MediaRecord & { chatId: string })[]
    let bytes = 0
    for (const r of records) bytes += r.size ?? r.blob?.size ?? 0
    return { files: records.length, bytes }
  } finally {
    db.close()
  }
}

/**
 * Per-file byte sizes for one chat, keyed by the blob's base name (the
 * message row's mediaPath). Media gallery rows use this to show sizes the
 * same way the server route (statSync) does.
 */
export async function mediaBytesByName(
  chatId: string
): Promise<Map<string, number>> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const index = tx.objectStore(STORE).index(CHAT_INDEX)
    const records = (await requestToPromise(
      index.getAll(chatId)
    )) as (MediaRecord & { chatId: string })[]
    const keys = (await requestToPromise(
      index.getAllKeys(chatId)
    )) as IDBValidKey[]
    const map = new Map<string, number>()
    const prefix = `${chatId}/`
    keys.forEach((key, i) => {
      const raw = String(key)
      if (!raw.startsWith(prefix)) return
      const name = raw.slice(prefix.length)
      const r = records[i]
      if (name && r) map.set(name, r.size ?? r.blob?.size ?? 0)
    })
    return map
  } finally {
    db.close()
  }
}
