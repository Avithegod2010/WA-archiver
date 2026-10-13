import { promises as fs } from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'

/**
 * Media files extracted from ZIP exports are stored on disk under
 * `db/media/<chatId>/<file>` and served through /api/media/[chatId]/[name].
 */
const MEDIA_ROOT = path.join(process.cwd(), 'db', 'media')

/**
 * Chat ids are Prisma cuids (alphanumeric) or the reserved virtual id
 * `saved-messages`. Anything else must never touch the filesystem — this
 * is the hard guard against path traversal via `/api/media/[chatId]/[name]`.
 */
export function isValidChatId(chatId: string): boolean {
  return chatId === 'saved-messages' || /^[a-z0-9]{1,64}$/i.test(chatId)
}

function sanitizeName(name: string): string {
  const base = (name.split(/[/\\]/).pop() ?? 'file').trim()
  // Strip bidi/rtl override characters that can spoof filenames in the UI,
  // then replace filesystem-hostile characters.
  return base
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[/\\?%*:|"<>\u0000-\u001f]/g, '_')
    .slice(-150) || 'file'
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
  if (!isValidChatId(chatId)) throw new Error('Invalid chat id')
  const dir = path.join(MEDIA_ROOT, chatId)
  await fs.mkdir(dir, { recursive: true })

  const safe = sanitizeName(originalName)
  let stored = safe
  let i = 1
  // Cap collision probing: 2000 same-named entries used to cost millions of
  // sequential fs.access calls (O(n²)). After the cap, fall back to a random
  // suffix that is guaranteed unique for practical purposes.
  while ((await exists(path.join(dir, stored))) && i < 500) {
    const dot = safe.lastIndexOf('.')
    if (dot > 0) {
      stored = `${safe.slice(0, dot)}_${i}${safe.slice(dot)}`
    } else {
      stored = `${safe}_${i}`
    }
    i++
  }
  if (await exists(path.join(dir, stored))) {
    const dot = safe.lastIndexOf('.')
    const stem = dot > 0 ? safe.slice(0, dot) : safe
    const ext = dot > 0 ? safe.slice(dot) : ''
    stored = `${stem}_${randomUUID().slice(0, 8)}${ext}`
  }

  await fs.writeFile(path.join(dir, stored), data)
  return stored
}

/**
 * Resolve a (chatId, name) pair to an absolute path, or null if missing.
 *
 * Hard traversal guards, in order:
 *  1. chatId must be an alphanumeric id (or the reserved `saved-messages`) —
 *     rejects `..`, `%2f`, absolute paths and anything weird outright.
 *  2. The final resolved path must live inside MEDIA_ROOT ( belt-and-braces
 *     `path.resolve` + prefix check, independent of the caller's join).
 */
export async function resolveMediaPath(
  chatId: string,
  name: string
): Promise<string | null> {
  if (!isValidChatId(chatId)) return null
  const safe = sanitizeName(name)
  const root = path.resolve(MEDIA_ROOT, chatId)
  const p = path.resolve(root, safe)
  if (p !== root && !p.startsWith(root + path.sep)) return null
  if (!(await exists(p))) return null
  return p
}

// Pure extension helpers live in the isomorphic media-kinds module so the
// client-side device import can share them without bundling node built-ins.
import { isVideoName } from '@/lib/media-kinds'
export { isVideoName, isAudioName } from '@/lib/media-kinds'

/**
 * Best-effort decompressed size of a JSZip entry, read from archive metadata
 * WITHOUT inflating it. Returns -1 when the metadata is unavailable (callers
 * should then fall back to checking after decompression). Used to reject
 * zip-bomb entries before they materialize gigabytes in memory.
 */
export function zipEntrySize(entry: unknown): number {
  const d = (entry as { _data?: { uncompressedSize?: number } })._data
  return typeof d?.uncompressedSize === 'number' ? d.uncompressedSize : -1
}

/** Poster thumbnails are stored next to the video as `<file>.poster.jpg`. */
export function posterPathFor(storedName: string): string {
  return `${storedName}.poster.jpg`
}

/**
 * Extract a poster frame from a video with ffmpeg (best effort).
 * Frame is taken at ~10% in (min 0.3s) so intro-black frames are skipped.
 * Returns true when a poster file exists afterwards.
 */
export async function generateVideoPoster(
  chatId: string,
  storedName: string
): Promise<boolean> {
  if (!isValidChatId(chatId)) return false
  const poster = posterPathFor(storedName)
  const posterAbs = path.join(MEDIA_ROOT, chatId, poster)
  if (await exists(posterAbs)) return true
  if (!isVideoName(storedName)) return false

  const videoAbs = path.join(MEDIA_ROOT, chatId, storedName)
  try {
    const stat = await fs.stat(videoAbs)
    const seek = Math.min(Math.max(stat.size > 0 ? 0.3 : 0, 0.3), 5)
    await new Promise<void>((resolve, reject) => {
      execFile(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-ss',
          String(seek),
          '-i',
          videoAbs,
          '-frames:v',
          '1',
          '-vf',
          "scale='min(720,iw)':-2",
          '-q:v',
          '4',
          '-y',
          posterAbs,
        ],
        { timeout: 15000 },
        (err) => (err ? reject(err) : resolve())
      )
    })
    return await exists(posterAbs)
  } catch {
    return false
  }
}

export async function removeChatMedia(chatId: string): Promise<void> {
  if (!isValidChatId(chatId)) return
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
