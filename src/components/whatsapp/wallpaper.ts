/**
 * Chat wallpaper system v2 — preset colors & gradients, custom uploaded
 * photos, plus dim / blur controls. Persisted per chat with an app-wide
 * default (chatId '' = global):
 *
 *   wa-viewer:wallpaper:<chatId>  → JSON `{ k, dim, blur, photo }`
 *   wa-viewer:wallpaper           → app-wide default, same shape
 *
 * Legacy values (a plain preset key like "doodle") are upgraded on read.
 */

export interface WallpaperConfig {
  /** Preset key, or 'custom' when a photo is set */
  k: string
  /** Darkness overlay 0..0.75 — boosts contrast/legibility on any wallpaper */
  dim: number
  /** Blur in px 0..12 — applied to custom photo wallpapers */
  blur: number
  /** URL of the uploaded photo (when k === 'custom') */
  photo: string | null
}

export const WALLPAPER_EVENT = 'wa-wallpaper'
export const GLOBAL_WALLPAPER_KEY = 'wa-viewer:wallpaper'
const DEFAULT_CONFIG: WallpaperConfig = { k: 'doodle', dim: 0, blur: 0, photo: null }

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
    key: 'plain',
    label: 'Plain',
    bg: 'bg-(--wa-chat-bg)',
    swatch: 'bg-(--wa-chat-bg)',
  },
  {
    key: 'sage',
    label: 'Sage',
    bg: 'bg-[#e3ecdd] dark:bg-[#0c1710]',
    doodle: 'text-[#4a7c59]/[0.08] dark:text-[#8fc7a5]/[0.05]',
    swatch: 'bg-[#e3ecdd] dark:bg-[#0c1710]',
  },
  {
    key: 'sepia',
    label: 'Sepia',
    bg: 'bg-[#f2e9d8] dark:bg-[#16120d]',
    doodle: 'text-[#8a6d3b]/[0.09] dark:text-[#d9b878]/[0.05]',
    swatch: 'bg-[#f2e9d8] dark:bg-[#16120d]',
  },
  {
    key: 'dusk',
    label: 'Dusk',
    bg: 'bg-[linear-gradient(140deg,#e5dcf7_0%,#f2e2ec_52%,#fbe9d6_100%)] dark:bg-[linear-gradient(140deg,#1b1230_0%,#251026_52%,#2a1408_100%)]',
    swatch:
      'bg-[linear-gradient(140deg,#e5dcf7_0%,#f2e2ec_52%,#fbe9d6_100%)] dark:bg-[linear-gradient(140deg,#1b1230_0%,#251026_52%,#2a1408_100%)]',
  },
  {
    key: 'mint',
    label: 'Mint',
    bg: 'bg-[#dbf2e5] dark:bg-[#081610]',
    doodle: 'text-[#2f855a]/[0.08] dark:text-[#7fd0a4]/[0.05]',
    swatch: 'bg-[#dbf2e5] dark:bg-[#081610]',
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
    key: 'graphite',
    label: 'Graphite',
    bg: 'bg-[#e2e5e8] dark:bg-[#0d1114]',
    swatch: 'bg-[#e2e5e8] dark:bg-[#0d1114]',
  },
  {
    key: 'cocoa',
    label: 'Cocoa',
    bg: 'bg-[#eddfcd] dark:bg-[#170f08]',
    doodle: 'text-[#7a5a38]/[0.08] dark:text-[#caa878]/[0.05]',
    swatch: 'bg-[#eddfcd] dark:bg-[#170f08]',
  },
]

export function presetByKey(k: string): WallpaperPreset {
  return WALLPAPER_PRESETS.find((p) => p.key === k) ?? WALLPAPER_PRESETS[0]
}

function clamp01(v: number, max: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(Math.max(v, 0), max)
}

function parseConfig(raw: string | null): WallpaperConfig | null {
  if (!raw) return null
  if (raw.startsWith('{')) {
    try {
      const o = JSON.parse(raw) as Record<string, unknown>
      const photo = typeof o.photo === 'string' && o.photo ? o.photo : null
      const k = typeof o.k === 'string' && o.k ? o.k : photo ? 'custom' : 'doodle'
      return {
        k,
        dim: clamp01(Number(o.dim ?? 0), 0.75),
        blur: clamp01(Number(o.blur ?? 0), 12),
        photo,
      }
    } catch {
      return null
    }
  }
  // Legacy plain-key value
  return { ...DEFAULT_CONFIG, k: raw }
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
    // For a fresh per-chat override start from the effective look
    const next: WallpaperConfig = {
      ...cur,
      ...patch,
    }
    if (next.k !== 'custom') next.photo = null
    if (next.k === 'custom' && !next.photo) next.k = 'doodle'
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
