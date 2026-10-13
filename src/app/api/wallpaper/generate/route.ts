import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import ZAI from 'z-ai-web-dev-sdk'
import { assertAppUnlocked } from '@/lib/server-lock'

export const runtime = 'nodejs'
// Image generation is measurably slower than the /api/ai text paths
// (observed ~61 s end-to-end) — give it a generous ceiling.
export const maxDuration = 300

/**
 * AI-generated chat wallpapers (task 14-i).
 *
 * Reuses the EXACT custom-wallpaper storage contract of POST /api/wallpaper:
 * a plain image file under `db/wallpapers/<name>`, served by
 * /api/wallpaper/[name]. Wallpapers have no registry/manifest — the URL is
 * handed back to the client which stores it in localStorage via the wallpaper
 * store. Generated files are named `ai-<timestamp>.<ext>` so they can be told
 * apart from uploaded UUID names, but are otherwise ordinary custom
 * wallpapers (they appear as the chat's photo wallpaper like any upload).
 */
const WALLPAPER_ROOT = path.join(process.cwd(), 'db', 'wallpapers')

const MIN_PROMPT = 3
const MAX_PROMPT = 300

/**
 * Fixed style suffix — steers every generation toward a WhatsApp-chat-friendly
 * look (subtle, low-contrast, doodle/pattern style) regardless of the prompt.
 */
const STYLE_SUFFIX =
  ', soft muted colors, subtle seamless doodle pattern, minimal, clean, phone wallpaper background'

const GEN_SIZE = '1024x1024'

/** Rate limit: 6 generations per minute per client (sliding window). */
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 6
const genHits = new Map<string, number[]>()

function rateLimited(key: string): boolean {
  const now = Date.now()
  const recent = (genHits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_MAX) {
    genHits.set(key, recent)
    return true
  }
  recent.push(now)
  genHits.set(key, recent)
  // Opportunistic prune so the map cannot grow without bound.
  if (genHits.size > 256) {
    for (const [k, v] of genHits) {
      if (k !== key && v.every((t) => now - t >= RATE_WINDOW_MS)) genHits.delete(k)
    }
  }
  return false
}

function clientKey(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local'
  )
}

/** Sniff the image type from base64 magic bytes (PNG / JPEG / WebP). */
function extFromBase64(b64: string): 'png' | 'jpg' | 'webp' | null {
  if (b64.startsWith('iVBORw0KGgo')) return 'png'
  if (b64.startsWith('/9j/')) return 'jpg'
  if (b64.startsWith('UklGR')) return 'webp'
  return null
}

export async function POST(req: Request) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  // ---- Validate the prompt (cheap checks first, no quota consumed) ---------
  let raw: unknown
  try {
    const body = await req.json()
    raw = body?.prompt
  } catch {
    raw = undefined
  }
  const prompt = typeof raw === 'string' ? raw.trim() : ''
  if (prompt.length < MIN_PROMPT || prompt.length > MAX_PROMPT) {
    return NextResponse.json(
      { error: 'Describe the wallpaper in 3–300 characters' },
      { status: 400 }
    )
  }

  // ---- Rate limit in front of the expensive generation call ----------------
  if (rateLimited(clientKey(req))) {
    return NextResponse.json(
      { error: 'Too many generations — try again in a minute' },
      { status: 429 }
    )
  }

  let writtenPath: string | null = null
  try {
    // ---- Generate ------------------------------------------------------------
    const zai = await ZAI.create()
    const res = await zai.images.generations.create({
      prompt: `${prompt}${STYLE_SUFFIX}`,
      size: GEN_SIZE,
    })
    const b64 = res.data?.[0]?.base64
    if (!b64) throw new Error('empty generation response')

    const ext = extFromBase64(b64)
    if (!ext) throw new Error('unrecognized image payload')

    const buf = Buffer.from(b64, 'base64')

    // ---- Store EXACTLY like POST /api/wallpaper stores uploads ---------------
    await fs.mkdir(WALLPAPER_ROOT, { recursive: true })
    const name = `ai-${Date.now()}.${ext}`
    writtenPath = path.join(WALLPAPER_ROOT, name)
    await fs.writeFile(writtenPath, buf)

    // Same shape as the upload endpoint ({ url }), plus ok/name for callers
    // that want the bare file name.
    return NextResponse.json({
      ok: true,
      name,
      url: `/api/wallpaper/${name}`,
    })
  } catch {
    // Never leak SDK internals; roll back any partially-written file.
    if (writtenPath) {
      try {
        await fs.unlink(writtenPath)
      } catch {
        /* nothing to clean up */
      }
    }
    return NextResponse.json(
      { error: 'Could not generate the wallpaper. Please try again.' },
      { status: 502 }
    )
  }
}
