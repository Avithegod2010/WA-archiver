'use client'

import './chat-extras.css'

import { useEffect, useState } from 'react'
import { Clapperboard, FastForward, Pause, Play, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/** px-per-second per speed step (1× → 2× → 4×). */
const SPEEDS = [
  { label: '1×', pps: 60 },
  { label: '2×', pps: 120 },
  { label: '4×', pps: 240 },
] as const

/** Reduced-motion fallback: one discrete jump every 600 ms (no smooth glide). */
const REDUCED_STEP_MS = 600

/**
 * Movie mode — auto-scroll story playback of the chat.
 *
 * Renders its own entry button (round Clapperboard, docked above the composer)
 * and, while active, a slim bottom-center control bar: play/pause, speed cycle
 * (1×/2×/4×), progress % and close. The message list scrolls via a rAF loop;
 * any user wheel/touch/press on the list pauses playback (resume via play).
 * Reaching the bottom auto-closes with an "End of chat" toast.
 *
 * `prefers-reduced-motion` swaps the smooth rAF glide for discrete
 * jump-scroll steps of the same effective speed.
 *
 * The active session is a separate component so every enable starts from a
 * fresh playing/progress state (mount = reset, no refs-during-render tricks).
 */
export function MovieMode({
  containerRef,
  enabled,
  onEnabledChange,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  enabled: boolean
  onEnabledChange: (v: boolean) => void
}) {
  if (!enabled) {
    return (
      <button
        type="button"
        onClick={() => onEnabledChange(true)}
        className="wa-movie-fab wa-iconbtn absolute right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-(--wa-in) text-(--wa-text-2) shadow-[0_1px_3px_rgba(11,20,26,0.3)] transition-transform hover:scale-110 active:scale-95 dark:bg-(--wa-panel-2)"
        style={{ bottom: 'calc(60px + env(safe-area-inset-bottom, 0px))' }}
        aria-label="Movie mode — auto-scroll the chat"
        title="Movie mode — auto-scroll the chat"
      >
        <Clapperboard className="h-5 w-5" />
      </button>
    )
  }
  return (
    <MovieSession containerRef={containerRef} onEnabledChange={onEnabledChange} />
  )
}

/** One playback session — mounted only while movie mode is enabled. */
function MovieSession({
  containerRef,
  onEnabledChange,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  onEnabledChange: (v: boolean) => void
}) {
  const [playing, setPlaying] = useState(true)
  const [speedIdx, setSpeedIdx] = useState(0)
  const [progress, setProgress] = useState(0)

  /* The scroll loop. rAF glide normally; fixed-step jumps for reduced motion. */
  useEffect(() => {
    if (!playing) return
    const el = containerRef.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let interval = 0
    let last = 0

    const finish = () => {
      onEnabledChange(false)
      toast.success('End of chat')
    }

    const tick = (distance: number) => {
      const span = el.scrollHeight - el.clientHeight
      if (span <= 0) {
        finish()
        return true
      }
      el.scrollTop += distance
      const p = Math.min(100, Math.round((el.scrollTop / span) * 100))
      setProgress((prev) => (prev === p ? prev : p))
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
        finish()
        return true
      }
      return false
    }

    const frame = (ts: number) => {
      if (!last) last = ts
      const dt = Math.min(0.1, (ts - last) / 1000)
      last = ts
      if (tick(SPEEDS[speedIdx].pps * dt)) return
      raf = requestAnimationFrame(frame)
    }

    if (reduced) {
      interval = window.setInterval(() => {
        if (tick(SPEEDS[speedIdx].pps * (REDUCED_STEP_MS / 1000))) {
          window.clearInterval(interval)
        }
      }, REDUCED_STEP_MS)
    } else {
      raf = requestAnimationFrame(frame)
    }

    return () => {
      if (raf) cancelAnimationFrame(raf)
      if (interval) window.clearInterval(interval)
    }
  }, [containerRef, onEnabledChange, playing, speedIdx])

  /* Any direct user scroll intent (wheel / touch / press on the list) pauses
     playback. Our own scrollTop writes fire none of these. */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const pause = () => setPlaying(false)
    el.addEventListener('wheel', pause, { passive: true })
    el.addEventListener('touchstart', pause, { passive: true })
    el.addEventListener('pointerdown', pause)
    return () => {
      el.removeEventListener('wheel', pause)
      el.removeEventListener('touchstart', pause)
      el.removeEventListener('pointerdown', pause)
    }
  }, [containerRef])

  return (
    <div
      className="wa-movie-bar absolute z-30 flex items-center gap-0.5 rounded-full border border-black/5 bg-(--wa-panel-2)/95 px-1.5 py-1 shadow-[0_4px_18px_rgba(11,20,26,0.28)] backdrop-blur-sm dark:border-white/10 dark:bg-(--wa-panel-2)/95"
      style={{
        bottom: 'calc(68px + env(safe-area-inset-bottom, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
      }}
      role="toolbar"
      aria-label="Movie mode playback controls"
    >
      <button
        type="button"
        onClick={() => setPlaying((v) => !v)}
        className={cn(
          'wa-iconbtn flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
          'text-(--wa-text) hover:bg-black/5 dark:hover:bg-white/10'
        )}
        aria-label={playing ? 'Pause playback' : 'Resume playback'}
        aria-pressed={playing}
        title={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
      </button>
      <button
        type="button"
        onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
        className={cn(
          'wa-iconbtn flex h-11 shrink-0 items-center gap-1 rounded-full px-2.5',
          'text-[12.5px] font-semibold tabular-nums text-(--wa-text)',
          'hover:bg-black/5 dark:hover:bg-white/10'
        )}
        aria-label={`Playback speed — now ${SPEEDS[speedIdx].label}, click to change`}
        title="Playback speed"
      >
        <FastForward className="h-3.5 w-3.5 text-(--wa-accent)" aria-hidden />
        {SPEEDS[speedIdx].label}
      </button>
      <span
        className="min-w-[44px] shrink-0 text-center text-[12px] font-medium tabular-nums text-(--wa-text-2)"
        aria-live="off"
      >
        {progress}%
      </span>
      <button
        type="button"
        onClick={() => onEnabledChange(false)}
        className={cn(
          'wa-iconbtn flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
          'text-(--wa-text-2) hover:bg-black/5 dark:hover:bg-white/10'
        )}
        aria-label="Close movie mode"
        title="Close"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  )
}

export default MovieMode
