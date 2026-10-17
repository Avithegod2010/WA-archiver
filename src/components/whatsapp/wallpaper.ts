/**
 * Chat wallpaper system v3 — three fully mixable layers plus fine-tuning:
 *
 *   1. COLORS      — any solid color (palette swatches or a custom color wheel)
 *   2. PATTERNS    — color-agnostic decorative overlays (masks) that can sit
 *                    on top of ANY color, or the default background
 *   3. PRE-BUILTS  — complete designed looks (gradients, scenes, classic doodle)
 *
 * Plus an optional uploaded photo, dim overlay and contrast / brightness /
 * saturation / blur tuning. Persisted per chat with an app-wide default:
 *
 *   wa-viewer:wallpaper:<chatId>  → JSON WallpaperConfig
 *   wa-viewer:wallpaper           → app-wide default
 *
 * Legacy stored values (flat preset keys) are upgraded on read.
 */

export type WallpaperMode = 'color' | 'pattern' | 'preset' | 'custom'

export interface WallpaperConfig {
  /** Which section the current look came from — drives rendering + highlights */
  k: WallpaperMode
  /** Base solid color (light mode) when k is 'color' or 'pattern' */
  color: string | null
  /** Optional dark-mode variant of the base color */
  colorDark: string | null
  /** Pattern overlay key (k 'pattern', or a pattern kept under a chosen color) */
  pattern: string | null
  /** Pre-built design key (k === 'preset') */
  preset: string
  /** Darkness overlay 0..0.75 — boosts legibility on any wallpaper */
  dim: number
  /** Blur in px 0..12 — applied to custom photo wallpapers */
  blur: number
  /** CSS contrast multiplier 0.6..1.6 (1 = normal) */
  contrast: number
  /** CSS brightness multiplier 0.6..1.3 (1 = normal) */
  brightness: number
  /** CSS saturation multiplier 0..2 (1 = normal) */
  saturation: number
  /** URL of the uploaded photo (when k === 'custom') */
  photo: string | null
}

export const WALLPAPER_EVENT = 'wa-wallpaper'
export const GLOBAL_WALLPAPER_KEY = 'wa-viewer:wallpaper'

export const DEFAULT_CONFIG: WallpaperConfig = {
  k: 'preset',
  preset: 'doodle',
  color: null,
  colorDark: null,
  pattern: null,
  dim: 0,
  blur: 0,
  contrast: 1,
  brightness: 1,
  saturation: 1,
  photo: null,
}

/* ------------------------------------------------------------------ */
/* Section 1 — Colors                                                  */
/* ------------------------------------------------------------------ */

export interface WallpaperColor {
  key: string
  label: string
  /** css color for light mode */
  light: string
  /** css color for dark mode */
  dark: string
}

/** null light+dark = follow the default chat background */
export const WALLPAPER_COLORS: WallpaperColor[] = [
  { key: 'auto', label: 'Auto', light: '', dark: '' },
  { key: 'sage', label: 'Sage', light: '#e3ecdd', dark: '#0c1710' },
  { key: 'mint', label: 'Mint', light: '#dbf2e5', dark: '#081610' },
  { key: 'teal', label: 'Lagoon', light: '#d5ebe7', dark: '#071614' },
  { key: 'blush', label: 'Blush', light: '#fbe4e6', dark: '#1c0f11' },
  { key: 'rose', label: 'Rose', light: '#f9dfe7', dark: '#1a0d13' },
  { key: 'sepia', label: 'Sepia', light: '#f2e9d8', dark: '#16120d' },
  { key: 'sand', label: 'Sand', light: '#f1e6d0', dark: '#151007' },
  { key: 'butter', label: 'Butter', light: '#fdf3cf', dark: '#191507' },
  { key: 'cocoa', label: 'Cocoa', light: '#eddfcd', dark: '#170f08' },
  { key: 'lilac', label: 'Lilac', light: '#eae2f5', dark: '#120e1c' },
  { key: 'graphite', label: 'Graphite', light: '#e2e5e8', dark: '#0d1114' },
  { key: 'slate', label: 'Slate', light: '#cfd8de', dark: '#0a0f14' },
]

/* ------------------------------------------------------------------ */
/* Section 2 — Patterns (color-agnostic overlays)                      */
/* ------------------------------------------------------------------ */

export interface WallpaperPattern {
  key: string
  label: string
}

/**
 * Rendering lives in globals.css as `.wpat-<key>` mask layers — a single
 * tint (`--wpat-tint`, adapts to light/dark) so any pattern can sit on top
 * of ANY user color. Validation on read uses this key list.
 */
export const WALLPAPER_PATTERNS: WallpaperPattern[] = [
  { key: 'dots', label: 'Dots' },
  { key: 'confetti', label: 'Confetti' },
  { key: 'stripes', label: 'Stripes' },
  { key: 'grid', label: 'Grid' },
  { key: 'plaid', label: 'Plaid' },
  { key: 'chevron', label: 'Chevron' },
  { key: 'waves', label: 'Waves' },
  { key: 'rings', label: 'Rings' },
  { key: 'bubbles', label: 'Bubbles' },
  { key: 'sparkle', label: 'Sparkle' },
  { key: 'hearts', label: 'Hearts' },
  { key: 'stars', label: 'Stars' },
]

const PATTERN_KEYS = new Set(WALLPAPER_PATTERNS.map((p) => p.key))

/* ------------------------------------------------------------------ */
/* Section 3 — Pre-built designs (complete looks)                      */
/* ------------------------------------------------------------------ */

export interface WallpaperPreset {
  key: string
  label: string
  /** Background classes for the chat area (light + dark variants) */
  bg: string
  /** Optional doodle tint classes */
  doodle?: string
  /** Swatch preview classes for the picker */
  swatch: string
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  {
    key: 'doodle',
    label: 'Classic',
    bg: 'bg-(--wa-chat-bg)',
    doodle: 'text-(--wa-doodle)',
    swatch: 'bg-(--wa-chat-bg)',
  },
  {
    key: 'dusk',
    label: 'Dusk',
    bg: 'bg-[linear-gradient(140deg,#e5dcf7_0%,#f2e2ec_52%,#fbe9d6_100%)] dark:bg-[linear-gradient(140deg,#1b1230_0%,#251026_52%,#2a1408_100%)]',
    swatch:
      'bg-[linear-gradient(140deg,#e5dcf7_0%,#f2e2ec_52%,#fbe9d6_100%)] dark:bg-[linear-gradient(140deg,#1b1230_0%,#251026_52%,#2a1408_100%)]',
  },
  {
    key: 'blossom',
    label: 'Blossom',
    bg: 'bg-[linear-gradient(140deg,#fce4ee_0%,#fdeee4_100%)] dark:bg-[linear-gradient(140deg,#200a14_0%,#200f08_100%)]',
    swatch:
      'bg-[linear-gradient(140deg,#fce4ee_0%,#fdeee4_100%)] dark:bg-[linear-gradient(140deg,#200a14_0%,#200f08_100%)]',
  },
  {
    key: 'lagoon',
    label: 'Lagoon',
    bg: 'bg-[linear-gradient(140deg,#d3f0ea_0%,#dcf0f8_100%)] dark:bg-[linear-gradient(140deg,#06201c_0%,#071820_100%)]',
    swatch:
      'bg-[linear-gradient(140deg,#d3f0ea_0%,#dcf0f8_100%)] dark:bg-[linear-gradient(140deg,#06201c_0%,#071820_100%)]',
  },
  {
    key: 'ember',
    label: 'Ember',
    bg: 'bg-[linear-gradient(140deg,#fde8d8_0%,#fbd9d0_60%,#f6d0e0_100%)] dark:bg-[linear-gradient(140deg,#26100a_0%,#230c12_60%,#1d0818_100%)]',
    swatch:
      'bg-[linear-gradient(140deg,#fde8d8_0%,#fbd9d0_60%,#f6d0e0_100%)] dark:bg-[linear-gradient(140deg,#26100a_0%,#230c12_60%,#1d0818_100%)]',
  },
  {
    key: 'forest',
    label: 'Forest',
    bg: 'bg-[linear-gradient(160deg,#dcead0_0%,#c9e2cf_100%)] dark:bg-[linear-gradient(160deg,#0d1a0a_0%,#0a1610_100%)]',
    doodle: 'text-[#3d6b35]/[0.08] dark:text-[#9ecf95]/[0.05]',
    swatch:
      'bg-[linear-gradient(160deg,#dcead0_0%,#c9e2cf_100%)] dark:bg-[linear-gradient(160deg,#0d1a0a_0%,#0a1610_100%)]',
  },
  {
    key: 'aurora',
    label: 'Aurora',
    bg: 'wp-aurora',
    swatch: 'wp-aurora',
  },
  {
    key: 'dunes',
    label: 'Dunes',
    bg: 'wp-dunes',
    swatch: 'wp-dunes',
  },
  {
    key: 'nordic',
    label: 'Nordic',
    bg: 'bg-[linear-gradient(150deg,#dfe7ee_0%,#d5e1ea_55%,#cfdde8_100%)] dark:bg-[linear-gradient(150deg,#0d141a_0%,#101a22_55%,#0f1d26_100%)]',
    swatch:
      'bg-[linear-gradient(150deg,#dfe7ee_0%,#d5e1ea_55%,#cfdde8_100%)] dark:bg-[linear-gradient(150deg,#0d141a_0%,#101a22_55%,#0f1d26_100%)]',
  },
  {
    key: 'matcha',
    label: 'Matcha',
    bg: 'bg-[linear-gradient(150deg,#e8f0dc_0%,#ddebd2_60%,#d3e6c8_100%)] dark:bg-[linear-gradient(150deg,#111a0d_0%,#152010_60%,#0f1c0c_100%)]',
    swatch:
      'bg-[linear-gradient(150deg,#e8f0dc_0%,#ddebd2_60%,#d3e6c8_100%)] dark:bg-[linear-gradient(150deg,#111a0d_0%,#152010_60%,#0f1c0c_100%)]',
  },
  {
    key: 'coral',
    label: 'Coral',
    bg: 'bg-[linear-gradient(150deg,#fdeae2_0%,#fbdfd8_55%,#f9d9e4_100%)] dark:bg-[linear-gradient(150deg,#1f0e0a_0%,#240e12_55%,#220b17_100%)]',
    swatch:
      'bg-[linear-gradient(150deg,#fdeae2_0%,#fbdfd8_55%,#f9d9e4_100%)] dark:bg-[linear-gradient(150deg,#1f0e0a_0%,#240e12_55%,#220b17_100%)]',
  },
  {
    key: 'galaxy',
    label: 'Galaxy',
    bg: 'bg-[linear-gradient(150deg,#e4dcf6_0%,#dcd6f2_50%,#d3d2f0_100%)] dark:bg-[linear-gradient(150deg,#120c22_0%,#171030_50%,#100a20_100%)]',
    doodle: 'text-[#6d5bb8]/[0.09] dark:text-[#a996f0]/[0.05]',
    swatch:
      'bg-[linear-gradient(150deg,#e4dcf6_0%,#dcd6f2_50%,#d3d2f0_100%)] dark:bg-[linear-gradient(150deg,#120c22_0%,#171030_50%,#100a20_100%)]',
  },
]

export function presetByKey(k: string): WallpaperPreset {
  return WALLPAPER_PRESETS.find((p) => p.key === k) ?? WALLPAPER_PRESETS[0]
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{5,8})$/i

function validColor(v: unknown): string | null {
  return typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim() : null
}

function clampNum(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(n, min), max)
}

function clamp01(v: unknown, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.min(Math.max(n, 0), max)
}

/** Old flat keys → the new model */
function mapLegacyKey(key: string, photo: string | null): WallpaperConfig {
  const base: WallpaperConfig = { ...DEFAULT_CONFIG }
  if (key === 'custom') {
    base.k = 'custom'
    base.photo = photo
    return base
  }
  if (PATTERN_KEYS.has(key)) {
    // old pattern presets; 'aurora'/'dunes' live in pre-builts now
    if (key === 'aurora' || key === 'dunes') {
      base.k = 'preset'
      base.preset = key
      return base
    }
    base.k = 'pattern'
    base.pattern = key
    return base
  }
  const oldSolid: Record<string, [string, string]> = {
    sage: ['#e3ecdd', '#0c1710'],
    mint: ['#dbf2e5', '#081610'],
    sepia: ['#f2e9d8', '#16120d'],
    graphite: ['#e2e5e8', '#0d1114'],
    cocoa: ['#eddfcd', '#170f08'],
  }
  if (oldSolid[key]) {
    base.k = 'color'
    base.color = oldSolid[key][0]
    base.colorDark = oldSolid[key][1]
    return base
  }
  if (key === 'plain') {
    base.k = 'color'
    base.color = null
    return base
  }
  // dusk / blossom / lagoon / ember / forest / doodle stay pre-builts
  base.k = 'preset'
  base.preset = presetByKey(key).key
  return base
}

function parseConfig(raw: string | null): WallpaperConfig | null {
  if (!raw) return null
  if (!raw.startsWith('{')) return mapLegacyKey(raw.trim(), null)
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    // The photo lands inside a CSS url("…") — only two producers may ever
    // appear there (a hand-edited value can't inject CSS):
    //   • /api/wallpaper/<name>   — the server upload endpoint (server mode)
    //   • data:image/<fmt>;base64 — the device path (Phase 3: the downscale
    //     helper embeds the JPEG directly, no server file storage needed)
    const rawPhoto = typeof o.photo === 'string' && o.photo ? o.photo : null
    const photo =
      rawPhoto &&
      (/^\/api\/wallpaper\/[a-zA-Z0-9._-]+$/.test(rawPhoto) ||
        /^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(
          rawPhoto
        ))
        ? rawPhoto
        : null
    const kStr = typeof o.k === 'string' ? o.k : null
    if (kStr && !['color', 'pattern', 'preset', 'custom'].includes(kStr)) {
      return mapLegacyKey(kStr, photo)
    }

    const mode = (['color', 'pattern', 'preset', 'custom'] as const).includes(
      o.k as WallpaperMode
    )
      ? (o.k as WallpaperMode)
      : photo
        ? 'custom'
        : 'preset'
    const pattern =
      typeof o.pattern === 'string' && PATTERN_KEYS.has(o.pattern) ? o.pattern : null
    const cfg: WallpaperConfig = {
      k: mode,
      color: validColor(o.color),
      colorDark: validColor(o.colorDark),
      pattern: mode === 'preset' ? null : pattern,
      preset: presetByKey(typeof o.preset === 'string' ? o.preset : 'doodle').key,
      dim: clamp01(o.dim, 0.75),
      blur: clamp01(o.blur, 12),
      contrast: clampNum(o.contrast, 1, 0.6, 1.6),
      brightness: clampNum(o.brightness, 1, 0.6, 1.3),
      saturation: clampNum(o.saturation, 1, 0, 2),
      photo: mode === 'custom' ? photo : photo, // keep the url cached either way
    }
    if (cfg.k === 'custom' && !cfg.photo) cfg.k = 'preset'
    return cfg
  } catch {
    return null
  }
}

function perChatKey(chatId: string): string {
  return `wa-viewer:wallpaper:${chatId}`
}

/** Resolve the effective wallpaper: per-chat override → app default → classic. */
export function readWallpaper(chatId: string): WallpaperConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG
  try {
    return (
      parseConfig(localStorage.getItem(perChatKey(chatId))) ??
      parseConfig(localStorage.getItem(GLOBAL_WALLPAPER_KEY)) ??
      DEFAULT_CONFIG
    )
  } catch {
    return DEFAULT_CONFIG
  }
}

export function hasWallpaperOverride(chatId: string): boolean {
  try {
    return !!localStorage.getItem(perChatKey(chatId))
  } catch {
    return false
  }
}

/** Persist a patch. `chatId` '' = the app-wide default. */
export function writeWallpaper(chatId: string, patch: Partial<WallpaperConfig>) {
  try {
    const cur = hasWallpaperOverride(chatId) || !chatId ? readWallpaper(chatId) : readWallpaper('')
    const next: WallpaperConfig = { ...cur, ...patch }
    if (next.k === 'preset') {
      next.color = null
      next.colorDark = null
      next.pattern = null
    }
    if (next.k === 'custom' && !next.photo) {
      next.k = 'preset'
      next.preset = 'doodle'
    }
    localStorage.setItem(
      chatId ? perChatKey(chatId) : GLOBAL_WALLPAPER_KEY,
      JSON.stringify(next)
    )
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(WALLPAPER_EVENT))
}

/** Remove the per-chat override so the app default applies again. */
export function resetWallpaper(chatId: string) {
  try {
    localStorage.removeItem(perChatKey(chatId))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(WALLPAPER_EVENT))
}

export function subscribeWallpaper(cb: () => void) {
  window.addEventListener(WALLPAPER_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(WALLPAPER_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

/** Downscale an image client-side (max 1920px, JPEG q0.85) before upload. */
export async function downscaleImage(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const max = 1920
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    if (scale >= 1 && file.size < 1.5 * 1024 * 1024) return file
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85)
    )
    return blob ?? file
  } catch {
    return file
  }
}

/**
 * Device-path upload (Phase 3): no server file storage — downscale and embed
 * the image as a self-contained JPEG data: URL that localStorage can hold.
 * Shrinks progressively until the encoded URL fits a ~1.05 MB budget (safe
 * inside the 5 MB localStorage quota even alongside other keys).
 */
export async function downscaleImageToDataUrl(file: File): Promise<string> {
  const steps: [number, number][] = [
    [1280, 0.82],
    [1024, 0.78],
    [820, 0.72],
    [640, 0.68],
  ]
  let last = ''
  for (const [max, quality] of steps) {
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
      const w = Math.max(1, Math.round(bitmap.width * scale))
      const h = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        bitmap.close()
        break
      }
      ctx.drawImage(bitmap, 0, 0, w, h)
      bitmap.close()
      last = canvas.toDataURL('image/jpeg', quality)
      if (last.length <= 1_050_000) return last
    } catch {
      break
    }
  }
  if (last) return last
  throw new Error('Could not read that image')
}
