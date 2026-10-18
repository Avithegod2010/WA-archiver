'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { Pause, Play, X } from 'lucide-react'
import {
  RATES,
  close as engineClose,
  cycleRate as engineCycleRate,
  fmtTime,
  getState as getEngineState,
  pause as enginePause,
  play as enginePlay,
  subscribe as subscribeEngine,
} from './audio-engine'
import { initialsForName } from './types'
import { cn } from '@/lib/utils'
import './dock-extras.css'

/** Window event fired when the dock body is tapped (contract for ChatView). */
export const DOCK_OPEN_EVENT = 'wa-audio-dock-open'

const RING_R = 22.5
const RING_C = 2 * Math.PI * RING_R

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * Telegram-style floating mini player for voice notes.
 *
 * Appears whenever the shared audio engine holds a track and — unlike the
 * per-bubble players — lives at the app root, so it keeps controlling (and
 * showing) playback across chat switches. Body tap opens the source chat
 * (wa-audio-dock-open { chatId }) and jumps/flashes the message element
 * when one with [data-msg-id="<messageId>"] exists in the DOM.
 */
export function AudioDock({ raised = false }: { raised?: boolean }) {
  const s = useSyncExternalStore(subscribeEngine, getEngineState, getEngineState)
  const flashTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
    }
  }, [])

  const openSource = useCallback(() => {
    if (!s.currentId) return
    window.dispatchEvent(
      new CustomEvent(DOCK_OPEN_EVENT, {
        detail: { chatId: s.chatId, messageId: s.currentId },
      })
    )
    try {
      const sel = `[data-msg-id="${
        typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s.currentId) : s.currentId
      }"]`
      const el = document.querySelector(sel)
      if (el) {
        el.scrollIntoView({
          block: 'center',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        })
        el.classList.remove('wa-dock-flash')
        // Force a reflow so re-taps restart the flash animation.
        void (el as HTMLElement).offsetWidth
        el.classList.add('wa-dock-flash')
        if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
        flashTimerRef.current = window.setTimeout(() => {
          el.classList.remove('wa-dock-flash')
          flashTimerRef.current = null
        }, 1300)
      }
    } catch {
      /* DOM lookup is best-effort — the event is the real contract */
    }
  }, [s.currentId, s.chatId])

  // No track → nothing floats.
  if (!s.currentId) return null

  const title = s.chatTitle || s.sender || 'Voice message'
  const senderPrefix = s.sender && s.sender !== title ? `${s.sender} · ` : ''
  const progress = s.duration > 0 ? Math.min(s.current / s.duration, 1) : 0
  const initials = initialsForName(title)
  const rate = RATES[s.rateIdx]

  return (
    <div
      className={cn(
        'pointer-events-none fixed left-3 z-40',
        // Raised while a chat is open: the composer (input row + optional
        // smart-reply chips) occupies the bottom ~6.5rem of the chat column,
        // so the dock lifts above it instead of covering the "+"/mic buttons.
        raised
          ? 'bottom-[7.5rem] sm:bottom-[6.75rem]'
          : 'bottom-[calc(3rem+env(safe-area-inset-bottom,0px))] sm:bottom-14'
      )}
      role="region"
      aria-label="Voice message mini player"
    >
      <div className="wa-dock-in pointer-events-auto relative flex max-w-[calc(100vw-24px)] items-center gap-1 overflow-hidden rounded-2xl border border-(--wa-line) bg-(--wa-panel) p-2 pr-1 shadow-[0_8px_30px_rgba(11,20,26,0.28)]">
        {/* Body: avatar with progress ring + title/time — tap = open chat */}
        <button
          type="button"
          onClick={openSource}
          aria-label={`Open voice message in ${title}`}
          className="flex min-w-0 items-center gap-2.5 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-(--wa-accent)"
        >
          <span className="relative h-12 w-12 shrink-0">
            <svg
              viewBox="0 0 48 48"
              className="absolute inset-0 h-12 w-12 -rotate-90"
              aria-hidden="true"
            >
              <circle
                cx="24"
                cy="24"
                r={RING_R}
                fill="none"
                strokeWidth="2"
                className="stroke-(--wa-line)"
              />
              <circle
                cx="24"
                cy="24"
                r={RING_R}
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
                stroke="var(--wa-accent)"
                className="wa-dock-ring"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - progress)}
              />
            </svg>
            <span
              aria-hidden="true"
              className={`absolute inset-1 flex items-center justify-center rounded-full text-[13px] font-semibold tracking-wide text-white ${
                s.playing ? 'wa-dock-avatar-pulse' : ''
              }`}
              style={{
                background:
                  'linear-gradient(135deg, var(--wa-accent), var(--wa-accent-strong))',
              }}
            >
              {initials}
            </span>
          </span>
          <span className="flex min-w-0 flex-col justify-center gap-0.5 py-0.5 pr-1 text-left">
            <span className="max-w-[38vw] truncate text-[13px] font-semibold text-(--wa-text) sm:max-w-[220px]">
              {title}
            </span>
            <span className="max-w-[38vw] truncate text-[11px] font-medium tabular-nums text-(--wa-text-2) sm:max-w-[220px]">
              {senderPrefix}
              {fmtTime(s.current)} / {s.duration > 0 ? fmtTime(s.duration) : '--:--'}
            </span>
          </span>
        </button>

        {/* Play / pause */}
        <button
          type="button"
          onClick={() => (s.playing ? enginePause() : enginePlay())}
          aria-label={s.playing ? 'Pause voice message' : 'Play voice message'}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--wa-accent) text-white outline-none focus-visible:ring-2 focus-visible:ring-(--wa-accent) focus-visible:ring-offset-2 focus-visible:ring-offset-(--wa-panel) motion-safe:transition-transform motion-safe:hover:scale-105 motion-safe:active:scale-95"
        >
          {s.playing ? (
            <Pause className="h-4.5 w-4.5 fill-current" />
          ) : (
            <Play className="h-4.5 w-4.5 translate-x-px fill-current" />
          )}
        </button>

        {/* Speed pill (session-wide, same cycle as the bubbles) */}
        <button
          type="button"
          onClick={engineCycleRate}
          aria-label={`Playback speed ${rate}× — tap to change`}
          title="Playback speed (applies to all voice messages)"
          className="flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums text-(--wa-text-2) outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-(--wa-accent) dark:hover:bg-white/10"
        >
          {rate}×
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={engineClose}
          aria-label="Close voice message player"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-(--wa-text-2) outline-none transition-colors hover:bg-black/5 hover:text-(--wa-text) focus-visible:ring-2 focus-visible:ring-(--wa-accent) dark:hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>

        {/* 2px accent progress bar along the pill's bottom edge */}
        <span
          aria-hidden="true"
          className="wa-dock-bar absolute inset-x-0 bottom-0 h-0.5 origin-left bg-(--wa-accent)"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
    </div>
  )
}
