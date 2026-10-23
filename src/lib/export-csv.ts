/**
 * Client-side CSV export — spreadsheet-friendly, mirrors the server route
 * (GET /api/chats/:id/export?format=csv) column-for-column so both paths
 * produce byte-compatible schemas:
 *   idx, timestamp_iso, timestamp_local, sender, type, body, media_name,
 *   starred, edited, forwarded, pinned, reactions_summary
 *
 * RFC-4180 quoting (double quotes, doubled inner quotes, CRLF row ending)
 * plus a UTF-8 BOM so Excel opens हिन्दी/Urdu text correctly.
 *
 * Used by: device-mode chat export (no /api in the static APK bundle),
 * starred-messages CSV, and the bulk multi-chat CSV export (chat-ops.ts).
 */

/** Minimal row shape — accepts ChatMessage, StarredItem and DTO rows. */
export interface CsvRow {
  ts: string | Date
  sender?: string | null
  body?: string | null
  type?: string | null
  mediaName?: string | null
  starred?: boolean | number | null
  edited?: boolean | number | null
  forwardedFrom?: string | null
  pinned?: boolean | number | null
  /** Emoji → reactors map (ChatMessage shape) or a preformatted summary. */
  reactions?: Record<string, string[]> | string | null
}

export const CSV_HEADERS = [
  'idx',
  'timestamp_iso',
  'timestamp_local',
  'sender',
  'type',
  'body',
  'media_name',
  'starred',
  'edited',
  'forwarded',
  'pinned',
  'reactions_summary',
] as const

/** Server-identical cell: always quoted, CRLF-normalized, formula-injection guarded. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value)
  // CRLF-safe: normalize line endings inside the quoted cell
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Guard against Excel/Sheets formula injection when the cell starts with
  // =, +, -, @ or tab (OWASP mitigation — prefix with ')
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

function boolCell(v: boolean | number | null | undefined): string {
  return v ? 'true' : 'false'
}

/** "👍: You, Amit; ❤️: Priya" — or the preformatted string passthrough. */
function reactionsSummary(r: CsvRow['reactions']): string {
  if (!r) return ''
  if (typeof r === 'string') return r
  const parts: string[] = []
  for (const [emoji, by] of Object.entries(r)) {
    if (!Array.isArray(by) || by.length === 0) continue
    parts.push(`${emoji}: ${by.join(', ')}`)
  }
  return parts.join('; ')
}

function localStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Build the full CSV file contents (BOM included) for the given rows. */
export function buildChatCsv(rows: CsvRow[]): string {
  const lines: string[] = [CSV_HEADERS.map((h) => csvCell(h)).join(',')]
  rows.forEach((m, i) => {
    const d = new Date(m.ts)
    const cells = [
      csvCell(i + 1),
      csvCell(Number.isNaN(d.getTime()) ? String(m.ts) : d.toISOString()),
      csvCell(Number.isNaN(d.getTime()) ? '' : localStamp(d)),
      csvCell(m.sender ?? ''),
      csvCell(m.type ?? ''),
      csvCell(m.body ?? ''),
      csvCell(m.mediaName ?? ''),
      csvCell(boolCell(m.starred)),
      csvCell(boolCell(m.edited)),
      csvCell(m.forwardedFrom ?? ''),
      csvCell(boolCell(m.pinned)),
      csvCell(reactionsSummary(m.reactions)),
    ]
    lines.push(cells.join(','))
  })
  // \r\n per RFC-4180 + BOM so Excel detects UTF-8.
  return '\uFEFF' + lines.join('\r\n') + '\r\n'
}

export function chatCsvBlob(rows: CsvRow[]): Blob {
  return new Blob([buildChatCsv(rows)], { type: 'text/csv;charset=utf-8' })
}
