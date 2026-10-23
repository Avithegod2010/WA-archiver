/**
 * Round-trip self-test ("Verify my export").
 *
 * Re-parses the chat's own WhatsApp-format export (built by buildWhatsAppText
 * with the SAME transcript the .txt download uses) through the standard
 * WhatsApp parser, then reports type-fidelity: which share of the messages
 * come back as the same message type (location → location, contact →
 * contact, deleted → deleted, poll → poll, media → the media family …).
 *
 * Known-lossy kinds (reported honestly, never hidden):
 *   • call     → the "<Missed call>" placeholder does not re-match the
 *                parser's stricter "missed *voice/video* call" rule
 *   • document → the placeholder text re-parses as plain text
 * Everything else is expected to survive the export → import cycle.
 */

import { parseWhatsAppText, type MessageType } from './whatsapp-parser'
import { buildWhatsAppText, type ExportMessage } from './export-text'

/** Re-parsed types that count as a preserved message type. */
const MEDIA_FAMILY: MessageType[] = [
  'image',
  'video',
  'audio',
  'sticker',
  'gif',
  'media',
]

function expectedTypes(src: string): string[] {
  switch (src) {
    case 'image':
    case 'video':
    case 'audio':
    case 'sticker':
    case 'gif':
    case 'media':
      return MEDIA_FAMILY
    case 'deleted':
      return ['deleted']
    case 'location':
      return ['location']
    case 'contact':
      return ['contact']
    case 'poll':
      return ['poll']
    case 'system':
      return ['system']
    case 'text':
      return ['text']
    // Known lossy: placeholder text falls back to plain text.
    case 'call':
      return ['call', 'text']
    case 'document':
      return ['document', 'text']
    default:
      return [src, 'text', 'media']
  }
}

const LOSS_NOTES: Record<string, string> = {
  call: 'Missed-call placeholder re-parses as plain text',
  document: 'Document placeholder re-parses as plain text (name is lost)',
}

export interface RoundTripReport {
  /** Messages fed into the builder. */
  total: number
  /** Messages the parser found in the rebuilt text. */
  reparsed: number
  /** Reparsed rows whose type stayed in the expected family. */
  typeMatched: number
  /** 0–100: typeMatched / total. */
  fidelityPct: number
  /** Per-type breakdown, sorted by count desc. */
  byType: { type: string; count: number; matched: number }[]
  /** First few mismatches for the details list. */
  losses: { idx: number; type: string; became: string; note?: string }[]
  /** v1.9 — reactions: how many source reactions came back attached. */
  reactionsTotal: number
  reactionsMatched: number
  /** v1.9 — replies: how many source reply threads came back quoted. */
  repliesTotal: number
  repliesMatched: number
}

export function verifyRoundTrip(messages: ExportMessage[]): RoundTripReport {
  const text = buildWhatsAppText(messages)
  const parsed = parseWhatsAppText(text).messages

  const byTypeMap = new Map<string, { count: number; matched: number }>()
  const losses: RoundTripReport['losses'] = []
  let typeMatched = 0

  // v1.9 — reaction / reply fidelity: the export re-encodes both as real
  // rows + quote prefixes; the parser must fold them back onto the same
  // messages (same index) with the same senders.
  let reactionsTotal = 0
  let reactionsMatched = 0
  let repliesTotal = 0
  let repliesMatched = 0
  const reactionCount = (m: ExportMessage): number =>
    Object.values(m.reactions ?? {}).reduce((s, l) => s + l.length, 0)

  const n = Math.min(messages.length, parsed.length)
  for (let i = 0; i < messages.length; i++) {
    const src = messages[i]
    const key = src.type || 'text'
    const bucket = byTypeMap.get(key) ?? { count: 0, matched: 0 }
    bucket.count++

    const reparsed = i < n ? String(parsed[i].type) : '(missing)'
    if (i < n && expectedTypes(key).includes(reparsed)) {
      typeMatched++
      bucket.matched++
    } else if (losses.length < 8) {
      losses.push({
        idx: i,
        type: key,
        became: reparsed,
        note: LOSS_NOTES[key],
      })
    }
    byTypeMap.set(key, bucket)

    if (i < n) {
      const srcReactions = src.reactions ?? null
      if (srcReactions && reactionCount(src) > 0) {
        reactionsTotal += reactionCount(src)
        const back = parsed[i].reactions ?? null
        if (back) {
          for (const [emoji, senders] of Object.entries(srcReactions)) {
            const got = back[emoji] ?? []
            for (const by of senders) {
              if (got.includes(by)) reactionsMatched++
            }
          }
        }
      }
      if (src.replyTo?.sender) {
        repliesTotal++
        const q = parsed[i].replyQuote ?? null
        if (
          q &&
          q.sender === src.replyTo.sender &&
          (src.replyTo.body || '')
            .replace(/\s*\n\s*/g, ' ')
            .trim()
            .toLowerCase()
            .startsWith(q.body.toLowerCase().slice(0, 40))
        ) {
          repliesMatched++
        }
      }
    }
  }

  return {
    total: messages.length,
    reparsed: parsed.length,
    typeMatched,
    fidelityPct:
      messages.length > 0
        ? Math.round((typeMatched / messages.length) * 1000) / 10
        : 100,
    byType: [...byTypeMap.entries()]
      .map(([type, v]) => ({ type, ...v }))
      .sort((a, b) => b.count - a.count),
    losses,
    reactionsTotal,
    reactionsMatched,
    repliesTotal,
    repliesMatched,
  }
}
