/**
 * Security regression tests for the app-lock bypass fix.
 *
 * Covers the unauthenticated `POST /api/auth/lock {"action":"reset"}` bypass,
 * PIN brute-force throttling, fail-closed behavior on DB errors, and the
 * unlock-cookie flags. Runs in-process via `bun test` (no server needed)
 * against the real route module and the real lock settings table.
 *
 * NOTE on locality: these tests run in a plain bun process where the
 * instrumentation hook has not run, so `requestIdentity()` treats every
 * request as remote/untrusted — exactly the attacker's position. Tests
 * that need to simulate the trusted local path toggle the hook flag the
 * same way src/instrumentation.ts does (and prove in an integration test
 * that the hook overwrites a spoofed socket header).
 *
 * Run: bun run test:security
 */
/// <reference types="bun-types" />
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { GET, POST } from '@/app/api/auth/lock/route'
import { db } from '@/lib/db'
import {
  assertAppUnlocked,
  clearUnlockCookieHeader,
  delSetting,
  genSalt,
  hashPin,
  isLockEnabled,
  setSetting,
  unlockCookieHeader,
} from '@/lib/server-lock'
import { clearPinThrottleForTests } from '@/lib/pin-throttle'

const TEST_PIN = '44556677'

const LOCK_KEYS = ['lock:enabled', 'lock:pin:hash', 'lock:pin:salt', 'lock:secret'] as const

/** Snapshotted lock rows, restored after the whole suite. */
const saved: Record<string, string | null> = {}

function postReq(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  url = 'http://localhost:3000/api/auth/lock'
): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

/** Force a lock state directly in the DB (bypasses the route). */
async function forceLock(pin: string | null): Promise<void> {
  if (pin === null) {
    await delSetting('lock:enabled')
    await delSetting('lock:pin:hash')
    await delSetting('lock:pin:salt')
    return
  }
  const salt = genSalt()
  await setSetting('lock:pin:salt', salt)
  await setSetting('lock:pin:hash', hashPin(pin, salt))
  await setSetting('lock:enabled', '1')
}

function setHookFlag(on: boolean): void {
  const g = globalThis as Record<string, unknown>
  if (on) g.__WA_SOCK_ADDR_HOOK__ = true
  else delete g.__WA_SOCK_ADDR_HOOK__
}

beforeAll(async () => {
  for (const key of LOCK_KEYS) {
    const row = await db.appSetting.findUnique({ where: { key } })
    saved[key] = row?.value ?? null
  }
  clearPinThrottleForTests()
})

afterAll(async () => {
  for (const key of LOCK_KEYS) {
    if (saved[key] === null) await delSetting(key)
    else await setSetting(key, saved[key] as string)
  }
  clearPinThrottleForTests()
  delete process.env.WA_LOCK_RESET_TOKEN
  setHookFlag(false)
})

describe('lock reset bypass (the reported bug)', () => {
  test('reset without PIN is rejected for a remote unauthenticated caller', async () => {
    await forceLock(TEST_PIN)
    expect(await isLockEnabled()).toBe(true)

    const res = await POST(postReq({ action: 'reset' }))
    expect(res.status).toBe(403)

    // The lock must still be armed and still gate data routes.
    expect(await isLockEnabled()).toBe(true)
    const denied = await assertAppUnlocked(new Request('http://localhost:3000/api/backup'))
    expect(denied?.status).toBe(401)
  })

  test('full archive stays blocked after a rejected reset (API-level regression)', async () => {
    await forceLock(TEST_PIN)
    await POST(postReq({ action: 'reset' })) // rejected, ignored
    const status = await GET(new Request('http://localhost:3000/api/auth/lock'))
    expect((await status.json()).enabled).toBe(true)
  })

  test('reset with the correct current PIN works from any client', async () => {
    await forceLock(TEST_PIN)
    clearPinThrottleForTests()
    const res = await POST(postReq({ action: 'reset', pin: TEST_PIN }))
    expect(res.status).toBe(200)
    expect(await isLockEnabled()).toBe(false)
  })

  test('reset with a wrong PIN is rejected and counts toward the lockout', async () => {
    await forceLock(TEST_PIN)
    clearPinThrottleForTests()
    const res = await POST(postReq({ action: 'reset', pin: '0000' }))
    expect(res.status).toBe(401)
    expect(await isLockEnabled()).toBe(true)
    clearPinThrottleForTests()
  })

  test('reset while no lock is enabled is a harmless no-op', async () => {
    await forceLock(null)
    const res = await POST(postReq({ action: 'reset' }))
    expect(res.status).toBe(200)
    expect((await res.json()).noop).toBe(true)
  })

  test('a spoofed x-wa-socket-remote-addr header is ignored without the hook', async () => {
    await forceLock(TEST_PIN)
    clearPinThrottleForTests()
    // Attacker claims loopback; the hook flag is OFF in this process, so the
    // header must not be trusted.
    const res = await POST(
      postReq({ action: 'reset' }, { 'x-wa-socket-remote-addr': '::1' })
    )
    expect(res.status).toBe(403)
    expect(await isLockEnabled()).toBe(true)
  })

  test('loopback socket + remote XFF hop is NOT local recovery (behind-proxy case)', async () => {
    await forceLock(TEST_PIN)
    clearPinThrottleForTests()
    setHookFlag(true)
    try {
      const res = await POST(
        postReq({ action: 'reset' }, {
          'x-wa-socket-remote-addr': '::1',
          'x-forwarded-for': '203.0.113.9',
        })
      )
      expect(res.status).toBe(403)
      expect(await isLockEnabled()).toBe(true)

      // Fake loopback prefix + honest proxy appending the real client —
      // the non-loopback tail must disqualify local recovery.
      const res2 = await POST(
        postReq({ action: 'reset' }, {
          'x-wa-socket-remote-addr': '127.0.0.1',
          'x-forwarded-for': '127.0.0.1, 203.0.113.9',
        })
      )
      expect(res2.status).toBe(403)
    } finally {
      setHookFlag(false)
    }
  })

  test('loopback socket + all-loopback XFF chain (appending proxy) IS local recovery', async () => {
    await forceLock(TEST_PIN)
    clearPinThrottleForTests()
    setHookFlag(true)
    try {
      const res = await POST(
        postReq({ action: 'reset' }, {
          'x-wa-socket-remote-addr': '::1',
          'x-forwarded-for': '::1, 127.0.0.1',
        })
      )
      expect(res.status).toBe(200)
      expect(await isLockEnabled()).toBe(false)
    } finally {
      setHookFlag(false)
    }
  })

  test('direct loopback (hook active, no proxy header) is honored as local recovery', async () => {
    await forceLock(TEST_PIN)
    clearPinThrottleForTests()
    setHookFlag(true)
    try {
      const res = await POST(
        postReq({ action: 'reset' }, { 'x-wa-socket-remote-addr': '127.0.0.1' })
      )
      expect(res.status).toBe(200)
      expect(await isLockEnabled()).toBe(false)
    } finally {
      setHookFlag(false)
    }
  })

  test('WA_LOCK_RESET_TOKEN: wrong token rejected, correct token accepted', async () => {
    await forceLock(TEST_PIN)
    clearPinThrottleForTests()
    process.env.WA_LOCK_RESET_TOKEN = 'correct-horse-battery-staple'
    try {
      const bad = await POST(postReq({ action: 'reset' }, { 'x-wa-recovery': 'wrong' }))
      expect(bad.status).toBe(403)
      expect(await isLockEnabled()).toBe(true)

      const good = await POST(
        postReq({ action: 'reset' }, { 'x-wa-recovery': 'correct-horse-battery-staple' })
      )
      expect(good.status).toBe(200)
      expect(await isLockEnabled()).toBe(false)
    } finally {
      delete process.env.WA_LOCK_RESET_TOKEN
    }
  })
})

describe('PIN brute-force throttling', () => {
  test('5 wrong PINs lock the client out for 15 minutes — even the correct PIN gets 429', async () => {
    await forceLock(TEST_PIN)
    clearPinThrottleForTests()

    for (let i = 0; i < 5; i++) {
      const res = await POST(postReq({ action: 'verify', pin: '0000' }))
      expect(res.status).toBe(401)
    }

    // Even the CORRECT PIN is now refused while locked out…
    const lockedOut = await POST(postReq({ action: 'verify', pin: TEST_PIN }))
    expect(lockedOut.status).toBe(429)
    const retryAfter = Number(lockedOut.headers.get('retry-after'))
    expect(Number.isFinite(retryAfter)).toBe(true)
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(15 * 60)

    // …and the lockout is shared across actions (disable with the correct
    // PIN is also refused — same client bucket).
    const disableTry = await POST(postReq({ action: 'disable', pin: TEST_PIN }))
    expect(disableTry.status).toBe(429)
  })

  test('after the throttle state is cleared, the correct PIN verifies again', async () => {
    await forceLock(TEST_PIN)
    clearPinThrottleForTests()
    const res = await POST(postReq({ action: 'verify', pin: TEST_PIN }))
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('wa_unlock=')
    clearPinThrottleForTests()
  })

  test('a successful verify clears the failure history for that client', async () => {
    await forceLock(TEST_PIN)
    clearPinThrottleForTests()
    await POST(postReq({ action: 'verify', pin: '0000' })) // 1 failure
    await POST(postReq({ action: 'verify', pin: '0000' })) // 2 failures
    const ok = await POST(postReq({ action: 'verify', pin: TEST_PIN })) // success clears
    expect(ok.status).toBe(200)
    // Fresh counter — 3 more failures are still allowed before lockout.
    for (let i = 0; i < 3; i++) {
      const res = await POST(postReq({ action: 'verify', pin: '0000' }))
      expect(res.status).toBe(401)
    }
    const stillOk = await POST(postReq({ action: 'verify', pin: TEST_PIN }))
    expect(stillOk.status).toBe(200)
    clearPinThrottleForTests()
  })
})

describe('fail-closed lock gate on DB errors', () => {
  test('assertAppUnlocked denies with 503 while lock state cannot be read', async () => {
    await forceLock(TEST_PIN)
    const delegate = db.appSetting as unknown as Record<string, unknown>
    const original = delegate.findUnique
    delegate.findUnique = () => {
      throw new Error('simulated DB outage')
    }
    try {
      const denied = await assertAppUnlocked(new Request('http://localhost:3000/api/backup'))
      expect(denied).not.toBeNull()
      expect(denied?.status).toBe(503) // fail closed, not fail open
    } finally {
      delegate.findUnique = original
    }
    // And the gate still behaves normally once the DB answers again.
    const still = await assertAppUnlocked(new Request('http://localhost:3000/api/backup'))
    expect(still?.status).toBe(401)
  })
})

describe('unlock cookie flags', () => {
  test('plain HTTP: HttpOnly + SameSite=Lax, no Secure', () => {
    const header = unlockCookieHeader('1234567890.' + 'a'.repeat(64))
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).not.toContain('Secure')
  })

  test('HTTPS transport: Secure flag is added', () => {
    const header = unlockCookieHeader('1234567890.' + 'a'.repeat(64), true)
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Secure')
    const clear = clearUnlockCookieHeader(true)
    expect(clear).toContain('Secure')
    expect(clear).toContain('Max-Age=0')
  })

  test('verify over https request sets a Secure session cookie; http does not', async () => {
    await forceLock(TEST_PIN)
    clearPinThrottleForTests()

    const httpRes = await POST(postReq({ action: 'verify', pin: TEST_PIN }))
    const httpCookie = httpRes.headers.get('set-cookie') ?? ''
    expect(httpCookie).toContain('HttpOnly')
    expect(httpCookie).toContain('SameSite=Lax')
    expect(httpCookie).not.toContain('Secure')

    clearPinThrottleForTests()
    const httpsRes = await POST(
      postReq({ action: 'verify', pin: TEST_PIN }, { 'x-forwarded-proto': 'https' },
        'https://example.com/api/auth/lock')
    )
    const httpsCookie = httpsRes.headers.get('set-cookie') ?? ''
    expect(httpsCookie).toContain('Secure')
    expect(httpsCookie).toContain('HttpOnly')
    expect(httpsCookie).toContain('SameSite=Lax')
    clearPinThrottleForTests()
  })
})

describe('instrumentation hook (unspoofable socket address)', () => {
  test('the http patch overwrites a spoofed x-wa-socket-remote-addr header', async () => {
    // Next sets NEXT_RUNTIME in the server process; mirror it so register()
    // applies its patch here (plain `bun test` does not set it).
    const prevRuntime = process.env.NEXT_RUNTIME
    process.env.NEXT_RUNTIME = 'nodejs'
    try {
      const { register } = await import('@/instrumentation')
      await register()

      const seen: string[] = []
      const server = createServer((req, res) => {
        seen.push(String(req.headers['x-wa-socket-remote-addr'] ?? ''))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ addr: req.headers['x-wa-socket-remote-addr'] }))
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as { port: number }).port

      try {
        // Client claims to be 9.8.7.6; the hook must overwrite it with the
        // real socket address (loopback, since we connect locally).
        const res = await fetch(`http://127.0.0.1:${port}/`, {
          headers: { 'x-wa-socket-remote-addr': '9.8.7.6' },
        })
        const body = (await res.json()) as { addr?: string }
        expect(body.addr).not.toBe('9.8.7.6')
        expect(
          body.addr === '127.0.0.1' || body.addr === '::1' || body.addr === '::ffff:127.0.0.1'
        ).toBe(true)
        expect(seen[0]).toBe(String(body.addr))
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    } finally {
      if (prevRuntime === undefined) delete process.env.NEXT_RUNTIME
      else process.env.NEXT_RUNTIME = prevRuntime
    }
  })
})
