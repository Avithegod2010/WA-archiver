/**
 * Client-side helper for the AI features (Translate / Explain / Reply).
 *
 * Holds the user's personal Gemini API key in localStorage and builds the
 * headers that `POST /api/ai` understands. When no key is stored, `aiHeaders()`
 * returns an empty object and the server falls back to its built-in provider.
 *
 * SSR-safe: every storage access is guarded with `typeof window`.
 */

export const AI_KEY_STORAGE = 'wa-viewer:ai-key'

/** Reads the stored Gemini API key ('' when none / storage unavailable). */
export function getGeminiKey(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(AI_KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

/** Trims and saves the Gemini API key. An empty value clears it. */
export function setGeminiKey(key: string): void {
  if (typeof window === 'undefined') return
  try {
    const trimmed = key.trim()
    if (trimmed) window.localStorage.setItem(AI_KEY_STORAGE, trimmed)
    else window.localStorage.removeItem(AI_KEY_STORAGE)
  } catch {
    // Storage unavailable (private mode etc.) — nothing we can do.
  }
}

/**
 * Headers for /api/ai requests: carries the Gemini key when one is set,
 * otherwise `{}` so the server uses its built-in provider.
 */
export function aiHeaders(): Record<string, string> {
  const key = getGeminiKey()
  return key ? { 'x-gemini-key': key } : {}
}
