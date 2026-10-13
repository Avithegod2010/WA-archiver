'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, RefreshCw, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { aiHeaders } from '@/lib/ai-client'
import { runDeviceAi } from '@/lib/device-ai'
import { isOnline, offlineAiMessage } from '@/lib/online'
import { useData } from './data-provider'

interface TldrSummary {
  overview: string
  bullets: string[]
  verdict: string | null
}

/** Parse the model's plain-text reply into overview / bullets / verdict. */
function parseTldr(text: string): TldrSummary {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const bullets: string[] = []
  const overviewLines: string[] = []
  let verdict: string | null = null
  for (const line of lines) {
    if (/^[-•*·]\s+/.test(line)) {
      bullets.push(line.replace(/^[-•*·]\s+/, '').trim())
    } else if (/^verdict\s*[:\-—]/i.test(line)) {
      verdict = line.replace(/^verdict\s*[:\-—]\s*/i, '').trim()
    } else if (/^overview\s*[:\-—]/i.test(line)) {
      overviewLines.push(line.replace(/^overview\s*[:\-—]\s*/i, '').trim())
    } else if (verdict === null) {
      overviewLines.push(line)
    } else {
      overviewLines.push(line)
    }
  }
  return {
    overview: overviewLines.join(' ').trim(),
    bullets: bullets.slice(0, 8),
    verdict,
  }
}

/**
 * Controlled dialog: AI-generated TL;DR of a chat's recent messages.
 * Props: { chatId, open, onOpenChange, onBuildContext? }
 * Server transport: POST /api/ai { mode: 'summarize', chatId } → { ok, result }.
 * Device transport (Phase 3): runDeviceAi calls Gemini directly with the
 * user's own key; the body carries the on-device transcript lines
 * (`context`) via onBuildContext — no server in the loop at all.
 */
export function TldrDialog({
  chatId,
  open,
  onOpenChange,
  onBuildContext,
}: {
  chatId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Device transport only: builds "Sender: text" lines (oldest first). */
  onBuildContext?: () => string[]
}) {
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<TldrSummary | null>(null)
  const [raw, setRaw] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Active transport (Phase 2) — device mode ships the transcript inline.
  const { mode: transportMode } = useData()

  async function run(id: string) {
    setLoading(true)
    setError(null)
    setSummary(null)
    setRaw(null)
    try {
      // Device transport (Phase 3): the transcript lives on-device —
      // runDeviceAi builds the same summarize prompt (ai-prompts.ts) and
      // calls Gemini directly with the user's own key, no server hop.
      // Server transport: the route reads its own DB via chatId.
      const data =
        transportMode === 'device'
          ? await runDeviceAi({
              mode: 'summarize',
              context: onBuildContext ? onBuildContext() : [],
            })
          : await (async () => {
              if (!isOnline()) throw new Error(offlineAiMessage())
              const res = await fetch('/api/ai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...aiHeaders() },
                body: JSON.stringify({ mode: 'summarize', chatId: id }),
              })
              const json = (await res.json().catch(() => null)) as
                | { ok?: boolean; result?: string; error?: string }
                | null
              if (!res.ok || !json?.ok) {
                throw new Error(json?.error ?? 'The AI service did not respond')
              }
              return json
            })()
      const text =
        typeof data.result === 'string' ? data.result : String(data.result ?? '')
      setRaw(text)
      setSummary(parseTldr(text))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Something went wrong — try again'
      )
    } finally {
      setLoading(false)
    }
  }

  // Fresh fetch whenever the dialog opens for a chat.
  useEffect(() => {
    if (!open || !chatId) return
    setLoading(false)
    setError(null)
    setSummary(null)
    setRaw(null)
    void run(chatId)
  }, [open, chatId])

  async function copySummary() {
    const text =
      raw ??
      [
        summary?.overview,
        ...(summary?.bullets ?? []).map((b) => `• ${b}`),
        summary?.verdict ? `Verdict: ${summary.verdict}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied')
    } catch {
      toast.error('Could not copy')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Chat TL;DR</DialogTitle>
          <DialogDescription>
            A quick catch-up of this chat&apos;s latest messages, written by AI.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div
            className="flex items-center justify-center gap-2 py-10"
            role="status"
            aria-live="polite"
          >
            <span className="sr-only">Summarizing the chat…</span>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-2.5 w-2.5 animate-bounce rounded-full bg-(--wa-accent) motion-reduce:animate-none"
                style={{ animationDelay: `${i * 160}ms` }}
                aria-hidden="true"
              />
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col gap-3" role="alert">
            <p className="text-[13px] font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                className="rounded-full"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
              <Button
                className="gap-1.5 rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
                onClick={() => void run(chatId)}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Retry
              </Button>
            </div>
          </div>
        )}

        {!loading && !error && summary && (
          <div
            className="wa-scroll max-h-[52vh] overflow-y-auto pr-0.5"
            aria-live="polite"
            aria-label="Chat summary"
          >
            {summary.overview && (
              <p className="text-[14px] leading-relaxed text-(--wa-text)">
                {summary.overview}
              </p>
            )}

            {summary.bullets.length > 0 && (
              <ul className="mt-3 flex flex-col overflow-hidden rounded-xl border border-(--wa-line) bg-black/[0.03] dark:bg-white/5">
                {summary.bullets.map((bullet, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2.5 border-b border-(--wa-line) px-3 py-2.5 last:border-b-0"
                  >
                    <span
                      className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-(--wa-accent)"
                      aria-hidden="true"
                    />
                    <span className="text-[13.5px] leading-snug text-(--wa-text)">
                      {bullet}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {summary.verdict && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-(--wa-accent)/10 px-3 py-2.5">
                <Sparkles
                  className="h-4 w-4 shrink-0 text-(--wa-accent-strong) dark:text-(--wa-accent)"
                  aria-hidden="true"
                />
                <p className="text-[13px] font-medium italic text-(--wa-text)">
                  {summary.verdict}
                </p>
              </div>
            )}

            {!summary.overview && summary.bullets.length === 0 && !summary.verdict && (
              <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-(--wa-text)">
                {raw || '(empty result)'}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {summary && !loading && !error && (
            <Button
              variant="secondary"
              className="gap-1.5 rounded-full"
              onClick={() => void copySummary()}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy
            </Button>
          )}
          {!loading && !error && (
            <Button
              variant="secondary"
              className="gap-1.5 rounded-full"
              onClick={() => void run(chatId)}
              disabled={loading}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Regenerate
            </Button>
          )}
          <Button
            variant="ghost"
            className="gap-1.5 rounded-full text-(--wa-text-2)"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default TldrDialog
