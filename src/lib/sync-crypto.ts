/**
 * Encrypted portable sync file (backlog idea #11) 🛡
 *
 * Wraps the existing JSON backup in end-to-end encryption:
 *
 *   • KDF:      PBKDF2-HMAC-SHA256, 310 000 iterations, 16-byte random salt
 *   • Cipher:   AES-GCM-256 (96-bit random IV, built-in auth tag)
 *   • Envelope: small JSON ("wa-sync" magic + params + base64 payload) so
 *               the format stays inspectable/upgradeable — the ciphertext
 *               itself is what's unreadable without the passphrase.
 *
 * No server ever sees plaintext: everything runs in the browser via
 * WebCrypto; the export is a normal file download and the import is a
 * normal file pick.
 *
 * File extension: `.wasync` (JSON envelope, application/json).
 */

const MAGIC = 'wa-sync'
const FORMAT_VERSION = 1
const PBKDF2_ITERATIONS = 310_000
const SALT_BYTES = 16
const IV_BYTES = 12

export const SYNC_FILE_EXT = '.wasync'
export const SYNC_FILE_ACCEPT = '.wasync,application/json'

export interface SyncEnvelope {
  magic: string
  v: number
  kdf: 'PBKDF2-SHA256'
  iter: number
  salt: string
  iv: string
  ct: string
  created: string
}

function subtle(): SubtleCrypto {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('WebCrypto is not available in this context')
  }
  return window.crypto.subtle
}

export function isSyncEnvelope(value: unknown): value is SyncEnvelope {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.magic === MAGIC &&
    typeof v.salt === 'string' &&
    typeof v.iv === 'string' &&
    typeof v.ct === 'string'
  )
}

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const keyMaterial = await subtle().importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return subtle().deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/**
 * Encrypt a JSON backup string with a passphrase.
 * Returns the `.wasync` envelope as a pretty-printed JSON string.
 */
export async function encryptToSyncFile(
  jsonText: string,
  passphrase: string
): Promise<string> {
  if (!passphrase) throw new Error('Passphrase is required')
  const salt = window.crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(jsonText)
  )
  const envelope: SyncEnvelope = {
    magic: MAGIC,
    v: FORMAT_VERSION,
    kdf: 'PBKDF2-SHA256',
    iter: PBKDF2_ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
    created: new Date().toISOString(),
  }
  return JSON.stringify(envelope, null, 2)
}

/**
 * Decrypt a `.wasync` envelope string with a passphrase.
 * Returns the original JSON backup text. Throws when the passphrase is
 * wrong (AES-GCM auth failure) or the envelope is malformed.
 */
export async function decryptFromSyncFile(
  text: string,
  passphrase: string
): Promise<string> {
  if (!passphrase) throw new Error('Passphrase is required')
  let env: unknown
  try {
    env = JSON.parse(text)
  } catch {
    throw new Error('Not a sync file (invalid envelope)')
  }
  if (!isSyncEnvelope(env)) {
    throw new Error('Not a sync file (missing wa-sync header)')
  }
  const salt = fromB64(env.salt)
  const iv = fromB64(env.iv)
  const ct = fromB64(env.ct)
  const key = await deriveKey(passphrase, salt, env.iter || PBKDF2_ITERATIONS)
  let plain: ArrayBuffer
  try {
    plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      ct as unknown as BufferSource
    )
  } catch {
    throw new Error('Wrong passphrase — or the file was modified')
  }
  return new TextDecoder().decode(plain)
}

/** True when the given text looks like one of OUR sync envelopes. */
export function looksLikeSyncFile(text: string): boolean {
  try {
    return isSyncEnvelope(JSON.parse(text))
  } catch {
    return false
  }
}

/** Suggested download name: wa-viewer-sync-2025-01-31.wasync */
export function syncFileName(d = new Date()): string {
  return `wa-viewer-sync-${d.toISOString().slice(0, 10)}${SYNC_FILE_EXT}`
}
