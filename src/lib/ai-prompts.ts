/**
 * Isomorphic AI core — shared by the server route (POST /api/ai) and the
 * device transport's direct-Gemini client (src/lib/device-ai.ts).
 *
 * Everything here is runtime-agnostic: no Node APIs, no DOM, no Prisma —
 * just fetch + timers, so the exact same prompt assembly runs on the server
 * and inside the standalone APK. The route keeps only the parts that touch
 * its database (resolving a chatId into transcript lines) and the built-in
 * provider fallback; the device client keeps only the key lookup.
 */

/** Modes shared by both transports. */
export type AiMode = 'translate' | 'explain' | 'reply' | 'summarize' | 'ask'

/* ---- Tuning constants (kept in lockstep with the route's old values) ---- */

export const MAX_TEXT = 4000
export const GEMINI_TIMEOUT_MS = 12_000
export const MAX_CONTEXT_MESSAGE_CHARS = 400
export const MAX_SUMMARY_INPUT_CHARS = 6000
export const MAX_ASK_TRANSCRIPT_CHARS = 8000
export const MAX_ASK_QUESTION_CHARS = 500
export const MAX_ASK_HISTORY = 6
export const MAX_ASK_TURN_CHARS = 1000

export const TRANSLATE_PROMPT =
  "You are a translation engine. Detect the language of the user's text and translate it into English. Reply with ONLY the translated text — no quotes, no explanations, no language name. If the text is already English, improve clarity slightly and return it."

export const EXPLAIN_PROMPT =
  'You help someone understand a chat message. In at most 120 words, explain what the message means: its intent/tone, any slang, abbreviations, cultural references or implied meaning. Be direct and friendly. Reply in plain text without markdown headers.'

export const SUMMARIZE_PROMPT =
  'You summarize WhatsApp chats into a punchy TL;DR. Use EXACTLY this plain-text format (no markdown, no extra lines):\n' +
  'Overview: one or two sentences about what this conversation is about.\n' +
  '• one short bullet point (up to 6 bullets — key moments, topics, plans or decisions)\n' +
  'Verdict: one fun, punchy one-liner about the chat.\n' +
  "Write in the chat's own language, keep a casual tone, and never invent facts."

export const ASK_PROMPT =
  'You answer questions about an imported WhatsApp chat transcript. Be concise and factual, use only the transcript, refer to people by their sender names, and say clearly when the transcript does not contain the answer.'

/** Short placeholder shown in the transcript for media-only messages. */
export const MEDIA_LABELS: Record<string, string> = {
  image: '[photo]',
  video: '[video]',
  gif: '[GIF]',
  audio: '[voice note]',
  sticker: '[sticker]',
  document: '[document]',
  contact: '[contact card]',
  location: '[location]',
  poll: '[poll]',
  media: '[media]',
  deleted: '[deleted message]',
}

/** Error carrying a user-facing message from prompt validation / Gemini. */
export class AiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiError'
  }
}

/** Visible text of a message; media-only messages get a short placeholder. */
export function messageText(body: string, type: string): string {
  const trimmed = body.trim()
  if (trimmed) return trimmed.slice(0, MAX_CONTEXT_MESSAGE_CHARS)
  return `[${type === 'text' ? 'message' : type}]`
}

/** One "Name: text" transcript line for the summarize/ask modes. */
export function transcriptLine(m: {
  sender: string | null
  body: string
  type: string
}): string {
  const body = m.body.trim()
  const content = body
    ? body.slice(0, MAX_CONTEXT_MESSAGE_CHARS)
    : (MEDIA_LABELS[m.type] ?? `[${m.type || 'message'}]`)
  const name = m.sender?.trim() || 'Unknown'
  return `${name}: ${content}`
}

/**
 * Sanitized context lines from the device transport (null when absent):
 * string-only, each capped at 400 chars, at most 400 lines.
 */
export function sanitizeContextLines(raw: unknown): string[] | null {
  return Array.isArray(raw)
    ? raw
        .filter((l): l is string => typeof l === 'string')
        .map((l) => l.slice(0, MAX_CONTEXT_MESSAGE_CHARS))
        .slice(0, 400)
    : null
}

/** Sanitized persona name (null when absent/blank), capped at 80 chars. */
export function sanitizePersona(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim()
    ? raw.trim().slice(0, 80)
    : null
}

/**
 * Validated prior Q/A pairs for the 'ask' mode: well-formed objects only,
 * strings capped, keeping at most the last 6 pairs.
 */
export function sanitizeAskHistory(raw: unknown): { q: string; a: string }[] {
  if (!Array.isArray(raw)) return []
  const pairs: { q: string; a: string }[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const q = (entry as { q?: unknown }).q
    const a = (entry as { a?: unknown }).a
    if (typeof q !== 'string' || typeof a !== 'string' || !q.trim()) continue
    pairs.push({
      q: q.trim().slice(0, MAX_ASK_TURN_CHARS),
      a: a.trim().slice(0, MAX_ASK_TURN_CHARS),
    })
  }
  return pairs.slice(-MAX_ASK_HISTORY)
}

/* ------------------------------------------------------------------ */
/* Prompt builders — one per mode, all operating on resolved inputs     */
/* ------------------------------------------------------------------ */

export interface BuiltPrompt {
  systemPrompt: string
  userText: string
}

/** 'translate' / 'explain' — plain text in, no transcript. */
export function buildTextPrompt(mode: 'translate' | 'explain', text: unknown): BuiltPrompt {
  if (typeof text !== 'string' || !text.trim()) {
    throw new AiError('Field "text" must be a non-empty string')
  }
  if (text.length > MAX_TEXT) {
    throw new AiError(`Field "text" must be at most ${MAX_TEXT} characters`)
  }
  return { systemPrompt: mode === 'translate' ? TRANSLATE_PROMPT : EXPLAIN_PROMPT, userText: text.trim() }
}

/**
 * 'reply' — persona + the last transcript line. Both transports resolve
 * these before calling (server: DB → messageText; device: context lines).
 */
export function buildReplyPrompt(persona: string, lastLine: string): BuiltPrompt {
  return {
    systemPrompt: `You are ${persona} in a casual WhatsApp chat. Reply naturally to the last message as ${persona} would — match the chat's language, tone and energy. Keep it under 40 words. Output ONLY the reply text.`,
    userText: lastLine || '…',
  }
}

/**
 * 'summarize' — chronological transcript lines (oldest first, newest last),
 * oldest lines dropped first when over the input budget.
 */
export function buildSummarizePrompt(lines: string[]): BuiltPrompt {
  if (lines.length === 0) {
    throw new AiError('This chat has no messages to summarize yet')
  }
  let trimmed = [...lines]
  let transcript = trimmed.join('\n')
  while (transcript.length > MAX_SUMMARY_INPUT_CHARS && trimmed.length > 1) {
    trimmed.shift()
    transcript = trimmed.join('\n')
  }
  return {
    systemPrompt: SUMMARIZE_PROMPT,
    userText: `Summarize this WhatsApp chat:\n\n${transcript}`,
  }
}

/**
 * 'ask' — question + chronological transcript lines + optional prior turns.
 * Over-budget transcripts keep the most recent context.
 */
export function buildAskPrompt(
  lines: string[],
  question: unknown,
  history: unknown
): BuiltPrompt {
  if (typeof question !== 'string' || !question.trim()) {
    throw new AiError('Field "question" must be a non-empty string')
  }
  if (question.length > MAX_ASK_QUESTION_CHARS) {
    throw new AiError(
      `Field "question" must be at most ${MAX_ASK_QUESTION_CHARS} characters`
    )
  }
  if (lines.length === 0) {
    throw new AiError('This chat has no messages to ask about yet')
  }
  let transcript = lines.join('\n')
  if (transcript.length > MAX_ASK_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(-MAX_ASK_TRANSCRIPT_CHARS)
  }
  let askContext = `Chat transcript (oldest first, most recent last):\n\n${transcript}`
  const priorTurns = sanitizeAskHistory(history)
  if (priorTurns.length > 0) {
    askContext +=
      '\n\nEarlier turns of this conversation (oldest first):\n' +
      priorTurns.map((t) => `Q: ${t.q}\nA: ${t.a}`).join('\n')
  }
  return { systemPrompt: `${ASK_PROMPT}\n\n${askContext}`, userText: question.trim() }
}

/* ------------------------------------------------------------------ */
/* Gemini REST call — identical for server passthrough + direct device */
/* ------------------------------------------------------------------ */

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: unknown }[]
    }
  }[]
}

/**
 * One generateContent call against the caller's own Google Gemini key
 * (gemini-2.0-flash). Throws AiError with user-friendly copy on rejection —
 * never leaks the raw HTTP error or the key.
 */
export async function callGemini(
  key: string,
  systemPrompt: string,
  userText: string,
  signal?: AbortSignal
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)
  const onOuterAbort = () => controller.abort()
  signal?.addEventListener('abort', onOuterAbort, { once: true })
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: 'user', parts: [{ text: userText }] }],
          generationConfig: { temperature: 0.7 },
        }),
        signal: controller.signal,
      }
    )
    if (!res.ok) {
      await res.text().catch(() => '') // release the socket
      if (res.status === 400 || res.status === 403) {
        throw new AiError(
          'That Gemini API key was rejected — check it in Settings'
        )
      }
      if (res.status === 429) {
        throw new AiError(
          'Gemini rate limit reached — try again in a minute'
        )
      }
      throw new AiError('Gemini request failed — try again')
    }
    const data = (await res.json().catch(() => null)) as GeminiResponse | null
    const parts = data?.candidates?.[0]?.content?.parts ?? []
    const result = parts
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim()
    if (!result) throw new AiError('Gemini request failed — try again')
    return result
  } catch (err) {
    if (err instanceof AiError) throw err
    // Abort (timeout) or network failure → generic friendly message
    throw new AiError('Gemini request failed — try again')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}
