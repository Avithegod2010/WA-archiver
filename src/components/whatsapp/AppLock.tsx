'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Delete, LockKeyhole } from 'lucide-react'
import { WhatsAppLogo } from './icons'
import { cn } from '@/lib/utils'

/** Window event dispatched whenever the server-side lock state may have changed. */
export const LOCK_CHANGED_EVENT = 'wa-lock-changed'

/** Legacy localStorage PIN hash (pre-Task-14 client-side lock) — removed on mount. */
const LEGACY_HASH_KEY = 'wa-viewer:lock-hash'

/** PIN length accepted by the server: /^\d{4,8}$/ */
const MIN_PIN = 4
const MAX_PIN = 8

/** Auto-submit once ≥4 digits sit untouched for a beat (variable-length PIN). */
const SUBMIT_IDLE_MS = 500

/** Wrong-PIN shake duration. */
const SHAKE_MS = 550

/** How long the inline "Incorrect PIN" message stays visible. */
const ERROR_MS = 1800

/**
 * Full-screen PIN lock overlay (Task 14 — server-side lock).
 * Hydration-safe: never locks during SSR / first paint — the server decides
 * in an effect (GET /api/auth/lock → { enabled, unlocked }). The PIN itself is
 * verified by the server (scrypt hash in the DB) and unlocking issues a signed
 * 12-hour httpOnly session cookie; the old client-side SHA-256/localStorage
 * flow is gone. Reacts to `wa-lock-changed` (dispatched by SettingsDialog).
 */
export function AppLock() {
  const [checking, setChecking] = useState(true)
  const [locked, setLocked] = useState(false)
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const verifyingRef = useRef(false)
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Ask the server whether the lock is enabled and whether we hold a session.
  const sync = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/lock', { cache: 'no-store' })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = (await res.json()) as { enabled?: boolean; unlocked?: boolean }
      setLocked(!!data.enabled && !data.unlocked)
    } catch {
      // Fail open — a network hiccup must never brick the app.
      setLocked(false)
    } finally {
      setChecking(false)
    }
  }, [])

  // Migration cleanup: drop the pre-server-side localStorage hash, then sync.
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_HASH_KEY)
    } catch {
      /* storage unavailable — nothing to clean */
    }
    void sync()
    const onSync = () => void sync()
    window.addEventListener(LOCK_CHANGED_EVENT, onSync)
    return () => window.removeEventListener(LOCK_CHANGED_EVENT, onSync)
  }, [sync])

  useEffect(() => {
    return () => {
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current)
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    }
  }, [])

  const fail = useCallback((message: string) => {
    setPin('')
    setShake(true)
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current)
    shakeTimerRef.current = setTimeout(() => setShake(false), SHAKE_MS)
    setError(message)
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => setError(null), ERROR_MS)
  }, [])

  // Server-side verification: POST /api/auth/lock { action: 'verify', pin }.
  const verify = useCallback(
    async (code: string) => {
      if (verifyingRef.current) return
      verifyingRef.current = true
      try {
        const res = await fetch('/api/auth/lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verify', pin: code }),
        })
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string }
          | null
        if (res.ok && data?.ok) {
          setPin('')
          setError(null)
          setLocked(false)
          // Tell the rest of the app (chat list, settings) to re-sync —
          // their fetches may have 401'd while the lock was up.
          window.dispatchEvent(new Event(LOCK_CHANGED_EVENT))
        } else {
          fail(data?.error ?? 'Incorrect PIN — try again')
        }
      } catch {
        fail('Could not verify the PIN — check your connection')
      } finally {
        verifyingRef.current = false
      }
    },
    [fail]
  )

  const pushDigit = useCallback((d: string) => {
    if (verifyingRef.current) return
    setPin((p) => (p.length >= MAX_PIN ? p : p + d))
  }, [])

  const popDigit = useCallback(() => {
    if (verifyingRef.current) return
    setPin((p) => p.slice(0, -1))
  }, [])

  // Auto-submit once ≥4 digits sit untouched for a beat (PINs are 4–8 digits,
  // so a fixed length trigger no longer works). Re-typing resets the timer.
  useEffect(() => {
    if (!locked || checking || pin.length < MIN_PIN) return
    const t = setTimeout(() => void verify(pin), SUBMIT_IDLE_MS)
    return () => clearTimeout(t)
  }, [locked, checking, pin, verify])

  // Keyboard number input while locked (Enter submits a complete-looking PIN)
  useEffect(() => {
    if (!locked) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        pushDigit(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        popDigit()
      } else if (e.key === 'Enter' && pin.length >= MIN_PIN) {
        e.preventDefault()
        void verify(pin)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [locked, pin, pushDigit, popDigit, verify])

  if (checking || !locked) return null

  // Exactly 4 dots while the PIN is up to 4 digits (unchanged look); grows to
  // the PIN length for longer (up to 8-digit) PINs.
  const dots = Math.min(MAX_PIN, Math.max(MIN_PIN, pin.length))
  const padKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="App locked"
      className="wa-lock-overlay fixed inset-0 z-[300] flex items-center justify-center bg-(--wa-panel) px-4 backdrop-blur-xl"
    >
      <div
        className={cn(
          'wa-lock-card flex w-full max-w-[19rem] flex-col items-center gap-5 rounded-2xl bg-(--wa-panel-2) px-6 py-8 shadow-2xl ring-1 ring-black/10 dark:ring-white/10',
          shake && 'wa-shake'
        )}
      >
        <span
          className="relative flex h-16 w-16 items-center justify-center rounded-full bg-(--wa-accent)/10"
          aria-hidden
        >
          <WhatsAppLogo size={38} className="text-(--wa-accent)" />
          <span className="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full bg-(--wa-accent) ring-2 ring-(--wa-panel-2)">
            <LockKeyhole className="h-3.5 w-3.5 text-white" />
          </span>
        </span>

        <div className="text-center">
          <h2 className="text-[17px] font-semibold text-(--wa-text)">
            App locked
          </h2>
          <p
            className={cn(
              'mt-0.5 text-[12.5px] leading-snug',
              error
                ? 'font-medium text-red-600 dark:text-red-400'
                : 'text-(--wa-text-2)'
            )}
          >
            {error ?? 'Enter your PIN to continue'}
          </p>
        </div>

        {/* Progress dots (4 for short PINs, up to 8 for longer ones) */}
        <div
          className="flex items-center gap-2.5"
          aria-label={`${pin.length} of ${dots} digits entered`}
        >
          {Array.from({ length: dots }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                'h-2.5 w-2.5 rounded-full transition-colors duration-150',
                i < pin.length
                  ? 'bg-(--wa-accent)'
                  : 'bg-black/15 dark:bg-white/20'
              )}
            />
          ))}
        </div>

        {/* Numeric pad: 1-9, spacer, 0, backspace */}
        <div className="grid grid-cols-3 gap-x-4 gap-y-3" aria-label="PIN pad">
          {padKeys.map((k, idx) => {
            if (k === '') return <span key={idx} aria-hidden />
            if (k === 'del') {
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={popDigit}
                  aria-label="Delete last digit"
                  className="wa-pin-key flex h-14 w-14 items-center justify-center rounded-full text-(--wa-text-2) hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <Delete className="h-5 w-5" aria-hidden />
                </button>
              )
            }
            return (
              <button
                key={idx}
                type="button"
                onClick={() => pushDigit(k)}
                aria-label={`Digit ${k}`}
                className="wa-pin-key h-14 w-14 rounded-full text-xl font-medium text-(--wa-text) hover:bg-black/5 dark:hover:bg-white/10"
              >
                {k}
              </button>
            )
          })}
        </div>

        <p aria-live="polite" className="sr-only">
          {error ??
            (shake
              ? 'Wrong PIN, try again'
              : `${pin.length} of ${dots} digits entered`)}
        </p>
      </div>
    </div>
  )
}
