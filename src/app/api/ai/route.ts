import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { assertAppUnlocked } from '@/lib/server-lock'
import { isRateLimited, clientIpOf } from '@/lib/rate-limit'
import {
  AiError,
  buildAskPrompt,
  buildReplyPrompt,
  buildSummarizePrompt,
  buildTextPrompt,
  callGemini,
  messageText,
  sanitizeContextLines,
  sanitizePersona,
  transcriptLine,
  type AiMode,
} from '@/lib/ai-prompts'

export const runtime = 'nodejs'
export const maxDuration = 60

const TIMEOUT_MS = 25_000
/** Rate limit: 20 AI calls per minute per client (shared limiter). */
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000
const REPLY_CONTEXT_MESSAGES = 12
const SUMMARIZE_CONTEXT_MESSAGES = 80
const ASK_CONTEXT_MESSAGES = 120

/**
 * POST /api/ai
 * Body:
 *   { mode: 'translate' | 'explain', text: string }
 *   { mode: 'reply', chatId: string }
 *   { mode: 'summarize', chatId: string }
 *   { mode: 'ask', chatId: string, question: string,
 *     history?: Array<{ q: string, a: string }> } → { ok, mode, answer }
 * Optional header: x-gemini-key — when present, the request runs through the
 * caller's own Google Gemini key; otherwise the built-in provider is used.
 * Device transport: { context } lines replace the DB lookup (and require
 * { persona } for 'reply'). Returns { ok, mode, result } ('ask' returns
 * { ok, mode, answer }).
 */
export async function POST(req: NextRequest) {
  // Server-side app lock — protects every mode (Task 14-e).
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  // Rate limit — AI calls are expensive (server provider cost + latency).
  if (isRateLimited(clientIpOf(req), RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json(
      { error: 'Too many AI requests — please wait a moment' },
      { status: 429 }
    )
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { mode, text, chatId, question, history, context, persona } = (payload ?? {}) as {
    mode?: unknown
    text?: unknown
    chatId?: unknown
    question?: unknown
    history?: unknown
    /**
     * Pre-built transcript lines ("Sender: text", oldest first) from the
     * device transport — replaces the server-side DB context lookup.
     */
    context?: unknown
    /** Explicit reply persona (device transport already picked one). */
    persona?: unknown
  }

  /** Sanitized context lines from the device transport (null when absent). */
  const contextLines = sanitizeContextLines(context)
  const personaName = sanitizePersona(persona)

  if (
    mode !== 'translate' &&
    mode !== 'explain' &&
    mode !== 'reply' &&
    mode !== 'summarize' &&
    mode !== 'ask'
  ) {
    return NextResponse.json(
      {
        error:
          'Field "mode" must be "translate", "explain", "reply", "summarize" or "ask"',
      },
      { status: 400 }
    )
  }
  const aiMode = mode as AiMode

  /** Build (systemPrompt, userText); DB-backed modes resolve chatId first. */
  let built: { systemPrompt: string; userText: string }
  try {
    if (aiMode === 'reply') {
      if (contextLines) {
        // Device transport: transcript provided inline, no DB access.
        if (!personaName) {
          return NextResponse.json(
            { error: 'Field "persona" is required with "context"' },
            { status: 400 }
          )
        }
        built = buildReplyPrompt(personaName, contextLines.at(-1)?.trim() ?? '')
      } else {
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
        const fallbackPersona = recentDesc.find(
          (m) => m.sender && m.sender !== 'You' && m.sender.trim()
        )?.sender
        if (!fallbackPersona) {
          return NextResponse.json(
            { error: 'No one to reply as' },
            { status: 400 }
          )
        }
        const last = recentDesc[0]
        const lastText = messageText(last.body, last.type)
        built = buildReplyPrompt(
          fallbackPersona,
          last.sender ? `${last.sender}: ${lastText}` : lastText
        )
      }
    } else if (aiMode === 'summarize') {
      let lines: string[]
      if (contextLines) {
        // Device transport: transcript provided inline, no DB access.
        lines = [...contextLines]
      } else {
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
        // Chronological transcript, newest at the bottom.
        lines = [...recentDesc].reverse().map(transcriptLine)
      }
      built = buildSummarizePrompt(lines)
    } else if (aiMode === 'ask') {
      let askLines: string[]
      if (contextLines) {
        // Device transport: transcript provided inline, no DB access.
        askLines = [...contextLines]
      } else {
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
          take: ASK_CONTEXT_MESSAGES,
          select: { sender: true, body: true, type: true },
        })
        // Chronological transcript; system rows are skipped, media-only
        // messages become short placeholders.
        askLines = [...recentDesc]
          .reverse()
          .filter((m) => m.type !== 'system')
          .map(transcriptLine)
      }
      built = buildAskPrompt(askLines, question, history)
    } else {
      built = buildTextPrompt(aiMode, text)
    }
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    throw err
  }

  const { systemPrompt, userText } = built
  const geminiKey = (req.headers.get('x-gemini-key') ?? '').trim()

  try {
    const result = await Promise.race([
      geminiKey
        ? callGemini(geminiKey, systemPrompt, userText)
        : runBuiltIn(systemPrompt, userText),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('__ai_timeout__')),
          TIMEOUT_MS
        )
      ),
    ])

    if (aiMode === 'ask') {
      const answer = result.trim()
      if (!answer) {
        return NextResponse.json(
          { error: 'The assistant could not answer. Please try again.' },
          { status: 502 }
        )
      }
      return NextResponse.json({ ok: true, mode: aiMode, answer })
    }

    return NextResponse.json({ ok: true, mode: aiMode, result })
  } catch (err) {
    if (err instanceof Error && err.message === '__ai_timeout__') {
      return NextResponse.json(
        { error: 'AI request timed out — please try again' },
        { status: 504 }
      )
    }
    if (aiMode === 'ask') {
      // Friendly catch-all for 'ask' — never leaks raw SDK errors.
      return NextResponse.json(
        { error: 'The assistant could not answer. Please try again.' },
        { status: 502 }
      )
    }
    if (err instanceof AiError) {
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
