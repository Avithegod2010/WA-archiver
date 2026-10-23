function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export interface ExportMessage {
  ts: Date
  sender: string | null
  body: string
  type: string
  mediaName: string | null
  /** Local edit flag — re-exported as an "(edited)" suffix (our convention). */
  edited?: boolean
  /** Pending scheduled send — re-exported with a "[Scheduled]" prefix. */
  scheduledFor?: Date | null
}

const FALLBACK_LABELS: Record<string, string> = {
  image: '<Media omitted>',
  video: '<Media omitted>',
  audio: '<Media omitted>',
  sticker: '<Media omitted>',
  gif: '<Media omitted>',
  media: '<Media omitted>',
  document: 'document omitted',
  contact: 'Contact: card omitted',
  poll: 'POLL: (options not included in export)',
  location: 'Location: not included',
  deleted: 'This message was deleted',
  call: 'Missed call',
}

/**
 * Round-trip body for special message types.
 *
 * Goal: an exported .txt re-imported through the WhatsApp parser yields the
 * SAME types again (see src/lib/whatsapp-parser.ts):
 *   • location → "Location: …"      (parser: /^location:/i + maps URLs)
 *   • contact  → "Contact: …"       (parser: /^contact:/i — our convention,
 *                                     .vcf attachments already round-trip)
 *   • deleted  → "This message was deleted" (parser: dedicated rule)
 *   • poll     → "POLL: …"          (parser: /^poll:/i)
 */
function roundTripBody(m: ExportMessage): string {
  let body = m.body ?? ''
  switch (m.type) {
    case 'location':
      if (!body) body = `Location: ${m.mediaName || 'shared a location'}`
      else if (!/^location:/i.test(body) && !/https?:\/\//i.test(body))
        body = `Location: ${body}`
      return body
    case 'contact':
      if (!body) body = `Contact: ${m.mediaName || 'card'}`
      else if (!/^contact:/i.test(body)) body = `Contact: ${body}`
      return body
    case 'deleted':
      // Always the canonical tombstone text — the parser re-detects it.
      return 'This message was deleted'
    case 'poll':
      body = body || 'Poll'
      if (!/^poll:/i.test(body)) body = `POLL: ${body}`
      return body
    default:
      if (!body && m.mediaName) body = `${m.mediaName} (file attached)`
      if (!body) body = FALLBACK_LABELS[m.type] ?? '<Media omitted>'
      return body
  }
}

/**
 * Reconstructs a WhatsApp-format chat log from stored messages:
 *   dd/mm/yyyy, hh:mm - Sender: body
 * System messages (no sender) omit the "Sender:" part.
 * Multiline bodies are re-exported as continuation lines.
 *
 * Special types emit round-trippable lines (see roundTripBody) so an
 * export → import cycle preserves location / contact / deleted / poll
 * message types. Locally edited messages carry an "(edited)" suffix and
 * pending scheduled sends a "[Scheduled]" prefix.
 */
export function buildWhatsAppText(messages: ExportMessage[]): string {
  const lines: string[] = []
  for (const m of messages) {
    const ts = `${pad(m.ts.getDate())}/${pad(m.ts.getMonth() + 1)}/${m.ts.getFullYear()}, ${pad(m.ts.getHours())}:${pad(m.ts.getMinutes())}`
    let body = roundTripBody(m)
    if (m.scheduledFor && !isNaN(m.scheduledFor.getTime())) {
      body = `[Scheduled for ${pad(m.scheduledFor.getDate())}/${pad(m.scheduledFor.getMonth() + 1)}/${m.scheduledFor.getFullYear()} ${pad(m.scheduledFor.getHours())}:${pad(m.scheduledFor.getMinutes())}] ${body}`
    }
    if (m.edited) body += ' (edited)'
    const bodyLines = body.split('\n')
    const first = m.sender
      ? `${ts} - ${m.sender}: ${bodyLines[0]}`
      : `${ts} - ${bodyLines[0]}`
    lines.push(first, ...bodyLines.slice(1))
  }
  return lines.join('\n') + '\n'
}

/** Sanitize a chat title into a safe download filename fragment. */
export function safeFileTitle(title: string): string {
  return (title || 'chat')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .slice(0, 80)
}
