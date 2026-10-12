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

export const runtime = 'nodejs'

/**
 * Server-side app lock gate (Task 14). This route IS the auth gate, so it
 * deliberately does NOT call assertAppUnlocked — every other data route does.
 *
 * GET  → { enabled, unlocked } (always accessible, no lock guard)
 * POST { action, pin?, newPin? }:
 *   set     → enable the lock with a new 4–8 digit PIN (409 if already enabled)
 *   change  → rotate the PIN (requires the current one), fresh 12 h session
 *   verify  → check a PIN, issue the unlock session cookie on success
 *   disable → turn the lock off (requires the current PIN), clears the session
 *   reset   → remove the lock WITHOUT a PIN (see the tradeoff comment below)
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

/** JSON response carrying a fresh 12-hour unlock session cookie. */
async function okWithSession(body: Record<string, unknown>): Promise<NextResponse> {
  const res = NextResponse.json(body)
  const cookie = await makeUnlockCookie()
  res.headers.append('Set-Cookie', unlockCookieHeader(cookie.value))
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
        return okWithSession({ ok: true })
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
        if (!(await pinMatches(pin))) {
          await slowDown()
          return NextResponse.json(
            { ok: false, error: 'Current PIN is incorrect' },
            { status: 401 }
          )
        }
        const salt = genSalt()
        await setSetting('lock:pin:salt', salt)
        await setSetting('lock:pin:hash', hashPin(newPin, salt))
        // `lock:enabled` stays '1' — a fresh session cookie is issued so the
        // person who changed the PIN stays unlocked.
        return okWithSession({ ok: true })
      }

      case 'verify': {
        if (!(await isLockEnabled())) {
          return badRequest('Lock is not enabled')
        }
        if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
          return badRequest('Enter your PIN (4–8 digits)')
        }
        if (await pinMatches(pin)) {
          return okWithSession({ ok: true })
        }
        await slowDown()
        return NextResponse.json(
          { ok: false, error: 'Incorrect PIN' },
          { status: 401 }
        )
      }

      case 'disable': {
        if (!(await isLockEnabled())) {
          return badRequest('Lock is not enabled')
        }
        if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
          return badRequest('Enter your current PIN (4–8 digits)')
        }
        if (!(await pinMatches(pin))) {
          await slowDown()
          return NextResponse.json(
            { ok: false, error: 'Incorrect PIN' },
            { status: 401 }
          )
        }
        await setSetting('lock:enabled', '0')
        await delSetting('lock:pin:hash')
        await delSetting('lock:pin:salt')
        const res = NextResponse.json({ ok: true })
        res.headers.append('Set-Cookie', clearUnlockCookieHeader())
        return res
      }

      case 'reset': {
        // TRADEOFF (deliberate, Task 14): resetting requires NO PIN. This is a
        // local, single-user viewer — the lock must never permanently lock its
        // owner out of their own data (forgotten PIN, stale cookie, restored
        // backup), and there is no auth system that could gate an admin reset.
        // The PIN protects against casual passers-by on a shared screen, not
        // against the device owner, who can always reset from Settings.
        await wipeLock()
        const res = NextResponse.json({ ok: true, reset: true })
        res.headers.append('Set-Cookie', clearUnlockCookieHeader())
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
