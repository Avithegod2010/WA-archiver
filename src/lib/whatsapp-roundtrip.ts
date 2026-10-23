/**
 * Round-trip linker for reactions + reply threads (v1.9).
 *
 * The .txt export encodes two things plain WhatsApp transcripts flatten:
 *
 *   • replies    — body prefixed with `[Replied to Sender: quoted text]`
 *                  (first line, our own bracketed convention so it can
 *                  never collide with real WhatsApp quote formats)
 *   • reactions  — separate rows shaped like the REAL Android export:
 *                  `ts - Alice: reacted 👍 to "original body"` (also
 *                  accepts WhatsApp's "pawed 🐾" variant)
 *
 * The parser emits both as ordinary rows; this pass then WALKS the parsed
 * transcript and
 *   1. removes reaction rows, attaching { emoji: [reactor] } to the nearest
 *      earlier message whose body starts with the quoted target, and
 *   2. resolves `[Replied to …]` prefixes into a replyQuote ref on the
 *      message (the import pipelines resolve the ref to a replyToId).
 *
 * Runs in the parse worker, on the main thread and in the verify self-test —
 * pure, dependency-free.
 */

export interface RoundtripReaction {
  emoji: string
  by: string
  /** Body snippet the reaction targets (leading-truncated, max 200 chars). */
  target: string
}

export interface ReplyQuote {
  /** Sender of the quoted (original) message. */
  sender: string
  /** Quoted body snippet (first line, max 200 chars). */
  body: string
}

/** Minimal message shape the linker needs (ParsedMessage satisfies it). */
export interface LinkableMessage {
  sender: string | null
  body: string
  reactions?: Record<string, string[]> | null
  replyQuote?: ReplyQuote | null
  reaction?: RoundtripReaction | null
}

/** `[Replied to John Doe: quoted first line]` at body start. */
export const REPLY_PREFIX_RE =
  /^\[Replied to ([^[\]]{1,100}?): ([^\]]{0,200})\]\s*\n?/

/** `reacted 👍 to "body"` / `pawed 🐾 to "body"` / `reacted to "body"`. */
export const REACTION_BODY_RE =
  /^(?:reacted|pawed)\s+(\S{1,8})?\s*to\s+"([\s\S]{1,200})"$/i

/** Max messages scanned backwards when resolving a reaction/quote target. */
const LOOKBACK = 400

/** First-line snippet used when ENCODING (export side). */
export function quoteSnippet(body: string, max = 200): string {
  const first = (body || '').replace(/\s*\n\s*/g, ' ').trim()
  return first.length > max ? `${first.slice(0, max - 1)}…` : first
}

interface ReactionRow {
  idx: number
  reaction: RoundtripReaction
}

/**
 * Link reactions + reply quotes across a parsed transcript, in place.
 * Returns the same array with reaction rows REMOVED (they were folded into
 * their target messages) — order otherwise preserved.
 */
export function linkReactionsAndReplies<T extends LinkableMessage>(
  messages: T[]
): T[] {
  const reactionRows: ReactionRow[] = []

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]

    // --- reaction rows -----------------------------------------------------
    // (the parser pre-marks them in `reaction`; the regex fallback keeps the
    //  pass usable with hand-built message arrays, e.g. the verify self-test)
    if (m.sender) {
      let r = m.reaction ?? null
      if (!r && !m.reactions) {
        const mr = m.body.match(REACTION_BODY_RE)
        if (mr) {
          r = {
            emoji: (mr[1] ?? '').trim(),
            by: m.sender,
            target: quoteSnippet(mr[2] ?? '', 200),
          }
        }
      }
      if (r) {
        reactionRows.push({ idx: i, reaction: r })
        continue
      }
    }

    // --- reply quotes ------------------------------------------------------
    if (!m.replyQuote) {
      const q = m.body.match(REPLY_PREFIX_RE)
      if (q) {
        m.replyQuote = { sender: q[1].trim(), body: q[2].trim() }
        m.body = m.body.slice(q[0].length).replace(/^\s+/, '')
      }
    }
  }

  // Fold reaction rows into their targets, newest row first so the nearest
  // earlier message wins when the same snippet appears multiple times.
  const drop = new Set<number>()
  for (let r = reactionRows.length - 1; r >= 0; r--) {
    const { idx, reaction } = reactionRows[r]
    const target = reaction.target.toLowerCase()
    if (!target) continue
    for (let j = idx - 1; j >= 0 && idx - j <= LOOKBACK; j--) {
      const cand = messages[j]
      if (!cand.sender) continue // system rows are never targets
      // Flatten multiline bodies — export snippets are single-line.
      const bodyFlat = (cand.body ?? '')
        .replace(/\s*\n\s*/g, ' ')
        .trim()
        .toLowerCase()
      if (!bodyFlat || !bodyFlat.startsWith(target)) continue
      const map = cand.reactions && { ...cand.reactions }
      const emoji = reaction.emoji || '❤️'
      const merged = map ?? {}
      const list = merged[emoji] ?? []
      if (!list.includes(reaction.by)) merged[emoji] = [...list, reaction.by]
      cand.reactions = merged
      drop.add(idx)
      break
    }
  }

  if (drop.size === 0) return messages
  return messages.filter((_, i) => !drop.has(i))
}
