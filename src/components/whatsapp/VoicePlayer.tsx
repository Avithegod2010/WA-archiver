'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AudioLines, Copy, Mic, Pause, Play, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  RATES,
  cycleRate as engineCycleRate,
  fmtTime,
  getState as getEngineState,
  load as engineLoad,
  seekBy as engineSeekBy,
  seekRatio as engineSeekRatio,
  subscribe as subscribeEngine,
  toggle as engineToggle,
} from './audio-engine'
import {
  getEmptyPlayedSnapshot,
  getPlayedSnapshot,
  markPlayed,
  subscribePlayed,
} from './unplayed-voice'
import { useData } from './data-provider'

const BAR_COUNT = 26

/** Voice notes already markPlayed() this session (avoids event spam). */
const playedOnce = new Set<string>()

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
 *
 * Playback runs through the shared audio-engine (ONE app-wide element), so
 * a voice note keeps playing when the user switches chats — the floating
 * AudioDock then controls it. This component keeps a hidden metadata-only
 * <audio> to show the duration before the track is ever played; it never
 * plays through the local element.
 *
 * Public props are { src, seed }; chatId/chatTitle/sender are optional
 * context used by the engine/dock and default to '' when unavailable.
 */
export function VoicePlayer({
  src,
  seed,
  chatId = '',
  chatTitle = '',
  sender = '',
}: {
  src: string
  seed: string
  chatId?: string
  chatTitle?: string
  sender?: string
}) {
  const waveRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  /** Seek requested before the engine knows the duration (load-then-seek). */
  const pendingSeekRef = useRef<number | null>(null)

  // Active transport (Phase 2): transcribing needs the server (ffmpeg + the
  // server-side media file), so the button is hidden on-device.
  const { mode: transportMode } = useData()

  // Shared engine state — every VoicePlayer re-renders on engine changes.
  const engine = useSyncExternalStore(subscribeEngine, getEngineState, getEngineState)
  const active = engine.currentId === seed
  const playing = active && engine.playing

  // Played/unplayed map (flips the play button from unplayed blue to accent).
  const playedMap = useSyncExternalStore(
    subscribePlayed,
    getPlayedSnapshot,
    getEmptyPlayedSnapshot
  )
  const unplayed = playedMap[seed] !== 1

  // Duration preview from a metadata-only element while NOT the active track.
  const [localDuration, setLocalDuration] = useState(0)
  const [localFailed, setLocalFailed] = useState(false)

  // AI speech-to-text (additive): idle → loading → done/error per voice note.
  const [transcript, setTranscript] = useState<string | null>(null)
  const [transcribing, setTranscribing] = useState(false)

  const duration = active ? engine.duration : localDuration
  const current = active ? engine.current : 0
  const failed = localFailed || (active && engine.failed)
  const rate = RATES[engine.rateIdx]
  const progress = duration > 0 ? Math.min(current / duration, 1) : 0
  const bars = useMemo(() => barHeights(seed), [seed])

  // Mark a voice note as played on its first successful play this session.
  useEffect(() => {
    if (active && engine.playing && !playedOnce.has(seed)) {
      playedOnce.add(seed)
      markPlayed(seed)
    }
  }, [active, engine.playing, seed])

  // A seek issued while the track was still loading (duration unknown) is
  // applied as soon as the engine reports a duration.
  useEffect(() => {
    if (active && pendingSeekRef.current !== null && engine.duration > 0) {
      const r = pendingSeekRef.current
      pendingSeekRef.current = null
      engineSeekRatio(r)
    }
  }, [active, engine.duration])

  const meta = useMemo(
    () => ({ id: seed, chatId, chatTitle, sender, src }),
    [seed, chatId, chatTitle, sender, src]
  )

  const togglePlay = useCallback(() => {
    if (failed) return
    if (getEngineState().currentId !== seed) engineLoad(meta)
    engineToggle()
  }, [failed, seed, meta])

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const el = waveRef.current
      if (!el || failed) return
      const rect = el.getBoundingClientRect()
      const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
      if (getEngineState().currentId === seed) {
        engineSeekRatio(ratio)
      } else if (localDuration > 0) {
        // Not active yet: load it into the engine (paused) and seek there.
        engineLoad(meta)
        pendingSeekRef.current = ratio
      }
    },
    [failed, seed, localDuration, meta]
  )

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
    if (failed) return
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const delta = e.key === 'ArrowLeft' ? -5 : 5
      if (getEngineState().currentId === seed) {
        engineSeekBy(delta)
      } else if (delta > 0 && localDuration > 0) {
        // Nothing to rewind on an unstarted track — forward jumps load it.
        engineLoad(meta)
        pendingSeekRef.current = Math.min(delta / localDuration, 1)
      }
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      togglePlay()
    }
  }

  function cycleRate() {
    // Session-wide: every VoicePlayer (and the dock) follows the new speed.
    engineCycleRate()
  }

  const transcribe = useCallback(async () => {
    if (transcribing) return
    setTranscribing(true)
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: seed }),
      })
      const data = (await res.json().catch(() => null)) as
        | { text?: string; error?: string }
        | null
      if (!res.ok || !data?.text) {
        throw new Error(data?.error ?? 'Transcription failed')
      }
      setTranscript(data.text)
    } catch {
      toast.error('Transcription failed. Please try again.')
    } finally {
      setTranscribing(false)
    }
  }, [seed, transcribing])

  const copyTranscript = useCallback(async () => {
    if (!transcript) return
    try {
      await navigator.clipboard.writeText(transcript)
      toast.success('Transcript copied')
    } catch {
      toast.error('Could not copy')
    }
  }, [transcript])

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
    <div className="flex min-w-[248px] flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={togglePlay}
        aria-label={
          playing
            ? 'Pause voice message'
            : unplayed
              ? 'Play voice message (unplayed)'
              : 'Play voice message'
        }
        className={cn(
          'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-[0_1px_2px_rgba(11,20,26,0.2)] motion-safe:transition-transform motion-safe:hover:scale-105 motion-safe:active:scale-95',
          unplayed ? 'bg-sky-500' : 'bg-(--wa-accent)'
        )}
      >
        {playing ? (
          <Pause className="h-4 w-4 fill-current" />
        ) : (
          <Play className="h-4 w-4 translate-x-[1px] fill-current" />
        )}
        {unplayed && !playing && (
          <Mic
            aria-hidden="true"
            className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-sky-500 p-px text-white [filter:drop-shadow(0_1px_1px_rgba(11,20,26,0.45))]"
          />
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

      {transportMode !== 'device' && (
        <button
          type="button"
          onClick={transcribe}
          disabled={transcribing}
          aria-busy={transcribing}
          aria-label={transcribing ? 'Transcribing voice message' : 'Transcribe voice message'}
          title="Transcribe voice message"
          className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-black/5 px-2.5 text-[11px] font-semibold text-(--wa-text-2) transition-colors hover:bg-black/10 disabled:cursor-default disabled:opacity-70 dark:bg-white/10 dark:text-(--wa-text-2) dark:hover:bg-white/15"
        >
          {transcribing ? (
            <span aria-hidden="true" className="flex items-center gap-[3px] py-2">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  style={{ animationDelay: `${delay}ms` }}
                  className="h-1 w-1 animate-pulse rounded-full bg-current motion-reduce:animate-none"
                />
              ))}
            </span>
          ) : (
            <AudioLines aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          <span className="hidden min-[420px]:inline">Transcribe</span>
        </button>
      )}

      {/* Metadata-only element: duration preview for tracks not yet played
          through the shared engine (this element never plays). */}
      {!active && (
        <audio
          src={src}
          preload="metadata"
          className="hidden"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            if (isFinite(d)) setLocalDuration(d)
          }}
          onError={() => setLocalFailed(true)}
        />
      )}
      </div>

      {transcript !== null && (
        <div
          aria-live="polite"
          className="rounded-lg bg-black/[0.04] px-3 py-2 dark:bg-white/[0.06]"
        >
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] italic leading-snug text-(--wa-text)/80">
            {transcript}
          </p>
          <div className="mt-1.5 flex items-center gap-1">
            <button
              type="button"
              onClick={copyTranscript}
              className="flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold text-(--wa-text-2) transition-colors hover:bg-black/10 dark:hover:bg-white/10"
            >
              <Copy aria-hidden="true" className="h-3 w-3" />
              Copy
            </button>
            <button
              type="button"
              onClick={() => setTranscript(null)}
              aria-label="Dismiss transcript"
              title="Dismiss transcript"
              className="flex h-6 w-6 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-black/10 dark:hover:bg-white/10"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}