/**
 * Chat-list preview logic — the isomorphic twin of the aggregate logic in
 * src/lib/chat-service.ts (which is server-only because it imports Prisma).
 * The local DataClient uses this so on-device chat lists produce the same
 * previews as server imports. Keep both in sync.
 */

/** Same media-type set as chat-service MEDIA_TYPES. */
export const MEDIA_TYPES = new Set([
  'image',
  'video',
  'audio',
  'sticker',
  'gif',
  'document',
  'contact',
  'media',
])

/**
 * Human preview for call messages — mirrors callPreviewText in
 * chat-service.ts (and the CallCard classification in MessageBubble).
 */
function callPreviewText(body: string): string {
  const text = (body ?? '').trim()
  if (!text) return ''
  const lower = text.toLowerCase()
  const video = lower.includes('video')
  if (/missed|no answer|cancel(?:l)?ed/.test(lower)) {
    return video ? 'Missed video call' : 'Missed voice call'
  }
  const kind = video ? 'Video call' : 'Voice call'
  const dur = text.match(/(\d+)\s*(hours?|hrs?|min(?:ute)?s?|sec(?:ond)?s?)/i)
  let duration: string | null = null
  if (dur) {
    const n = parseInt(dur[1], 10)
    const unit = dur[2].toLowerCase()
    duration = unit.startsWith('h')
      ? `${n} ${n === 1 ? 'hour' : 'hours'}`
      : unit.startsWith('min')
        ? `${n} min`
        : `${n} ${n === 1 ? 'sec' : 'secs'}`
  }
  if (
    lower.includes('incoming') ||
    lower.includes('outgoing') ||
    lower.includes('started a call')
  ) {
    return duration ? `${kind} · ${duration}` : kind
  }
  return text.slice(0, 120)
}

/** Port of chat-service previewText(). */
export function previewText(
  type: string,
  body: string,
  mediaName: string | null
): string {
  if (type === 'system') return body.slice(0, 300)
  const LABELED = new Set([
    'image',
    'video',
    'gif',
    'audio',
    'sticker',
    'document',
    'contact',
    'media',
    'poll',
    'location',
    'call',
    'deleted',
  ])
  if (LABELED.has(type)) {
    if (type === 'document') {
      return (body || mediaName || '').slice(0, 120)
    }
    if (type === 'location' || type === 'contact') {
      let rec: Record<string, unknown> | null = null
      if (body.startsWith('{')) {
        try {
          const o: unknown = JSON.parse(body)
          if (o && typeof o === 'object' && !Array.isArray(o)) {
            rec = o as Record<string, unknown>
          }
        } catch {
          /* legacy plain-text body */
        }
      }
      if (type === 'location') {
        const label =
          rec && typeof rec.label === 'string' ? rec.label.trim() : ''
        if (label) return label.slice(0, 120)
        const rest = body.replace(/^(live\s+)?location[:\s]*/i, '').trim()
        return rest ? rest.slice(0, 120) : ''
      }
      const name = rec && typeof rec.name === 'string' ? rec.name.trim() : ''
      if (name) {
        const phone =
          rec && typeof rec.phone === 'string' ? rec.phone.trim() : ''
        return (phone ? `${name} · ${phone}` : name).slice(0, 120)
      }
      return (body || mediaName || '').slice(0, 120)
    }
    if (type === 'call') return callPreviewText(body)
    if (type === 'poll') return body.slice(0, 120)
    // Caption-less media falls back to its file name so the chat list never
    // renders a bare "Photo:" chip (matches import-time previews).
    return (body || mediaName || '').slice(0, 120)
  }
  return body.slice(0, 300)
}
