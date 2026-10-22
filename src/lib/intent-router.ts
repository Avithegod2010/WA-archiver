/**
 * Android intent router (Task A4).
 *
 * The Capacitor Android shell forwards ACTION_VIEW / ACTION_SEND /
 * ACTION_SEND_MULTIPLE intents (e.g. a WhatsApp .txt / .zip export opened
 * from a file manager or shared from another app) into the WebView by
 * evaluating `window.__WA_INTENT__({kind, ...})` — see MainActivity.java.
 *
 * This module installs that hook, decodes payloads into File objects and
 * hands them to the app's normal import entry point. It is completely
 * passive in plain web/PWA builds: nothing ever calls window.__WA_INTENT__
 * outside the Android shell, so installation is a harmless no-op there.
 *
 * Caveat: Android ships file bodies as base64 inside a single
 * evaluateJavascript string (Java-side cap ~60 MB, Base64 inflates by ~4/3).
 * That is large but acceptable on modern devices; very large exports briefly
 * hold the payload twice in memory (JS string + decoded bytes).
 */

type IntentFilePayload = {
  kind: 'file'
  name?: string
  mime?: string
  b64: string
  text?: string
}

type IntentTextPayload = {
  kind: 'text'
  name?: string
  text: string
}

export type IntentPayload = IntentFilePayload | IntentTextPayload

export type IntentRouterHandlers = {
  /**
   * Receives decoded files (and raw shared text, when present). Files
   * arriving in quick succession (ACTION_SEND_MULTIPLE sends one payload
   * per Uri) are coalesced into a single batch.
   */
  onFiles(files: File[], text?: string): void
}

declare global {
  interface Window {
    __WA_INTENT__?: (payload: IntentPayload) => void
    __waIntentRouterInstalled?: boolean
  }
}

/** Handlers are re-bound on every install call so the closure handed to
 * window.__WA_INTENT__ can never go stale (e.g. after transport changes). */
let currentHandlers: IntentRouterHandlers | null = null

/** Payloads arriving within this window are delivered as one onFiles batch. */
const BATCH_WINDOW_MS = 250

/**
 * Install the Android intent hook. Idempotent: window.__WA_INTENT__ is
 * defined once, but the handler reference is refreshed on every call.
 * SSR-safe: no-ops when window is unavailable.
 */
export function installIntentRouter(handlers: IntentRouterHandlers): void {
  if (typeof window === 'undefined') return
  currentHandlers = handlers
  if (window.__waIntentRouterInstalled) return
  window.__waIntentRouterInstalled = true

  let batch: File[] = []
  let batchText: string | undefined
  let batchTimer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    const files = batch
    const text = batchText
    batch = []
    batchText = undefined
    batchTimer = null
    if (files.length === 0 && !text) return
    try {
      currentHandlers?.onFiles(files, text)
    } catch (err) {
      console.error('[intent-router] handler failed', err)
    }
  }

  window.__WA_INTENT__ = (payload) => {
    try {
      if (payload.kind === 'text') {
        batchText = payload.text
      } else {
        // base64 → binary string → Uint8Array → File
        const bin = atob(payload.b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const file = new File([bytes], payload.name || 'shared-file', {
          type: payload.mime || 'application/octet-stream',
        })
        if (payload.text) batchText = payload.text
        batch.push(file)
      }
      if (batchTimer !== null) clearTimeout(batchTimer)
      batchTimer = setTimeout(flush, BATCH_WINDOW_MS)
    } catch (err) {
      console.error('[intent-router] failed to decode intent payload', err)
    }
  }
}
