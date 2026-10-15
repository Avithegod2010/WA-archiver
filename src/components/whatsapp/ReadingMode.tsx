'use client'

/**
 * Reading mode (backlog idea #18) — distraction-free chat view.
 *
 * A full-screen overlay that renders the transcript as clean,
 * book-style typography: no bubbles, no chrome, adjustable font size and
 * line height, three column widths, and a gentle auto-scroll for long
 * exports (rAF glide, reduced-motion fallback, pauses on user scroll).
 *
 * Prefs persist in localStorage (`wa-viewer:reading-prefs`). Keyboard:
 * Esc closes, Space toggles auto-scroll, +/− step the font size.
 *
 * The component mounts ONLY while open (parent renders it conditionally),
 * so every open starts from a fresh scroll position and saved prefs.
 *
 * Very long chats render the LAST 2500 messages (reading is linear; the
 * regular chat view / timeline scrubber cover jumps).
 */

import './chat-extras.css'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AArrowDown,
  AArrowUp,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  Pause,
  Play,
  Plus,
  Settings2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ChatMessage } from './types'
import { colorForName } from './types'

const PREFS_KEY = 'wa-viewer:reading-prefs'
const RENDER_CAP = 2500

type WidthKey = 's' | 'm' | 'l'

const WIDTH_CLASS: Record<WidthKey, string> = {
  s: 'max-w-xl',
  m: 'max-w-3xl',
  l: 'max-w-5xl',
}
const WIDTH_ICON: Record<WidthKey, typeof AlignLeft> = {
  s: AlignLeft,
  m: AlignCenter,
  l: AlignRight,
}
const WIDTH_ORDER: WidthKey[] = ['s', 'm', 'l']

/** Auto-scroll speeds (px/s) — gentle by design. */
const AUTO_SPEEDS = [
  { label: 'Slow', pps: 35 },
  { label: 'Steady', pps: 70 },
  { label: 'Brisk', pps: 140 },
] as const

interface ReadingPrefs {
  fontPx: number
  lh: number
  width: WidthKey
  autoIdx: number
}

const DEFAULT_PREFS: ReadingPrefs = {
  fontPx: 16.5,
  lh: 1.75,
  width: 'm',
  autoIdx: 1,
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function readPrefs(): ReadingPrefs {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFS }
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const p = JSON.parse(raw) as Partial<ReadingPrefs>
    return {
      fontPx: clamp(Number(p.fontPx) || DEFAULT_PREFS.fontPx, 13, 24),
      lh: clamp(Number(p.lh) || DEFAULT_PREFS.lh, 1.4, 2.2),
      width: WIDTH_ORDER.includes(p.width as WidthKey)
        ? (p.width as WidthKey)
        : DEFAULT_PREFS.width,
      autoIdx: clamp(Number(p.autoIdx) || 0, 0, AUTO_SPEEDS.length - 1),
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

function writePrefs(p: ReadingPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* best-effort */
  }
}

function fmtDay(ts: string): string {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  })
}

function fmtTime(ts: string): string {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

const MEDIA_ICON: Record<string, string> = {
  image: '📷',
  video: '🎥',
  gif: '🎞',
  audio: '🎤',
  voice: '🎤',
  sticker: '🌟',
  document: '📎',
  contact: '👤',
  location: '📍',
  poll: '📊',
}

export function ReadingMode({
  onClose,
  chatTitle,
  isGroup,
  messages,
}: {
  onClose: () => void
  chatTitle: string
  isGroup: boolean
  messages: ChatMessage[]
}) {
  // Prefs read once at mount — the overlay only ever mounts client-side
  // (parent renders it conditionally), so localStorage is available.
  const [prefs, setPrefs] = useState<ReadingPrefs>(() => readPrefs())
  const [showControls, setShowControls] = useState(true)
  const [auto, setAuto] = useState(false)
  const [progress, setProgress] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const autoRef = useRef(false)

  useEffect(() => {
    autoRef.current = auto
  }, [auto])

  const patch = useCallback((p: Partial<ReadingPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...p }
      writePrefs(next)
      return next
    })
  }, [])

  const visible = useMemo(() => {
    const tail =
      messages.length > RENDER_CAP ? messages.slice(-RENDER_CAP) : messages
    return tail
  }, [messages])

  const finish = useCallback(() => {
    setAuto(false)
    toast.success('End of chat')
  }, [])

  /* --- Auto-scroll loop (rAF glide; fixed steps for reduced motion) --- */
  useEffect(() => {
    if (!auto) return
    const el = scrollRef.current
    if (!el) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const pps = AUTO_SPEEDS[prefs.autoIdx].pps
    let raf = 0
    let interval = 0
    let last = 0

    const tick = (distance: number): boolean => {
      const span = el.scrollHeight - el.clientHeight
      if (span <= 0) return true
      el.scrollTop += distance
      const p = clamp(Math.round((el.scrollTop / span) * 100), 0, 100)
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
      if (tick(pps * dt)) return
      raf = requestAnimationFrame(frame)
    }
    if (reduced) {
      const stepMs = 600
      interval = window.setInterval(() => {
        if (tick(pps * (stepMs / 1000))) window.clearInterval(interval)
      }, stepMs)
    } else {
      raf = requestAnimationFrame(frame)
    }
    return () => {
      if (raf) cancelAnimationFrame(raf)
      if (interval) window.clearInterval(interval)
    }
  }, [auto, prefs.autoIdx, finish])

  /* User scroll intent pauses auto-scroll. */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const pause = () => {
      if (autoRef.current) setAuto(false)
    }
    el.addEventListener('wheel', pause, { passive: true })
    el.addEventListener('touchstart', pause, { passive: true })
    el.addEventListener('pointerdown', pause)
    return () => {
      el.removeEventListener('wheel', pause)
      el.removeEventListener('touchstart', pause)
      el.removeEventListener('pointerdown', pause)
    }
  }, [])

  /* Keyboard: Esc close · Space auto-scroll · +/− font size. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if (typing) return
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === ' ' && !e.shiftKey) {
        e.preventDefault()
        setAuto((v) => !v)
      } else if (e.key === '+' || e.key === '=') {
        patch({ fontPx: clamp(prefs.fontPx + 1, 13, 24) })
      } else if (e.key === '-' || e.key === '_') {
        patch({ fontPx: clamp(prefs.fontPx - 1, 13, 24) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, patch, prefs.fontPx])

  const WidthIcon = WIDTH_ICON[prefs.width]

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-[#faf6ee] text-(--wa-text) dark:bg-[#0b141a] dark:text-(--wa-text)"
      role="dialog"
      aria-modal="true"
      aria-label={`Reading mode — ${chatTitle}`}
    >
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-black/[0.06] px-3 py-2 dark:border-white/10">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--wa-accent)/12 text-(--wa-accent)"
          aria-hidden
        >
          <AArrowUp className="h-4 w-4 rotate-90" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[14px] font-semibold leading-tight">
            {chatTitle}
          </h2>
          <p className="truncate text-[11.5px] leading-tight text-(--wa-text-2)">
            {visible.length.toLocaleString()} messages · reading mode
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowControls((v) => !v)}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
            showControls
              ? 'bg-(--wa-accent)/12 text-(--wa-accent)'
              : 'text-(--wa-text-2) hover:bg-black/5 dark:hover:bg-white/10'
          )}
          aria-label="Toggle reading controls"
          aria-pressed={showControls}
          title="Reading controls"
        >
          <Settings2 className="h-4.5 w-4.5" />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          aria-label="Close reading mode"
          title="Close (Esc)"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* Controls */}
      {showControls && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-black/[0.06] bg-black/[0.02] px-3 py-1.5 dark:border-white/10 dark:bg-white/[0.03]"
          role="toolbar"
          aria-label="Reading display settings"
        >
          <div className="flex items-center gap-1" role="group" aria-label="Font size">
            <CtrlBtn
              onClick={() => patch({ fontPx: clamp(prefs.fontPx - 1, 13, 24) })}
              label="Smaller text (−)"
            >
              <AArrowDown className="h-4 w-4" />
            </CtrlBtn>
            <span className="w-10 text-center text-[11.5px] tabular-nums text-(--wa-text-2)">
              {Math.round(prefs.fontPx)}px
            </span>
            <CtrlBtn
              onClick={() => patch({ fontPx: clamp(prefs.fontPx + 1, 13, 24) })}
              label="Larger text (+)"
            >
              <AArrowUp className="h-4 w-4" />
            </CtrlBtn>
          </div>

          <div className="flex items-center gap-1" role="group" aria-label="Line height">
            <CtrlBtn
              onClick={() => patch({ lh: clamp(prefs.lh - 0.1, 1.4, 2.2) })}
              label="Tighter lines"
            >
              <Minus className="h-4 w-4" />
            </CtrlBtn>
            <span className="w-9 text-center text-[11.5px] tabular-nums text-(--wa-text-2)">
              {prefs.lh.toFixed(1)}×
            </span>
            <CtrlBtn
              onClick={() => patch({ lh: clamp(prefs.lh + 0.1, 1.4, 2.2) })}
              label="Looser lines"
            >
              <Plus className="h-4 w-4" />
            </CtrlBtn>
          </div>

          <CtrlBtn
            onClick={() =>
              patch({
                width:
                  WIDTH_ORDER[
                    (WIDTH_ORDER.indexOf(prefs.width) + 1) % WIDTH_ORDER.length
                  ],
              })
            }
            label="Change column width"
          >
            <WidthIcon className="h-4 w-4" />
          </CtrlBtn>

          <div className="ml-auto flex items-center gap-1.5">
            {auto && (
              <button
                type="button"
                onClick={() =>
                  patch({
                    autoIdx: (prefs.autoIdx + 1) % AUTO_SPEEDS.length,
                  })
                }
                className="rounded-full px-2 py-1 text-[11.5px] font-medium text-(--wa-accent-strong) transition-colors hover:bg-(--wa-accent)/10 dark:text-(--wa-accent)"
                aria-label={`Auto-scroll speed ${AUTO_SPEEDS[prefs.autoIdx].label} — click to change`}
              >
                {AUTO_SPEEDS[prefs.autoIdx].label}
              </button>
            )}
            <button
              type="button"
              onClick={() => setAuto((v) => !v)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-all',
                auto
                  ? 'bg-(--wa-accent) text-white shadow-sm hover:bg-(--wa-accent-strong)'
                  : 'border border-black/10 text-(--wa-text-2) hover:border-(--wa-accent)/40 hover:text-(--wa-accent) dark:border-white/15'
              )}
              aria-pressed={auto}
              title="Auto-scroll (Space)"
            >
              {auto ? (
                <Pause className="h-3.5 w-3.5" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {auto ? 'Pause' : 'Auto-scroll'}
            </button>
            <span
              className="w-10 text-right text-[11.5px] tabular-nums text-(--wa-text-2)"
              aria-live="off"
            >
              {progress}%
            </span>
          </div>
        </div>
      )}

      {/* Transcript */}
      <div
        ref={scrollRef}
        className="wa-scroll wa-reading-body min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => {
          if (autoRef.current) return
          const el = e.currentTarget
          const span = el.scrollHeight - el.clientHeight
          if (span > 0) {
            const p = clamp(Math.round((el.scrollTop / span) * 100), 0, 100)
            setProgress((prev) => (prev === p ? prev : p))
          }
        }}
      >
        <article
          className={cn(
            'mx-auto w-full px-5 pb-24 pt-6 sm:px-8',
            WIDTH_CLASS[prefs.width]
          )}
          style={{
            fontSize: `${prefs.fontPx}px`,
            lineHeight: prefs.lh,
          }}
        >
          {messages.length > RENDER_CAP && (
            <p className="mb-6 rounded-md bg-black/[0.04] px-3 py-2 text-center text-[12px] text-(--wa-text-2) dark:bg-white/[0.06]">
              Showing the last {RENDER_CAP.toLocaleString()} of{' '}
              {messages.length.toLocaleString()} messages — use the regular
              view or the timeline to reach older ones.
            </p>
          )}
          {visible.map((m, i) => {
            if (m.type === 'system') {
              return (
                <p
                  key={m.id}
                  className="my-4 text-center text-[0.78em] font-medium text-(--wa-text-2)"
                >
                  {m.body}
                </p>
              )
            }
            const prev = visible[i - 1]
            const newDay =
              !prev || fmtDay(prev.ts) !== fmtDay(m.ts) || !prev
            const mine = m.sender === 'You'
            const showSender =
              isGroup && !mine && (newDay || (prev && prev.sender !== m.sender))
            const mediaIcon = MEDIA_ICON[m.type]
            const body = m.body?.trim()
            return (
              <div key={m.id}>
                {newDay && fmtDay(m.ts) && (
                  <p className="my-6 text-center">
                    <span className="rounded-full bg-black/[0.05] px-3 py-1 text-[0.72em] font-semibold uppercase tracking-wide text-(--wa-text-2) dark:bg-white/[0.07]">
                      {fmtDay(m.ts)}
                    </span>
                  </p>
                )}
                <div className="group mb-0.5">
                  {showSender && (
                    <p
                      className="mt-3 text-[0.8em] font-semibold"
                      style={{ color: colorForName(m.sender ?? '') }}
                    >
                      {m.sender}
                    </p>
                  )}
                  <p
                    className={cn(
                      'whitespace-pre-wrap break-words',
                      mine && 'text-(--wa-text-2) italic'
                    )}
                  >
                    {body}
                    {!body && mediaIcon && (
                      <span>
                        {mediaIcon} {m.mediaName || 'Attachment'}
                      </span>
                    )}
                    {body && mediaIcon && (
                      <span className="ml-1.5 opacity-70">{mediaIcon}</span>
                    )}
                    {m.starred && <span className="ml-1 opacity-60">★</span>}
                    {m.edited && (
                      <span className="ml-1 text-[0.75em] opacity-50">
                        (edited)
                      </span>
                    )}
                    <span
                      className={cn(
                        'ml-2 select-none align-baseline text-[0.7em] tabular-nums opacity-40',
                        'whitespace-nowrap'
                      )}
                    >
                      {fmtTime(m.ts)}
                    </span>
                  </p>
                </div>
              </div>
            )
          })}
          <p className="mt-10 text-center text-[0.75em] text-(--wa-text-2)">
            ■ end of transcript
          </p>
        </article>
      </div>
    </div>
  )
}

function CtrlBtn({
  onClick,
  label,
  children,
}: {
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-black/5 hover:text-(--wa-text) dark:hover:bg-white/10"
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )
}

export default ReadingMode
