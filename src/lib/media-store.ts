import { promises as fs } from 'fs'
import path from 'path'

/**
 * Media files extracted from ZIP exports are stored on disk under
 * `db/media/<chatId>/<file>` and served through /api/media/[chatId]/[name].
 */
const MEDIA_ROOT = path.join(process.cwd(), 'db', 'media')

function sanitizeName(name: string): string {
  const base = (name.split(/[/\\]/).pop() ?? 'file').trim()
  return base.replace(/[/\\?%*:|"<>\u0000-\u001f]/g, '_').slice(-150) || 'file'
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Save a media blob for a chat and return the unique stored filename. */
export async function saveMediaFile(
  chatId: string,
  originalName: string,
  data: Buffer
): Promise<string> {
  const dir = path.join(MEDIA_ROOT, chatId)
  await fs.mkdir(dir, { recursive: true })

  const safe = sanitizeName(originalName)
  let stored = safe
  let i = 1
  while (await exists(path.join(dir, stored))) {
    const dot = safe.lastIndexOf('.')
    if (dot > 0) {
      stored = `${safe.slice(0, dot)}_${i}${safe.slice(dot)}`
    } else {
      stored = `${safe}_${i}`
    }
    i++
  }

  await fs.writeFile(path.join(dir, stored), data)
  return stored
}

/** Resolve a (chatId, name) pair to an absolute path, or null if missing. */
export async function resolveMediaPath(
  chatId: string,
  name: string
): Promise<string | null> {
  const safe = sanitizeName(name)
  const p = path.join(MEDIA_ROOT, chatId, safe)
  // Path traversal guard
  if (!p.startsWith(path.join(MEDIA_ROOT, chatId))) return null
  if (!(await exists(p))) return null
  return p
}

export async function removeChatMedia(chatId: string): Promise<void> {
  const dir = path.join(MEDIA_ROOT, chatId)
  await fs.rm(dir, { recursive: true, force: true })
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  '3gp': 'video/3gpp',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  opus: 'audio/ogg',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  amr: 'audio/amr',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  vcf: 'text/vcard',
  zip: 'application/zip',
}

export function mimeFromName(name: string): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  return MIME[ext] ?? 'application/octet-stream'
}
