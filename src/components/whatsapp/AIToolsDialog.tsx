'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Languages, Loader2, Wand2 } from 'lucide-react'
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>AI message tools</DialogTitle>
          <DialogDescription>
            Translate this message or get a plain-language explanation — runs on
            your own server, nothing is stored.
          </DialogDescription>
        </DialogHeader>

        {/* Quoted message (reply-quote style) */}
        {message && (
          <div className="rounded-md border-l-4 border-(--wa-accent) bg-black/5 p-2 text-[13px] dark:bg-white/5">
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
          className="flex gap-1 rounded-full bg-black/5 p-1 dark:bg-white/5"
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
            className="text-[12.5px] font-medium text-rose-600 dark:text-rose-400"
            role="alert"
          >
            {error} — press Run to retry.
          </p>
        )}

        {result !== null && !error && (
          <div
            className="wa-scroll max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-(--wa-line) bg-black/[0.03] p-3 text-[13.5px] leading-relaxed text-(--wa-text) dark:bg-white/5"
            aria-live="polite"
            aria-label="AI result"
          >
            {result || '(empty result)'}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            className="flex-1 gap-1.5 rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
            disabled={!hasText || running}
            onClick={() => void run()}
          >
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
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
