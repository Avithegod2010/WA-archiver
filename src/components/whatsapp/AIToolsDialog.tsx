'use client'

import './ai-tools.css'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Languages, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { ChatMessage } from './types'

type AiMode = 'translate' | 'explain'

/**
 * AI message tools — translate or explain a single message.
 * Talks to `POST /api/ai` ({ mode, text } → { ok, mode, result }).
 * Media-only messages have no text to analyze, so Run is disabled.
 */
export function AIToolsDialog({
  open,
  onOpenChange,
  message,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  message: ChatMessage | null
}) {
  const [mode, setMode] = useState<AiMode>('translate')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const body = (message?.body ?? '').trim()
  const hasText = body.length > 0

  // Fresh state whenever the target message (or open state) changes
  useEffect(() => {
    setResult(null)
    setError(null)
    setRunning(false)
    setMode('translate')
  }, [message?.id, open])

  async function run() {
    if (!message || !hasText || running) return
    setRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, text: body }),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; result?: string; error?: string }
        | null
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? 'The AI service did not respond')
      }
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="wa-ai-pop sm:max-w-lg">
        <DialogHeader className="wa-ai-rise" style={{ animationDelay: '40ms' }}>
          <DialogTitle>AI message tools</DialogTitle>
          <DialogDescription>
            Translate this message or get a plain-language explanation — runs on
            your own server, nothing is stored.
          </DialogDescription>
        </DialogHeader>

        {/* Quoted message (reply-quote style) */}
        {message && (
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

        {!hasText && (
          <p className="text-[12.5px] text-(--wa-text-2)">
            This message has no text to analyze.
          </p>
        )}

        {error && (
          <p
            className="wa-ai-rise text-[12.5px] font-medium text-rose-600 dark:text-rose-400"
            role="alert"
          >
            {error} — press Run to retry.
          </p>
        )}

        {/* Loading skeleton with a shimmer sweep */}
        {running && (
          <div
            className="wa-ai-shimmer wa-ai-rise rounded-lg border border-(--wa-line) bg-black/[0.03] p-3 dark:bg-white/5"
            aria-hidden="true"
          >
            <div className="h-3 w-2/3 rounded-full bg-black/10 dark:bg-white/10" />
            <div className="mt-2 h-3 w-5/6 rounded-full bg-black/10 dark:bg-white/10" />
            <div className="mt-2 h-3 w-1/2 rounded-full bg-black/10 dark:bg-white/10" />
          </div>
        )}

        {result !== null && !error && (
          <div
            className="wa-ai-rise wa-scroll max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-(--wa-line) bg-black/[0.03] p-3 text-[13.5px] leading-relaxed text-(--wa-text) dark:bg-white/5"
            aria-live="polite"
            aria-label="AI result"
          >
            {result || '(empty result)'}
          </div>
        )}

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
      </DialogContent>
    </Dialog>
  )
}
