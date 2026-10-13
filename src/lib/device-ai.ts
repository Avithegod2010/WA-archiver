/**
 * Device-transport AI client (Phase 3 of the local-first refactor).
 *
 * On the device storage mode there is no server to proxy through — the
 * standalone APK and the offline PWA have no /api/ai. Instead, AI features
 * call Google's Gemini REST API DIRECTLY with the user's own free API key
 * (Settings → AI). Prompt assembly is shared with the server route via
 * ai-prompts.ts so both transports behave identically.
 *
 * The contract mirrors POST /api/ai:
 *   runDeviceAi({ mode, text })                       → { ok, mode, result }
 *   runDeviceAi({ mode: 'reply', persona, context })  → { ok, mode, result }
 *   runDeviceAi({ mode: 'summarize', context })       → { ok, mode, result }
 *   runDeviceAi({ mode: 'ask', question, history, context }) → { ok, mode, answer }
 *
 * Errors are thrown as plain Errors with the SAME user-facing copy the
 * server route produces, so components can render them unchanged.
 * SSR-safe: callers are client components; key access is window-guarded.
 */

import { getGeminiKey } from './ai-client'
import { isOnline, offlineAiMessage } from './online'
import {
  AiError,
  buildAskPrompt,
  buildReplyPrompt,
  buildSummarizePrompt,
  buildTextPrompt,
  callGemini,
  sanitizeContextLines,
  sanitizePersona,
  type AiMode,
} from './ai-prompts'

/** Device-mode request — a subset of the /api/ai body (no chatId: the
 * transcript always travels inline as `context` lines). */
export interface DeviceAiRequest {
  mode: AiMode
  /** translate/explain */
  text?: string
  /** reply — persona already derived on-device (persona-engine) */
  persona?: string
  /** reply/summarize/ask — "Sender: text" lines, oldest first */
  context?: string[]
  /** ask */
  question?: string
  /** ask — prior turns */
  history?: { q: string; a: string }[]
}

export interface DeviceAiResponse {
  ok: true
  mode: AiMode
  /** translate/explain/reply/summarize */
  result?: string
  /** ask */
  answer?: string
}

/** Error message when no key is stored — AI is BYO-key on the device path. */
export function missingKeyMessage(): string {
  return 'Add your free Gemini API key in Settings → AI — on this device, AI runs directly on Google Gemini with your own key.'
}

/**
 * Run one AI request entirely on the device: validate + build the prompt
 * (shared with the route), then call Gemini directly with the stored key.
 * Throws Error (user-friendly message) on any failure.
 */
export async function runDeviceAi(
  req: DeviceAiRequest,
  opts?: { signal?: AbortSignal }
): Promise<DeviceAiResponse> {
  const mode = req.mode
  const contextLines = sanitizeContextLines(req.context)
  const personaName = sanitizePersona(req.persona)
  const key = getGeminiKey()

  if (
    mode !== 'translate' &&
    mode !== 'explain' &&
    mode !== 'reply' &&
    mode !== 'summarize' &&
    mode !== 'ask'
  ) {
    throw new Error('Unknown AI mode')
  }

  // The device path has no built-in provider — a key is mandatory.
  if (!key) throw new AiError(missingKeyMessage())

  // AI is the one feature that needs the internet — fail fast with a
  // friendly message instead of a raw network error when offline.
  if (!isOnline()) throw new AiError(offlineAiMessage())

  let built: { systemPrompt: string; userText: string }
  try {
    if (mode === 'reply') {
      if (!contextLines) {
        throw new AiError('Field "context" is required on the device transport')
      }
      if (!personaName) {
        throw new AiError('Field "persona" is required with "context"')
      }
      built = buildReplyPrompt(personaName, contextLines.at(-1)?.trim() ?? '')
    } else if (mode === 'summarize') {
      built = buildSummarizePrompt(contextLines ? [...contextLines] : [])
    } else if (mode === 'ask') {
      built = buildAskPrompt(
        contextLines ? [...contextLines] : [],
        req.question,
        req.history
      )
    } else {
      built = buildTextPrompt(mode, req.text)
    }
  } catch (err) {
    if (err instanceof AiError) throw new Error(err.message)
    throw err
  }

  try {
    const result = await callGemini(
      key,
      built.systemPrompt,
      built.userText,
      opts?.signal
    )
    if (mode === 'ask') {
      const answer = result.trim()
      if (!answer) {
        throw new Error('The assistant could not answer. Please try again.')
      }
      return { ok: true, mode, answer }
    }
    return { ok: true, mode, result }
  } catch (err) {
    if (err instanceof AiError) throw new Error(err.message)
    throw err
  }
}
