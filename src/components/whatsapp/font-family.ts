/**
 * Viewer-wide chat font family (accessibility + personalization), persisted
 * per device. Mirrors text-size.ts: the settings popover is the writer and
 * the app shell is the consumer, applied as a CSS font-family on the root
 * wrapper so every in-flow surface (chat list, bubbles, previews) inherits.
 *
 * All stacks are system-font stacks — zero network requests, and every
 * option degrades gracefully on platforms missing the first choices.
 */

export const FONT_FAMILIES = {
  default: {
    label: 'Default',
    hint: 'WhatsApp look',
    stack:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  },
  modern: {
    label: 'Modern',
    hint: 'Geometric sans',
    stack:
      'Futura, "Century Gothic", "Avenir Next", "Trebuchet MS", "Segoe UI", sans-serif',
  },
  rounded: {
    label: 'Rounded',
    hint: 'Soft & friendly',
    stack:
      'Comfortaa, Quicksand, "Trebuchet MS", "Varela Round", "Segoe UI", sans-serif',
  },
  serif: {
    label: 'Serif',
    hint: 'Classic print',
    stack: 'Georgia, "Times New Roman", Times, serif',
  },
  elegant: {
    label: 'Elegant',
    hint: 'Old-style serif',
    stack:
      '"Palatino Linotype", Palatino, "Book Antiqua", "Iowan Old Style", Georgia, serif',
  },
  mono: {
    label: 'Mono',
    hint: 'Typewriter',
    stack:
      'ui-monospace, "JetBrains Mono", "Cascadia Mono", Menlo, Consolas, "Courier New", monospace',
  },
  handwriting: {
    label: 'Handwriting',
    hint: 'Casual ink',
    stack:
      '"Segoe Print", "Bradley Hand", "Chalkboard SE", "Comic Sans MS", cursive',
  },
} as const

export type FontFamilyKey = keyof typeof FONT_FAMILIES

export const FONT_FAMILY_EVENT = 'wa-fontfamily'
const STORAGE_KEY = 'wa-viewer:fontfamily'

export function subscribeFontFamily(cb: () => void) {
  window.addEventListener(FONT_FAMILY_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(FONT_FAMILY_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

export function getFontFamily(): FontFamilyKey {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && v in FONT_FAMILIES) return v as FontFamilyKey
  } catch {
    /* storage unavailable */
  }
  return 'default'
}

export function setFontFamily(k: FontFamilyKey) {
  try {
    localStorage.setItem(STORAGE_KEY, k)
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(FONT_FAMILY_EVENT))
}
