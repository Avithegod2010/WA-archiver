'use client'

/**
 * SQLite-WASM engine for the on-device database.
 *
 * Runtime: sql.js (SQLite compiled to WebAssembly), loaded as a plain
 * static asset from /sql-wasm.js + /sql-wasm.wasm — no bundler plumbing,
 * works in dev, production and the Capacitor APK shell.
 *
 * Persistence: the whole database is a single file. After mutating work we
 * `export()` the bytes and write them to OPFS (origin-private file system)
 * when the browser supports it, falling back to IndexedDB otherwise.
 * Writes are debounced (autosave) and also flushed on pagehide /
 * visibilitychange so nothing is lost when the tab or app goes away.
 */

import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'

// ---- Minimal sql.js typings (only what this engine uses) -----------------

export interface SqlJsStatement {
  bind(values: unknown[]): boolean
  step(): boolean
  getAsObject(): Record<string, unknown>
  free(): boolean
  reset(): void
}

export interface SqlJsDatabase {
  run(sql: string, params?: unknown[]): SqlJsDatabase
  exec(sql: string, params?: unknown[]): SqlQueryResult[]
  prepare(sql: string): SqlJsStatement
  export(): Uint8Array
  close(): void
}

export interface SqlQueryResult {
  columns: string[]
  values: unknown[][]
}

interface SqlJsStatic {
  (config?: { locateFile?: (file: string) => string }): Promise<SqlJsModule>
}

/** The resolved sql.js module (what initSqlJs resolves to). */
export interface SqlJsModule {
  Database: new (data?: Uint8Array | null) => SqlJsDatabase
}

declare global {
  interface Window {
    initSqlJs?: SqlJsStatic
  }
}

// ---- Script loading -------------------------------------------------------

function loadScriptOnce(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-wa-sql="${src}"]`
    )
    if (existing) {
      if (window.initSqlJs) return resolve()
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load the SQLite engine')),
        { once: true }
      )
      return
    }
    const s = document.createElement('script')
    s.src = src
    s.async = true
    s.dataset.waSql = src
    s.onload = () => resolve()
    s.onerror = () =>
      reject(new Error('Failed to load the SQLite engine (script)'))
    document.head.appendChild(s)
  })
}

// ---- OPFS / IndexedDB persistence -----------------------------------------

const DB_FILE = 'wa-viewer.sqlite3'
const IDB_NAME = 'wa-viewer-local'
const IDB_STORE = 'kv'

export type PersistenceKind = 'opfs' | 'indexeddb'

function opfsAvailable(): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.storage?.getDirectory &&
      typeof FileSystemFileHandle !== 'undefined' &&
      typeof FileSystemFileHandle.prototype.createWritable === 'function'
    )
  } catch {
    return false
  }
}

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () =>
      reject(new Error('IndexedDB unavailable for local persistence'))
  })
}

function idbPut(key: string, value: Uint8Array): Promise<void> {
  return idbOpen().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite')
        tx.objectStore(IDB_STORE).put(value, key)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => {
          db.close()
          reject(tx.error ?? new Error('IndexedDB write failed'))
        }
      })
  )
}

function idbGet(key: string): Promise<Uint8Array | null> {
  return idbOpen().then(
    (db) =>
      new Promise<Uint8Array | null>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly')
        const req = tx.objectStore(IDB_STORE).get(key)
        req.onsuccess = () => {
          db.close()
          resolve((req.result as Uint8Array | undefined) ?? null)
        }
        req.onerror = () => {
          db.close()
          reject(req.error ?? new Error('IndexedDB read failed'))
        }
      })
  )
}

async function opfsWrite(bytes: Uint8Array): Promise<void> {
  const root = await navigator.storage.getDirectory()
  const handle = await root.getFileHandle(DB_FILE, { create: true })
  const writable = await handle.createWritable()
  await writable.write(bytes as BlobPart)
  await writable.close()
}

async function opfsRead(): Promise<Uint8Array | null> {
  try {
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle(DB_FILE)
    const file = await handle.getFile()
    if (file.size === 0) return null
    return new Uint8Array(await file.arrayBuffer())
  } catch {
    return null // NotFoundError or similar — fresh database
  }
}

async function opfsDelete(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(DB_FILE)
  } catch {
    /* already gone */
  }
}

// ---- The engine ------------------------------------------------------------

export class LocalEngine {
  private db: SqlJsDatabase | null = null
  private sql: SqlJsModule | null = null
  private persistence: PersistenceKind | null = null
  private readyPromise: Promise<void> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private saving = false
  private dirty = false
  private lastSavedAt: string | null = null

  /** Init (idempotent). Loads sql.js, restores the database file, migrates. */
  ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.init().catch((err) => {
        // Allow a later retry after a failure
        this.readyPromise = null
        throw err
      })
    }
    return this.readyPromise
  }

  private async init(): Promise<void> {
    await loadScriptOnce('/sql-wasm.js')
    if (!window.initSqlJs) {
      throw new Error('SQLite engine did not initialise')
    }
    const SQL = await window.initSqlJs({
      locateFile: (file: string) =>
        file.endsWith('.wasm') ? '/sql-wasm.wasm' : `/${file}`,
    })
    this.sql = SQL

    // Restore the last persisted snapshot: OPFS first, IndexedDB fallback.
    let bytes: Uint8Array | null = null
    if (opfsAvailable()) {
      try {
        bytes = await opfsRead()
        this.persistence = 'opfs'
      } catch {
        bytes = null
      }
    }
    if (!bytes) {
      bytes = await idbGet(DB_FILE).catch(() => null)
      if (bytes) this.persistence = 'indexeddb'
      else if (!this.persistence) this.persistence = opfsAvailable() ? 'opfs' : 'indexeddb'
    }

    this.db = new SQL.Database(bytes ?? null)
    this.db.run('PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  /** Apply the schema; bump-safe for future versions. */
  private migrate(): void {
    const db = this.db
    if (!db) throw new Error('Engine not initialised')
    db.run(SCHEMA_SQL)
    const res = db.exec(
      "SELECT value FROM _meta WHERE key = 'schema_version'"
    )
    const current = res[0]?.values[0]?.[0]
    if (current == null) {
      db.run(
        "INSERT INTO _meta (key, value) VALUES ('schema_version', ?)",
        [String(SCHEMA_VERSION)]
      )
      this.markDirty()
    }
    // Future migrations: compare SCHEMA_VERSION to `current` here.
    void this.flush()
  }

  isReady(): boolean {
    return this.db !== null
  }

  getPersistence(): PersistenceKind | null {
    return this.persistence
  }

  getLastSavedAt(): string | null {
    return this.lastSavedAt
  }

  // ---- Query helpers -------------------------------------------------------

  private assertDb(): SqlJsDatabase {
    if (!this.db) throw new Error('Local database is not ready yet')
    return this.db
  }

  /** Run a mutating statement and schedule an autosave. */
  run(sql: string, params?: unknown[]): void {
    this.assertDb().run(sql, params)
    this.markDirty()
  }

  /** Run statements without waiting for autosave (bulk import paths). */
  runNoSave(sql: string, params?: unknown[]): void {
    this.assertDb().run(sql, params)
    this.dirty = true
  }

  /** SELECT returning rows as plain objects. */
  all(sql: string, params?: unknown[]): Record<string, unknown>[] {
    const results = this.assertDb().exec(sql, params)
    if (results.length === 0) return []
    const { columns, values } = results[0]
    return values.map((row) => {
      const obj: Record<string, unknown> = {}
      columns.forEach((c, i) => (obj[c] = row[i]))
      return obj
    })
  }

  /** SELECT returning the first row or null. */
  first(sql: string, params?: unknown[]): Record<string, unknown> | null {
    return this.all(sql, params)[0] ?? null
  }

  scalar(sql: string, params?: unknown[]): unknown {
    const results = this.assertDb().exec(sql, params)
    return results[0]?.values[0]?.[0] ?? null
  }

  // ---- Persistence -----------------------------------------------------------

  private markDirty(): void {
    this.dirty = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), 600)
  }

  /** Write the current database image to OPFS/IndexedDB immediately. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.db || !this.dirty || this.saving) return
    this.saving = true
    try {
      const bytes = this.db.export()
      if (this.persistence === 'opfs' && opfsAvailable()) {
        try {
          await opfsWrite(bytes)
        } catch {
          // OPFS write can fail on transient quota/permission issues —
          // degrade to IndexedDB rather than losing data.
          this.persistence = 'indexeddb'
          await idbPut(DB_FILE, bytes)
        }
      } else {
        if (!this.persistence) {
          this.persistence = opfsAvailable() ? 'opfs' : 'indexeddb'
        }
        if (this.persistence === 'opfs') {
          try {
            await opfsWrite(bytes)
          } catch {
            this.persistence = 'indexeddb'
            await idbPut(DB_FILE, bytes)
          }
        } else {
          this.persistence = 'indexeddb'
          await idbPut(DB_FILE, bytes)
        }
      }
      this.dirty = false
      this.lastSavedAt = new Date().toISOString()
    } finally {
      this.saving = false
    }
    // A mutation may have landed while we were writing — run one more pass.
    if (this.dirty) await this.flush()
  }

  /** Fresh empty database (used by wipe). */
  async reset(): Promise<void> {
    await this.ready()
    this.db!.close()
    this.db = null
    await this.deletePersistedFile()
    // Re-open from scratch (readyPromise cleared → full init runs again)
    this.readyPromise = null
    await this.ready()
  }

  /** Raw database image (snapshot/backup use). Copy of the whole file. */
  exportDb(): Uint8Array {
    return this.assertDb().export()
  }

  /**
   * Swap the live database for the given image (rolling snapshot restore,
   * idea #14). The image is validated by opening it BEFORE the swap so a
   * corrupt snapshot never destroys the live database. The restored image
   * is persisted immediately.
   */
  async restoreFromBytes(bytes: Uint8Array): Promise<void> {
    await this.ready()
    if (!this.db || !this.sql) throw new Error('Engine not initialised')
    let next: SqlJsDatabase
    try {
      next = new this.sql.Database(bytes)
      next.run('SELECT COUNT(*) FROM sqlite_master')
    } catch {
      throw new Error('Not a valid database snapshot')
    }
    this.db.close()
    this.db = next
    this.db.run('PRAGMA foreign_keys = ON;')
    // Idempotent schema guard (older snapshots migrate forward) + persist.
    this.migrate()
    this.dirty = true
    await this.flush()
  }

  async deletePersistedFile(): Promise<void> {
    if (this.persistence === 'opfs') await opfsDelete()
    try {
      const db = await idbOpen()
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).delete(DB_FILE)
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => resolve()
      })
      db.close()
    } catch {
      /* ignore */
    }
  }

  /** Register page-level flush hooks (call once after first ready()). */
  installLifecycleHooks(): void {
    if (typeof window === 'undefined') return
    window.addEventListener('pagehide', () => void this.flush())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush()
    })
  }

  dbBytes(): number {
    try {
      return this.db ? this.db.export().length : 0
    } catch {
      return 0
    }
  }
}

/** Module-level singleton (client side only). */
let engine: LocalEngine | null = null

export function getEngine(): LocalEngine {
  if (!engine) engine = new LocalEngine()
  return engine
}
