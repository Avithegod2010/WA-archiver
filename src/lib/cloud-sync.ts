/**
 * Cloud-ready persistence — storage-adapter layer with pluggable providers.
 *
 * The SAME encrypted `.wasync` envelope produced by sync-crypto is pushed
 * to / pulled from ANY configured provider. The passphrase never leaves the
 * device — the provider only ever stores AES-GCM ciphertext, so "cloud" is
 * just a dumb, replaceable blob store:
 *
 *   exportBackup() → encryptToSyncFile(json, passphrase) → provider PUT
 *   restore()      → provider GET → decryptFromSyncFile → import pipeline
 *
 * Providers (behind one test / push / pull UI):
 *   • webdav  — any WebDAV server (Nextcloud, ownCloud, Fastmail, InfiniCloud…)
 *   • gdrive  — Google Drive v3 REST (user-supplied OAuth access token)
 *   • s3      — any S3-compatible bucket (AWS SigV4, incl. R2 / B2 / Minio)
 *
 * Two transports:
 *   • server mode (Next.js web app): POST /api/cloud-sync proxy — no CORS
 *     problems, credentials stay in the request body only.
 *   • device mode (Capacitor): direct fetch from the webview.
 *
 * Multi-file history: every push can also store a timestamped snapshot
 * (wa-archiver-YYYYMMDD-HHMMSS.wasync); the oldest beyond `historyKeep`
 * are pruned after each successful push.
 *
 * Auto-push: when enabled, imports/exports call autoPushIfEnabled() so the
 * cloud copy is never stale. The sync passphrase is stored device-local
 * (localStorage) ONLY when auto-push is on — documented in the UI.
 *
 * Config lives in localStorage under 'wa-viewer:cloud-sync'.
 */

import {
  decryptFromSyncFile,
  encryptToSyncFile,
  looksLikeSyncFile,
} from './sync-crypto'
import {
  S3_MULTIPART_THRESHOLD,
  s3BucketUrl,
  s3MultipartUploadStrings,
  s3SignedFetch,
  type S3Credentials,
} from './s3-sign'
import {
  isDeltaEnvelope,
  planSnapshot,
  rebuildFullFromChain,
} from './sync-delta'
import { ensureFreshGdriveToken } from './gdrive-oauth'

const CONFIG_KEY = 'wa-viewer:cloud-sync'

export type CloudProvider = 'webdav' | 'gdrive' | 's3'

export interface CloudSyncConfig {
  /** Which storage adapter to use (default 'webdav'). */
  provider?: CloudProvider
  // ---- WebDAV ----
  /** WebDAV collection URL, e.g. https://cloud.example.com/remote.php/dav/files/me/wa-archiver/ */
  url: string
  username: string
  /** App password — stored device-local (localStorage) only. */
  password: string
  // ---- shared ----
  /** Remote file name inside the collection/bucket/folder. */
  filename: string
  // ---- S3 ----
  s3Region?: string
  s3Bucket?: string
  s3AccessKey?: string
  s3SecretKey?: string
  /** Custom endpoint (R2/B2/Minio). Empty → virtual-hosted AWS URL. */
  s3Endpoint?: string
  /** Object key prefix, default 'wa-archiver/'. */
  s3Prefix?: string
  // ---- Google Drive ----
  /** OAuth access token (drive.file scope is enough). Device-local only. */
  gdriveToken?: string
  /** Optional destination folder id (empty → My Drive root). */
  gdriveFolderId?: string
  // ---- Google Drive refresh-token flow (v1.9) ----
  /** Long-lived refresh token from the authorization-code exchange. */
  gdriveRefreshToken?: string
  /** The user's own Google Cloud OAuth client (device-local only). */
  gdriveClientId?: string
  gdriveClientSecret?: string
  /** Epoch ms the cached access token expires at (auto-rotated). */
  gdriveTokenExpiresAt?: number
  // ---- behaviour ----
  /** Push a timestamped snapshot after every successful push; prune to N. */
  historyKeep?: number
  /** Auto-push after every import / export (needs syncPassphrase). */
  autoPush?: boolean
  /** Sync passphrase kept device-local ONLY when autoPush is on. */
  syncPassphrase?: string
  /** v1.9 — only push the chats selected below (empty list = all). */
  syncSelectedOnly?: boolean
  /** Chat ids included when syncSelectedOnly is on. */
  syncChatIds?: string[]
  /** v1.9 — timestamped snapshots carry hash-chained deltas, not fulls. */
  incremental?: boolean
  lastPushAt?: number
  lastPullAt?: number
}

export function getCloudSyncConfig(): CloudSyncConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<CloudSyncConfig>
    if (typeof v.url !== 'string' || !v.url) return null
    return {
      provider:
        v.provider === 'gdrive' || v.provider === 's3' ? v.provider : 'webdav',
      url: v.url,
      username: v.username ?? '',
      password: v.password ?? '',
      filename: v.filename || 'wa-archiver.wasync',
      s3Region: typeof v.s3Region === 'string' ? v.s3Region : '',
      s3Bucket: typeof v.s3Bucket === 'string' ? v.s3Bucket : '',
      s3AccessKey: typeof v.s3AccessKey === 'string' ? v.s3AccessKey : '',
      s3SecretKey: typeof v.s3SecretKey === 'string' ? v.s3SecretKey : '',
      s3Endpoint: typeof v.s3Endpoint === 'string' ? v.s3Endpoint : '',
      s3Prefix: typeof v.s3Prefix === 'string' ? v.s3Prefix : '',
      gdriveToken: typeof v.gdriveToken === 'string' ? v.gdriveToken : '',
      gdriveFolderId:
        typeof v.gdriveFolderId === 'string' ? v.gdriveFolderId : '',
      gdriveRefreshToken:
        typeof v.gdriveRefreshToken === 'string' ? v.gdriveRefreshToken : '',
      gdriveClientId:
        typeof v.gdriveClientId === 'string' ? v.gdriveClientId : '',
      gdriveClientSecret:
        typeof v.gdriveClientSecret === 'string' ? v.gdriveClientSecret : '',
      gdriveTokenExpiresAt:
        typeof v.gdriveTokenExpiresAt === 'number'
          ? v.gdriveTokenExpiresAt
          : undefined,
      historyKeep:
        typeof v.historyKeep === 'number' && v.historyKeep >= 0
          ? Math.min(v.historyKeep, 30)
          : 0,
      autoPush: v.autoPush === true,
      syncPassphrase:
        typeof v.syncPassphrase === 'string' ? v.syncPassphrase : '',
      syncSelectedOnly: v.syncSelectedOnly === true,
      syncChatIds: Array.isArray(v.syncChatIds)
        ? v.syncChatIds.filter((x): x is string => typeof x === 'string')
        : [],
      incremental: v.incremental === true,
      lastPushAt: typeof v.lastPushAt === 'number' ? v.lastPushAt : undefined,
      lastPullAt: typeof v.lastPullAt === 'number' ? v.lastPullAt : undefined,
    }
  } catch {
    return null
  }
}

export function saveCloudSyncConfig(cfg: CloudSyncConfig): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
}

export function clearCloudSyncConfig(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(CONFIG_KEY)
}

function providerOf(cfg: CloudSyncConfig): CloudProvider {
  return cfg.provider ?? 'webdav'
}

/** Normalize the collection URL + filename into the full file URL (WebDAV). */
export function cloudFileUrl(cfg: CloudSyncConfig): string {
  const base = cfg.url.replace(/\/+$/, '')
  const file = cfg.filename.replace(/^\/+/, '')
  return `${base}/${file}`
}

/** S3 object key for a (snapshot) file name. */
function s3Key(cfg: CloudSyncConfig, file: string): string {
  const prefix = (cfg.s3Prefix || 'wa-archiver/').replace(/^\/+/, '')
  const withSlash = prefix.endsWith('/') || prefix === '' ? prefix : `${prefix}/`
  return `${withSlash}${file.replace(/^\/+/, '')}`
}

function s3Creds(cfg: CloudSyncConfig): S3Credentials | null {
  if (!cfg.s3Bucket || !cfg.s3Region || !cfg.s3AccessKey || !cfg.s3SecretKey) {
    return null
  }
  return {
    accessKeyId: cfg.s3AccessKey,
    secretAccessKey: cfg.s3SecretKey,
    region: cfg.s3Region,
    bucket: cfg.s3Bucket,
    endpoint: cfg.s3Endpoint || undefined,
  }
}

const GDRIVE_API = 'https://www.googleapis.com/drive/v3'
const GDRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

// ---------------------------------------------------------------------------
// Remote file naming (shared by every provider)
// ---------------------------------------------------------------------------

/** Timestamped snapshot name derived from the main file name. */
export function snapshotName(filename: string, at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp =
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot) : '.wasync'
  return `${base}-${stamp}${ext}`
}

const SNAPSHOT_RE = /-(\d{8})-(\d{6})(\.[^.]*)?$/

/** True when a remote file name is one of our timestamped snapshots. */
function isSnapshotName(name: string, filename: string): boolean {
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  return name.startsWith(base) && SNAPSHOT_RE.test(name)
}

// ---------------------------------------------------------------------------
// Transport: server proxy (web build) + direct (device build)
// ---------------------------------------------------------------------------

/**
 * True when the server proxy is usable (web build). The APK/device build
 * has no /api routes and must talk to providers directly.
 */
export function proxyAvailable(): boolean {
  if (typeof window === 'undefined') return false
  const isCap = /capacitor/i.test(window.navigator.userAgent)
  return !isCap
}

type ProxyAction = 'test' | 'push' | 'pull' | 'list' | 'delete'

interface ProxyRequest extends Partial<CloudSyncConfig> {
  action: ProxyAction
  url: string
  username: string
  password: string
  payload?: string
  /** For delete/list: which remote file (defaults to cfg.filename). */
  target?: string
}

interface ProxyResponse {
  ok: boolean
  status?: number
  text?: string
  /** Parsed name list for 'list'. */
  names?: string[]
  error?: string
}

/** Server-proxy transport (web mode). */
async function proxyRequest(req: ProxyRequest): Promise<ProxyResponse> {
  const res = await fetch('/api/cloud-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(90_000),
  })
  const out = (await res.json().catch(() => null)) as ProxyResponse | null
  // null → treated as a transport failure at the call sites
  return out ?? { ok: false, error: 'Cloud sync proxy unreachable' }
}

// ---- direct WebDAV (device mode) ------------------------------------------

async function directWebdav(
  action: ProxyAction,
  cfg: CloudSyncConfig,
  target: string,
  payload?: string
): Promise<ProxyResponse> {
  const base = cfg.url.replace(/\/+$/, '')
  const isList = action === 'list'
  const url = isList ? base : `${base}/${target.replace(/^\/+/, '')}`
  const headers: Record<string, string> = {
    Authorization: 'Basic ' + btoa(`${cfg.username}:${cfg.password}`),
  }
  if (action === 'push') headers['Content-Type'] = 'application/json'
  if (isList) headers.Depth = '1'
  try {
    const res = await fetch(url, {
      method:
        action === 'push'
          ? 'PUT'
          : action === 'pull'
            ? 'GET'
            : action === 'delete'
              ? 'DELETE'
              : 'PROPFIND',
      headers,
      body: action === 'push' ? payload : undefined,
      signal: AbortSignal.timeout(90_000),
    })
    const text =
      action === 'pull' || isList ? await res.text().catch(() => '') : ''
    const names = isList ? parseDavList(text, base) : undefined
    return { ok: res.ok, status: res.status, text, names }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Direct WebDAV failed: ${err.message} (CORS or offline)`
          : 'Direct WebDAV failed',
    }
  }
}

/** Extract file names from a WebDAV PROPFIND (Depth 1) response. */
function parseDavList(xml: string, base: string): string[] {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const baseNoSlash = base.replace(/\/+$/, '')
    return [...doc.getElementsByTagName('D:href')]
      .concat([...doc.getElementsByTagName('href')])
      .map((h) => {
        let href = h.textContent ?? ''
        try {
          href = decodeURIComponent(href)
        } catch {
          /* keep raw */
        }
        // Absolute URLs → keep the path part
        if (/^https?:\/\//i.test(href)) {
          try {
            href = new URL(href).pathname
          } catch {
            /* keep raw */
          }
        }
        return href.replace(baseNoSlash, '').replace(/^\/+/, '')
      })
      .filter((n) => n && !n.endsWith('/') && n !== '')
  } catch {
    return []
  }
}

// ---- direct S3 (device mode) ----------------------------------------------

async function directS3(
  action: ProxyAction,
  cfg: CloudSyncConfig,
  target: string,
  payload?: string
): Promise<ProxyResponse> {
  const creds = s3Creds(cfg)
  if (!creds) {
    return { ok: false, error: 'S3 settings incomplete (bucket / region / keys)' }
  }
  const baseUrl = s3BucketUrl(creds)
  try {
    if (action === 'list') {
      const res = await s3SignedFetch(creds, {
        method: 'GET',
        baseUrl,
        key: '',
        query: { 'list-type': '2', prefix: s3Key(cfg, '') },
      })
      const text = await res.text().catch(() => '')
      return {
        ok: res.ok,
        status: res.status,
        text,
        names: res.ok ? parseS3List(text) : undefined,
      }
    }
    if (action === 'push' && (payload?.length ?? 0) > S3_MULTIPART_THRESHOLD) {
      // v1.9 — huge envelopes go through the S3 multipart API (device mode).
      try {
        await s3MultipartUploadStrings(creds, {
          key: s3Key(cfg, target),
          payload: payload ?? '',
        })
        return { ok: true, status: 200 }
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error ? err.message : 'S3 multipart upload failed',
        }
      }
    }
    const method =
      action === 'push' ? 'PUT' : action === 'pull' ? 'GET' : 'DELETE'
    const res = await s3SignedFetch(creds, {
      method,
      baseUrl,
      key: s3Key(cfg, target),
      body: action === 'push' ? payload : undefined,
    })
    const text = action === 'pull' ? await res.text().catch(() => '') : ''
    return { ok: res.ok, status: res.status, text }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Direct S3 failed: ${err.message} (CORS or offline)`
          : 'Direct S3 failed',
    }
  }
}

/** Extract <Key> values from an S3 ListObjectsV2 XML response. */
function parseS3List(xml: string): string[] {
  const out: string[] = []
  const re = /<Key>([^<]+)<\/Key>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

// ---- direct Google Drive (device mode; same REST the proxy uses) ----------

async function gdriveFetch(
  cfg: CloudSyncConfig,
  path: string,
  init?: { method?: string; body?: BodyInit; headers?: Record<string, string> }
): Promise<Response> {
  return fetch(`${GDRIVE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.gdriveToken ?? ''}`,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(90_000),
  })
}

/** Find the fileId for a file name (optional parent folder). */
async function gdriveFindId(
  cfg: CloudSyncConfig,
  name: string
): Promise<string | null> {
  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    'trashed = false',
    cfg.gdriveFolderId ? `'${cfg.gdriveFolderId}' in parents` : '',
  ]
    .filter(Boolean)
    .join(' and ')
  const res = await gdriveFetch(
    cfg,
    `/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=5&spaces=drive`
  )
  if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as {
    files?: { id: string }[]
  } | null
  return data?.files?.[0]?.id ?? null
}

async function directGdrive(
  action: ProxyAction,
  cfg: CloudSyncConfig,
  target: string,
  payload?: string
): Promise<ProxyResponse> {
  if (!cfg.gdriveToken) {
    return { ok: false, error: 'Google Drive access token missing' }
  }
  try {
    if (action === 'test') {
      const res = await gdriveFetch(cfg, '/about?fields=user')
      return { ok: res.ok, status: res.status }
    }
    if (action === 'list' || action === 'delete') {
      const id = await gdriveFindId(cfg, target)
      if (action === 'delete') {
        if (!id) return { ok: true, status: 204 }
        const res = await gdriveFetch(cfg, `/files/${id}`, { method: 'DELETE' })
        return { ok: res.ok || res.status === 204, status: res.status }
      }
      // list: match the filename prefix via name contains
      const dot = target.lastIndexOf('.')
      const base = dot > 0 ? target.slice(0, dot) : target
      const q = [
        `name contains '${base.replace(/'/g, "\\'")}'`,
        'trashed = false',
        cfg.gdriveFolderId ? `'${cfg.gdriveFolderId}' in parents` : '',
      ]
        .filter(Boolean)
        .join(' and ')
      const res = await gdriveFetch(
        cfg,
        `/files?q=${encodeURIComponent(q)}&fields=files(name)&pageSize=100&spaces=drive`
      )
      const data = (await res.json().catch(() => null)) as {
        files?: { name: string }[]
      } | null
      return {
        ok: res.ok,
        status: res.status,
        names: res.ok ? (data?.files ?? []).map((f) => f.name) : undefined,
      }
    }
    if (action === 'push') {
      const id = await gdriveFindId(cfg, target)
      if (id) {
        // Overwrite the media of an existing file (metadata stays)
        const res = await fetch(
          `${GDRIVE_UPLOAD}/files/${id}?uploadType=media`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${cfg.gdriveToken ?? ''}`,
              'Content-Type': 'application/json',
            },
            body: payload,
            signal: AbortSignal.timeout(90_000),
          }
        )
        return { ok: res.ok, status: res.status }
      }
      // Create with metadata (+ optional parent folder)
      const meta: Record<string, unknown> = { name: target }
      if (cfg.gdriveFolderId) meta.parents = [cfg.gdriveFolderId]
      const form = new FormData()
      form.append(
        'metadata',
        new Blob([JSON.stringify(meta)], { type: 'application/json' })
      )
      form.append(
        'file',
        new Blob([payload ?? ''], { type: 'application/json' })
      )
      const res = await fetch(
        `${GDRIVE_UPLOAD}/files?uploadType=multipart`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.gdriveToken ?? ''}` },
          body: form,
          signal: AbortSignal.timeout(90_000),
        }
      )
      return { ok: res.ok, status: res.status }
    }
    // pull
    const id = await gdriveFindId(cfg, target)
    if (!id) return { ok: false, status: 404, error: 'File not found in Drive' }
    const res = await gdriveFetch(cfg, `/files/${id}?alt=media`)
    const text = await res.text().catch(() => '')
    return { ok: res.ok, status: res.status, text }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Drive request failed: ${err.message}`
          : 'Drive request failed',
    }
  }
}

/** Direct transport (device mode) — dispatch by provider. */
async function directRequest(
  action: ProxyAction,
  cfg: CloudSyncConfig,
  target: string,
  payload?: string
): Promise<ProxyResponse> {
  switch (providerOf(cfg)) {
    case 's3':
      return directS3(action, cfg, target, payload)
    case 'gdrive':
      return directGdrive(action, cfg, target, payload)
    default:
      return directWebdav(action, cfg, target, payload)
  }
}

async function request(
  action: ProxyAction,
  cfg: CloudSyncConfig,
  payload?: string,
  target?: string
): Promise<ProxyResponse> {
  // Google Drive refresh-token flow (v1.9): rotate the access token when it
  // is (about to be) expired — the caller persists the returned config.
  if (providerOf(cfg) === 'gdrive') {
    cfg = await ensureFreshGdriveToken(cfg)
  }
  const file = target ?? cfg.filename
  if (proxyAvailable()) {
    const viaProxy = await proxyRequest({
      ...cfg,
      action,
      url: cloudFileUrl(cfg),
      username: cfg.username,
      password: cfg.password,
      payload,
      target: file,
    })
    if (viaProxy) return viaProxy
    // Proxy unreachable (unlikely in web mode) — fall through to direct.
  }
  return directRequest(action, cfg, file, payload)
}

// ---------------------------------------------------------------------------
// Public adapter API (identical for every provider)
// ---------------------------------------------------------------------------

/** Verify the destination is reachable + credentials are valid. */
export async function testCloudConnection(
  cfg: CloudSyncConfig
): Promise<{ ok: boolean; message: string }> {
  const res = await request('test', cfg)
  if (res.ok) {
    const p = providerOf(cfg)
    const label =
      p === 'gdrive' ? 'Google Drive' : p === 's3' ? 'S3 bucket' : 'WebDAV'
    return { ok: true, message: `${label} connection OK` }
  }
  if (res.status === 401 || res.status === 403)
    return {
      ok: false,
      message:
        'Unauthorized (401/403) — check the username / app password / token',
    }
  if (res.status === 404)
    return {
      ok: false,
      message:
        'Not found (404) — create the remote folder / check bucket + prefix first',
    }
  return {
    ok: false,
    message: res.error ?? `Failed (status ${res.status ?? 'network'})`,
  }
}

/** List remote snapshot names matching the configured file's base name. */
export async function listSnapshots(cfg: CloudSyncConfig): Promise<string[]> {
  const res = await request('list', cfg)
  if (!res.ok || !res.names) return []
  return res.names
    .filter((n) => isSnapshotName(n, cfg.filename))
    .sort()
    .reverse() // newest stamp first
}

async function deleteRemote(cfg: CloudSyncConfig, name: string): Promise<void> {
  await request('delete', cfg, undefined, name)
}

/**
 * Push a JSON backup, encrypted with the passphrase, to the configured
 * provider. When `historyKeep > 0` a timestamped snapshot is stored too and
 * the oldest beyond the limit are pruned. Returns the timestamp written
 * into the config.
 */
export async function pushToCloud(
  cfg: CloudSyncConfig,
  backupJson: string,
  passphrase: string,
  opts?: { history?: boolean }
): Promise<number> {
  const envelope = await encryptToSyncFile(backupJson, passphrase)
  const res = await request('push', cfg, envelope)
  if (!res.ok) {
    throw new Error(
      res.error ?? `Upload failed (status ${res.status ?? 'network'})`
    )
  }
  const keep = opts?.history
    ? cfg.historyKeep ?? 0
    : 0
  if (keep > 0) {
    let snap: string | null = null
    try {
      // Timestamped snapshot — the live file always stays untouched.
      // v1.9: with incremental on, the snapshot carries a hash-chained
      // DELTA (only changed chats) and is cut with a full every MAX_CHAIN.
      snap = snapshotName(cfg.filename, new Date())
      const plan = await planSnapshot(cfg.filename, backupJson, {
        incremental: cfg.incremental === true,
        fileToUpload: snap,
      })
      const payload =
        plan.kind === 'delta'
          ? await encryptToSyncFile(plan.deltaJson ?? '', passphrase)
          : envelope
      await request('push', cfg, payload, snap)
      // Manifest only advances once the snapshot actually landed.
      await import('./sync-delta').then((m) =>
        m.saveDeltaManifest(plan.manifest)
      )
      // The chain files must survive pruning (a delta without its parent
      // is unrestorable) — keep = N snapshots + the whole current chain.
      const snaps = await listSnapshots(cfg)
      const chain = new Set(plan.manifest.chain)
      const prunable = snaps.filter((n) => !chain.has(n))
      for (const old of prunable.slice(Math.max(keep, chain.size))) {
        await deleteRemote(cfg, old)
      }
    } catch {
      /* history is best-effort — the live copy succeeded */
    }
  }
  return Date.now()
}

/**
 * Pull the remote envelope, decrypt it, and hand back the plain JSON backup
 * text ready for the standard restore pipeline. Throws when the passphrase
 * is wrong or the remote file is not one of ours.
 */
export async function pullFromCloud(
  cfg: CloudSyncConfig,
  passphrase: string,
  /** Pull a specific snapshot instead of the live file. */
  fromSnapshot?: string
): Promise<string> {
  const json = await pullDecryptedJson(cfg, passphrase, fromSnapshot)
  // v1.9 — incremental snapshots are delta envelopes: walk the chain up to
  // the base full snapshot and merge the changed chats on top, so callers
  // always restore from a self-contained backup.
  if (fromSnapshot && isDeltaEnvelope(json)) {
    return rebuildFullFromChain(
      (name) => pullDecryptedJson(cfg, passphrase, name),
      fromSnapshot
    )
  }
  return json
}

/** Pull + decrypt one remote file (no delta resolution). */
async function pullDecryptedJson(
  cfg: CloudSyncConfig,
  passphrase: string,
  name?: string
): Promise<string> {
  const res = await request('pull', cfg, undefined, name)
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'No cloud backup found yet (404) — push one first'
        : res.error ?? `Download failed (status ${res.status ?? 'network'})`
    )
  }
  const text = res.text ?? ''
  if (!looksLikeSyncFile(text)) {
    throw new Error('The remote file is not a WA Archiver encrypted backup')
  }
  return decryptFromSyncFile(text, passphrase)
}

/**
 * v1.9 — pull the RAW encrypted envelope of the live file (or a snapshot)
 * without decrypting: used by "save snapshot to file" so an off-site copy
 * can be kept on disk. Throws the same way pullFromCloud does.
 */
export async function pullEnvelopeText(
  cfg: CloudSyncConfig,
  name?: string
): Promise<string> {
  const res = await request('pull', cfg, undefined, name)
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'No cloud backup found yet (404) — push one first'
        : res.error ?? `Download failed (status ${res.status ?? 'network'})`
    )
  }
  const text = res.text ?? ''
  if (!looksLikeSyncFile(text)) {
    throw new Error('The remote file is not a WA Archiver encrypted backup')
  }
  return text
}

// ---------------------------------------------------------------------------
// Auto-push (optional "sync automatically after every import / export")
// ---------------------------------------------------------------------------

export interface AutoPushOutcome {
  pushed: boolean
  error?: string
}

/**
 * v1.9 — selective per-chat cloud sync. When the config restricts the sync
 * to a set of chats, `backupJson` is filtered down to those chats before
 * encryption/upload (envelopes stay small). No selection = untouched input.
 */
export function filterBackupJson(
  backupJson: string,
  cfg: CloudSyncConfig
): string {
  if (!cfg.syncSelectedOnly) return backupJson
  const ids = cfg.syncChatIds ?? []
  if (ids.length === 0) return backupJson
  try {
    const parsed = JSON.parse(backupJson) as { chats?: unknown }
    if (!Array.isArray(parsed.chats)) return backupJson
    const wanted = new Set(ids)
    parsed.chats = parsed.chats.filter((c) => {
      if (!c || typeof c !== 'object') return false
      const id = (c as { id?: unknown }).id
      return typeof id === 'string' && wanted.has(id)
    })
    return JSON.stringify(parsed)
  } catch {
    return backupJson
  }
}

/**
 * Push the current data to the cloud IF auto-push is enabled and configured.
 * Fire-and-forget safe: never throws. Call after every successful import or
 * export so the cloud copy is never stale. The sync passphrase must have
 * been saved device-local by the CloudSyncCard toggle.
 */
export async function autoPushIfEnabled(
  data: { exportBackup(): Promise<Blob> }
): Promise<AutoPushOutcome> {
  let cfg: CloudSyncConfig | null = null
  try {
    cfg = getCloudSyncConfig()
  } catch {
    return { pushed: false }
  }
  if (!cfg?.autoPush || !cfg.url) return { pushed: false }
  const pass = cfg.syncPassphrase ?? ''
  if (pass.length < 8) {
    return { pushed: false, error: 'Auto-push has no saved passphrase yet' }
  }
  try {
    const blob = await data.exportBackup()
    const json = filterBackupJson(await blob.text(), cfg)
    const at = await pushToCloud(cfg, json, pass, { history: true })
    saveCloudSyncConfig({ ...cfg, lastPushAt: at })
    return { pushed: true }
  } catch (err) {
    return {
      pushed: false,
      error: err instanceof Error ? err.message : 'Auto-push failed',
    }
  }
}
