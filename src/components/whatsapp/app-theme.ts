/**
 * Viewer-wide app theme (accent + header + bubble colors), persisted per
 * device. Mirrors font-family.ts / text-size.ts: the settings popover is the
 * writer, the app shell applies `data-wa-theme` on <html>, and globals.css
 * defines the CSS variable values per theme (light & dark variants).
 */

export const APP_THEMES = {
  classic: {
    label: 'WhatsApp',
    hint: 'Classic green',
    swatch: { appbar: '#008069', bubble: '#d9fdd3', accent: '#00a884' },
  },
  telegram: {
    label: 'Telegram',
    hint: 'Sky blue',
    swatch: { appbar: '#3390ec', bubble: '#effdde', accent: '#3390ec' },
  },
  sunset: {
    label: 'Sunset',
    hint: 'Warm orange',
    swatch: { appbar: '#c2410c', bubble: '#ffe8d6', accent: '#ea580c' },
  },
  violet: {
    label: 'Violet',
    hint: 'Deep purple',
    swatch: { appbar: '#6d28d9', bubble: '#ece4fe', accent: '#8b5cf6' },
  },
  rose: {
    label: 'Rose',
    hint: 'Pink blush',
    swatch: { appbar: '#be185d', bubble: '#ffe4e9', accent: '#e11d48' },
  },
  ocean: {
    label: 'Ocean',
    hint: 'Calm teal',
    swatch: { appbar: '#0f766e', bubble: '#d7f5ef', accent: '#14b8a6' },
  },
  graphite: {
    label: 'Graphite',
    hint: 'Neutral slate',
    swatch: { appbar: '#37474f', bubble: '#e2e5e9', accent: '#607d8b' },
  },
  midnight: {
    label: 'Midnight',
    hint: 'Dark neon',
    swatch: { appbar: '#1e293b', bubble: '#d8ecfa', accent: '#0ea5e9' },
  },
  espresso: {
    label: 'Espresso',
    hint: 'Coffee brown',
    swatch: { appbar: '#4e342e', bubble: '#f0e6dd', accent: '#795548' },
  },
  terracotta: {
    label: 'Terracotta',
    hint: 'Warm clay',
    swatch: { appbar: '#a8552f', bubble: '#fdeadd', accent: '#c96f4a' },
  },
  wine: {
    label: 'Wine',
    hint: 'Deep burgundy',
    swatch: { appbar: '#6b1230', bubble: '#fbe0e6', accent: '#a4133c' },
  },
  forest: {
    label: 'Forest',
    hint: 'Woodland green',
    swatch: { appbar: '#1b4332', bubble: '#d8f3dc', accent: '#2d6a4f' },
  },
  amber: {
    label: 'Amber',
    hint: 'Golden honey',
    swatch: { appbar: '#b45309', bubble: '#fef3c7', accent: '#d97706' },
  },
  citrus: {
    label: 'Citrus',
    hint: 'Fresh lime',
    swatch: { appbar: '#4d7c0f', bubble: '#ecfccb', accent: '#65a30d' },
  },
  lavender: {
    label: 'Lavender',
    hint: 'Soft pastel',
    swatch: { appbar: '#7c6bb0', bubble: '#efeafb', accent: '#8674c9' },
  },
  cyber: {
    label: 'Cyber',
    hint: 'Neon glow',
    swatch: { appbar: '#3b0764', bubble: '#f5d0fe', accent: '#a21caf' },
  },
  mono: {
    label: 'Mono',
    hint: 'Pure grayscale',
    swatch: { appbar: '#27272a', bubble: '#e4e4e7', accent: '#52525b' },
  },
} as const

export type AppThemeKey = keyof typeof APP_THEMES

export const APP_THEME_EVENT = 'wa-theme'
const STORAGE_KEY = 'wa-viewer:theme'

export function subscribeAppTheme(cb: () => void) {
  window.addEventListener(APP_THEME_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(APP_THEME_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

export function getAppTheme(): AppThemeKey {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && v in APP_THEMES) return v as AppThemeKey
  } catch {
    /* storage unavailable */
  }
  return 'classic'
}

export function setAppTheme(k: AppThemeKey) {
  try {
    localStorage.setItem(STORAGE_KEY, k)
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(APP_THEME_EVENT))
}

/** Resolve the live accent color (any CSS-parseable value) for canvas/SVG code. */
export function getThemeAccent(): string {
  if (typeof window === 'undefined') return '#00a884'
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--wa-accent')
    .trim()
  return v || '#00a884'
}

/** Apply the theme attribute to <html> (call on mount + on change). */
export function applyThemeAttribute(k: AppThemeKey) {
  document.documentElement.setAttribute('data-wa-theme', k)
}
