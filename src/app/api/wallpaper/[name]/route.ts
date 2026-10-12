import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { mimeFromName } from '@/lib/media-store'
import { assertAppUnlocked } from '@/lib/server-lock'

/**
 * Serves stored custom wallpapers from `db/wallpapers/<name>` with
 * long-lived caching (files are immutable — the name is a UUID).
 */
const WALLPAPER_ROOT = path.join(process.cwd(), 'db', 'wallpapers')

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const denied = await assertAppUnlocked(_req)
  if (denied) return denied

  const { name } = await params
  // Only allow plain file names — no traversal
  if (!/^[a-zA-Z0-9._-]+$/.test(name) || name.includes('..')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const p = path.join(WALLPAPER_ROOT, name)
  if (!p.startsWith(WALLPAPER_ROOT)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const data = await fs.readFile(p)
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': mimeFromName(name),
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
