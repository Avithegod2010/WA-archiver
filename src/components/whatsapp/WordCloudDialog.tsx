'use client'

import './stats-extras.css'

import { useEffect, useRef, useState } from 'react'
import { Cloud, CloudOff, TriangleAlert } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useData } from './data-provider'
import { cn } from '@/lib/utils'

/** Warm palette for cloud glyphs — aligned with the app's avatar colors
 *  (no hardcoded blues/indigos). */
const CLOUD_COLORS = [
  '#e542a3',
  '#f2a33c',
  '#12b886',
  '#0ea5a4',
  '#b06ad4',
  '#ef6c6c',
  '#5f9b3f',
  '#c27a3f',
]

interface WordEntry {
  word: string
  count: number
}

/**
 * Per-chat word cloud dialog. Fetches /api/chats/:id/wordcloud when it
 * opens; every word is a large hit-area button that reports the picked
 * word via onPickWord (typically to seed an in-chat search) and closes.
 */
export function WordCloudDialog({
  open,
  onOpenChange,
  chatId,
  chatTitle,
  onPickWord,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  chatId: string
  chatTitle: string
  onPickWord: (word: string) => void
}) {
  // undefined = loading, null = fetch failed, [] / entries = loaded
  const [words, setWords] = useState<WordEntry[] | null | undefined>(undefined)
  // Word counts are a server-side computation — device mode shows a hint
  // instead of a request that has no on-device equivalent.
  const { mode } = useData()

  // Reset the fetch state whenever the dialog opens for a (new) chat.
  // Render-time state adjustment — same pattern GlobalSearch uses.
  const lastKeyRef = useRef<string | null>(null)
  const openKey = open ? chatId : null
  if (lastKeyRef.current !== openKey) {
    lastKeyRef.current = openKey
    setWords(undefined)
  }

  useEffect(() => {
    if (!open || !chatId || mode !== 'server') return
    let alive = true
    fetch(`/api/chats/${chatId}/wordcloud`, { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`status ${r.status}`)
        return r.json()
      })
      .then((d: unknown) => {
        if (!alive) return
        const list = (d as { words?: unknown } | null)?.words
        setWords(
          Array.isArray(list)
            ? list.filter(
                (w): w is WordEntry =>
                  typeof w === 'object' &&
                  w !== null &&
                  typeof (w as { word?: unknown }).word === 'string' &&
                  typeof (w as { count?: unknown }).count === 'number'
              )
            : []
        )
      })
      .catch(() => {
        if (alive) setWords(null)
      })
    return () => {
      alive = false
    }
  }, [open, chatId, mode])

  const loading = words === undefined
  const last = (words?.length ?? 1) - 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="gap-1 border-b border-black/5 px-4 pb-3 pt-4 dark:border-white/5">
          <DialogTitle className="flex items-center gap-2 text-[15.5px]">
            <Cloud className="h-4.5 w-4.5 text-(--wa-accent)" />
            Word cloud
          </DialogTitle>
          <DialogDescription className="truncate">
            Top words in{' '}
            <b className="font-semibold text-(--wa-text)">{chatTitle}</b> — tap
            one to search it in this chat.
          </DialogDescription>
        </DialogHeader>

        <div className="wa-scroll min-h-[160px] flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {mode === 'device' ? (
            <div className="flex flex-col items-center px-4 py-10 text-center">
              <CloudOff className="mb-2 h-6 w-6 text-(--wa-text-2)" />
              <p className="text-[13.5px] font-medium text-(--wa-text)">
                Insights are computed on the server
              </p>
              <p className="mt-1 text-[12px] text-(--wa-text-2)">
                Switch to Server storage in Settings → Data &amp; storage to
                see stats for server-hosted chats.
              </p>
            </div>
          ) : loading ? (
            /* Loading skeleton — pulse blobs + shimmer sweep (stats-extras.css) */
            <div role="status" aria-live="polite" className="px-2 py-4">
              <span className="sr-only">Loading word cloud…</span>
              <div
                className="wa-wc-shimmer flex flex-wrap items-center justify-center gap-2"
                aria-hidden
              >
                {Array.from({ length: 14 }, (_, i) => (
                  <div
                    key={i}
                    className="animate-pulse rounded-full bg-black/[0.07] dark:bg-white/[0.07]"
                    style={{
                      width: `${34 + ((i * 37) % 64)}px`,
                      height: `${16 + ((i * 23) % 18)}px`,
                    }}
                  />
                ))}
              </div>
            </div>
          ) : words === null ? (
            <div className="flex flex-col items-center px-4 py-10 text-center">
              <TriangleAlert className="mb-2 h-6 w-6 text-(--wa-text-2)" />
              <p className="text-[13.5px] font-medium text-(--wa-text)">
                Could not load the word cloud
              </p>
              <p className="mt-1 text-[12px] text-(--wa-text-2)">
                Something went wrong — try again in a moment.
              </p>
            </div>
          ) : words.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-10 text-center">
              <Cloud className="mb-2 h-6 w-6 text-(--wa-text-2)" />
              <p className="text-[13.5px] font-medium text-(--wa-text)">
                No words yet
              </p>
              <p className="mt-1 text-[12px] text-(--wa-text-2)">
                Words from this chat&apos;s text messages will show up here.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-center gap-x-1 gap-y-0">
                {words.map((w, i) => {
                  const rank = last > 0 ? i / last : 1 // 0 = top word
                  const size = Math.round(30 - rank * 18) // 30 → 12px by rank
                  const color = CLOUD_COLORS[i % CLOUD_COLORS.length]
                  return (
                    <button
                      key={w.word}
                      type="button"
                      onClick={() => {
                        onPickWord(w.word)
                        onOpenChange(false)
                      }}
                      title={`${w.count.toLocaleString()} use${w.count === 1 ? '' : 's'} — search in chat`}
                      aria-label={`Search the word ${w.word} in ${chatTitle}`}
                      className={cn(
                        'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg px-2',
                        'font-semibold leading-tight transition-transform hover:scale-110 active:scale-95',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--wa-accent)'
                      )}
                      style={{
                        fontSize: size,
                        color,
                        opacity: 0.55 + (1 - rank) * 0.45,
                      }}
                    >
                      {w.word}
                    </button>
                  )
                })}
              </div>
              <p className="mt-3 text-center text-[10.5px] text-(--wa-text-2)">
                {words.length} word{words.length === 1 ? '' : 's'} · sized by
                how often they appear
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
