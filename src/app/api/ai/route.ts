import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_TEXT = 4000
const TIMEOUT_MS = 25_000

const TRANSLATE_PROMPT =
  "You are a translation engine. Detect the language of the user's text and translate it into English. Reply with ONLY the translated text — no quotes, no explanations, no language name. If the text is already English, improve clarity slightly and return it."

const EXPLAIN_PROMPT =
  'You help someone understand a chat message. In at most 120 words, explain what the message means: its intent/tone, any slang, abbreviations, cultural references or implied meaning. Be direct and friendly. Reply in plain text without markdown headers.'

/**
 * POST /api/ai
 * Body: { mode: 'translate' | 'explain', text: string }
 * Runs the text through the AI backend and returns the plain-text result.
 */
export async function POST(req: NextRequest) {
  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const { mode, text } = (payload ?? {}) as {
    mode?: unknown
    text?: unknown
  }

  if (mode !== 'translate' && mode !== 'explain') {
    return NextResponse.json(
      { error: 'Field "mode" must be "translate" or "explain"' },
      { status: 400 }
    )
  }
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

  const systemPrompt = mode === 'translate' ? TRANSLATE_PROMPT : EXPLAIN_PROMPT
  const trimmed = text.trim()

  try {
    const result = await Promise.race([
      (async () => {
        const zai = await ZAI.create()
        const completion = await zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: systemPrompt },
            { role: 'user', content: trimmed },
          ],
          thinking: { type: 'disabled' },
        })
        return completion.choices[0]?.message?.content ?? ''
      })(),
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
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `AI request failed: ${err.message}`
            : 'AI request failed',
      },
      { status: 502 }
    )
  }
}
