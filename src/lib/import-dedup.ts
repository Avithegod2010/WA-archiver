/**
 * B1 — Import merge/dedup helpers.
 *
 * Shared by the device import path (lib/data/local), the server import route
 * and the import preview UI. Zero dependencies, isomorphic, deterministic:
 *
 *  • makeMsgKey — stable message fingerprint (FNV-1a over ts|sender|body|type)
 *    used to skip exact duplicates when re-importing an updated export.
 *  • normalizeTitleKey / basenameKey — match-rule normalization for
 *    "same chat" detection (case/emoji-insensitive).
 *  • findMergeCandidates — existing chats that look like the parsed export.
 *  • estimateNewForMerge — rough "how many incoming messages are new"
 *    estimate (outside the existing chat's date span) for the preview UI.
 */

/** Fixed id of the personal "Saved Messages" chat (never a merge target). */
const SAVED_CHAT_ID = 'saved-messages'

/**
 * Chats whose generic title must never drive a title match ("Imported Chat"
 * is the parser's fallback for files with no derivable name — two unrelated
 * exports would otherwise look like the same chat).
 */
const GENERIC_TITLES = new Set(['imported chat'])

// ---- Fingerprinting ---------------------------------------------------------

/** FNV-1a 32-bit (primes chosen for good avalanche on short strings). */
function fnv1a32(input: string, seed: number): number {
  let h = seed >>> 0
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    // Math.imul keeps the multiply in 32-bit space (no precision loss).
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

const BODY_KEY_CAP = 8000 // must match the insert-time body slice (both paths)

/** Normalize any accepted timestamp form to a canonical ISO string. */
function tsIso(ts: Date | string): string {
  const d = ts instanceof Date ? ts : new Date(ts)
  return Number.isFinite(d.getTime()) ? d.toISOString() : 'invalid-ts'
}

/** Minimal message shape both transports can supply (Date or ISO ts). */
export interface DedupMessageLike {
  ts: Date | string
  sender: string | null
  body: string
  type: string
}

/**
 * Stable dedup key for a message: hash of (ts | sender | body | type).
 *
 * Two independent FNV-1a passes (different seeds → effectively 64 bits) are
 * concatenated as 16 hex chars, making accidental collisions negligible at
 * chat scale (hundreds of thousands of messages). Not cryptographic — the
 * inputs are app-generated rows, not adversarial content.
 *
 * Body is capped at the same 8000 chars the insert paths slice to, so keys
 * computed from a parsed export always match keys recomputed from stored rows.
 */
export function makeMsgKey(m: DedupMessageLike): string {
  const joined = `${tsIso(m.ts)}\u0000${m.sender ?? ''}\u0000${(m.body ?? '')
    .slice(0, BODY_KEY_CAP)
    .replace(/\r?\n/g, '\n')}\u0000${m.type ?? ''}`
  const a = fnv1a32(joined, 0x811c9dc5)
  const b = fnv1a32(joined, 0x811c9dc5 ^ 0x9e3779b9)
  return (
    a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
  )
}

// ---- Match-rule normalization -----------------------------------------------

/**
 * Title key: lowercase, whitespace-collapsed, emoji/variation-selector/ZWJ
 * stripped. Lets "Emma 💕✨" and "emma" match as the same chat while keeping
 * real distinct names apart.
 */
export function normalizeTitleKey(title: string): string {
  return (title ?? '')
    .replace(
      /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D\u20E3]/gu,
      ''
    )
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** sourceFile key: bare basename, lowercased (zips keep folder prefixes). */
export function basenameKey(name: string): string {
  const base = (name ?? '').split(/[/\\]/).pop() ?? ''
  return base.toLowerCase().trim()
}

// ---- Merge candidate matching ----------------------------------------------

/** Subset of ChatSummary the matcher needs (both transports satisfy this). */
export interface MergeCandidateChat {
  id: string
  title: string
  sourceFile: string
  messageCount: number
  firstAt: string | null
  lastAt: string | null
}

export interface ImportMergeCandidate extends MergeCandidateChat {
  /** Which rule(s) matched: normalized title, source file basename, or both. */
  matchedBy: ('title' | 'sourceFile')[]
}

/**
 * Existing chats that look like the parsed export. Match rule: same
 * normalized title OR same sourceFile basename. Saved Messages is never a
 * candidate, and generic fallback titles never match by title (an unrelated
 * "Imported Chat" is not proof of sameness — sourceFile still can match).
 */
export function findMergeCandidates(input: {
  title: string
  sourceFile: string
  chats: MergeCandidateChat[]
}): ImportMergeCandidate[] {
  const titleKey = normalizeTitleKey(input.title)
  const fileKey = basenameKey(input.sourceFile)
  const titleUsable = titleKey.length > 0 && !GENERIC_TITLES.has(titleKey)
  const out: ImportMergeCandidate[] = []
  for (const c of input.chats) {
    if (!c || c.id === SAVED_CHAT_ID) continue
    const byTitle = titleUsable && normalizeTitleKey(c.title) === titleKey
    const byFile = fileKey.length > 0 && basenameKey(c.sourceFile) === fileKey
    if (!byTitle && !byFile) continue
    out.push({
      ...c,
      matchedBy: [
        ...(byTitle ? (['title'] as const) : []),
        ...(byFile ? (['sourceFile'] as const) : []),
      ],
    })
  }
  return out
}

// ---- Preview estimate --------------------------------------------------------

/**
 * Rough "how many incoming messages are genuinely new" estimate for the
 * preview banner: incoming messages dated outside the existing chat's
 * [firstAt, lastAt] span cannot collide with stored rows, so they are new
 * with certainty; everything inside the span is *probably* a duplicate.
 * The exact count comes from makeMsgKey dedup at commit time.
 */
export function estimateNewForMerge(
  messages: ReadonlyArray<{ ts: Date | string }>,
  existingFirst: string | null,
  existingLast: string | null
): number {
  if (messages.length === 0) return 0
  if (!existingFirst || !existingLast) return messages.length // empty target chat
  const lo = Date.parse(existingFirst)
  const hi = Date.parse(existingLast)
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return messages.length
  let outside = 0
  for (const m of messages) {
    const t = m.ts instanceof Date ? m.ts.getTime() : Date.parse(m.ts)
    if (!Number.isFinite(t) || t < lo || t > hi) outside++
  }
  return outside
}
