import { promises as fs } from 'fs'
import path from 'path'
import { execFile } from 'child_process'

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

const VIDEO_EXT = new Set(['mp4', 'm4v', '3gp', 'mkv', 'mov', 'webm', 'avi'])

export function isVideoName(name: string): boolean {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  return VIDEO_EXT.has(ext)
}

/**
 * Voice-note / audio extensions (mp3, m4a, ogg, oga, opus, wav, aac, flac,
 * amr, 3ga and webm audio). Used by the import routes to honor
 * `includeAudio=0` — matching entries are not written to db/media.
 * Note: `.webm` is included per the audio spec (webm voice notes from the
 * composer recorder); the parser types webm as video, so a webm *video*
 * would also be skipped when audio is excluded (rare in real exports).
 */
const AUDIO_EXT = new Set([
  'mp3',
  'm4a',
  'ogg',
  'oga',
  'opus',
  'wav',
  'aac',
  'flac',
  'amr',
  '3ga',
  'webm',
])

export function isAudioName(name: string): boolean {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  return AUDIO_EXT.has(ext)
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
