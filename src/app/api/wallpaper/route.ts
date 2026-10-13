import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { assertAppUnlocked } from '@/lib/server-lock'

/**
 * Custom chat wallpapers: a client-uploaded photo is stored on disk under
 * `db/wallpapers/<uuid>.<ext>` and served through /api/wallpaper/[name].
 * Only the small URL is kept in localStorage on the client.
 */
const WALLPAPER_ROOT = path.join(process.cwd(), 'db', 'wallpapers')

const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
}

const MAX_BYTES = 12 * 1024 * 1024 // 12 MB — generous, browsers downscale client-side too

export async function POST(req: Request) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }
    const ext = ALLOWED[file.type]
    if (!ext) {
      return NextResponse.json(
        { error: 'Unsupported image type — use JPG, PNG, WebP or GIF' },
        { status: 415 }
      )
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'Image is too large (max 12 MB)' },
        { status: 413 }
      )
    }

    const buf = Buffer.from(await file.arrayBuffer())
    await fs.mkdir(WALLPAPER_ROOT, { recursive: true })

    const name = `${randomUUID()}.${ext}`
    await fs.writeFile(path.join(WALLPAPER_ROOT, name), buf)

    return NextResponse.json({ url: `/api/wallpaper/${name}` })
  } catch {
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
