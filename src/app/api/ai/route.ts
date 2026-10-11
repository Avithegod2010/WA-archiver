import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_TEXT = 4000
const TIMEOUT_MS = 25_000
const GEMINI_TIMEOUT_MS = 12_000
const REPLY_CONTEXT_MESSAGES = 12
const MAX_CONTEXT_MESSAGE_CHARS = 400
const SUMMARIZE_CONTEXT_MESSAGES = 80
const MAX_SUMMARY_INPUT_CHARS = 6000

const TRANSLATE_PROMPT =
  "You are a translation engine. Detect the language of the user's text and translate it into English. Reply with ONLY the translated text — no quotes, no explanations, no language name. If the text is already English, improve clarity slightly and return it."

const EXPLAIN_PROMPT =
  'You help someone understand a chat message. In at most 120 words, explain what the message means: its intent/tone, any slang, abbreviations, cultural references or implied meaning. Be direct and friendly. Reply in plain text without markdown headers.'

const SUMMARIZE_PROMPT =
  'You summarize WhatsApp chats into a punchy TL;DR. Use EXACTLY this plain-text format (no markdown, no extra lines):\n' +
  'Overview: one or two sentences about what this conversation is about.\n' +
  '• one short bullet point (up to 6 bullets — key moments, topics, plans or decisions)\n' +
  'Verdict: one fun, punchy one-liner about the chat.\n' +
  "Write in the chat's own language, keep a casual tone, and never invent facts."

type AiMode = 'translate' | 'explain' | 'reply' | 'summarize'

/** Short placeholder shown in the transcript for media-only messages. */
const MEDIA_LABELS: Record<string, string> = {
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

/** Error carrying a user-friendly message from the Gemini REST path. */
class GeminiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GeminiError'
  }
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: unknown }[]
    }
  }[]
}

/**
 * POST /api/ai
 * Body:
 *   { mode: 'translate' | 'explain', text: string }
 *   { mode: 'reply', chatId: string }
 *   { mode: 'summarize', chatId: string }
 * Optional header: x-gemini-key — when present, the request runs through the
 * caller's own Google Gemini key; otherwise the built-in provider is used.
 * Returns { ok, mode, result } with the plain-text result.
 */
export async function POST(req: NextRequest) {
  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { mode, text, chatId } = (payload ?? {}) as {
    mode?: unknown
    text?: unknown
    chatId?: unknown
  }

  if (
    mode !== 'translate' &&
    mode !== 'explain' &&
    mode !== 'reply' &&
    mode !== 'summarize'
  ) {
    return NextResponse.json(
      {
        error:
          'Field "mode" must be "translate", "explain", "reply" or "summarize"',
      },
      { status: 400 }
    )
  }

  let systemPrompt: string
  let userText: string

  if (mode === 'reply') {
    if (typeof chatId !== 'string' || !chatId.trim()) {
      return NextResponse.json(
        { error: 'Field "chatId" must be a non-empty string' },
        { status: 400 }
      )
    }
    const chat = await db.chat.findUnique({
      where: { id: chatId },
      select: { id: true },
    })
    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }
    const recentDesc = await db.message.findMany({
      where: { chatId },
      orderBy: { idx: 'desc' },
      take: REPLY_CONTEXT_MESSAGES,
      select: { sender: true, body: true, type: true },
    })
    // Persona: a non-'You' sender from those messages, most recent preferred.
    const persona = recentDesc.find(
      (m) => m.sender && m.sender !== 'You' && m.sender.trim()
    )?.sender
    if (!persona) {
      return NextResponse.json(
        { error: 'No one to reply as' },
        { status: 400 }
      )
    }
    const last = recentDesc[0]
    const lastText = messageText(last.body, last.type)
    systemPrompt = `You are ${persona} in a casual WhatsApp chat. Reply naturally to the last message as ${persona} would — match the chat's language, tone and energy. Keep it under 40 words. Output ONLY the reply text.`
    userText = last.sender ? `${last.sender}: ${lastText}` : lastText
  } else if (mode === 'summarize') {
    if (typeof chatId !== 'string' || !chatId.trim()) {
      return NextResponse.json(
        { error: 'Field "chatId" must be a non-empty string' },
        { status: 400 }
      )
    }
    const chat = await db.chat.findUnique({
      where: { id: chatId },
      select: { id: true },
    })
    if (!chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }
    const recentDesc = await db.message.findMany({
      where: { chatId },
      orderBy: { idx: 'desc' },
      take: SUMMARIZE_CONTEXT_MESSAGES,
      select: { sender: true, body: true, type: true },
    })
    if (recentDesc.length === 0) {
      return NextResponse.json(
        { error: 'This chat has no messages to summarize yet' },
        { status: 400 }
      )
    }
    // Chronological transcript, newest at the bottom; cap the input size by
    // dropping the oldest lines first.
    const lines = [...recentDesc].reverse().map(transcriptLine)
    let transcript = lines.join('\n')
    while (transcript.length > MAX_SUMMARY_INPUT_CHARS && lines.length > 1) {
      lines.shift()
      transcript = lines.join('\n')
    }
    systemPrompt = SUMMARIZE_PROMPT
    userText = `Summarize this WhatsApp chat:\n\n${transcript}`
  } else {
    if (typeof text !== 'string' || !text.trim()) {
      return NextResponse.json(
        { error: 'Field "text" must be a non-empty string' },
        { status: 400 }
      )
    }
    if (text.length > MAX_TEXT) {
      return NextResponse.json(
        { error: `Field "text" must be at most ${MAX_TEXT} characters` },
        { status: 400 }
      )
    }
    systemPrompt = mode === 'translate' ? TRANSLATE_PROMPT : EXPLAIN_PROMPT
    userText = text.trim()
  }

  const geminiKey = (req.headers.get('x-gemini-key') ?? '').trim()

  try {
    const result = await Promise.race([
      geminiKey
        ? runGemini(geminiKey, systemPrompt, userText)
        : runBuiltIn(systemPrompt, userText),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('__ai_timeout__')),
          TIMEOUT_MS
        )
      ),
    ])

    return NextResponse.json({ ok: true, mode, result })
  } catch (err) {
    if (err instanceof Error && err.message === '__ai_timeout__') {
      return NextResponse.json(
        { error: 'AI request timed out — please try again' },
        { status: 504 }
      )
    }
    if (err instanceof GeminiError) {
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? 'AI request failed. Check your connection or API key and try again.'
            : 'AI request failed',
      },
      { status: 502 }
    )
  }
}

/** Built-in provider path (unchanged behavior). */
async function runBuiltIn(
  systemPrompt: string,
  userText: string
): Promise<string> {
  const zai = await ZAI.create()
  const completion = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: systemPrompt },
      { role: 'user', content: userText },
    ],
    thinking: { type: 'disabled' },
  })
  return completion.choices[0]?.message?.content ?? ''
}

/** Caller's own Google Gemini path (gemini-2.0-flash, 12s timeout). */
async function runGemini(
  key: string,
  systemPrompt: string,
  userText: string
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)
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
        throw new GeminiError(
          'That Gemini API key was rejected — check it in Settings'
        )
      }
      if (res.status === 429) {
        throw new GeminiError(
          'Gemini rate limit reached — try again in a minute'
        )
      }
      throw new GeminiError('Gemini request failed — try again')
    }
    const data = (await res.json().catch(() => null)) as GeminiResponse | null
    const parts = data?.candidates?.[0]?.content?.parts ?? []
    const result = parts
      .map((p) => (typeof p?.text === 'string' ? p.text : ''))
      .join('')
      .trim()
    if (!result) throw new GeminiError('Gemini request failed — try again')
    return result
  } catch (err) {
    if (err instanceof GeminiError) throw err
    // Abort (timeout) or network failure → generic friendly message
    throw new GeminiError('Gemini request failed — try again')
  } finally {
    clearTimeout(timer)
  }
}

/** Visible text of a message; media-only messages get a short placeholder. */
function messageText(body: string, type: string): string {
  const trimmed = body.trim()
  if (trimmed) return trimmed.slice(0, MAX_CONTEXT_MESSAGE_CHARS)
  return `[${type === 'text' ? 'message' : type}]`
}

/** One "Name: text" transcript line for the summarize mode. */
function transcriptLine(m: {
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
