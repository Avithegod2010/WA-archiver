/**
 * PIN attempt throttling / lockout for the app lock (security fix).
 *
 * The old server lock only added a fixed 250 ms delay on a wrong PIN — no
 * limit on how many guesses a client may make. A 4–8 digit PIN has at most
 * 10^8 candidates; at network speed that is enumerable in minutes.
 *
 * This module adds a per-client (see src/lib/request-identity.ts for how a
 * client is identified) failure counter with a hard lockout:
 *
 *   - 5 failed PIN attempts within a 15-minute window
 *     → 15-minute lockout for that client
 *   - during the lockout every attempt is rejected with 429 — even the
 *     correct PIN — without touching the scrypt path (no timing oracle)
 *   - a successful verify clears the counter
 *
 * State is in-memory (single-user tool, single process): it resets on
 * restart, which is documented in docs/SECURITY.md.
 */

const MAX_BUCKETS = 500

interface PinFailState {
  /** Consecutive failures within the current window. */
  fails: number
  /** Start of the current counting window (ms epoch). */
  windowStart: number
  /** Lockout end (ms epoch); 0 while not locked out. */
  lockedUntil: number
}

export const PIN_MAX_FAILS = 5
export const PIN_FAIL_WINDOW_MS = 15 * 60 * 1000
export const PIN_LOCKOUT_MS = 15 * 60 * 1000

const states = new Map<string, PinFailState>()

/**
 * Lockout check for a throttle key.
 * Returns the seconds until the lockout ends, or null when the client is
 * free to attempt a PIN.
 */
export function pinThrottleCheck(key: string): number | null {
  const now = Date.now()
  const state = states.get(key)
  if (!state) return null
  if (state.lockedUntil > now) {
    return Math.max(1, Math.ceil((state.lockedUntil - now) / 1000))
  }
  if (state.lockedUntil <= now && state.lockedUntil > 0) {
    // Lockout expired — start a fresh window.
    states.delete(key)
  }
  return null
}

/** Record a failed PIN attempt; escalates to a lockout past the limit. */
export function recordPinFailure(key: string): void {
  const now = Date.now()
  let state = states.get(key)
  if (!state || now - state.windowStart > PIN_FAIL_WINDOW_MS || state.lockedUntil > 0) {
    if (states.size > MAX_BUCKETS) {
      for (const [k, s] of states) {
        if (s.lockedUntil <= now && now - s.windowStart > PIN_FAIL_WINDOW_MS) states.delete(k)
      }
    }
    state = { fails: 0, windowStart: now, lockedUntil: 0 }
    states.set(key, state)
  }
  state.fails += 1
  if (state.fails >= PIN_MAX_FAILS) {
    state.lockedUntil = now + PIN_LOCKOUT_MS
  }
}

/** A successful PIN check clears this client's failure history. */
export function recordPinSuccess(key: string): void {
  states.delete(key)
}

/** Test-only: reset throttle state (all keys or a specific one). */
export function clearPinThrottleForTests(key?: string): void {
  if (key === undefined) states.clear()
  else states.delete(key)
}
