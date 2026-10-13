'use client'

import './ai-tools.css'

import { Fragment, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Copy,
  Languages,
  MessageCircleQuestion,
  RotateCcw,
  SendHorizontal,
  Trash2,
  Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { aiHeaders, getGeminiKey } from '@/lib/ai-client'
import { runDeviceAi } from '@/lib/device-ai'
import { isOnline, offlineAiMessage } from '@/lib/online'
import { useData } from './data-provider'
import type { ChatMessage } from './types'

type AiMode = 'ask' | 'translate' | 'explain'

type AskTurn = { q: string; a: string }

const MAX_ASK_QUESTION = 500
const MAX_ASK_TURNS = 6

const SUGGESTED_QUESTIONS = [
  'What did we agree on?',
  'List any dates or times mentioned',
  'Who owes whom money?',
  'What are the main topics?',
]

/**
 * AI message tools — ask AI questions about the whole chat transcript, or
 * translate/explain a single message.
 * Server transport talks to `POST /api/ai` ({ mode, … } → { ok, mode, result
 * | answer }); the 'ask' body lets the route read its own DB.
 * Device transport (Phase 3): no server in the loop — runDeviceAi builds the
 * SAME prompt (ai-prompts.ts) and calls Gemini directly with the user's own
 * key; the 'ask' body carries the on-device transcript lines (`context`).
 * Media-only messages have no text to analyze, so Run is disabled.
 */
export function AIToolsDialog({
  open,
  onOpenChange,
  message,
  chatId,
  onBuildContext,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  message: ChatMessage | null
  /** Chat whose transcript the Ask tab answers from (wired by ChatView). */
  chatId?: string
  /** Device transport only: builds "Sender: text" lines (oldest first). */
  onBuildContext?: () => string[]
}) {
  const [mode, setMode] = useState<AiMode>('ask')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hasKey, setHasKey] = useState(false)
  // Active transport (Phase 2) — device mode ships the transcript inline.
  const { mode: transportMode } = useData()

  // Ask-tab conversation state — kept across tab switches and dialog
  // close/reopen while this component stays mounted. (ChatView remounts it
  // per chat via `key={activeId}`, so threads never bleed across chats.)
  const [turns, setTurns] = useState<AskTurn[]>([])
  const [pendingQ, setPendingQ] = useState<string | null>(null)
  const [askPending, setAskPending] = useState(false)
  const [askError, setAskError] = useState<{ q: string; message: string } | null>(
    null
  )
  const [askInput, setAskInput] = useState('')
  const threadRef = useRef<HTMLDivElement | null>(null)
  const threadChatRef = useRef<string | null>(null)

  const body = (message?.body ?? '').trim()
  const hasText = body.length > 0

  // Fresh translate/explain state whenever the target message (or open state)
  // changes. The Ask thread is deliberately NOT reset here — it belongs to the
  // whole chat and survives tab switches + close/reopen.
  useEffect(() => {
    setResult(null)
    setError(null)
    setRunning(false)
    setMode('ask')
    if (open) setHasKey(!!getGeminiKey())
  }, [message?.id, open])

  // Reset the thread if the dialog ever moves to a different chat.
  useEffect(() => {
    if (threadChatRef.current && chatId !== threadChatRef.current) {
      setTurns([])
      setAskError(null)
    }
    if (chatId) threadChatRef.current = chatId
  }, [chatId])

  // Keep the thread pinned to the newest bubble while it grows.
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }, [mode, turns.length, pendingQ, askError])

  async function run() {
    if (!message || !hasText || running) return
    setRunning(true)
    setError(null)
    try {
      // Device transport: direct Gemini call with the user's own key —
      // same prompt assembly as the route (ai-prompts.ts), no server hop.
      const data =
        transportMode === 'device'
          ? await runDeviceAi({ mode, text: body })
          : await (async () => {
              if (!isOnline()) throw new Error(offlineAiMessage())
              const res = await fetch('/api/ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...aiHeaders() },
                body: JSON.stringify({ mode, text: body }),
              })
              const json = (await res.json().catch(() => null)) as
                | { ok?: boolean; result?: string; error?: string }
                | null
              if (!res.ok || !json?.ok) {
                throw new Error(json?.error ?? 'The AI service did not respond')
              }
              return json
            })()
      setResult(typeof data.result === 'string' ? data.result : String(data.result ?? ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — try again')
    } finally {
      setRunning(false)
    }
  }

  async function copyResult() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result)
      toast.success('Copied')
    } catch {
      toast.error('Could not copy')
    }
  }

  /** Send one question to POST /api/ai { mode: 'ask' } (chips, Enter or Retry). */
  async function sendQuestion(raw: string) {
    const q = raw.trim()
    if (!q || !chatId || askPending || q.length > MAX_ASK_QUESTION) return
    const sentChatId = chatId
    setAskError(null)
    setAskInput('')
    setPendingQ(q)
    setAskPending(true)
    try {
      const history = turns
        .slice(-MAX_ASK_TURNS)
        .map((t) => ({ q: t.q, a: t.a }))
      // Device transport: the transcript lives on-device — runDeviceAi ships
      // the context lines (oldest first) straight to Gemini with the user's
      // key. Server transport: the route reads its own DB via chatId.
      const context =
        transportMode === 'device' && onBuildContext ? onBuildContext() : null
      const data =
        transportMode === 'device'
          ? await runDeviceAi({ mode: 'ask', question: q, history, context: context ?? [] })
          : await (async () => {
              if (!isOnline()) throw new Error(offlineAiMessage())
              const res = await fetch('/api/ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...aiHeaders() },
                body: JSON.stringify({
                  mode: 'ask',
                  chatId: sentChatId,
                  question: q,
                  history,
                }),
              })
              const json = (await res.json().catch(() => null)) as
                | { ok?: boolean; answer?: string; error?: string }
                | null
              if (!res.ok || !json?.ok) {
                throw new Error(
                  json?.error ?? 'The assistant could not answer. Please try again.'
                )
              }
              return json
            })()
      const answer = 'answer' in data ? data.answer : undefined
      if (typeof answer !== 'string' || !answer.trim()) {
        throw new Error('The assistant could not answer. Please try again.')
      }
      // Chat switched mid-request — drop the stale answer.
      if (threadChatRef.current && threadChatRef.current !== sentChatId) return
      setTurns((prev) => [...prev.slice(-MAX_ASK_TURNS), { q, a: answer }])
    } catch (err) {
      setAskError({
        q,
        message: err instanceof Error
          ? err.message
          : 'Something went wrong — try again',
      })
    } finally {
      setPendingQ(null)
      setAskPending(false)
    }
  }

  function clearThread() {
    if (askPending) return
    setTurns([])
    setAskError(null)
    setAskInput('')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="wa-ai-pop sm:max-w-lg">
        <DialogHeader className="wa-ai-rise" style={{ animationDelay: '40ms' }}>
          <DialogTitle>AI message tools</DialogTitle>
          <DialogDescription>
            Ask AI about this chat, or translate/explain a message — runs on
            your own server, nothing is stored.
          </DialogDescription>
        </DialogHeader>

        {!hasKey && (
          <p className="text-[12px] leading-snug text-(--wa-text-2)">
            Tip: add your own Gemini key in Settings → AI
          </p>
        )}

        {/* Quoted message (reply-quote style) — translate/explain only */}
        {mode !== 'ask' && message && (
          <div
            className="wa-ai-rise rounded-md border-l-4 border-(--wa-accent) bg-black/5 p-2 text-[13px] dark:bg-white/5"
            style={{ animationDelay: '110ms' }}
          >
            <p className="text-[12px] font-semibold text-(--wa-accent-strong) dark:text-(--wa-accent)">
              {message.sender ?? 'WhatsApp'}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-(--wa-text)">
              {message.body?.trim() || '[Media message]'}
            </p>
          </div>
        )}

        {/* Mode toggle (segmented) */}
        <div
          className="wa-ai-rise flex gap-1 rounded-full bg-black/5 p-1 dark:bg-white/5"
          style={{ animationDelay: '180ms' }}
          role="tablist"
          aria-label="AI tool mode"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'ask'}
            disabled={running}
            onClick={() => setMode('ask')}
            className={cn(
              'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium transition-colors',
              mode === 'ask'
                ? 'bg-(--wa-accent)/15 text-(--wa-accent-strong) dark:bg-(--wa-accent)/25 dark:text-(--wa-accent)'
                : 'text-(--wa-text-2) hover:bg-black/5 dark:hover:bg-white/10'
            )}
          >
            <MessageCircleQuestion className="h-4 w-4" />
            Ask AI
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'translate'}
            disabled={running}
            onClick={() => setMode('translate')}
            className={cn(
              'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium transition-colors',
              mode === 'translate'
                ? 'bg-(--wa-accent)/15 text-(--wa-accent-strong) dark:bg-(--wa-accent)/25 dark:text-(--wa-accent)'
                : 'text-(--wa-text-2) hover:bg-black/5 dark:hover:bg-white/10'
            )}
          >
            <Languages className="h-4 w-4" />
            Translate
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'explain'}
            disabled={running}
            onClick={() => setMode('explain')}
            className={cn(
              'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium transition-colors',
              mode === 'explain'
                ? 'bg-(--wa-accent)/15 text-(--wa-accent-strong) dark:bg-(--wa-accent)/25 dark:text-(--wa-accent)'
                : 'text-(--wa-text-2) hover:bg-black/5 dark:hover:bg-white/10'
            )}
          >
            <Wand2 className="h-4 w-4" />
            Explain
          </button>
        </div>

        {/* Ask tab — conversational Q&A over the chat transcript */}
        {mode === 'ask' && (
          <div
            className="wa-ai-rise flex flex-col gap-2"
            style={{ animationDelay: '240ms' }}
          >
            <div
              ref={threadRef}
              role="log"
              aria-live="polite"
              aria-label="Ask AI conversation"
              className="wa-scroll flex max-h-[50vh] flex-col gap-2 overflow-y-auto rounded-lg border border-(--wa-line) bg-black/[0.02] p-3 dark:bg-white/[0.04]"
            >
              {turns.length === 0 && !pendingQ && !askError && (
                <div className="flex flex-col gap-2 py-1">
                  <p className="text-[12.5px] leading-snug text-(--wa-text-2)">
                    Ask anything about this chat — answers come only from the
                    transcript.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTED_QUESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={!chatId || askPending}
                        onClick={() => void sendQuestion(s)}
                        className="rounded-full border border-(--wa-line) bg-(--wa-panel) px-3 py-1.5 text-[12.5px] text-(--wa-text) transition-colors hover:border-(--wa-accent) hover:text-(--wa-accent-strong) disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  {!chatId && (
                    <p className="text-[12px] text-(--wa-text-2)">
                      Open this dialog from inside a chat to ask about it.
                    </p>
                  )}
                </div>
              )}

              {turns.map((t, i) => (
                <Fragment key={i}>
                  <AskBubble side="out">{t.q}</AskBubble>
                  <AskBubble side="in">{t.a}</AskBubble>
                </Fragment>
              ))}

              {pendingQ && <AskBubble side="out">{pendingQ}</AskBubble>}
              {pendingQ && (
                <div
                  className="wa-ai-rise max-w-[85%] self-start rounded-2xl rounded-bl-md border border-(--wa-line) bg-black/[0.03] px-3 py-2 text-[13.5px] text-(--wa-text-2) dark:bg-white/5"
                  aria-label="AI is thinking"
                >
                  <span
                    className="wa-ai-dots mr-1 inline-flex items-center gap-1"
                    aria-hidden="true"
                  >
                    <span />
                    <span />
                    <span />
                  </span>
                  Thinking…
                </div>
              )}

              {askError && (
                <div
                  role="alert"
                  className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[12.5px] text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {askError.message}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 gap-1 rounded-full px-2 text-rose-600 hover:bg-rose-100 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/15 dark:hover:text-rose-300"
                    onClick={() => void sendQuestion(askError.q)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                </div>
              )}
            </div>

            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void sendQuestion(askInput)
              }}
            >
              {turns.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0 rounded-full text-(--wa-text-2) hover:bg-black/5 hover:text-(--wa-text) dark:hover:bg-white/10"
                  disabled={askPending}
                  aria-label="Clear conversation"
                  title="Clear conversation"
                  onClick={clearThread}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
              <Input
                value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
                placeholder={
                  chatId ? 'Ask about this chat…' : 'Open from a chat to ask'
                }
                maxLength={MAX_ASK_QUESTION}
                disabled={askPending || !chatId}
                aria-label="Ask AI a question about this chat"
                className="h-10 flex-1 rounded-full border-(--wa-line) bg-black/[0.03] text-[13.5px] dark:bg-white/5"
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Send question"
                disabled={askPending || !chatId || !askInput.trim()}
                className="h-10 w-10 shrink-0 rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
              >
                <SendHorizontal className="h-4 w-4" />
              </Button>
            </form>
          </div>
        )}

        {mode !== 'ask' && !hasText && (
          <p className="text-[12.5px] text-(--wa-text-2)">
            This message has no text to analyze.
          </p>
        )}

        {mode !== 'ask' && error && (
          <p
            className="wa-ai-rise text-[12.5px] font-medium text-rose-600 dark:text-rose-400"
            role="alert"
          >
            {error} — press Run to retry.
          </p>
        )}

        {/* Loading skeleton with a shimmer sweep */}
        {mode !== 'ask' && running && (
          <div
            className="wa-ai-shimmer wa-ai-rise rounded-lg border border-(--wa-line) bg-black/[0.03] p-3 dark:bg-white/5"
            aria-hidden="true"
          >
            <div className="h-3 w-2/3 rounded-full bg-black/10 dark:bg-white/10" />
            <div className="mt-2 h-3 w-5/6 rounded-full bg-black/10 dark:bg-white/10" />
            <div className="mt-2 h-3 w-1/2 rounded-full bg-black/10 dark:bg-white/10" />
          </div>
        )}

        {mode !== 'ask' && result !== null && !error && (
          <div
            className="wa-ai-rise wa-scroll max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-(--wa-line) bg-black/[0.03] p-3 text-[13.5px] leading-relaxed text-(--wa-text) dark:bg-white/5"
            aria-live="polite"
            aria-label="AI result"
          >
            {result || '(empty result)'}
          </div>
        )}

        {mode !== 'ask' && (
          <div
            className="wa-ai-rise flex items-center gap-2"
            style={{ animationDelay: '240ms' }}
          >
            <Button
              className="flex-1 gap-1.5 rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
              disabled={!hasText || running}
              onClick={() => void run()}
            >
              {running ? (
                <>
                  <span
                    className="wa-ai-dots inline-flex items-center gap-1"
                    aria-hidden="true"
                  >
                    <span />
                    <span />
                    <span />
                  </span>
                  Thinking…
                </>
              ) : mode === 'translate' ? (
                'Translate'
              ) : (
                'Explain'
              )}
            </Button>
            {result !== null && !error && (
              <Button
                variant="secondary"
                className="gap-1.5 rounded-full"
                onClick={() => void copyResult()}
              >
                <Copy className="h-4 w-4" />
                Copy
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** One chat-style bubble in the Ask thread (out = user, in = AI). */
function AskBubble({
  side,
  children,
}: {
  side: 'in' | 'out'
  children: string
}) {
  return (
    <div
      className={cn(
        'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13.5px] leading-relaxed text-(--wa-text)',
        side === 'out'
          ? 'self-end rounded-br-md bg-(--wa-out)'
          : 'self-start rounded-bl-md border border-(--wa-line) bg-black/[0.03] dark:bg-white/5'
      )}
    >
      {children}
    </div>
  )
}
