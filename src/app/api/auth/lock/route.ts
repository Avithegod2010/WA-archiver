import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  clearUnlockCookieHeader,
  delSetting,
  genSalt,
  getSetting,
  hashPin,
  isLockEnabled,
  isUnlocked,
  makeUnlockCookie,
  safeEqualHex,
  setSetting,
  unlockCookieHeader,
} from '@/lib/server-lock'
import { isDirectLocalRequest, requestIdentity } from '@/lib/request-identity'
import {
  pinThrottleCheck,
  recordPinFailure,
  recordPinSuccess,
} from '@/lib/pin-throttle'

export const runtime = 'nodejs'

/**
 * Server-side app lock gate. This route IS the auth gate, so it
 * deliberately does NOT call assertAppUnlocked — every other data route does.
 *
 * GET  → { enabled, unlocked } (always accessible, no lock guard)
 * POST { action, pin?, newPin? }:
 *   set     → enable the lock with a new 4–8 digit PIN (409 if already enabled)
 *   change  → rotate the PIN (requires the current one), fresh 12 h session
 *   verify  → check a PIN, issue the unlock session cookie on success
 *   disable → turn the lock off (requires the current PIN), clears the session
 *   reset   → remove the lock — see the recovery rules in the reset case
 *
 * Security (lock-bypass fix): every action that checks a PIN (verify /
 * change / disable / reset-with-PIN) is throttled per client — 5 wrong
 * attempts within 15 minutes trigger a 15-minute lockout (429, correct
 * PIN included). 'reset' without a PIN is no longer callable by arbitrary
 * network clients: it requires local (loopback, direct) access or the
 * operator-set WA_LOCK_RESET_TOKEN header.
 */

const PIN_RE = /^\d{4,8}$/

/** Constant-time check of a candidate PIN against the stored salt/hash. */
async function pinMatches(pin: string): Promise<boolean> {
  const salt = await getSetting('lock:pin:salt')
  const hash = await getSetting('lock:pin:hash')
  if (!salt || !hash) return false
  return safeEqualHex(hashPin(pin, salt), hash)
}

/** Small delay so wrong-PIN responses can't be timed apart from scrypt work. */
function slowDown(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 250))
}

function badRequest(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 })
}

/**
 * 429 response while the client is locked out of PIN attempts, or null when
 * the client may still try. Shared by verify / change / disable / reset.
 */
function throttleReject(identity: ReturnType<typeof requestIdentity>): NextResponse | null {
  const retryAfter = pinThrottleCheck(identity.throttleKey)
  if (retryAfter === null) return null
  return NextResponse.json(
    {
      ok: false,
      error: `Too many incorrect PIN attempts — locked for ${Math.ceil(retryAfter / 60)} more minute(s)`,
    },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } }
  )
}

/**
 * Shared PIN gate: lockout check → constant-time compare → throttle bookkeeping.
 * Returns a NextResponse on rejection, or null when the PIN is correct.
 */
async function wrongPinGate(
  identity: ReturnType<typeof requestIdentity>,
  pin: string,
  errorBody: string
): Promise<NextResponse | null> {
  const throttled = throttleReject(identity)
  if (throttled) return throttled
  if (!(await pinMatches(pin))) {
    recordPinFailure(identity.throttleKey)
    await slowDown()
    return NextResponse.json(
      { ok: false, error: errorBody },
      { status: 401 }
    )
  }
  recordPinSuccess(identity.throttleKey)
  return null
}

/** Timing-safe compare of a client-supplied recovery token against the env value. */
function recoveryTokenMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** JSON response carrying a fresh 12-hour unlock session cookie. */
async function okWithSession(
  body: Record<string, unknown>,
  identity: ReturnType<typeof requestIdentity>
): Promise<NextResponse> {
  const res = NextResponse.json(body)
  const cookie = await makeUnlockCookie()
  res.headers.append('Set-Cookie', unlockCookieHeader(cookie.value, identity.secureTransport))
  return res
}

/** Remove all lock settings and expire the unlock session cookie. */
async function wipeLock(): Promise<void> {
  await delSetting('lock:enabled')
  await delSetting('lock:pin:hash')
  await delSetting('lock:pin:salt')
}

export async function GET(req: Request) {
  try {
    return NextResponse.json({
      enabled: await isLockEnabled(),
      unlocked: await isUnlocked(req),
    })
  } catch {
    return NextResponse.json({ error: 'Lock service error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return badRequest('Invalid request body — expected JSON')
    }
    if (typeof body !== 'object' || body === null) {
      return badRequest('Invalid request body — expected a JSON object')
    }
    const { action, pin, newPin } = body as {
      action?: unknown
      pin?: unknown
      newPin?: unknown
    }
    if (typeof action !== 'string' || action.length === 0) {
      return badRequest('Missing lock action')
    }

    const identity = requestIdentity(req)

    switch (action) {
      case 'set': {
        if (await isLockEnabled()) {
          return NextResponse.json(
            { error: 'Lock already enabled — use change' },
            { status: 409 }
          )
        }
        if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
          return badRequest('PIN must be 4–8 digits (numbers only)')
        }
        const salt = genSalt()
        await setSetting('lock:pin:salt', salt)
        await setSetting('lock:pin:hash', hashPin(pin, salt))
        await setSetting('lock:enabled', '1')
        return okWithSession({ ok: true }, identity)
      }

      case 'change': {
        if (!(await isLockEnabled())) {
          return badRequest('Lock is not enabled')
        }
        if (
          typeof pin !== 'string' ||
          !PIN_RE.test(pin) ||
          typeof newPin !== 'string' ||
          !PIN_RE.test(newPin)
        ) {
          return badRequest('PINs must be 4–8 digits (numbers only)')
        }
        const denied = await wrongPinGate(identity, pin, 'Current PIN is incorrect')
        if (denied) return denied
        const salt = genSalt()
        await setSetting('lock:pin:salt', salt)
        await setSetting('lock:pin:hash', hashPin(newPin, salt))
        // `lock:enabled` stays '1' — a fresh session cookie is issued so the
        // person who changed the PIN stays unlocked.
        return okWithSession({ ok: true }, identity)
      }

      case 'verify': {
        if (!(await isLockEnabled())) {
          return badRequest('Lock is not enabled')
        }
        if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
          return badRequest('Enter your PIN (4–8 digits)')
        }
        const denied = await wrongPinGate(identity, pin, 'Incorrect PIN')
        if (denied) return denied
        return okWithSession({ ok: true }, identity)
      }

      case 'disable': {
        if (!(await isLockEnabled())) {
          return badRequest('Lock is not enabled')
        }
        if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
          return badRequest('Enter your current PIN (4–8 digits)')
        }
        const denied = await wrongPinGate(identity, pin, 'Incorrect PIN')
        if (denied) return denied
        await setSetting('lock:enabled', '0')
        await delSetting('lock:pin:hash')
        await delSetting('lock:pin:salt')
        const res = NextResponse.json({ ok: true })
        res.headers.append('Set-Cookie', clearUnlockCookieHeader(identity.secureTransport))
        return res
      }

      case 'reset': {
        // RECOVERY GATE (security fix). Resetting without the PIN used to be
        // callable by anyone over HTTP, which disabled the app's only access
        // control. It is now limited to paths only the machine's owner can
        // satisfy, keeping the "never permanently lock the owner out" promise:
        //
        //   1. correct current PIN              — same trust level as disable
        //   2. local recovery                    — a direct (no proxy) loopback
        //      connection, i.e. the owner at the server console / SSH tunnel
        //   3. WA_LOCK_RESET_TOKEN recovery      — operator sets a random token
        //      in the environment; requests carry it in the `x-wa-recovery`
        //      header (see docs/SECURITY.md → "Forgotten PIN recovery")
        //
        // Resetting while no lock exists is a harmless no-op.

        if (!(await isLockEnabled())) {
          return NextResponse.json({ ok: true, reset: true, noop: true })
        }

        // Path 1 — the current PIN proves ownership.
        if (typeof pin === 'string' && PIN_RE.test(pin)) {
          const denied = await wrongPinGate(identity, pin, 'Incorrect PIN — cannot reset')
          if (denied) return denied
        } else {
          // Paths 2 & 3 — owner-only recovery without the PIN.
          const token = process.env.WA_LOCK_RESET_TOKEN
          const provided = req.headers.get('x-wa-recovery')
          const localOk = isDirectLocalRequest(identity)
          const tokenOk = !!token && !!provided && recoveryTokenMatches(provided, token)
          if (!localOk && !tokenOk) {
            return NextResponse.json(
              {
                ok: false,
                error:
                  'Lock reset requires the current PIN, local server access, or the recovery token (docs/SECURITY.md → Forgotten PIN recovery)'
              },
              { status: 403 }
            )
          }
        }

        await wipeLock()
        const res = NextResponse.json({ ok: true, reset: true })
        res.headers.append('Set-Cookie', clearUnlockCookieHeader(identity.secureTransport))
        return res
      }

      default:
        return badRequest(
          'Unknown lock action — expected set, change, verify, disable or reset'
        )
    }
  } catch {
    return NextResponse.json({ error: 'Lock service error' }, { status: 500 })
  }
}
