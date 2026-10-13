/**
 * Media URL helpers shared by every component that renders a message's
 * attachment (Phase 2). One rule for both transports:
 *
 *   • server mode — mediaPath is the stored file name; the URL is
 *     /api/media/<chatId>/<name>
 *   • device mode — the data boundary (useMessageNormalizer) has already
 *     swapped mediaPath for a blob: object URL, which passes through
 *     untouched.
 */

export function displayMediaSrc(
  chatId: string,
  mediaPath: string | null | undefined
): string | null {
  if (!mediaPath) return null
  if (mediaPath.startsWith('blob:') || mediaPath.startsWith('data:')) {
    return mediaPath
  }
  return `/api/media/${chatId}/${encodeURIComponent(mediaPath)}`
}
