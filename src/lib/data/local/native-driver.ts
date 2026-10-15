'use client'

/**
 * Idea #22 — Native SQLite driver for the Capacitor APK.
 *
 * When the app runs inside the Android shell, queries go through
 * @capacitor-community/sqlite (device SQLite, no WASM memory ceiling and no
 * OPFS serialization) instead of sql.js + OPFS. Browsers and the dev server
 * keep the sql.js + OPFS/IndexedDB engine (engine.ts) — this module is only
 * activated when `Capacitor.isNativePlatform()` is true.
 *
 * The plugin executes asynchronously and does not report result column
 * names, so `columnsFor()` derives them from the query text (the client's
 * SQL is a controlled set: explicit column lists, or single-table
 * `SELECT *` resolved through PRAGMA table_info and cached).
 */

import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'

/** Magic prefix marking JSON-serialized snapshots (native devices). */
export const NATIVE_SNAPSHOT_MAGIC = 'WABJ1:'

const conn = new SQLiteConnection(CapacitorSQLite)

/** True only inside the native (APK) shell with the plugin present. */
export function nativeAvailable(): boolean {
  try {
    return (
      Capacitor.isNativePlatform() &&
      Capacitor.isPluginAvailable('CapacitorSQLite')
    )
  } catch {
    return false
  }
}

interface NativeConnection {
  open(): Promise<void>
  execute(statements: string, transaction?: boolean): Promise<unknown>
  query(statement: string, values?: unknown[]): Promise<{ values?: unknown[][] }>
  run(statement: string, values?: unknown[], transaction?: boolean): Promise<unknown>
  close(): Promise<void>
  exportToJson(mode: string): Promise<{ export?: string }>
  importFromJson(json: string): Promise<unknown>
}

/**
 * Extract the output column names of a SELECT from its text:
 * - `expr AS "name"` / `expr AS name` → name
 * - `table.column` / `"table".column` → column
 * - bare identifiers → themselves
 * - `*` → resolved through PRAGMA table_info (single-table queries only)
 * Unaliased expressions fall back to their source text (sql.js behaves the
 * same way), so hand-written queries keep stable row shapes.
 */
function parseSelectColumns(sql: string): { columns: string[]; starTable: string | null } {
  const cleaned = sql
    .replace(/--.*$/gm, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const m = /^select\s+([\s\S]*?)\s+from\s+/i.exec(cleaned)
  if (!m) return { columns: [], starTable: null }
  const list = m[1]
  // Top-level comma split (parens and quotes aware).
  const parts: string[] = []
  let depth = 0
  let cur = ''
  let quote: string | null = null
  for (const ch of list) {
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      cur += ch
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)

  const columns: string[] = []
  let starTable: string | null = null
  for (const raw of parts) {
    const expr = raw.trim()
    const aliased = /\s+as\s+("?)([\w\u0080-\uffff ]+?)\1\s*$/i.exec(expr)
    if (aliased) {
      columns.push(aliased[2])
      continue
    }
    if (expr === '*') {
      starTable ??= /from\s+("?)([\w. ]+?)\1?\s*(\s|$)/i.exec(cleaned)?.[2] ?? null
      columns.push('*')
      continue
    }
    const qualified = /^(?:"[^"]+"|[\w]+)\.("([^"]+)"|[\w]+)$/.exec(expr)
    if (qualified) {
      columns.push(qualified[2] ?? qualified[1])
      continue
    }
    const bare = /^("?)([\w\u0080-\uffff]+)\1$/.exec(expr)
    if (bare) {
      columns.push(bare[2])
      continue
    }
    columns.push(expr.replace(/^"|"$/g, ''))
  }
  return { columns, starTable }
}

export class NativeDriver {
  /** Write-through persistence — no explicit flush needed. */
  readonly needsFlush = false
  private db: NativeConnection | null = null
  private columnCache = new Map<string, string[]>()

  constructor(private readonly fileName: string) {}

  get isOpen(): boolean {
    return this.db !== null
  }

  /** Open (idempotent) and set safe defaults. */
  async open(): Promise<void> {
    if (this.db) return
    const connection = await conn.createConnection(
      this.fileName,
      false,
      'no-encryption',
      1,
      false
    )
    await connection.open()
    await connection.execute('PRAGMA foreign_keys = ON;')
    this.db = connection as unknown as NativeConnection
  }

  /** Resolve output columns (cached per SQL text). */
  private async columnsFor(sql: string): Promise<string[]> {
    const cached = this.columnCache.get(sql)
    if (cached) return cached
    const { columns, starTable } = parseSelectColumns(sql)
    let resolved = columns
    if (columns.includes('*') && starTable) {
      const table = starTable.split('.').pop()!.replace(/"/g, '').trim()
      const info = await this.db!.query('PRAGMA table_info("' + table + '")')
      const names = (info.values ?? [])
        .map((row) => row[1])
        .filter((v): v is string => typeof v === 'string')
      if (names.length > 0) {
        resolved = columns.flatMap((c) => (c === '*' ? names : [c]))
      }
    }
    this.columnCache.set(sql, resolved)
    return resolved
  }

  /** Mutating statement (INSERT/UPDATE/DELETE). */
  async run(sql: string, params?: unknown[]): Promise<void> {
    await this.db!.run(sql, params ?? [])
  }

  /** Bulk-import alias — the plugin persists write-through either way. */
  async runNoSave(sql: string, params?: unknown[]): Promise<void> {
    await this.run(sql, params)
  }

  /** Multi-statement DDL / scripts. */
  async exec(sql: string): Promise<void> {
    await this.db!.execute(sql, false)
  }

  /** SELECT → row objects (columns derived from the query text). */
  async all(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    const res = await this.db!.query(sql, params ?? [])
    const values = res.values ?? []
    if (values.length === 0) return []
    const columns = await this.columnsFor(sql)
    return values.map((row) => {
      const obj: Record<string, unknown> = {}
      columns.forEach((c, i) => (obj[c] = row[i]))
      return obj
    })
  }

  /** First value of the first row (PRAGMA/aggregate friendly). */
  async scalar(sql: string, params?: unknown[]): Promise<unknown> {
    const res = await this.db!.query(sql, params ?? [])
    return res.values?.[0]?.[0] ?? null
  }

  /** Approximate database size from SQLite page counters. */
  async byteLength(): Promise<number> {
    try {
      const pages = (await this.scalar('PRAGMA page_count')) as number | null
      const size = (await this.scalar('PRAGMA page_size')) as number | null
      if (typeof pages === 'number' && typeof size === 'number') {
        return pages * size
      }
    } catch {
      /* fall through */
    }
    return 0
  }

  /** Native persists write-through — nothing to do. */
  async flush(): Promise<void> {}

  /** EngineDriver seam — the plugin owns the storage file. */
  async deletePersisted(): Promise<void> {
    await this.deleteDatabase()
  }

  /**
   * Snapshot bytes. The native plugin cannot hand out the raw SQLite file,
   * so snapshots serialize to JSON with a magic prefix; restoreFromBytes
   * detects it and replays through importFromJson.
   */
  async exportSnapshot(): Promise<Uint8Array> {
    const json = await this.db!.exportToJson('full')
    const text = NATIVE_SNAPSHOT_MAGIC + (json.export ?? '')
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff
    return bytes
  }

  /** Restore a snapshot previously produced by exportSnapshot(). */
  async importSnapshot(bytes: Uint8Array): Promise<void> {
    const text = new TextDecoder('latin1').decode(bytes)
    if (!text.startsWith(NATIVE_SNAPSHOT_MAGIC)) {
      throw new Error('Not a valid database snapshot')
    }
    const json = text.slice(NATIVE_SNAPSHOT_MAGIC.length)
    // Structural sanity before touching the live database.
    const parsed = JSON.parse(json) as { database?: { tables?: unknown[] } }
    if (!parsed || !Array.isArray(parsed.database?.tables)) {
      throw new Error('Not a valid database snapshot')
    }
    await this.db!.importFromJson(json)
    this.columnCache.clear()
  }

  async close(): Promise<void> {
    if (!this.db) return
    try {
      await this.db.close()
    } finally {
      this.db = null
    }
  }

  async deleteDatabase(): Promise<void> {
    await this.close()
    try {
      await CapacitorSQLite.deleteDatabase({ database: this.fileName })
    } catch {
      /* already gone */
    }
  }
}
