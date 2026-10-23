/**
 * Incremental .wasync snapshot pushes (v1.9) — hash-chained deltas.
 *
 * Full backups still go to the LIVE remote file after every push, so a
 * naive restore is always safe. On top of that, the timestamped snapshot
 * history can be INCREMENTAL: instead of re-uploading the whole archive
 * every time, a snapshot stores only the chats whose content hash changed
 * since the previous snapshot, chained to it:
 *
 *   full  (wa-archiver-<stamp>.wasync)        ← every MAX_CHAIN steps
 *     └─ delta {parentFile, parentHash, chats:[changed]}
 *          └─ delta …                          ← chain depth ≤ MAX_CHAIN
 *
 * Restoring any snapshot walks `parentFile` links until a full envelope and
 * merges the deltas on top (changed chats REPLACE the same chat key; other
 * chats come from the full). Chat key = id when present, else title +
 * sourceFile. Deletions are NOT propagated by deltas — the live full file
 * remains the source of truth for exact restores.
 *
 * The manifest (last snapshot chain + per-chat hashes) lives in
 * localStorage under 'wa-viewer:sync-delta' keyed by the remote file name.
 * SHA-256 uses WebCrypto, so the module runs in the browser, the parse
 * worker and Node ≥ 19 alike.
 */

const MANIFEST_KEY = 'wa-viewer:sync-delta'

/** Deltas deeper than this are cut with a fresh full snapshot. */
export const MAX_CHAIN = 4

export interface DeltaManifest {
  /** Remote base file name the manifest belongs to. */
  filename: string
  /** Ordered file names of the current chain: [full, delta?, delta?…]. */
  chain: string[]
  /** Per-chat content hashes as of the last snapshot push. */
  chats: Record<string, string>
  at: number
}

/** Marker inside a decrypted snapshot envelope (plain JSON backups lack it). */
export interface DeltaEnvelope {
  kind: 'wa-archiver-delta'
  v: 1
  parentFile: string
  parentHash: string
  at: number
  /** Changed chats — wholesale replacements keyed like backup chats. */
  chats: Record<string, unknown>[]
  /** Key list removed since the parent (informational; apply is additive). */
  removedKeys: string[]
}

interface BackupShape {
  chats?: Record<string, unknown>[]
  [k: string]: unknown
}

// ---------------------------------------------------------------------------
// Manifest persistence (SSR-safe)
// ---------------------------------------------------------------------------

export function getDeltaManifest(filename: string): DeltaManifest | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(MANIFEST_KEY)
    if (!raw) return null
    const all = JSON.parse(raw) as Record<string, DeltaManifest>
    const m = all[filename]
    if (!m || !Array.isArray(m.chain) || m.filename !== filename) return null
    return m
  } catch {
    return null
  }
}

export function saveDeltaManifest(m: DeltaManifest): void {
  if (typeof window === 'undefined') return
  try {
    const raw = window.localStorage.getItem(MANIFEST_KEY)
    const all = (raw ? JSON.parse(raw) : {}) as Record<string, DeltaManifest>
    all[m.filename] = m
    window.localStorage.setItem(MANIFEST_KEY, JSON.stringify(all))
  } catch {
    /* storage unavailable — deltas just fall back to full next time */
  }
}

export function clearDeltaManifest(filename?: string): void {
  if (typeof window === 'undefined') return
  try {
    if (!filename) {
      window.localStorage.removeItem(MANIFEST_KEY)
      return
    }
    const raw = window.localStorage.getItem(MANIFEST_KEY)
    if (!raw) return
    const all = JSON.parse(raw) as Record<string, DeltaManifest>
    delete all[filename]
    window.localStorage.setItem(MANIFEST_KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  )
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function chatKeyOf(chat: Record<string, unknown>): string {
  const id = typeof chat.id === 'string' && chat.id ? chat.id : ''
  if (id) return `id:${id}`
  const title = typeof chat.title === 'string' ? chat.title : ''
  const src = typeof chat.sourceFile === 'string' ? chat.sourceFile : ''
  return `t:${title}\u0000${src}`
}

// ---------------------------------------------------------------------------
// Snapshot build (used by pushToCloud)
// ---------------------------------------------------------------------------

export interface SnapshotPlan {
  /** 'full' → upload `json` as-is; 'delta' → upload `deltaJson`. */
  kind: 'full' | 'delta'
  deltaJson?: string
  /** Updated manifest to persist after a successful upload. */
  manifest: DeltaManifest
  /** chat keys carried by this snapshot (info only). */
  changedCount?: number
}

/**
 * Decide what the timestamped snapshot should carry for this push.
 * `fullJson` is the (already filtered) plain backup text that was pushed to
 * the live file. Returns a full plan whenever incremental is off, the
 * manifest is missing/mismatched, the chain is at max depth — or when the
 * payload yields no chats to diff (defensive).
 */
export async function planSnapshot(
  filename: string,
  fullJson: string,
  opts: { incremental: boolean; fileToUpload: string }
): Promise<SnapshotPlan> {
  const manifest: DeltaManifest = {
    filename,
    chain: [opts.fileToUpload],
    chats: {},
    at: Date.now(),
  }

  let backup: BackupShape
  try {
    backup = JSON.parse(fullJson) as BackupShape
  } catch {
    return { kind: 'full', manifest }
  }
  const chats = Array.isArray(backup.chats) ? backup.chats : []
  if (chats.length === 0) return { kind: 'full', manifest }

  // Hash every chat of the current push.
  const hashes: Record<string, string> = {}
  const byKey = new Map<string, Record<string, unknown>>()
  for (const c of chats) {
    const key = chatKeyOf(c)
    byKey.set(key, c)
    hashes[key] = await sha256(JSON.stringify(c))
  }

  // NOTE: the manifest is NOT persisted here — the caller saves it only
  // after the snapshot actually landed on the provider.
  const prev = opts.incremental ? getDeltaManifest(filename) : null
  if (
    !prev ||
    !opts.incremental ||
    prev.chain.length <= 0 ||
    prev.chain.length >= MAX_CHAIN
  ) {
    return { kind: 'full', manifest }
  }

  // Diff against the previous snapshot.
  const changed: Record<string, unknown>[] = []
  const removedKeys: string[] = []
  for (const [key, hash] of Object.entries(hashes)) {
    if (prev.chats[key] !== hash) {
      changed.push(byKey.get(key)!)
    }
  }
  for (const key of Object.keys(prev.chats)) {
    if (!(key in hashes)) removedKeys.push(key)
  }
  if (changed.length === 0) {
    // Nothing changed since the previous snapshot — still cut a (small)
    // full so the chain root stays fresh and restorable.
    return { kind: 'full', manifest }
  }

  const delta: DeltaEnvelope = {
    kind: 'wa-archiver-delta',
    v: 1,
    parentFile: prev.chain[prev.chain.length - 1],
    parentHash: '',
    at: manifest.at,
    chats: changed,
    removedKeys,
  }
  const deltaJson = JSON.stringify(delta)
  const next: DeltaManifest = {
    filename,
    chain: [...prev.chain, opts.fileToUpload],
    chats: { ...prev.chats, ...hashes },
    at: manifest.at,
  }
  return { kind: 'delta', deltaJson, manifest: next, changedCount: changed.length }
}

/**
 * True when a decrypted snapshot is one of our delta envelopes.
 */
export function isDeltaEnvelope(json: string): boolean {
  try {
    const v = JSON.parse(json) as { kind?: unknown }
    return v?.kind === 'wa-archiver-delta'
  } catch {
    return false
  }
}

/**
 * Walk a delta chain (≤ MAX_CHAIN pulls) and rebuild ONE full backup JSON.
 * `pull(name)` must return the DECRYPTED json of a remote snapshot or throw.
 * The final full envelope's chats are replaced wholesale by every delta's
 * changed chats; metadata keys (settings etc.) come from the full.
 */
export async function rebuildFullFromChain(
  pull: (name: string) => Promise<string>,
  name: string,
  depth = 0
): Promise<string> {
  const json = await pull(name)
  if (depth >= MAX_CHAIN || !isDeltaEnvelope(json)) return json
  const delta = JSON.parse(json) as DeltaEnvelope
  if (!delta.parentFile) return json
  const baseText = await rebuildFullFromChain(pull, delta.parentFile, depth + 1)
  let base: BackupShape
  try {
    base = JSON.parse(baseText) as BackupShape
  } catch {
    throw new Error('The snapshot chain points at a corrupt base snapshot')
  }
  const chats = Array.isArray(base.chats) ? base.chats : []
  const index = new Map<string, number>()
  chats.forEach((c, i) => index.set(chatKeyOf(c), i))
  for (const c of delta.chats) {
    const key = chatKeyOf(c)
    const at = index.get(key)
    if (at === undefined) {
      index.set(key, chats.length)
      chats.push(c)
    } else {
      chats[at] = c
    }
  }
  base.chats = chats
  return JSON.stringify(base)
}
