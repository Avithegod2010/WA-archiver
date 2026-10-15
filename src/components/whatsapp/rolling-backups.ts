'use client'

/**
 * Rolling on-device snapshots (backlog idea #14).
 *
 * Keeps the last 5 full-database images (raw SQLite bytes from the local
 * engine) in IndexedDB, one-click restorable from Settings. Auto-snapshots
 * fire after every import (throttled); a manual "Snapshot now" always runs.
 *
 * Storage: IndexedDB database `wa-viewer-backups`, object store
 * `snapshots` — records `{ id, at, reason, size, chats, messages, bytes }`
 * keyed by id (epoch-based, so iteration order = chronological).
 *
 * Everything is guarded: without IndexedDB the card simply reports that
 * snapshots are unavailable; no snapshot path can ever destroy live data.
 */

import { getEngine } from '@/lib/data/local/engine'

const DB_NAME = 'wa-viewer-backups'
const STORE = 'snapshots'
/** Rolling window size. */
export const MAX_SNAPSHOTS = 5
/** Minimum age of the newest snapshot before an AUTO one is worth taking. */
const AUTO_THROTTLE_MS = 90_000

export type SnapshotReason = 'import' | 'manual' | 'restore'

export interface SnapshotMeta {
  id: string
  at: number
  reason: SnapshotReason
  size: number
  chats: number
  messages: number
}

export interface Snapshot extends SnapshotMeta {
  bytes: ArrayBuffer
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(new Error('IndexedDB unavailable for snapshots'))
  })
}

function txDone(db: IDBDatabase, tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error('Snapshot store write failed'))
    }
  })
}

function available(): boolean {
  return typeof indexedDB !== 'undefined'
}

/** Live counts (chats/messages) read straight from the local engine. */
function liveCounts(): { chats: number; messages: number } {
  try {
    const e = getEngine()
    if (!e.isReady()) return { chats: 0, messages: 0 }
    const chats = Number(e.scalar('SELECT COUNT(*) FROM "Chat"') ?? 0)
    const messages = Number(e.scalar('SELECT COUNT(*) FROM "Message"') ?? 0)
    return { chats, messages }
  } catch {
    return { chats: 0, messages: 0 }
  }
}

/** All snapshots, newest first (meta only — no bytes). */
export async function listSnapshots(): Promise<SnapshotMeta[]> {
  if (!available()) return []
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAll()
    req.onsuccess = () => {
      db.close()
      const rows = (req.result as Snapshot[]).map((s) => ({
        id: s.id,
        at: s.at,
        reason: s.reason,
        size: s.size,
        chats: s.chats,
        messages: s.messages,
      }))
      rows.sort((a, b) => b.at - a.at)
      resolve(rows)
    }
    req.onerror = () => {
      db.close()
      reject(req.error ?? new Error('Snapshot read failed'))
    }
  })
}

/**
 * Capture a snapshot of the CURRENT database.
 * `reason: 'import'` (auto) is throttled: skipped when the newest
 * snapshot is younger than AUTO_THROTTLE_MS (returns null).
 */
export async function takeSnapshot(
  reason: SnapshotReason
): Promise<SnapshotMeta | null> {
  if (!available()) return null
  const e = getEngine()
  if (!e.isReady()) return null

  if (reason === 'import') {
    const existing = await listSnapshots().catch(() => [])
    if (existing[0] && Date.now() - existing[0].at < AUTO_THROTTLE_MS) {
      return null // just snapshotted — nothing meaningful changed yet
    }
  }

  const bytes = e.exportDb()
  const { chats, messages } = liveCounts()
  const snap: Snapshot = {
    id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
    reason,
    size: bytes.byteLength,
    chats,
    messages,
    bytes: bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer,
  }

  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).put(snap)
  // Rolling window: drop the oldest entries beyond the cap.
  const all = tx.objectStore(STORE).getAll()
  all.onsuccess = () => {
    const rows = (all.result as Snapshot[]).sort((a, b) => a.at - b.at)
    for (const old of rows.slice(0, Math.max(0, rows.length - MAX_SNAPSHOTS))) {
      tx.objectStore(STORE).delete(old.id)
    }
  }
  await txDone(db, tx)
  const { bytes: _drop, ...meta } = snap
  return meta
}

/** Load one snapshot's bytes (restore path). */
export async function getSnapshot(id: string): Promise<Snapshot | null> {
  if (!available()) return null
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => {
      db.close()
      resolve((req.result as Snapshot | undefined) ?? null)
    }
    req.onerror = () => {
      db.close()
      reject(req.error ?? new Error('Snapshot read failed'))
    }
  })
}

/**
 * Restore a snapshot: captures a safety snapshot of the CURRENT state
 * first ('restore' reason — it becomes the newest rolling entry, so the
 * restore itself is undoable), then swaps the database image.
 * Returns the restored snapshot's counts.
 */
export async function restoreSnapshot(
  id: string
): Promise<{ chats: number; messages: number }> {
  const snap = await getSnapshot(id)
  if (!snap) throw new Error('Snapshot not found')
  // Safety net: the pre-restore state is itself snapshotted.
  const e = getEngine()
  if (e.isReady()) {
    const current = e.exportDb()
    const { chats, messages } = liveCounts()
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({
      id: `snap-${Date.now()}-pre`,
      at: Date.now(),
      reason: 'restore' as SnapshotReason,
      size: current.byteLength,
      chats,
      messages,
      bytes: current.buffer.slice(
        current.byteOffset,
        current.byteOffset + current.byteLength
      ) as ArrayBuffer,
    })
    await txDone(db, tx)
    await trimSnapshots()
  }
  await e.restoreFromBytes(new Uint8Array(snap.bytes))
  return { chats: snap.chats, messages: snap.messages }
}

export async function deleteSnapshot(id: string): Promise<void> {
  if (!available()) return
  const db = await openDb()
  const tx = db.transaction(STORE, 'readwrite')
  tx.objectStore(STORE).delete(id)
  await txDone(db, tx)
}

/** Keep at most MAX_SNAPSHOTS (used after safety snapshots too). */
async function trimSnapshots(): Promise<void> {
  const all = await listSnapshots().catch(() => [])
  for (const old of all.slice(MAX_SNAPSHOTS)) {
    await deleteSnapshot(old.id).catch(() => {})
  }
}

/**
 * Post-import hook (idea #14): call after every successful import.
 * Fire-and-forget safe — failures never break the import flow.
 */
export function maybeAutoSnapshot(): void {
  void takeSnapshot('import').catch(() => {})
}
