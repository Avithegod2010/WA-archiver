/**
 * Viewer-wide reading text size (accessibility), persisted per device.
 * Small module shared by the top-bar settings popover (writer) and
 * ChatView (consumer, applied as a CSS variable on the message area).
 */

export const TEXT_SIZES = {
  sm: { label: 'Small', px: 13 },
  md: { label: 'Medium', px: 14.2 },
  lg: { label: 'Large', px: 15.6 },
} as const

export type TextSizeKey = keyof typeof TEXT_SIZES

export const TEXT_SIZE_EVENT = 'wa-textsize'
const STORAGE_KEY = 'wa-viewer:textsize'

export function subscribeTextSize(cb: () => void) {
  window.addEventListener(TEXT_SIZE_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(TEXT_SIZE_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

export function getTextSize(): TextSizeKey {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'sm' || v === 'lg' ? v : 'md'
  } catch {
    return 'md'
  }
}

export function setTextSize(k: TextSizeKey) {
  try {
    localStorage.setItem(STORAGE_KEY, k)
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(TEXT_SIZE_EVENT))
}
