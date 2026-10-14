/**
 * Smart reply suggestions (backlog idea #1) — fully on-device, zero network.
 *
 * Given the tail of a chat's messages, produce up to 3 short tap-to-send
 * replies. This is the offline-capable heuristic core of the feature:
 *
 *   1. The LAST meaningful incoming message (not from "You", not system,
 *      not deleted) decides the intent bucket.
 *   2. Intent buckets: yes/no questions, wh-questions (where/when/what
 *      time/how are you…), greetings, thanks, goodbyes, congratulations,
 *      invitations, apologies, media reactions (photo/video/sticker),
 *      voice notes, location shares, document received.
 *   3. Fallback picks blend generic acknowledgements with a couple of
 *      vocabulary-flavoured options harvested from the chat itself.
 *
 * Determinism: suggestions are seeded by the id of the anchor message so a
 * re-render never swaps the chips under the user's finger, while different
 * messages still produce varied picks. `suggestReplies(messages, salt)` can
 * be re-called with a bumped salt (shuffle button) to rotate the pool.
 */

import type { ChatMessage } from '@/components/whatsapp/types'

/** "You" is the fixed sender name for outgoing messages in this app. */
const SELF = 'You'

const MAX_CHIPS = 3
/** Only look at the last N messages for the anchor + vocabulary. */
const TAIL = 40

type Bucket =
  | 'yesno'
  | 'where'
  | 'when'
  | 'whatTime'
  | 'howAreYou'
  | 'whatDoing'
  | 'canYou'
  | 'didYou'
  | 'greeting'
  | 'thanks'
  | 'bye'
  | 'congrats'
  | 'invitation'
  | 'apology'
  | 'loveCompliment'
  | 'media'
  | 'voice'
  | 'location'
  | 'document'
  | 'poll'
  | 'generic'

const REPLIES: Record<Bucket, string[]> = {
  yesno: ['Yes 👍', 'Nope', 'Maybe 🤔', 'Sure!', 'For sure', 'Not sure yet'],
  where: ['On my way 🚗', 'Almost there', 'Home', 'At work', 'Stuck in traffic'],
  when: ['Tomorrow', 'This weekend', 'Later today', 'In an hour', 'Let you know'],
  whatTime: ['Around 6', 'In an hour', 'Morning works', 'Let me check 🕐'],
  howAreYou: ["I'm good! 😊", 'All good, you?', 'Great! You?', 'Not bad 😄'],
  whatDoing: ['Nothing much', 'Just working', 'Free now', 'Busy — later?'],
  canYou: ['Sure 👍', 'Will do', 'On it', "Sorry, can't right now"],
  didYou: ['Yes, done ✅', 'Not yet', 'On it now', 'Almost finished'],
  greeting: ['Hey! 👋', 'Hello!', 'Hi, how are you?', 'Hey, long time!'],
  thanks: ["You're welcome!", 'Anytime 😊', 'No problem 👍', 'Happy to help!'],
  bye: ['Good night! 🌙', 'Bye! 👋', 'Talk later', 'See you!'],
  congrats: ['Thank you! 🎉', 'Thanks a lot! 🙏', '🎉🎉'],
  invitation: ["I'd love to!", "I'm in 🙌", "Can't today, sorry", 'Maybe, let me check'],
  apology: ['No worries!', "It's fine 😊", 'All good', 'Thanks for letting me know'],
  loveCompliment: ['❤️', 'Aww, thank you! 😊', 'You too! ❤️'],
  media: ['😍', 'Nice! 🔥', 'Looks great!', '😂😂', 'Wow 🤩'],
  voice: ['Will listen now 🎧', 'Got it 👍', 'Listening 🎧'],
  location: ['On my way 📍', 'Got it', 'See you there!'],
  document: ['Got it, thanks 📎', 'Reviewing now', 'Thanks, will read'],
  poll: ['Voted! 🗳', 'Good idea 👍', 'Option 1 for me'],
  generic: ['👍', 'Sounds good', 'Haha 😄', 'True 😅', 'Interesting 🤔', 'Ok!'],
}

/* ------------------------------------------------ detection helpers ------ */

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function isQuestion(b: string): boolean {
  if (b.includes('?')) return true
  return /^(are|is|do|does|did|can|could|will|would|have|has|should|shall|was|were|am)\b/.test(b)
}

/** Detect an intent bucket for one message body. */
function bucketForBody(raw: string): Bucket | null {
  const b = norm(raw)
  if (!b) return null

  if (/\b(happy birthday|happy bday)\b/.test(b)) return 'congrats'
  if (/\b(congrats|congratulations|well done|proud of you)\b/.test(b)) return 'congrats'
  if (/\b(thanks|thank you|thankyou|thx|tysm)\b/.test(b)) return 'thanks'
  if (/^(hi|hello|hey|yo|hiya|good (morning|afternoon|evening))\b/.test(b)) return 'greeting'
  if (/\b(good night|goodnight|gn\b|see (ya|you)|bye|talk (to you )?later)\b/.test(b)) return 'bye'
  if (/\b(sorry|my bad|apologies|forgive me)\b/.test(b)) return 'apology'
  if (/\b(i love you|love you|miss you|you.re (the best|amazing|awesome)|beautiful)\b/.test(b))
    return 'loveCompliment'
  if (/\b(fancy|wanna|want to|up for|join (us|me)|come (over|along)|let.s go)\b/.test(b))
    return 'invitation'
  if (/how (are|r) (you|u)\b|^how.s it going|^hows it going|kaise|kya haal/.test(b)) return 'howAreYou'
  if (/^(what|whats|what.s) (are )?(you|u)\b.*(doing|up to)|^wyd\b|^sup\b/.test(b)) return 'whatDoing'
  if (/\b(what time|what.s the time|whats the time|kt time|timing)\b/.test(b)) return 'whatTime'
  if (/^(where|wer)\b|where (are|r) (you|u)|kahan/.test(b)) return 'where'
  if (/^(when|wb)\b|kab\b/.test(b)) return 'when'
  if (/^(can|could) (you|u)\b|^will (you|u)\b/.test(b)) return 'canYou'
  if (/^(did|have) (you|u)\b|^did u\b/.test(b)) return 'didYou'
  if (isQuestion(b)) return 'yesno'
  return null
}

function bucketForType(type: string): Bucket | null {
  switch (type) {
    case 'image':
    case 'video':
    case 'gif':
    case 'sticker':
      return 'media'
    case 'audio':
    case 'voice':
      return 'voice'
    case 'location':
      return 'location'
    case 'document':
      return 'document'
    case 'poll':
      return 'poll'
    default:
      return null
  }
}

/* ------------------------------------------------- pick machinery -------- */

/** Stable 32-bit string hash (FNV-1a) — seed for the deterministic pick. */
function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Rotating pick: hash decides the starting offset, salt rotates further. */
function pick(pool: string[], seed: number, salt: number, count: number): string[] {
  if (pool.length === 0) return []
  const offset = (seed + salt * 7) % pool.length
  const out: string[] = []
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    out.push(pool[(offset + i) % pool.length])
  }
  return out
}

/** Recent content words from the OTHER side of the chat (flavour fallback). */
function vocabularyFlavour(messages: ChatMessage[]): string[] {
  const stop = new Set([
    'the', 'and', 'you', 'your', 'this', 'that', 'with', 'have', 'what',
    'was', 'are', 'for', 'but', 'not', 'yes', 'okay', 'ok', 'haha', 'lol',
    'will', 'can', 'just', 'like', 'get', 'got', 'one', 'its', "it's",
  ])
  const freq = new Map<string, number>()
  let scanned = 0
  for (let i = messages.length - 1; i >= 0 && scanned < TAIL; i--) {
    const m = messages[i]
    if (!m || !m.sender || m.sender === SELF || m.type !== 'text') continue
    scanned++
    for (const w of norm(m.body).split(/[^a-z']+/)) {
      if (w.length < 4 || w.length > 12 || stop.has(w)) continue
      freq.set(w, (freq.get(w) ?? 0) + 1)
      if (freq.size > 60) break
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([w]) => `${w[0].toUpperCase()}${w.slice(1)}? 👀`)
}

/* ------------------------------------------------------ public API ------- */

/**
 * Suggest up to 3 replies for the given chat tail.
 * `salt` rotates the pool (shuffle button). Deterministic per
 * (anchor message id, salt) so re-renders never reshuffle silently.
 */
export function suggestReplies(messages: ChatMessage[], salt = 0): string[] {
  // Find the anchor: last incoming, meaningful message.
  let anchor: ChatMessage | null = null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m) continue
    if (m.sender && m.sender !== SELF && m.type !== 'system' && m.type !== 'deleted') {
      anchor = m
      break
    }
  }
  if (!anchor) return []

  const bodyBucket = bucketForBody(anchor.body ?? '')
  const typeBucket = bucketForType(anchor.type)
  const bucket: Bucket = bodyBucket ?? typeBucket ?? 'generic'

  const seed = hash32(anchor.id || anchor.ts || String(anchor.idx))
  let pool = REPLIES[bucket]

  // Yes/no questions: append one soft "let me check" style escape hatch.
  if (bucket === 'yesno' && (salt + seed) % 3 === 0) {
    pool = [...pool, 'Let me check']
  }

  const picks = pick(pool, seed, salt, MAX_CHIPS)

  // Generic bucket: swap one chip for a vocabulary-flavoured option.
  if (bucket === 'generic') {
    const flavour = vocabularyFlavour(messages)
    if (flavour.length > 0 && (seed + salt) % 2 === 0) {
      picks[picks.length - 1] = flavour[(seed + salt) % flavour.length]
    }
  }

  return [...new Set(picks)].slice(0, MAX_CHIPS)
}

/** True when the anchor message would produce chips (cheap guard for UI). */
export function hasSmartReplies(messages: ChatMessage[]): boolean {
  return suggestReplies(messages).length > 0
}
