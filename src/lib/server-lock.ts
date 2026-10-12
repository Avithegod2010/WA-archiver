/**
 * Server-side app lock — shared helpers (Task 14, server-side lock feature).
 *
 * Design:
 *  - PIN hash: scrypt(pin, salt, 64) stored in AppSetting keys `lock:pin:hash`
 *    and `lock:pin:salt`; `lock:enabled` = '1' | '0'.
 *  - Unlock session: httpOnly cookie `wa_unlock` = "<expMs>.<hmac>" where the
 *    HMAC key lives in AppSetting `lock:secret` (generated lazily). Valid for
 *    12 hours, then the lock screen comes back.
 *  - Every data route starts with:
 *        const denied = await assertAppUnlocked(req)
 *        if (denied) return denied
 *    which is a no-op while the lock is disabled.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const UNLOCK_COOKIE = 'wa_unlock'
export const UNLOCK_TTL_S = 12 * 60 * 60 // 12 hours
const UNLOCK_TTL_MS = UNLOCK_TTL_S * 1000

export function genSalt(): string {
  return randomBytes(16).toString('hex')
}

/** scrypt PIN hash (NFKC-normalized, 64-byte output). */
export function hashPin(pin: string, saltHex: string): string {
  return scryptSync(pin.normalize('NFKC'), saltHex, 64, { N: 16384, r: 8, p: 1 }).toString('hex')
}

/** Constant-time hex string comparison (false-safe on length mismatch). */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

export async function delSetting(key: string): Promise<void> {
  try {
    await db.appSetting.delete({ where: { key } })
  } catch {
    /* already gone */
  }
}

export async function isLockEnabled(): Promise<boolean> {
  const v = await getSetting('lock:enabled')
  return v === '1'
}

async function getSessionSecret(): Promise<string> {
  const existing = await getSetting('lock:secret')
  if (existing) return existing
  const secret = randomBytes(32).toString('hex')
  await setSetting('lock:secret', secret)
  return secret
}

function signUnlock(expMs: number, secret: string): string {
  return createHmac('sha256', secret).update(`wa_unlock|${expMs}`).digest('hex')
}

/** Issue a fresh unlock cookie (call after set/verify/disable-check success). */
export async function makeUnlockCookie(): Promise<{ name: string; value: string; maxAge: number }> {
  const secret = await getSessionSecret()
  const exp = Date.now() + UNLOCK_TTL_MS
  return { name: UNLOCK_COOKIE, value: `${exp}.${signUnlock(exp, secret)}`, maxAge: UNLOCK_TTL_S }
}

export function unlockCookieHeader(value: string): string {
  return `${UNLOCK_COOKIE}=${value}; Path=/; Max-Age=${UNLOCK_TTL_S}; HttpOnly; SameSite=Lax`
}

export function clearUnlockCookieHeader(): string {
  return `${UNLOCK_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
}

function readCookieFromRequest(req?: Request): string | null {
  const header = req?.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    if (part.slice(0, idx).trim() === UNLOCK_COOKIE) return decodeURIComponent(part.slice(idx + 1).trim())
  }
  return null
}

/** True when the request carries a valid, unexpired unlock cookie. */
export async function isUnlocked(req?: Request): Promise<boolean> {
  const raw = readCookieFromRequest(req)
  if (!raw) return false
  const dot = raw.indexOf('.')
  if (dot === -1) return false
  const expStr = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp <= Date.now() || exp > Date.now() + UNLOCK_TTL_MS + 60_000) return false
  if (!/^[0-9a-f]{64}$/.test(sig)) return false
  const secret = await getSessionSecret()
  return safeEqualHex(signUnlock(exp, secret), sig)
}

/**
 * Guard for data routes: returns a 401 NextResponse while the app lock is
 * enabled and the request is not unlocked; returns null (allow) otherwise.
 *
 * Usage at the top of every data route handler:
 *   const denied = await assertAppUnlocked(req)
 *   if (denied) return denied
 */
export async function assertAppUnlocked(req?: Request): Promise<NextResponse | null> {
  let enabled: boolean
  try {
    enabled = await isLockEnabled()
  } catch {
    // DB hiccups must never brick the whole app — fail open.
    return null
  }
  if (!enabled) return null
  if (await isUnlocked(req)) return null
  return NextResponse.json({ error: 'App is locked' }, { status: 401 })
}
