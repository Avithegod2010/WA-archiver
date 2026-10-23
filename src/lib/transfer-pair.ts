/**
 * One-bundle multi-device transfer — pairing codes + QR payload (v1.9).
 *
 * The transfer bundle is the SAME encrypted `.wasync` envelope the cloud
 * sync pushes. Pairing hands device B everything it needs to pull that
 * bundle from the shared provider (or to just receive the bundle directly
 * via the cloud): provider + endpoint fields + the sync passphrase, packed
 * into one portable string:
 *
 *   WAARCHIVER1.<base64url(json)>
 *
 * Device A shows the code as a QR (scannable with any camera app / the
 * in-app scanner) and a copy-paste code; device B pastes or scans it,
 * the CloudSyncCard adopts the config, and one tap pulls the bundle.
 * The code CONTAINS the provider credentials and the sync passphrase —
 * it must only ever be shown on the user's own screen / channel.
 */

import type { CloudProvider, CloudSyncConfig } from './cloud-sync'

const PREFIX = 'WAARCHIVER1.'

export interface PairingPayload {
  app: 'wa-archiver'
  v: 1
  provider: CloudProvider
  url: string
  username: string
  password: string
  filename: string
  s3Region?: string
  s3Bucket?: string
  s3AccessKey?: string
  s3SecretKey?: string
  s3Endpoint?: string
  s3Prefix?: string
  gdriveToken?: string
  gdriveRefreshToken?: string
  gdriveClientId?: string
  gdriveClientSecret?: string
  gdriveFolderId?: string
  /** Sync passphrase — the bundle on the provider is AES-GCM encrypted. */
  passphrase: string
  historyKeep?: number
  incremental?: boolean
}

function b64urlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(text: string): string {
  const pad = text.length % 4 === 0 ? '' : '='.repeat(4 - (text.length % 4))
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** Build a pairing code from the current cloud-sync config. */
export function buildPairingCode(
  cfg: CloudSyncConfig,
  passphrase: string
): string {
  const payload: PairingPayload = {
    app: 'wa-archiver',
    v: 1,
    provider: cfg.provider ?? 'webdav',
    url: cfg.url,
    username: cfg.username ?? '',
    password: cfg.password ?? '',
    filename: cfg.filename,
    s3Region: cfg.s3Region || undefined,
    s3Bucket: cfg.s3Bucket || undefined,
    s3AccessKey: cfg.s3AccessKey || undefined,
    s3SecretKey: cfg.s3SecretKey || undefined,
    s3Endpoint: cfg.s3Endpoint || undefined,
    s3Prefix: cfg.s3Prefix || undefined,
    gdriveToken: cfg.gdriveToken || undefined,
    gdriveRefreshToken: cfg.gdriveRefreshToken || undefined,
    gdriveClientId: cfg.gdriveClientId || undefined,
    gdriveClientSecret: cfg.gdriveClientSecret || undefined,
    gdriveFolderId: cfg.gdriveFolderId || undefined,
    passphrase,
    historyKeep: cfg.historyKeep ?? 0,
    incremental: cfg.incremental === true,
  }
  return PREFIX + b64urlEncode(JSON.stringify(payload))
}

/**
 * Parse a pairing code (tolerates surrounding text/whitespace — QR scanners
 * often wrap the payload). Returns null when the payload is not ours.
 */
export function parsePairingCode(raw: string): PairingPayload | null {
  if (!raw) return null
  const start = raw.indexOf(PREFIX)
  if (start < 0) return null
  const rest = raw.slice(start + PREFIX.length)
  // The code runs until the first whitespace (QR scanners add newlines).
  const end = rest.search(/\s/)
  const body = end > 0 ? rest.slice(0, end) : rest
  try {
    const obj = JSON.parse(b64urlDecode(body)) as Partial<PairingPayload>
    if (obj?.app !== 'wa-archiver') return null
    const provider: CloudProvider =
      obj.provider === 'gdrive' || obj.provider === 's3' ? obj.provider : 'webdav'
    if (typeof obj.url !== 'string' || typeof obj.filename !== 'string') {
      return null
    }
    return {
      app: 'wa-archiver',
      v: 1,
      provider,
      url: obj.url,
      username: typeof obj.username === 'string' ? obj.username : '',
      password: typeof obj.password === 'string' ? obj.password : '',
      filename: obj.filename,
      s3Region: obj.s3Region,
      s3Bucket: obj.s3Bucket,
      s3AccessKey: obj.s3AccessKey,
      s3SecretKey: obj.s3SecretKey,
      s3Endpoint: obj.s3Endpoint,
      s3Prefix: obj.s3Prefix,
      gdriveToken: obj.gdriveToken,
      gdriveRefreshToken: obj.gdriveRefreshToken,
      gdriveClientId: obj.gdriveClientId,
      gdriveClientSecret: obj.gdriveClientSecret,
      gdriveFolderId: obj.gdriveFolderId,
      passphrase: typeof obj.passphrase === 'string' ? obj.passphrase : '',
      historyKeep:
        typeof obj.historyKeep === 'number' ? obj.historyKeep : 0,
      incremental: obj.incremental === true,
    }
  } catch {
    return null
  }
}

/** Pairing payload → a complete CloudSyncConfig for saveCloudSyncConfig. */
export function pairingToConfig(p: PairingPayload): CloudSyncConfig {
  return {
    provider: p.provider,
    url: p.url,
    username: p.username,
    password: p.password,
    filename: p.filename || 'wa-archiver.wasync',
    s3Region: p.s3Region ?? '',
    s3Bucket: p.s3Bucket ?? '',
    s3AccessKey: p.s3AccessKey ?? '',
    s3SecretKey: p.s3SecretKey ?? '',
    s3Endpoint: p.s3Endpoint ?? '',
    s3Prefix: p.s3Prefix ?? 'wa-archiver/',
    gdriveToken: p.gdriveToken ?? '',
    gdriveRefreshToken: p.gdriveRefreshToken ?? '',
    gdriveClientId: p.gdriveClientId ?? '',
    gdriveClientSecret: p.gdriveClientSecret ?? '',
    gdriveFolderId: p.gdriveFolderId ?? '',
    historyKeep: p.historyKeep ?? 0,
    incremental: p.incremental === true,
    syncPassphrase: p.passphrase,
  }
}
