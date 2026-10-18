'use client'

/**
 * On-device database engine.
 *
 * Two interchangeable drivers behind one async facade:
 *
 *  - WasmDriver (default, browsers + dev): sql.js (SQLite compiled to
 *    WebAssembly) loaded as a static asset from /sql-wasm.js + /sql-wasm.wasm.
 *    The whole database is a single file, exported to OPFS (IndexedDB
 *    fallback) with debounced autosave + pagehide/visibilitychange flush.
 *
 *  - NativeDriver (idea #22, Capacitor APK shell): @capacitor-community/
 *    sqlite — device SQLite with write-through persistence and no WASM
 *    memory ceiling, for very large exports. Snapshots serialize to JSON
 *    (see native-driver.ts); WASM keeps raw SQLite images.
 *
 * The driver is chosen once at init(): native when running inside the
 * Capacitor shell, WASM everywhere else. All query methods are async so the
 * client layer never needs to know which one is active.
 */

import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'
import { assetUrl } from '@/lib/asset-base'
import {
  NativeDriver,
  nativeAvailable,
} from './native-driver'

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

// ---- OPFS / IndexedDB persistence (WASM driver) ---------------------------

const DB_FILE = 'wa-viewer.sqlite3'
const IDB_NAME = 'wa-viewer-local'
const IDB_STORE = 'kv'

export type PersistenceKind = 'opfs' | 'indexeddb' | 'native'

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

async function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

async function idbPut(key: string, value: Uint8Array): Promise<void> {
  const db = await idbOpen()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(value.slice(), key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
  })
  db.close()
}

async function idbGet(key: string): Promise<Uint8Array | null> {
  const db = await idbOpen()
  const result = await new Promise<Uint8Array | null>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(key)
    req.onsuccess = () => resolve((req.result as Uint8Array) ?? null)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
  })
  db.close()
  return result
}

async function opfsWrite(bytes: Uint8Array): Promise<void> {
  const root = await navigator.storage.getDirectory()
  const handle = await root.getFileHandle(DB_FILE, { create: true })
  const writable = await handle.createWritable()
  await writable.write(new Uint8Array(bytes))
  await writable.close()
}

async function opfsRead(): Promise<Uint8Array | null> {
  const root = await navigator.storage.getDirectory()
  const handle = await root.getFileHandle(DB_FILE)
  const file = await handle.getFile()
  if (file.size === 0) return null
  return new Uint8Array(await file.arrayBuffer())
}

async function opfsDelete(): Promise<void> {
  const root = await navigator.storage.getDirectory()
  try {
    await root.removeEntry(DB_FILE)
  } catch {
    /* already gone */
  }
}

// ---- The driver seam --------------------------------------------------------

interface EngineDriver {
  /** Execute a mutating statement. */
  run(sql: string, params?: unknown[]): Promise<void>
  /** Execute without marking dirty (bulk import paths — wasm only cares). */
  runNoSave(sql: string, params?: unknown[]): Promise<void>
  /** SELECT → row objects. */
  all(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Single scalar value. */
  scalar(sql: string, params?: unknown[]): Promise<unknown>
  /** Multi-statement DDL / scripts. */
  exec(sql: string): Promise<void>
  /** Snapshot bytes (raw SQLite image on wasm, JSON envelope on native). */
  exportSnapshot(): Promise<Uint8Array>
  /** Swap/replace the database with a snapshot. */
  importSnapshot(bytes: Uint8Array): Promise<void>
  /** Byte length of the current database image (storage meters). */
  byteLength(): Promise<number>
  /** Whether mutations need an explicit persistence flush. */
  readonly needsFlush: boolean
  flush(): Promise<void>
  close(): Promise<void>
  deletePersisted(): Promise<void>
}

// ---- WASM driver ------------------------------------------------------------

class WasmDriver implements EngineDriver {
  readonly needsFlush = true
  private db: SqlJsDatabase | null = null
  private sql: SqlJsModule | null = null
  private dirty = false
  private saving = false

  constructor(
    private readonly onDirtyChange: (dirty: boolean) => void,
    private readonly onSaved: () => void
  ) {}

  async init(): Promise<'opfs' | 'indexeddb'> {
    await loadScriptOnce(assetUrl('/sql-wasm.js'))
    if (!window.initSqlJs) {
      throw new Error('SQLite engine did not initialise')
    }
    const SQL = await window.initSqlJs({
      locateFile: (file: string) =>
        file.endsWith('.wasm') ? assetUrl('/sql-wasm.wasm') : assetUrl(`/${file}`),
    })
    this.sql = SQL

    // Restore the last persisted snapshot: OPFS first, IndexedDB fallback.
    let bytes: Uint8Array | null = null
    let persistence: 'opfs' | 'indexeddb' = 'indexeddb'
    if (opfsAvailable()) {
      try {
        bytes = await opfsRead()
        persistence = 'opfs'
      } catch {
        bytes = null
      }
    }
    if (!bytes) {
      bytes = await idbGet(DB_FILE).catch(() => null)
      if (bytes) persistence = 'indexeddb'
      else persistence = opfsAvailable() ? 'opfs' : 'indexeddb'
    }

    this.db = new SQL.Database(bytes ?? null)
    this.db.run('PRAGMA foreign_keys = ON;')
    return persistence
  }

  private assertDb(): SqlJsDatabase {
    if (!this.db) throw new Error('Engine not initialised')
    return this.db
  }

  async run(sql: string, params?: unknown[]): Promise<void> {
    this.assertDb().run(sql, params)
    this.dirty = true
    this.onDirtyChange(true)
  }

  async runNoSave(sql: string, params?: unknown[]): Promise<void> {
    this.assertDb().run(sql, params)
    this.dirty = true
  }

  async all(
    sql: string,
    params?: unknown[]
  ): Promise<Record<string, unknown>[]> {
    const results = this.assertDb().exec(sql, params)
    if (results.length === 0) return []
    const { columns, values } = results[0]
    return values.map((row) => {
      const obj: Record<string, unknown> = {}
      columns.forEach((c, i) => (obj[c] = row[i]))
      return obj
    })
  }

  async scalar(sql: string, params?: unknown[]): Promise<unknown> {
    const results = this.assertDb().exec(sql, params)
    return results[0]?.values[0]?.[0] ?? null
  }

  async exec(sql: string): Promise<void> {
    this.assertDb().run(sql)
    this.dirty = true
    this.onDirtyChange(true)
  }

  async exportSnapshot(): Promise<Uint8Array> {
    return this.assertDb().export()
  }

  async importSnapshot(bytes: Uint8Array): Promise<void> {
    if (!this.sql) throw new Error('Engine not initialised')
    let next: SqlJsDatabase
    try {
      next = new this.sql.Database(bytes)
      next.run('SELECT COUNT(*) FROM sqlite_master')
    } catch {
      throw new Error('Not a valid database snapshot')
    }
    this.db?.close()
    this.db = next
    this.db.run('PRAGMA foreign_keys = ON;')
    this.dirty = true
    this.onDirtyChange(true)
  }

  async byteLength(): Promise<number> {
    try {
      return this.db ? this.db.export().length : 0
    } catch {
      return 0
    }
  }

  isDirty(): boolean {
    return this.dirty
  }

  clearDirty(): void {
    this.dirty = false
    this.onDirtyChange(false)
  }

  setSaving(saving: boolean): void {
    this.saving = saving
  }

  isSaving(): boolean {
    return this.saving
  }

  /** Flush the database image to OPFS/IndexedDB (wasm only). */
  async flush(): Promise<void> {
    if (!this.db || !this.dirty || this.saving) return
    this.saving = true
    try {
      const bytes = this.db.export()
      try {
        if (opfsAvailable()) {
          await opfsWrite(bytes)
        } else {
          await idbPut(DB_FILE, bytes)
        }
      } catch {
        // OPFS write can fail on transient quota/permission issues —
        // degrade to IndexedDB rather than losing data.
        await idbPut(DB_FILE, bytes)
      }
      this.dirty = false
      this.onDirtyChange(false)
      this.onSaved()
    } finally {
      this.saving = false
    }
    // A mutation may have landed while we were writing — run one more pass.
    if (this.dirty) await this.flush()
  }

  async close(): Promise<void> {
    this.db?.close()
    this.db = null
  }

  async deletePersisted(): Promise<void> {
    if (opfsAvailable()) await opfsDelete()
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
}

// ---- The engine facade ------------------------------------------------------

export class LocalEngine {
  private driver: EngineDriver | null = null
  private wasm: WasmDriver | null = null
  private native: NativeDriver | null = null
  private persistence: PersistenceKind | null = null
  private readyPromise: Promise<void> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private lastSavedAt: string | null = null

  /** Init (idempotent). Picks the driver, restores the file, migrates. */
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
    // Idea #22 — inside the APK the device SQLite takes over.
    if (nativeAvailable()) {
      const native = new NativeDriver(DB_FILE)
      await native.open()
      this.native = native
      this.driver = native
      this.persistence = 'native'
      await this.migrate()
      return
    }

    const wasm = new WasmDriver(
      (dirty) => {
        if (dirty && !this.saveTimer) {
          this.saveTimer = setTimeout(() => {
            this.saveTimer = null
            void this.flush()
          }, 600)
        }
      },
      () => {
        this.lastSavedAt = new Date().toISOString()
      }
    )
    this.persistence = await wasm.init()
    this.wasm = wasm
    this.driver = wasm
    await this.migrate()
  }

  /** Apply the schema; bump-safe for future versions. */
  private async migrate(): Promise<void> {
    const driver = this.driver
    if (!driver) throw new Error('Engine not initialised')
    await driver.exec(SCHEMA_SQL)
    const row = await driver.scalar(
      "SELECT value FROM _meta WHERE key = 'schema_version'"
    )
    const current = row as string | null
    if (current == null) {
      await driver.run(
        "INSERT INTO _meta (key, value) VALUES ('schema_version', ?)",
        [String(SCHEMA_VERSION)]
      )
      await this.flush()
    }
    // Future migrations: compare SCHEMA_VERSION to `current` here.
    await this.flush()
  }

  isReady(): boolean {
    return this.driver !== null
  }

  /** 'native' inside the APK shell; 'opfs'/'indexeddb' for the WASM driver. */
  getPersistence(): PersistenceKind | null {
    return this.persistence
  }

  getLastSavedAt(): string | null {
    return this.lastSavedAt
  }

  // ---- Query helpers -------------------------------------------------------

  private assertDriver(): EngineDriver {
    if (!this.driver) throw new Error('Local database is not ready yet')
    return this.driver
  }

  /** Run a mutating statement and schedule an autosave. */
  async run(sql: string, params?: unknown[]): Promise<void> {
    await this.assertDriver().run(sql, params)
  }

  /** Run statements without waiting for autosave (bulk import paths). */
  async runNoSave(sql: string, params?: unknown[]): Promise<void> {
    await this.assertDriver().runNoSave(sql, params)
  }

  /** SELECT returning rows as plain objects. */
  async all(
    sql: string,
    params?: unknown[]
  ): Promise<Record<string, unknown>[]> {
    return this.assertDriver().all(sql, params)
  }

  /** SELECT returning the first row or null. */
  async first(
    sql: string,
    params?: unknown[]
  ): Promise<Record<string, unknown> | null> {
    const rows = await this.all(sql, params)
    return rows[0] ?? null
  }

  async scalar(sql: string, params?: unknown[]): Promise<unknown> {
    return this.assertDriver().scalar(sql, params)
  }

  // ---- Persistence -----------------------------------------------------------

  /** Persist now (native drivers persist write-through; wasm exports+writes). */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.wasm) {
      if (!this.wasm.isDirty() || this.wasm.isSaving()) return
      await this.wasm.flush()
    }
    // Native driver: write-through, nothing to do.
  }

  /** Fresh empty database (used by wipe). */
  async reset(): Promise<void> {
    await this.ready()
    await this.driver!.close()
    this.driver = null
    this.wasm = null
    this.native = null
    await this.deletePersistedFile()
    // Re-open from scratch (readyPromise cleared → full init runs again)
    this.readyPromise = null
    await this.ready()
  }

  /** Snapshot bytes (rolling snapshots / backups). */
  async exportDb(): Promise<Uint8Array> {
    return this.assertDriver().exportSnapshot()
  }

  /**
   * Swap the live database for the given image (rolling snapshot restore,
   * idea #14). The image is validated by the driver BEFORE the swap so a
   * corrupt snapshot never destroys the live database. The restored image
   * is persisted immediately.
   */
  async restoreFromBytes(bytes: Uint8Array): Promise<void> {
    await this.ready()
    const driver = this.assertDriver()
    await driver.importSnapshot(bytes)
    // Idempotent schema guard (older snapshots migrate forward) + persist.
    await this.migrate()
  }

  async deletePersistedFile(): Promise<void> {
    if (this.native) {
      await this.native.deleteDatabase()
      return
    }
    if (this.wasm) await this.wasm.deletePersisted()
  }

  /** Register page-level flush hooks (call once after first ready()). */
  installLifecycleHooks(): void {
    if (typeof window === 'undefined') return
    // Native persists write-through; only the WASM driver needs flushes.
    window.addEventListener('pagehide', () => void this.flush())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flush()
    })
  }

  async dbBytes(): Promise<number> {
    if (!this.driver) return 0
    return this.driver.byteLength()
  }
}

/** Module-level singleton (client side only). */
let engine: LocalEngine | null = null

export function getEngine(): LocalEngine {
  if (!engine) engine = new LocalEngine()
  return engine
}
