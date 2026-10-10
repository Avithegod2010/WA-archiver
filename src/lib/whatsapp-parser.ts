/**
 * Parser for WhatsApp exported chat archives (.txt content).
 *
 * Supported line formats:
 *  - Android:  `12/03/2024, 14:23 - John Doe: message text`
 *  - iOS:      `[12/03/2024, 14:23:11] John Doe: message text`
 *  - 12h time: `[15/06/2024, 9:05 PM] John Doe: message text`
 *  - Multiline continuation lines are appended to the previous message.
 *  - System messages (no sender) are detected as `system`.
 */

export type MessageType =
  | 'text'
  | 'system'
  | 'deleted'
  | 'call'
  | 'poll'
  | 'location'
  | 'contact'
  | 'image'
  | 'video'
  | 'audio'
  | 'sticker'
  | 'gif'
  | 'document'
  | 'media'

export interface ParsedMessage {
  ts: Date
  sender: string | null
  body: string
  type: MessageType
  mediaName: string | null
  /** For polls: option labels detected from `Option: N votes` lines. */
  pollOptions?: string[] | null
}

export interface ParseResult {
  messages: ParsedMessage[]
  participants: string[]
  isGroup: boolean
  dateOrder: 'dmy' | 'mdy'
}

const INVISIBLE_RE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\uFEFF]/g

// [12/03/2024, 14:23:11] | 12/03/2024, 14:23 - | [15/06/2024, 9:05 PM]
const TS_RE =
  /^\[?(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AaPp])\.?[Mm]\.?)?\]?\s*(?:[-\u2013]\s*)?/

// Sender is the shortest run of non-colon chars followed by ": " (max 100 chars).
const SENDER_RE = /^([^:\n]{1,100}):\s?/

// Candidate senders that are clearly message bodies, not names.
const SENDER_BLOCKLIST = new Set([
  'location',
  'live location',
  'http',
  'https',
  'poll',
  'image',
  'video',
  'audio',
  'document',
  'sticker',
  'gif',
])

const MEDIA_EXT_RE =
  /^[\w\- .()\[\]]{1,150}\.(jpe?g|png|gif|webp|bmp|heic|svg|mp4|3gp|mkv|mov|avi|webm|opus|ogg|m4a|mp3|wav|aac|amr|flac|pdf|docx?|xlsx?|pptx?|csv|txt|rtf|zip|rar|7z|apk|epub|vcf|ics)$/i

const DOC_EXTS =
  /\.(pdf|docx?|xlsx?|pptx?|csv|txt|rtf|zip|rar|7z|apk|epub|ics)$/i
const AUDIO_EXTS = /\.(opus|ogg|m4a|mp3|wav|aac|amr|flac)$/i
const VIDEO_EXTS = /\.(mp4|3gp|mkv|mov|avi|webm)$/i
const STICKER_EXTS = /\.(webp)$/i
const IMAGE_EXTS = /\.(jpe?g|png|gif|bmp|heic|svg)$/i

export function typeFromFilename(name: string): MessageType {
  const base = name.split('/').pop() ?? name
  if (/\.vcf$/i.test(base)) return 'contact'
  if (/sticker/i.test(base) || STICKER_EXTS.test(base)) return 'sticker'
  if (AUDIO_EXTS.test(base)) return 'audio'
  if (VIDEO_EXTS.test(base)) return /gif$/i.test(base) ? 'gif' : 'video'
  if (IMAGE_EXTS.test(base)) return 'image'
  if (DOC_EXTS.test(base)) return 'document'
  return 'media'
}

export function isMediaFilename(name: string): boolean {
  return MEDIA_EXT_RE.test(name.trim())
}

interface Segment {
  groups: RegExpMatchArray
  rest: string
}

function buildDate(m: RegExpMatchArray, order: 'dmy' | 'mdy'): Date | null {
  const first = parseInt(m[1], 10)
  const second = parseInt(m[2], 10)
  let year = parseInt(m[3], 10)
  const hh = parseInt(m[4], 10)
  const mm = parseInt(m[5], 10)
  const ss = m[6] ? parseInt(m[6], 10) : 0
  const ampm = m[7]

  if (year < 100) year += 2000

  // Disambiguate day/month: a value > 12 can only be a day;
  // otherwise fall back to the globally detected order.
  let day: number
  let month: number
  if (first > 12) {
    day = first
    month = second
  } else if (second > 12) {
    day = second
    month = first
  } else if (order === 'mdy') {
    day = second
    month = first
  } else {
    day = first
    month = second
  }

  let hours = hh
  if (ampm) {
    const isPM = ampm.toLowerCase().startsWith('p')
    if (isPM && hours < 12) hours += 12
    if (!isPM && hours === 12) hours = 0
  }

  const d = new Date(year, month - 1, day, hours, mm, ss)
  if (
    Number.isNaN(d.getTime()) ||
    d.getDate() !== day ||
    d.getMonth() !== month - 1
  ) {
    return null
  }
  return d
}

function detectOrder(raws: RegExpMatchArray[]): 'dmy' | 'mdy' {
  for (const m of raws) {
    const a = parseInt(m[1], 10)
    const b = parseInt(m[2], 10)
    if (a > 12) return 'dmy'
    if (b > 12) return 'mdy'
  }
  return 'dmy'
}

function classifySenderMessage(body: string): {
  type: MessageType
  mediaName: string | null
  body: string
  pollOptions?: string[] | null
} {
  let text = body.trim()

  // Deleted messages
  if (/^(this message was deleted|you deleted this message)/i.test(text)) {
    return { type: 'deleted', mediaName: null, body: text }
  }

  // Missed calls
  if (/missed (group )?(voice|video) call/i.test(text)) {
    return { type: 'call', mediaName: null, body: text }
  }

  // Polls — real exports embed the options as `Option name: N votes` lines
  if (/^poll:/i.test(text)) {
    const [firstLine, ...restLines] = text.split(/\n/)
    const body = firstLine.replace(/^poll:\s*/i, '')
    const options: string[] = []
    for (const line of restLines) {
      const m = line.match(/^(.+?):\s*\d+\s*votes?$/i)
      if (m) options.push(m[1].trim().slice(0, 100))
    }
    return {
      type: 'poll',
      mediaName: null,
      body,
      pollOptions: options.length >= 2 ? options.slice(0, 12) : null,
    }
  }

  // Location
  if (
    /^location:/i.test(text) ||
    /^live location/i.test(text) ||
    /https?:\/\/(maps\.app\.goo\.gl|maps\.google\.|www\.google\.[a-z.]+\/maps)/i.test(
      text
    )
  ) {
    return { type: 'location', mediaName: null, body: text }
  }

  // "(file attached)" pattern (iOS + newer Android)
  const attached = text.match(/([\w\- .()\[\]]+\.\w{2,5})\s*\(file attached\)/i)
  if (attached) {
    const name = attached[1]
    const caption = text.replace(attached[0], '').trim()
    return { type: typeFromFilename(name), mediaName: name, body: caption }
  }

  // "<attached: NAME>" pattern
  const attachedTag = text.match(/<attached:\s*(.+?)>/)
  if (attachedTag) {
    const name = attachedTag[1].trim()
    const caption = text.replace(attachedTag[0], '').trim()
    return { type: typeFromFilename(name), mediaName: name, body: caption }
  }

  // "<Media omitted>" (older Android exports)
  if (/^(\s*<\s*media omitted\s*>\s*)+$/i.test(text)) {
    return { type: 'media', mediaName: null, body: '' }
  }

  // Standalone media/document filename
  if (isMediaFilename(text)) {
    return { type: typeFromFilename(text), mediaName: text.trim(), body: '' }
  }

  return { type: 'text', mediaName: null, body: text }
}

export function parseWhatsAppText(raw: string): ParseResult {
  const text = raw.replace(INVISIBLE_RE, '')
  const lines = text.split(/\r\n|\r|\n/)

  const segments: Segment[] = []
  for (const line of lines) {
    const m = line.match(TS_RE)
    if (m) {
      segments.push({ groups: m, rest: line.slice(m[0].length) })
    } else if (segments.length > 0 && line.trim().length > 0) {
      segments[segments.length - 1].rest += '\n' + line
    }
    // Lines before the first timestamp are ignored (headers/BOM noise)
  }

  const order = detectOrder(segments.map((s) => s.groups))
  const messages: ParsedMessage[] = []

  for (const seg of segments) {
    const ts = buildDate(seg.groups, order)
    if (!ts) continue

    let rest = seg.rest.replace(/^\s+/, '')
    let sender: string | null = null

    const senderMatch = rest.match(SENDER_RE)
    if (senderMatch) {
      const candidate = senderMatch[1].trim()
      if (!SENDER_BLOCKLIST.has(candidate.toLowerCase())) {
        sender = candidate
        rest = rest.slice(senderMatch[0].length)
      }
    }

    if (!sender) {
      messages.push({
        ts,
        sender: null,
        body: rest.trim(),
        type: 'system',
        mediaName: null,
      })
      continue
    }

    const cls = classifySenderMessage(rest)
    messages.push({
      ts,
      sender,
      body: cls.body,
      type: cls.type,
      mediaName: cls.mediaName,
      pollOptions: cls.pollOptions ?? null,
    })
  }

  // Participants ordered by message count
  const counts = new Map<string, number>()
  for (const msg of messages) {
    if (msg.sender) counts.set(msg.sender, (counts.get(msg.sender) ?? 0) + 1)
  }
  const participants = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)

  // Group detection: 3+ distinct senders, or explicit group system notices
  const hasGroupNotice = messages.some(
    (m) =>
      m.type === 'system' &&
      /(created group|joined using this group|changed the subject)/i.test(m.body)
  )
  const isGroup = participants.length > 2 || hasGroupNotice

  return { messages, participants, isGroup, dateOrder: order }
}

/** Derive a chat title from the export filename. */
export function guessTitleFromFilename(filename: string): string {
  let base = filename.replace(/\.(txt|zip)$/i, '').trim()
  base = base.replace(/^whatsapp chat with /i, '').trim()
  base = base.replace(/^whatsapp chat /i, '').trim()
  return base || 'Imported Chat'
}

const MEDIA_LABEL: Partial<Record<MessageType, string>> = {
  image: 'Photo',
  gif: 'GIF',
  video: 'Video',
  audio: 'Voice message',
  sticker: 'Sticker',
  document: 'Document',
  contact: 'Contact card',
  location: 'Location',
  poll: 'Poll',
  media: 'Media',
  call: 'Missed call',
  deleted: 'This message was deleted',
}

/** Build a one-line preview for the chat list. */
export function buildPreview(msg: {
  body: string
  type: MessageType
}): string {
  if (msg.type === 'system') return msg.body
  if (msg.type === 'location') return 'Location'
  const label = MEDIA_LABEL[msg.type]
  if (label) return label
  return msg.body.replace(/\s*\n\s*/g, ' ').trim()
}
