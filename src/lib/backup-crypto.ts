/**
 * Encrypted backups — optional passphrase protection for the JSON backup file.
 *
 * Format (version 1 envelope):
 * {
 *   "waArchiverEncrypted": true,
 *   "v": 1,
 *   "kdf": "PBKDF2-SHA256",
 *   "iterations": 310000,
 *   "salt": "<base64 16 bytes>",
 *   "iv":  "<base64 12 bytes>",
 *   "ct":  "<base64 AES-GCM-256 ciphertext of the UTF-8 backup JSON>"
 * }
 *
 * Design notes:
 * - WebCrypto only (works in browsers + Capacitor WebView, no deps).
 * - PBKDF2 with 310,000 iterations (OWASP 2023 guidance for SHA-256) and a
 *   per-backup random 16-byte salt — brute-forcing a stolen file is slow.
 * - AES-GCM-256 gives confidentiality + integrity; a wrong passphrase or a
 *   tampered file fails decryption instead of yielding garbage JSON.
 * - The envelope is itself valid JSON, so "restore from backup" can detect it
 *   with a cheap parse and route through the passphrase prompt.
 */

const ENVELOPE_FLAG = 'waArchiverEncrypted'
const KDF = 'PBKDF2-SHA256'
const ITERATIONS = 310_000
const SALT_BYTES = 16
const IV_BYTES = 12

export interface EncryptedBackupEnvelope {
  [ENVELOPE_FLAG]: true
  v: number
  kdf: string
  iterations: number
  salt: string
  iv: string
  ct: string
}

// ---- base64 helpers (btoa/atob are fine for small backups; chunked to be safe) ----

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

function b64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Cheap structural test: is this text an encrypted-backup envelope? */
export function isEncryptedBackup(text: string): boolean {
  try {
    const j = JSON.parse(text) as Record<string, unknown> | null
    return (
      !!j &&
      j[ENVELOPE_FLAG] === true &&
      typeof j.ct === 'string' &&
      typeof j.iv === 'string' &&
      typeof j.salt === 'string'
    )
  } catch {
    return false
  }
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const base = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** Encrypt a backup JSON string with a passphrase → envelope JSON string. */
export async function encryptBackupText(
  text: string,
  passphrase: string
): Promise<string> {
  if (!passphrase) throw new Error('Passphrase required')
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt, ITERATIONS)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(text)
  )
  const envelope: EncryptedBackupEnvelope = {
    [ENVELOPE_FLAG]: true,
    v: 1,
    kdf: KDF,
    iterations: ITERATIONS,
    salt: bufToB64(salt),
    iv: bufToB64(iv),
    ct: bufToB64(ct),
  }
  return JSON.stringify(envelope)
}

/**
 * Decrypt an encrypted-backup envelope with a passphrase → original backup
 * JSON string. Throws on a wrong passphrase (WebCrypto OperationError) or a
 * corrupted/tampered file.
 */
export async function decryptBackupText(
  text: string,
  passphrase: string
): Promise<string> {
  const j = JSON.parse(text) as Partial<EncryptedBackupEnvelope>
  if (j[ENVELOPE_FLAG] !== true || !j.salt || !j.iv || !j.ct) {
    throw new Error('Not an encrypted backup')
  }
  const iterations =
    typeof j.iterations === 'number' && j.iterations >= 10_000
      ? j.iterations
      : ITERATIONS
  const key = await deriveKey(passphrase, b64ToBuf(j.salt), iterations)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(j.iv) as BufferSource },
    key,
    b64ToBuf(j.ct) as BufferSource
  )
  return new TextDecoder().decode(pt)
}
