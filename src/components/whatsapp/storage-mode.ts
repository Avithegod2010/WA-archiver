'use client'

/**
 * Storage mode — where the app's data lives (Phase 2 of the local-first
 * refactor). A tiny external store (same pattern as app-theme.ts):
 *
 *   • 'server' — data lives in the server's SQLite via /api/* (hosted demo,
 *     Vercel). The classic v1.0 behavior.
 *   • 'device' — data lives in this browser (SQLite-WASM + OPFS via
 *     src/lib/data/local). Works with no internet at all.
 *
 * Inside the Capacitor shell (Phase 3 standalone APK / future iOS) there is
 * no server at all, so the DEFAULT mode is 'device' — detected through the
 * native bridge's global window.Capacitor (injected before any page script
 * runs; absent in ordinary browsers).
 *
 * Switching modes fires STORAGE_MODE_EVENT and the caller reloads the app so
 * every data boundary re-resolves against the new transport.
 */

export type StorageMode = 'server' | 'device'

const KEY = 'wa-viewer:storage-mode'
export const STORAGE_MODE_EVENT = 'wa-storage-mode-changed'

/** Minimal shape of the Capacitor native bridge we care about. */
interface CapacitorBridge {
  isNativePlatform?: () => boolean
}

function capacitorBridge(): CapacitorBridge | null {
  if (typeof window === 'undefined') return null
  return (window as { Capacitor?: CapacitorBridge }).Capacitor ?? null
}

/**
 * True inside the Capacitor shell (standalone APK / iOS app). The native
 * runtime injects window.Capacitor before page scripts execute; ordinary
 * browsers never have it (our web bundle does not import @capacitor/core).
 */
export function isNativeApp(): boolean {
  try {
    return capacitorBridge()?.isNativePlatform?.() === true
  } catch {
    return false
  }
}

function isValid(v: unknown): v is StorageMode {
  return v === 'server' || v === 'device'
}

export function getStorageMode(): StorageMode {
  if (typeof window === 'undefined') return 'server'
  try {
    const raw = window.localStorage.getItem(KEY)
    if (isValid(raw)) return raw
  } catch {
    /* storage unavailable — fall through to the platform default */
  }
  // Standalone shell → on-device storage; hosted web → server (v1.0 default).
  return isNativeApp() ? 'device' : 'server'
}

export function setStorageMode(mode: StorageMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, mode)
  } catch {
    /* storage unavailable — the mode stays for this session */
  }
  window.dispatchEvent(new Event(STORAGE_MODE_EVENT))
}

/** Subscribe helper for useSyncExternalStore. */
export function subscribeStorageMode(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener(STORAGE_MODE_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(STORAGE_MODE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** Human label used in Settings and the header. */
export function storageModeLabel(mode: StorageMode): string {
  return mode === 'device' ? 'This device' : 'Server'
}
