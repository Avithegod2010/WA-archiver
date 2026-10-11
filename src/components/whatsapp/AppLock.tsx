'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Delete, LockKeyhole } from 'lucide-react'
import { WhatsAppLogo } from './icons'
import { cn } from '@/lib/utils'

/** localStorage key holding the SHA-256 hex of the 4-digit PIN (Task 7-e #15). */
export const LOCK_HASH_KEY = 'wa-viewer:lock-hash'

/** Window event dispatched whenever the lock hash is created or removed. */
export const LOCK_CHANGED_EVENT = 'wa-lock-changed'

/** Re-lock after this much time without pointer/key activity. */
const IDLE_LOCK_MS = 5 * 60 * 1000

/** SHA-256 hex digest (WebCrypto). Returns null when unavailable. */
export async function sha256Hex(text: string): Promise<string | null> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return null
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(text)
    )
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return null
  }
}

function readStoredHash(): string | null {
  try {
    return localStorage.getItem(LOCK_HASH_KEY)
  } catch {
    return null
  }
}

/**
 * Full-screen PIN lock overlay (Task 7-e #15).
 * Hydration-safe: never locks during SSR / first paint — the stored hash is
 * evaluated in an effect. Re-locks after 5 minutes of inactivity and reacts
 * to the `wa-lock-changed` event dispatched by SettingsDialog.
 */
export function AppLock() {
  const [hasLock, setHasLock] = useState(false)
  const [locked, setLocked] = useState(false)
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)
  const verifyingRef = useRef(false)
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstReadRef = useRef(true)

  // Read the stored hash on mount + whenever SettingsDialog changes it
  useEffect(() => {
    const sync = () => {
      const hash = readStoredHash()
      setHasLock(!!hash)
      // Only auto-lock on the very first read (page load) — enabling the PIN
      // from Settings while the app is in use should not lock immediately.
      if (firstReadRef.current) {
        firstReadRef.current = false
        if (hash) setLocked(true)
      }
    }
    sync()
    window.addEventListener(LOCK_CHANGED_EVENT, sync)
    return () => window.removeEventListener(LOCK_CHANGED_EVENT, sync)
  }, [])

  // Re-lock after 5 minutes without pointer/key activity (while unlocked)
  useEffect(() => {
    if (!hasLock || locked) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const reset = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => setLocked(true), IDLE_LOCK_MS)
    }
    const events = ['pointerdown', 'keydown', 'wheel'] as const
    events.forEach((ev) =>
      window.addEventListener(ev, reset, { passive: true })
    )
    reset()
    return () => {
      if (timer) clearTimeout(timer)
      events.forEach((ev) => window.removeEventListener(ev, reset))
    }
  }, [hasLock, locked])

  const verify = useCallback(async (code: string) => {
    verifyingRef.current = true
    try {
      const stored = readStoredHash()
      if (!stored) {
        setPin('')
        setLocked(false)
        return
      }
      const hex = await sha256Hex(code)
      if (hex && hex === stored) {
        setPin('')
        setLocked(false)
      } else {
        setPin('')
        setShake(true)
        if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current)
        shakeTimerRef.current = setTimeout(() => setShake(false), 550)
      }
    } finally {
      verifyingRef.current = false
    }
  }, [])

  useEffect(() => {
    return () => {
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current)
    }
  }, [])

  const pushDigit = useCallback(
    (d: string) => {
      if (verifyingRef.current) return
      setPin((p) => (p.length >= 4 ? p : p + d))
    },
    []
  )

  const popDigit = useCallback(() => {
    if (verifyingRef.current) return
    setPin((p) => p.slice(0, -1))
  }, [])

  // Auto-verify once 4 digits are entered
  useEffect(() => {
    if (pin.length === 4) void verify(pin)
  }, [pin, verify])

  // Keyboard number input while locked
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
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [locked, pushDigit, popDigit])

  if (!hasLock || !locked) return null

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
          <p className="mt-0.5 text-[12.5px] leading-snug text-(--wa-text-2)">
            Enter your 4-digit PIN to continue
          </p>
        </div>

        {/* 4-dot progress */}
        <div
          className="flex items-center gap-2.5"
          aria-label={`${pin.length} of 4 digits entered`}
        >
          {[0, 1, 2, 3].map((i) => (
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
          {shake ? 'Wrong PIN, try again' : `${pin.length} of 4 digits entered`}
        </p>
      </div>
    </div>
  )
}
