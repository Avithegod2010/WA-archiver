'use client'

import './chat-extras.css'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cn } from '@/lib/utils'

export interface ScrubMonth {
  /** yyyy-MM month key (same shape ChatView computes). */
  key: string
  /** Human label, e.g. "Jun 2025". */
  label: string
  /** Messages in this month. */
  count: number
}

/**
 * WhatsApp-archive-style timeline scrubber — a thin vertical track docked at
 * the right edge of the message list with one tick dot per month.
 *
 * Interaction:
 *  - drag (pointer) anywhere on the 44px-wide host → floating bubble under the
 *    pointer shows month + message count; release smooth-scrolls there
 *  - wheel-over steps month by month (non-passive native listener), then jumps
 *    after a short idle
 *  - click a tick (pointer down+up on it) jumps straight to that month
 *  - keyboard: the host is a vertical slider (arrows / Home / End jump months)
 *
 * The scroll↔month mapping is message-weighted: track fractions come from
 * cumulative message counts, so a month holding half the archive occupies half
 * the track — matching how the underlying list actually scrolls.
 */
export function TimelineScrubber({
  months,
  onPick,
  containerRef,
}: {
  months: ScrubMonth[]
  onPick: (key: string) => void
  containerRef: React.RefObject<HTMLDivElement | null>
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const wheelTimerRef = useRef(0)
  const hideTimerRef = useRef(0)
  /** Ref mirror of the active bubble (stable access inside listeners). */
  const activeRef = useRef<{ idx: number; y: number } | null>(null)
  /** Ref mirror of the current (scroll position) month index. */
  const currentIdxRef = useRef(0)
  /** Latest onPick for the native wheel listener (kept fresh via effect). */
  const onPickRef = useRef(onPick)
  useEffect(() => {
    onPickRef.current = onPick
  }, [onPick])

  /** Bubble/active state: month index + bubble Y (px inside the host). */
  const [active, setActive] = useState<{ idx: number; y: number } | null>(null)
  /** Month under the current scroll position (slider aria + cursor dot). */
  const [currentIdx, setCurrentIdx] = useState(0)

  const total = useMemo(() => months.reduce((s, m) => s + m.count, 0), [months])

  /** Track fraction of each month's tick center (message-weighted). */
  const fractions = useMemo(() => {
    const out: number[] = []
    let cum = 0
    for (const m of months) {
      out.push(total > 0 ? Math.min(1, (cum + m.count / 2) / total) : 0)
      cum += m.count
    }
    return out
  }, [months, total])

  /** Month index that owns message number `n` (0-based, document order). */
  const monthForMessage = useCallback(
    (n: number) => {
      let cum = 0
      for (let i = 0; i < months.length; i++) {
        cum += months[i].count
        if (n < cum) return i
      }
      return months.length - 1
    },
    [months]
  )

  /** Track fraction (0..1) → month index. */
  const monthForFraction = useCallback(
    (f: number) => monthForMessage(Math.round(f * Math.max(0, total - 1))),
    [monthForMessage, total]
  )

  /** Host-relative Y for a month's tick. */
  const yForIdx = useCallback((idx: number) => {
    const host = hostRef.current
    const rect = host?.getBoundingClientRect()
    const frac = fractions[idx] ?? 0
    return rect ? frac * rect.height : 0
  }, [fractions])

  /** Show the bubble for a month; optionally auto-hide after N ms. */
  const show = useCallback((idx: number, y: number, autoHideMs?: number) => {
    activeRef.current = { idx, y }
    setActive({ idx, y })
    window.clearTimeout(hideTimerRef.current)
    if (autoHideMs) {
      hideTimerRef.current = window.setTimeout(() => {
        activeRef.current = null
        setActive(null)
      }, autoHideMs)
    }
  }, [])

  const hide = useCallback(() => {
    activeRef.current = null
    setActive(null)
    window.clearTimeout(hideTimerRef.current)
  }, [])

  useEffect(
    () => () => {
      window.clearTimeout(wheelTimerRef.current)
      window.clearTimeout(hideTimerRef.current)
    },
    []
  )

  /* Track the month under the viewport (updates the cursor + slider aria). */
  useEffect(() => {
    const el = containerRef.current
    if (!el || months.length === 0 || total === 0) return
    let raf = 0
    const compute = () => {
      const span = el.scrollHeight - el.clientHeight
      const f = span > 0 ? el.scrollTop / span : 1
      const idx = monthForMessage(Math.round(f * Math.max(0, total - 1)))
      currentIdxRef.current = idx
      setCurrentIdx((prev) => (prev === idx ? prev : idx))
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(compute)
    }
    compute()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('scroll', onScroll)
    }
  }, [containerRef, months.length, monthForMessage, total])

  /* Wheel-over scrubbing — native non-passive listener (React's onWheel is
     passive and cannot preventDefault). Wheel steps months; after a short
     idle the highlighted month is jumped to. */
  useEffect(() => {
    const host = hostRef.current
    if (!host || months.length === 0) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const dir = e.deltaY > 0 ? 1 : -1
      const base = activeRef.current ? activeRef.current.idx : currentIdxRef.current
      const idx = Math.min(Math.max(base + dir, 0), months.length - 1)
      show(idx, yForIdx(idx))
      window.clearTimeout(wheelTimerRef.current)
      wheelTimerRef.current = window.setTimeout(() => {
        const cur = activeRef.current
        hide()
        if (cur) onPickRef.current(months[cur.idx].key)
      }, 450)
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      host.removeEventListener('wheel', onWheel)
      window.clearTimeout(wheelTimerRef.current)
    }
  }, [hide, months, show, yForIdx])

  /* ---------------------------- pointer drag ---------------------------- */

  const monthFromEvent = useCallback(
    (clientY: number): { idx: number; y: number } | null => {
      const host = hostRef.current
      if (!host) return null
      const rect = host.getBoundingClientRect()
      const y = Math.min(Math.max(clientY - rect.top, 0), rect.height)
      const f = rect.height > 0 ? y / rect.height : 0
      return { idx: monthForFraction(f), y }
    },
    [monthForFraction]
  )

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const hit = monthFromEvent(e.clientY)
    if (!hit) return
    draggingRef.current = true
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* pointer already gone */
    }
    show(hit.idx, hit.y)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return
    const hit = monthFromEvent(e.clientY)
    if (!hit) return
    show(hit.idx, hit.y)
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return
    draggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* capture already gone */
    }
    const hit = monthFromEvent(e.clientY)
    hide()
    if (hit) onPick(months[hit.idx].key)
  }

  /* ----------------------------- keyboard ------------------------------- */

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (months.length === 0) return
    let next: number
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = currentIdxRef.current - 1
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight')
      next = currentIdxRef.current + 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = months.length - 1
    else return
    e.preventDefault()
    const idx = Math.min(Math.max(next, 0), months.length - 1)
    currentIdxRef.current = idx
    setCurrentIdx(idx)
    show(idx, yForIdx(idx), 900)
    onPick(months[idx].key)
  }

  if (months.length < 2 || total === 0) return null

  // Clamped view index — guards the first render after a chat switch, where
  // currentIdx can still point past the new (shorter) months list.
  const curIdx = Math.min(Math.max(currentIdx, 0), months.length - 1)
  const activeMonth =
    active && active.idx >= 0 && active.idx < months.length
      ? months[active.idx]
      : null

  return (
    <div
      ref={hostRef}
      className="wa-scrub-host hidden sm:flex"
      role="slider"
      aria-label="Timeline scrubber — jump to month"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={months.length - 1}
      aria-valuenow={curIdx}
      aria-valuetext={`${months[curIdx].label}, ${months[curIdx].count} message${months[curIdx].count === 1 ? '' : 's'}`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onBlur={hide}
    >
      <div className="wa-scrub-line">
        {months.map((m, i) => (
          <span
            key={m.key}
            aria-hidden
            className={cn('wa-scrub-tick', i === curIdx && 'is-active')}
            style={{ top: `${fractions[i] * 100}%` }}
          />
        ))}
        <span
          aria-hidden
          className="wa-scrub-cursor"
          style={{
            top: `${(fractions[curIdx] ?? 0) * 100}%`,
            opacity: active ? 0 : 1,
          }}
        />
      </div>
      {active && activeMonth && (
        <div className="wa-scrub-bubble" role="status" style={{ top: active.y }}>
          {activeMonth.label}
          <span className="wa-scrub-count">
            {' '}
            · {activeMonth.count} msg{activeMonth.count === 1 ? '' : 's'}
          </span>
        </div>
      )}
    </div>
  )
}

export default TimelineScrubber
