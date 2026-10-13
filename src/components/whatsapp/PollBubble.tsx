'use client'

import { useCallback, useState, useSyncExternalStore } from 'react'
import { BarChart3, Check } from 'lucide-react'
import type { ChatMessage } from './types'
import { cn } from '@/lib/utils'

/**
 * WhatsApp-style interactive poll. Votes are stored locally per device
 * (single user), so the owner can vote and re-vote on any option.
 */

const EVENT = 'wa-pollvote'

function voteKey(id: string) {
  return `wa-pollvote:${id}`
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

function getVote(id: string): number {
  try {
    const v = localStorage.getItem(voteKey(id))
    if (v == null) return -1
    const n = Number(v)
    return Number.isInteger(n) && n >= 0 ? n : -1
  } catch {
    return -1
  }
}

function setVote(id: string, option: number) {
  try {
    localStorage.setItem(voteKey(id), String(option))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT))
}

function clearVote(id: string) {
  try {
    localStorage.removeItem(voteKey(id))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT))
}

export function PollBubble({
  msg,
  outgoing,
}: {
  msg: ChatMessage
  outgoing: boolean
}) {
  const options = msg.pollOptions ?? []
  const getSnapshot = useCallback(() => getVote(msg.id), [msg.id])
  const voted = useSyncExternalStore(subscribe, getSnapshot, () => -1)
  const [changeMode, setChangeMode] = useState(false)

  if (options.length === 0) {
    return (
      <div className="min-w-[200px]">
        <p className="flex items-center gap-1.5 font-medium text-(--wa-text)">
          <BarChart3 className="h-4 w-4 shrink-0" />
          POLL: {msg.body}
        </p>
        <p className="mt-1 text-[12px] text-(--wa-text-2)">
          Poll options are not included in exports
        </p>
      </div>
    )
  }

  const showBars = voted >= 0 && !changeMode

  return (
    <div className="min-w-[230px]">
      <p className="flex items-start gap-1.5 font-medium text-(--wa-text)">
        <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-(--wa-accent)" />
        <span className="whitespace-pre-wrap break-words">{msg.body}</span>
      </p>
      <div className="my-1.5 h-px bg-black/10 dark:bg-white/10" />

      <div className="flex flex-col gap-1">
        {options.map((opt, i) => {
          const isVoted = voted === i
          return showBars ? (
            <div
              key={i}
              className="relative h-6 min-w-0 overflow-hidden rounded-md"
            >
              <div
                className={cn(
                  'absolute inset-y-0 left-0 rounded-md transition-[width] duration-300',
                  outgoing ? 'bg-black/10 dark:bg-white/25' : 'bg-(--wa-accent)/25'
                )}
                style={{ width: isVoted ? '100%' : '0%' }}
              />
              <span className="relative z-10 flex h-full items-center justify-between px-1.5 text-[13.5px] leading-none">
                <span className="truncate">{opt}</span>
                <span className="ml-2 flex shrink-0 items-center gap-1 text-[11.5px] font-semibold tabular-nums text-(--wa-text-2)">
                  {isVoted && '100%'}
                  {isVoted && <Check className="h-3.5 w-3.5 text-(--wa-accent)" />}
                </span>
              </span>
            </div>
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => setVote(msg.id, i)}
              className="group/opt -mx-1 flex items-center gap-2.5 rounded-md px-1 py-1 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              aria-pressed={isVoted}
            >
              <span
                className={cn(
                  'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                  isVoted
                    ? 'border-(--wa-accent) bg-(--wa-accent)'
                    : 'border-(--wa-text-2) group-hover/opt:border-(--wa-accent)'
                )}
              >
                {isVoted && <Check className="h-3 w-3 text-white" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] leading-tight">
                {opt}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-(--wa-text-2)">
        <span>{voted >= 0 ? '1 vote' : 'No votes yet'}</span>
        {voted >= 0 ? (
          <button
            type="button"
            className="font-medium text-(--wa-accent-strong) hover:underline"
            onClick={() => setChangeMode((v) => !v)}
          >
            {changeMode ? 'View results' : 'Change vote'}
          </button>
        ) : (
          <span className="italic opacity-80">Tap to vote</span>
        )}
      </div>
    </div>
  )
}
