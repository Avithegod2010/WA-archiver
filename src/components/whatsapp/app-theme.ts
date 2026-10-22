/**
 * Viewer-wide app theme (accent + header + bubble colors), persisted per
 * device. Mirrors font-family.ts / text-size.ts: the settings popover is the
 * writer, the app shell applies `data-wa-theme` on <html>, and globals.css
 * defines the CSS variable values per theme (light & dark variants).
 */

import {
  DENSITIES,
  BUBBLE_STYLES,
  getBubbleStyle,
  getDensity,
  setBubbleStyle,
  setDensity,
  type BubbleStyleKey,
  type DensityKey,
} from './display'
import {
  GLOBAL_WALLPAPER_KEY,
  writeWallpaper,
  type WallpaperConfig,
} from './wallpaper'

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

/* ------------------------------------------------------------------ */
/* Custom accent override — any hex color on top of the active theme    */
/* ------------------------------------------------------------------ */

export const ACCENT_EVENT = 'wa-accent'
const ACCENT_STORAGE_KEY = 'wa-viewer:accent'
const HEX6_RE = /^#[0-9a-f]{6}$/i

/** Curated accent swatches offered in the picker (theme-independent). */
export const ACCENT_PRESETS: { label: string; hex: string }[] = [
  { label: 'WhatsApp', hex: '#00a884' },
  { label: 'Sky', hex: '#3390ec' },
  { label: 'Violet', hex: '#8b5cf6' },
  { label: 'Rose', hex: '#e11d48' },
  { label: 'Tangerine', hex: '#ea580c' },
  { label: 'Teal', hex: '#14b8a6' },
  { label: 'Honey', hex: '#d97706' },
  { label: 'Slate', hex: '#64748b' },
]

export function subscribeAccent(cb: () => void) {
  window.addEventListener(ACCENT_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(ACCENT_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

/** null = follow the active theme's accent. */
export function getAccentOverride(): string | null {
  try {
    const v = localStorage.getItem(ACCENT_STORAGE_KEY)
    return v && HEX6_RE.test(v) ? v.toLowerCase() : null
  } catch {
    return null
  }
}

export function setAccentOverride(hex: string | null) {
  try {
    if (hex && HEX6_RE.test(hex)) localStorage.setItem(ACCENT_STORAGE_KEY, hex.toLowerCase())
    else localStorage.removeItem(ACCENT_STORAGE_KEY)
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(ACCENT_EVENT))
}

/** Darken a #rrggbb color by `amt` (0..1) — used for --wa-accent-strong. */
export function darkenHex(hex: string, amt = 0.14): string {
  if (!HEX6_RE.test(hex)) return hex
  const n = parseInt(hex.slice(1), 16)
  const ch = (shift: number) => {
    const v = Math.round(((n >> shift) & 0xff) * (1 - amt))
    return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')
  }
  return `#${ch(16)}${ch(8)}${ch(0)}`
}

/**
 * Apply (or clear) the accent override as inline style on <html>. Inline
 * style wins over every [data-wa-theme] variable block, so the override
 * survives theme switches until cleared.
 */
export function applyAccentOverride(hex: string | null) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!hex || !HEX6_RE.test(hex)) {
    root.style.removeProperty('--wa-accent')
    root.style.removeProperty('--wa-accent-strong')
    return
  }
  root.style.setProperty('--wa-accent', hex)
  root.style.setProperty('--wa-accent-strong', darkenHex(hex))
}

/* ------------------------------------------------------------------ */
/* Theme studio (C1 #13) — saved "whole look" presets                  */
/*                                                                     */
/* A preset captures the current look in one entry: theme + accent +   */
/* bubble style + density + the app-wide wallpaper config (raw JSON,   */
/* only when the user actually set one). Stored in localStorage under  */
/* 'wa-viewer:custom-themes' (allowlisted in personal-data.ts), capped */
/* at 12 entries with unique names.                                    */
/* ------------------------------------------------------------------ */

export const CUSTOM_THEMES_KEY = 'wa-viewer:custom-themes'
export const CUSTOM_THEMES_MAX = 12
export const CUSTOM_THEME_EVENT = 'wa-custom-themes'

export interface CustomThemePreset {
  id: string
  name: string
  createdAt: number
  themeId: AppThemeKey
  /** Custom accent override captured with the look (null = theme default). */
  accent: string | null
  bubbleStyle: BubbleStyleKey
  density: DensityKey
  /** Raw JSON WallpaperConfig of the app-wide default wallpaper, if set. */
  wallpaper: string | null
}

function isBubbleStyle(v: unknown): v is BubbleStyleKey {
  return typeof v === 'string' && v in BUBBLE_STYLES
}

function isDensity(v: unknown): v is DensityKey {
  return typeof v === 'string' && v in DENSITIES
}

function isCustomThemePreset(v: unknown): v is CustomThemePreset {
  if (!v || typeof v !== 'object') return false
  const p = v as Partial<CustomThemePreset>
  return (
    typeof p.id === 'string' &&
    p.id.length > 0 &&
    typeof p.name === 'string' &&
    p.name.length > 0 &&
    typeof p.createdAt === 'number' &&
    typeof p.themeId === 'string' &&
    p.themeId in APP_THEMES &&
    (p.accent === null || (typeof p.accent === 'string' && HEX6_RE.test(p.accent))) &&
    isBubbleStyle(p.bubbleStyle) &&
    isDensity(p.density) &&
    (p.wallpaper === null || typeof p.wallpaper === 'string')
  )
}

/** Read the saved presets (tolerant: unknown/corrupt entries are dropped). */
export function listCustomThemes(): CustomThemePreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY)
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(isCustomThemePreset).slice(0, CUSTOM_THEMES_MAX)
  } catch {
    return []
  }
}

export type SaveCustomThemeResult =
  | { ok: true; preset: CustomThemePreset }
  | { ok: false; reason: 'limit' | 'name-taken' | 'storage' }

/** Save a captured look. Names are unique (case-insensitive), list capped. */
export function saveCustomTheme(input: {
  name: string
  themeId: AppThemeKey
  accent: string | null
  bubbleStyle: BubbleStyleKey
  density: DensityKey
  wallpaper: string | null
}): SaveCustomThemeResult {
  const name = input.name.trim().slice(0, 40)
  if (!name) return { ok: false, reason: 'name-taken' }
  const list = listCustomThemes()
  if (list.length >= CUSTOM_THEMES_MAX) return { ok: false, reason: 'limit' }
  if (list.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    return { ok: false, reason: 'name-taken' }
  }
  const preset: CustomThemePreset = {
    id: `ct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    name,
    themeId: input.themeId,
    accent: input.accent,
    bubbleStyle: input.bubbleStyle,
    density: input.density,
    wallpaper: input.wallpaper,
  }
  try {
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify([...list, preset]))
  } catch {
    return { ok: false, reason: 'storage' }
  }
  window.dispatchEvent(new Event(CUSTOM_THEME_EVENT))
  return { ok: true, preset }
}

/** Remove one saved preset by id (no-op when the id is unknown). */
export function deleteCustomTheme(id: string): void {
  try {
    const next = listCustomThemes().filter((p) => p.id !== id)
    localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(CUSTOM_THEME_EVENT))
}

/** Snapshot the live look so the theme studio can save it as a preset. */
export function captureCurrentLook(): {
  themeId: AppThemeKey
  accent: string | null
  bubbleStyle: BubbleStyleKey
  density: DensityKey
  wallpaper: string | null
} {
  let wallpaper: string | null = null
  try {
    wallpaper = localStorage.getItem(GLOBAL_WALLPAPER_KEY)
  } catch {
    wallpaper = null
  }
  return {
    themeId: getAppTheme(),
    accent: getAccentOverride(),
    bubbleStyle: getBubbleStyle(),
    density: getDensity(),
    wallpaper: wallpaper && wallpaper.trim() ? wallpaper : null,
  }
}

/**
 * Apply a saved look end-to-end via the existing setters (theme attribute,
 * accent inline style, bubble/density events, wallpaper store). Only the
 * wallpaper is conditional — presets captured without one leave the current
 * wallpaper untouched.
 */
export function applyCustomTheme(preset: CustomThemePreset): void {
  setAppTheme(preset.themeId)
  applyThemeAttribute(preset.themeId)
  setAccentOverride(preset.accent)
  applyAccentOverride(preset.accent)
  setBubbleStyle(preset.bubbleStyle)
  setDensity(preset.density)
  if (preset.wallpaper) {
    try {
      const cfg = JSON.parse(preset.wallpaper) as Partial<WallpaperConfig>
      writeWallpaper('', cfg)
    } catch {
      /* malformed captured wallpaper — skip it, the rest still applies */
    }
  }
}
