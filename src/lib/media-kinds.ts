/**
 * Pure filename→media-kind helpers, safe for client and server bundles
 * (no node built-ins). The server-only media-store re-exports these, and
 * client code (e.g. the device import path) imports them from here.
 */

const VIDEO_EXT = new Set(['mp4', 'm4v', '3gp', 'mkv', 'mov', 'webm', 'avi'])

export function isVideoName(name: string): boolean {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  return VIDEO_EXT.has(ext)
}

/**
 * Voice-note / audio extensions (mp3, m4a, ogg, oga, opus, wav, aac, flac,
 * amr, 3ga and webm audio). Used by the import routes to honor
 * `includeAudio=0` — matching entries are not stored. Note: `.webm` is
 * included per the audio spec (webm voice notes from the composer
 * recorder); the parser types webm as video, so a webm *video* would also
 * be skipped when audio is excluded (rare in real exports).
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
