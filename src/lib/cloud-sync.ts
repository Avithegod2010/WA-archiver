/**
 * Cloud-ready persistence (WebDAV) — backlog "cloud sync".
 *
 * Storage-adapter approach: the SAME encrypted `.wasync` envelope produced by
 * sync-crypto is pushed to / pulled from ANY WebDAV server (Nextcloud, ownCloud,
 * Fastmail, InfiniCloud, …). The passphrase never leaves the device — the
 * WebDAV endpoint only ever stores AES-GCM ciphertext, so "cloud" is just a
 * dumb, replaceable blob store:
 *
 *   exportBackup() → encryptToSyncFile(json, passphrase) → PUT <url>/<file>
 *   restore()      → GET <url>/<file> → decryptFromSyncFile → import pipeline
 *
 * Two transports:
 *   • server mode (Next.js web app): POST /api/cloud-sync proxy — no CORS
 *     problems, credentials stay in the request body only.
 *   • device mode (Capacitor): direct fetch from the webview (many WebDAV
 *     servers allow it; the user can always fall back to the .wasync file).
 *
 * Config lives in localStorage under 'wa-viewer:cloud-sync' — the app
 * password is stored device-local only (documented in the UI).
 */

import {
  decryptFromSyncFile,
  encryptToSyncFile,
  looksLikeSyncFile,
} from './sync-crypto'

const CONFIG_KEY = 'wa-viewer:cloud-sync'

export interface CloudSyncConfig {
  /** WebDAV collection URL, e.g. https://cloud.example.com/remote.php/dav/files/me/wa-archiver/ */
  url: string
  username: string
  /** App password — stored device-local (localStorage) only. */
  password: string
  /** Remote file name inside the collection. */
  filename: string
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
      url: v.url,
      username: v.username ?? '',
      password: v.password ?? '',
      filename: v.filename || 'wa-archiver.wasync',
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

/** Normalize the collection URL + filename into the full file URL. */
export function cloudFileUrl(cfg: CloudSyncConfig): string {
  const base = cfg.url.replace(/\/+$/, '')
  const file = cfg.filename.replace(/^\/+/, '')
  return `${base}/${file}`
}

/**
 * True when the server proxy is usable (web build). The APK/device build
 * has no /api routes and must talk WebDAV directly.
 */
export function proxyAvailable(): boolean {
  if (typeof window === 'undefined') return false
  const isCap = /capacitor/i.test(window.navigator.userAgent)
  return !isCap
}

type ProxyAction = 'test' | 'push' | 'pull'

interface ProxyRequest {
  action: ProxyAction
  url: string
  username: string
  password: string
  payload?: string
}

interface ProxyResponse {
  ok: boolean
  status?: number
  text?: string
  error?: string
}

/** Server-proxy transport (web mode). */
async function proxyRequest(req: ProxyRequest): Promise<ProxyResponse> {
  const res = await fetch('/api/cloud-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(60_000),
  })
  const out = (await res.json().catch(() => null)) as ProxyResponse | null
  // null → treated as a transport failure at the call sites
  return out ?? { ok: false, error: 'Cloud sync proxy unreachable' }
}

/** Direct WebDAV transport (device mode). */
async function directRequest(
  action: ProxyAction,
  cfg: CloudSyncConfig,
  payload?: string
): Promise<ProxyResponse> {
  const url = cloudFileUrl(cfg)
  const headers: Record<string, string> = {
    Authorization: 'Basic ' + btoa(`${cfg.username}:${cfg.password}`),
  }
  if (action === 'push') headers['Content-Type'] = 'application/json'
  try {
    const res = await fetch(url, {
      method: action === 'push' ? 'PUT' : action === 'pull' ? 'GET' : 'PROPFIND',
      headers: action === 'test' ? { ...headers, Depth: '0' } : headers,
      body: action === 'push' ? payload : undefined,
      signal: AbortSignal.timeout(60_000),
    })
    const text =
      action === 'pull' || action === 'test'
        ? await res.text().catch(() => '')
        : ''
    return { ok: res.ok, status: res.status, text }
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

async function request(
  action: ProxyAction,
  cfg: CloudSyncConfig,
  payload?: string
): Promise<ProxyResponse> {
  if (proxyAvailable()) {
    const viaProxy = await proxyRequest({
      action,
      url: cloudFileUrl(cfg),
      username: cfg.username,
      password: cfg.password,
      payload,
    })
    if (viaProxy) return viaProxy
    // Proxy unreachable (unlikely in web mode) — fall through to direct.
  }
  return directRequest(action, cfg, payload)
}

/** Verify the collection is reachable + writable credentials. */
export async function testCloudConnection(
  cfg: CloudSyncConfig
): Promise<{ ok: boolean; message: string }> {
  const res = await request('test', cfg)
  if (res.ok) return { ok: true, message: 'Connection OK' }
  if (res.status === 401) return { ok: false, message: 'Unauthorized (401) — check username / app password' }
  if (res.status === 404)
    return {
      ok: false,
      message:
        'Not found (404) — create the remote folder first (e.g. in Nextcloud Files)',
    }
  return {
    ok: false,
    message: res.error ?? `Failed (status ${res.status ?? 'network'})`,
  }
}

/**
 * Push a JSON backup, encrypted with the passphrase, to the WebDAV file.
 * Returns the timestamp written into the config.
 */
export async function pushToCloud(
  cfg: CloudSyncConfig,
  backupJson: string,
  passphrase: string
): Promise<number> {
  const envelope = await encryptToSyncFile(backupJson, passphrase)
  const res = await request('push', cfg, envelope)
  if (!res.ok) {
    throw new Error(
      res.error ?? `Upload failed (status ${res.status ?? 'network'})`
    )
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
  passphrase: string
): Promise<string> {
  const res = await request('pull', cfg)
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
