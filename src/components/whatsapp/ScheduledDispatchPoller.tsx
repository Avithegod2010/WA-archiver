'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

/** Window CustomEvent fired to ask the poller for an immediate dispatch run. */
export const SCHEDULED_CHECK_EVENT = 'wa-scheduled-check'
/** Window CustomEvent fired after deliveries — detail: { chatIds: string[] }. */
export const SCHEDULED_DELIVERED_EVENT = 'wa-scheduled-delivered'

/** Fire an immediate dispatch check (SSR-safe, no-op without a window). */
export function fireScheduledCheck() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(SCHEDULED_CHECK_EVENT))
}

/**
 * Delivers due scheduled messages: runs every 20 s, on window focus and on
 * `wa-scheduled-check`. When something is delivered it announces
 * `wa-scheduled-delivered` { detail: { chatIds } } so an open chat can refresh.
 * Renders nothing — mount it once near the app root.
 */
export function ScheduledDispatchPoller() {
  const inFlightRef = useRef(false)

  useEffect(() => {
    async function dispatchOnce() {
      if (inFlightRef.current) return
      inFlightRef.current = true
      try {
        const res = await fetch('/api/scheduled/dispatch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!res.ok) return
        const data = (await res.json().catch(() => null)) as {
          delivered?: number
          chatIds?: string[]
        } | null
        if (data && typeof data.delivered === 'number' && data.delivered > 0) {
          toast.success('Scheduled message delivered')
          window.dispatchEvent(
            new CustomEvent(SCHEDULED_DELIVERED_EVENT, {
              detail: { chatIds: Array.isArray(data.chatIds) ? data.chatIds : [] },
            })
          )
        }
      } catch {
        // Offline / server hiccup — the next tick will retry silently.
      } finally {
        inFlightRef.current = false
      }
    }

    const check = () => void dispatchOnce()
    check() // catch anything that came due while the tab was closed
    const interval = setInterval(check, 20_000)
    window.addEventListener('focus', check)
    window.addEventListener(SCHEDULED_CHECK_EVENT, check)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', check)
      window.removeEventListener(SCHEDULED_CHECK_EVENT, check)
    }
  }, [])

  return null
}

export default ScheduledDispatchPoller
