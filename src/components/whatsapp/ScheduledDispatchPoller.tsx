'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useData } from './data-provider'

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
  // Phase 3: modeResolved gates the first dispatch — before the persisted
  // storage mode is read, `data` is still the (wrong) default transport.
  const { data, modeResolved } = useData()
  const inFlightRef = useRef(false)

  useEffect(() => {
    if (!modeResolved) return
    async function dispatchOnce() {
      if (inFlightRef.current) return
      inFlightRef.current = true
      try {
        const result = await data.dispatchScheduled()
        if (result.delivered > 0) {
          toast.success('Scheduled message delivered')
          window.dispatchEvent(
            new CustomEvent(SCHEDULED_DELIVERED_EVENT, {
              detail: { chatIds: result.chatIds },
            })
          )
        }
      } catch {
        // Offline / transport hiccup — the next tick will retry silently.
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
  }, [data, modeResolved])

  return null
}

export default ScheduledDispatchPoller
