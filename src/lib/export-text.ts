function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export interface ExportMessage {
  ts: Date
  sender: string | null
  body: string
  type: string
  mediaName: string | null
}

const FALLBACK_LABELS: Record<string, string> = {
  image: '<Media omitted>',
  video: '<Media omitted>',
  audio: '<Media omitted>',
  sticker: '<Media omitted>',
  gif: '<Media omitted>',
  media: '<Media omitted>',
  document: 'document omitted',
  contact: 'contact card omitted',
  poll: 'POLL: (options not included in export)',
  location: 'location omitted',
  deleted: 'This message was deleted',
  call: 'Missed call',
}

/**
 * Reconstructs a WhatsApp-format chat log from stored messages:
 *   dd/mm/yyyy, hh:mm - Sender: body
 * System messages (no sender) omit the "Sender:" part.
 * Multiline bodies are re-exported as continuation lines.
 */
export function buildWhatsAppText(messages: ExportMessage[]): string {
  const lines: string[] = []
  for (const m of messages) {
    const ts = `${pad(m.ts.getDate())}/${pad(m.ts.getMonth() + 1)}/${m.ts.getFullYear()}, ${pad(m.ts.getHours())}:${pad(m.ts.getMinutes())}`
    let body = m.body ?? ''
    if (!body && m.mediaName) body = `${m.mediaName} (file attached)`
    if (!body) body = FALLBACK_LABELS[m.type] ?? '<Media omitted>'
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
