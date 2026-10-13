'use client'

/**
 * Online/offline awareness (Phase 4 — offline polish).
 *
 * `navigator.onLine` is the only synchronous signal a web app gets. It is
 * optimistic (says "online" behind captive portals), but it is exactly right
 * for the common case: airplane mode / no network. We use it to
 *
 *   • guard AI features with a friendly "you're offline" message instead of
 *     a raw "Failed to fetch" (AI is the one thing that needs internet —
 *     everything else is on-device by design), and
 *   • show a small Offline pill in the app bar.
 *
 * SSR-safe: useOnlineStatus returns true on the server snapshot so hydration
 * matches; the pill then appears immediately after mount when offline.
 */

import { useSyncExternalStore } from 'react'

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    // Server snapshot: assume online (matches the pill being hidden).
    () => true
  )
}

/** Sync check for event handlers / service code. Defaults to online. */
export function isOnline(): boolean {
  try {
    return navigator.onLine
  } catch {
    return true
  }
}

/**
 * User-facing copy for AI features used while offline. Same wording works
 * for both transports: the server route also needs the internet (it proxies
 * to an AI provider), and in device mode the user's Gemini call is direct.
 */
export function offlineAiMessage(): string {
  return "You're offline — AI needs internet. Everything else keeps working on this device."
}
