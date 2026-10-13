/**
 * Mode-aware app lock (Phase 2).
 *
 * Server transport — unchanged v1.0 flow: PIN verified by /api/auth/lock
 * (scrypt hash in the DB), unlocking issues the signed 12-hour cookie that
 * also gates the data routes.
 *
 * Device transport — fully on-device: a random salt + WebCrypto SHA-256 hash
 * of "salt:pin" live in the local AppSetting table; the unlock marker is a
 * sessionStorage flag (clears when the tab closes — the device analogue of
 * the 12-hour cookie). No network involved.
 *
 * The local lock intentionally keeps the server's tradeoff: "reset" works
 * without the PIN (a viewer app must never hard-lock someone out of their
 * own data; documented in the UI).
 */

import type { DataClient } from './types'

export interface LockStatus {
  enabled: boolean
  unlocked: boolean
}

const PIN_RE = /^\d{4,8}$/

// Device-side setting keys (namespaced so they can never collide with the
// server's AppSetting keys if a backup is ever restored across transports).
const K_ENABLED = 'lock:enabled'
const K_SALT = 'lock:pin:salt'
const K_HASH = 'lock:pin:hash'
/** sessionStorage marker — the device analogue of the 12-hour cookie. */
const UNLOCK_KEY = 'wa-viewer:device-unlocked'

function bad(message: string): Error {
  return new Error(message)
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function randomSalt(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Small delay so wrong-PIN checks can't be timed apart (server parity). */
function slowDown(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 250))
}

async function serverAction(
  action: string,
  extra: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const res = await fetch('/api/auth/lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...extra }),
  })
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
  if (!res.ok) {
    const message =
      data && typeof data.error === 'string' ? data.error : 'Lock request failed'
    throw bad(message)
  }
  return data ?? {}
}

// ---------------------------------------------------------------------------
// Device-side helpers

async function deviceHashPin(pin: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${pin}`)
}

async function devicePinMatches(data: DataClient, pin: string): Promise<boolean> {
  const salt = await data.getSetting(K_SALT)
  const hash = await data.getSetting(K_HASH)
  if (!salt || !hash) return false
  const candidate = await deviceHashPin(pin, salt)
  return candidate === hash
}

function deviceMarkUnlocked(): void {
  try {
    window.sessionStorage.setItem(UNLOCK_KEY, '1')
  } catch {
    /* no sessionStorage — lock simply re-arms next load */
  }
}

function deviceClearUnlock(): void {
  try {
    window.sessionStorage.removeItem(UNLOCK_KEY)
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Public API

export async function lockStatus(
  mode: 'server' | 'device',
  data: DataClient
): Promise<LockStatus> {
  if (mode === 'server') {
    const res = await fetch('/api/auth/lock', { cache: 'no-store' })
    if (!res.ok) throw bad('Lock service error')
    const json = (await res.json()) as { enabled?: boolean; unlocked?: boolean }
    return { enabled: !!json.enabled, unlocked: !!json.unlocked }
  }
  const enabled = (await data.getSetting(K_ENABLED)) === '1'
  let unlocked = false
  try {
    unlocked = window.sessionStorage.getItem(UNLOCK_KEY) === '1'
  } catch {
    unlocked = false
  }
  return { enabled, unlocked: unlocked || !enabled }
}

export async function lockSet(
  mode: 'server' | 'device',
  data: DataClient,
  pin: string
): Promise<void> {
  if (!PIN_RE.test(pin)) throw bad('PIN must be 4–8 digits (numbers only)')
  if (mode === 'server') {
    await serverAction('set', { pin })
    return
  }
  if ((await data.getSetting(K_ENABLED)) === '1') {
    throw bad('Lock already enabled — use change')
  }
  const salt = randomSalt()
  await data.setSetting(K_SALT, salt)
  await data.setSetting(K_HASH, await deviceHashPin(pin, salt))
  await data.setSetting(K_ENABLED, '1')
  deviceMarkUnlocked()
}

export async function lockChange(
  mode: 'server' | 'device',
  data: DataClient,
  currentPin: string,
  newPin: string
): Promise<void> {
  if (!PIN_RE.test(newPin)) throw bad('New PIN must be 4–8 digits (numbers only)')
  if (mode === 'server') {
    await serverAction('change', { pin: currentPin, newPin })
    return
  }
  if ((await data.getSetting(K_ENABLED)) !== '1') throw bad('Lock is not enabled')
  if (!(await devicePinMatches(data, currentPin))) {
    await slowDown()
    throw bad('Current PIN is incorrect')
  }
  const salt = randomSalt()
  await data.setSetting(K_SALT, salt)
  await data.setSetting(K_HASH, await deviceHashPin(newPin, salt))
}

export async function lockVerify(
  mode: 'server' | 'device',
  data: DataClient,
  pin: string
): Promise<void> {
  if (mode === 'server') {
    await serverAction('verify', { pin })
    return
  }
  const ok = await devicePinMatches(data, pin)
  if (!ok) {
    await slowDown()
    throw bad('Incorrect PIN — try again')
  }
  deviceMarkUnlocked()
}

export async function lockDisable(
  mode: 'server' | 'device',
  data: DataClient,
  pin: string
): Promise<void> {
  if (mode === 'server') {
    await serverAction('disable', { pin })
    return
  }
  if ((await data.getSetting(K_ENABLED)) !== '1') throw bad('Lock is not enabled')
  if (!(await devicePinMatches(data, pin))) {
    await slowDown()
    throw bad('Current PIN is incorrect')
  }
  await data.deleteSetting(K_ENABLED)
  await data.deleteSetting(K_HASH)
  await data.deleteSetting(K_SALT)
  deviceClearUnlock()
}

/**
 * Remove the lock WITHOUT the PIN. Server transport documents this tradeoff
 * ("Forgot PIN?"); the device path behaves the same for local data.
 */
export async function lockReset(
  mode: 'server' | 'device',
  data: DataClient
): Promise<void> {
  if (mode === 'server') {
    await serverAction('reset')
    return
  }
  await data.deleteSetting(K_ENABLED)
  await data.deleteSetting(K_HASH)
  await data.deleteSetting(K_SALT)
  deviceClearUnlock()
}

/** Dispatched by callers after any successful lock-state mutation. */
export function fireLockChanged(): void {
  window.dispatchEvent(new Event('wa-lock-changed'))
}
