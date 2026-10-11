'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'

const RATES = [1, 1.5, 2] as const
const BAR_COUNT = 26

/** Only one voice note plays at a time (module-level "who is active" slot). */
const activeAudio: { current: HTMLAudioElement | null } = { current: null }

/**
 * Chosen speed persists across tracks for the whole session:
 * every VoicePlayer starts at the last speed the user picked.
 */
let preferredRateIdx = 0

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function hashSeed(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Deterministic pseudo-random bar heights so each voice note looks unique. */
function barHeights(seed: string): number[] {
  const n = hashSeed(seed) || 1
  const out: number[] = []
  for (let i = 0; i < BAR_COUNT; i++) {
    const v = Math.sin(n * (i + 1) * 12.9898) * 43758.5453
    const frac = v - Math.floor(v)
    out.push(Math.round(5 + frac * 11)) // 5..16px
  }
  return out
}

/**
 * WhatsApp-style voice message player: play/pause, seekable waveform,
 * elapsed/total time and a 1×/1.5×/2× speed toggle.
 */
export function VoicePlayer({
  src,
  seed,
}: {
  src: string
  seed: string
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const waveRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [rateIdx, setRateIdx] = useState(preferredRateIdx)
  const [failed, setFailed] = useState(false)
  const bars = useMemo(() => barHeights(seed), [seed])
  const rate = RATES[rateIdx]

  const progress = duration > 0 ? Math.min(current / duration, 1) : 0

  // Pause (and release the active slot) when the bubble unmounts
  useEffect(() => {
    const a = audioRef.current
    return () => {
      a?.pause()
      if (activeAudio.current === a) activeAudio.current = null
    }
  }, [])

  const togglePlay = useCallback(() => {
    const a = audioRef.current
    if (!a || failed) return
    if (a.paused) {
      if (activeAudio.current && activeAudio.current !== a) {
        activeAudio.current.pause()
      }
      a.playbackRate = rate
      a.play().then(() => {
        activeAudio.current = a
        setPlaying(true)
      }).catch(() => setPlaying(false))
    } else {
      a.pause()
      setPlaying(false)
      if (activeAudio.current === a) activeAudio.current = null
    }
  }, [rate, failed])

  const seekFromClientX = useCallback((clientX: number) => {
    const el = waveRef.current
    const a = audioRef.current
    if (!el || !a || !isFinite(a.duration) || a.duration <= 0) return
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
    a.currentTime = ratio * a.duration
    setCurrent(a.currentTime)
  }, [])

  function onWavePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (failed) return
    draggingRef.current = true
    // Untrusted/synthetic events can throw here — seeking must still work
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* pointer capture unavailable */
    }
    seekFromClientX(e.clientX)
  }
  function onWavePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return
    seekFromClientX(e.clientX)
  }
  function onWavePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer capture unavailable */
    }
  }

  function onWaveKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const a = audioRef.current
    if (!a || failed) return
    const dur = isFinite(a.duration) ? a.duration : 0
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const delta = e.key === 'ArrowLeft' ? -5 : 5
      a.currentTime = Math.min(Math.max(a.currentTime + delta, 0), dur)
      setCurrent(a.currentTime)
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      togglePlay()
    }
  }

  function cycleRate() {
    const next = (rateIdx + 1) % RATES.length
    preferredRateIdx = next
    setRateIdx(next)
    const a = audioRef.current
    if (a) a.playbackRate = RATES[next]
  }

  if (failed) {
    return (
      <div className="flex min-w-[200px] items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/10 text-(--wa-text-2) dark:bg-white/10">
          <Play className="h-3.5 w-3.5" />
        </span>
        <span className="text-[13px] text-(--wa-text-2)">
          Voice message — media unavailable
        </span>
      </div>
    )
  }

  return (
    <div className="flex min-w-[248px] items-center gap-2.5">
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--wa-accent) text-white shadow-[0_1px_2px_rgba(11,20,26,0.2)] transition-transform hover:scale-105 active:scale-95"
      >
        {playing ? (
          <Pause className="h-4 w-4 fill-current" />
        ) : (
          <Play className="h-4 w-4 translate-x-[1px] fill-current" />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
        <div
          ref={waveRef}
          role="slider"
          tabIndex={0}
          aria-label="Voice message position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration) || 0}
          aria-valuenow={Math.round(current)}
          aria-valuetext={`${fmtTime(current)} of ${fmtTime(duration)}`}
          onPointerDown={onWavePointerDown}
          onPointerMove={onWavePointerMove}
          onPointerUp={onWavePointerUp}
          onPointerCancel={() => (draggingRef.current = false)}
          onKeyDown={onWaveKeyDown}
          className="flex h-7 cursor-pointer touch-none items-center gap-[2px] rounded outline-none focus-visible:ring-2 focus-visible:ring-(--wa-accent)/60"
        >
          {bars.map((h, i) => {
            const played = (i + 0.5) / BAR_COUNT <= progress
            return (
              <span
                key={i}
                style={{ height: `${h}px` }}
                className={cn(
                  'w-[3px] shrink-0 rounded-full transition-colors duration-100',
                  played
                    ? 'bg-(--wa-accent)'
                    : 'bg-(--wa-text-2)/45 dark:bg-white/30'
                )}
              />
            )
          })}
        </div>
        <div className="flex items-center justify-between text-[10.5px] font-medium tabular-nums text-(--wa-text-2)">
          <span>{fmtTime(current)}</span>
          <span>{duration > 0 ? fmtTime(duration) : 'voice message'}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={cycleRate}
        aria-label={`Playback speed ${rate}× — tap to change`}
        title="Playback speed (applies to all voice messages)"
        className="flex h-8 shrink-0 items-center rounded-full bg-black/5 px-2.5 text-[11px] font-bold tabular-nums text-(--wa-text-2) transition-colors hover:bg-black/10 dark:bg-white/10 dark:text-(--wa-text-2) dark:hover:bg-white/15"
      >
        {rate}×
      </button>

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(e) => {
          const a = e.currentTarget
          if (isFinite(a.duration)) setDuration(a.duration)
          a.playbackRate = rate
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onEnded={(e) => {
          setPlaying(false)
          setCurrent(0)
          e.currentTarget.currentTime = 0
          if (activeAudio.current === e.currentTarget) {
            activeAudio.current = null
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setFailed(true)}
      />
    </div>
  )
}
