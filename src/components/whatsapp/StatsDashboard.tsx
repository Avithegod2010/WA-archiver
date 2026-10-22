'use client'

import './stats-extras.css'

import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  CalendarCheck2,
  CalendarDays,
  Cloud,
  EyeOff,
  Flame,
  HelpCircle,
  Link2,
  Loader2,
  MessageSquare,
  Images,
  Group,
  Search,
  Smile,
  Timer,
  Type,
  HardDrive,
  Quote,
  Trash2,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Avatar } from './Avatar'
import { useData } from './data-provider'
import type { StatsData } from './types'
import { colorForName } from './types'
import { computeStats } from '@/lib/stats-compute'
import { cn } from '@/lib/utils'

const TYPE_LABELS: Record<string, string> = {
  text: 'Text',
  system: 'System',
  image: 'Photos',
  video: 'Videos',
  audio: 'Voice',
  sticker: 'Stickers',
  gif: 'GIFs',
  document: 'Documents',
  call: 'Calls',
  poll: 'Polls',
  location: 'Locations',
  contact: 'Contacts',
  deleted: 'Deleted',
  media: 'Other media',
}

const WEEKDAY_FULL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/* --------------- /api/stats extension types (local, defensive) ---------------
   types.ts holds the shared StatsData shape; these extras arrive from the
   same response but are parsed defensively so an older/cached payload
   missing them degrades to empty sections instead of crashing. */

interface GlobalWordEntry {
  word: string
  count: number
}

interface EmojiLeaderEntry {
  emoji: string
  count: number
  topUser: string
}

interface IgnorePair {
  chatId: string
  chatTitle: string
  aName: string
  bName: string
  aCount: number
  bReplies: number
  leftOnReadPct: number
}

interface ReplySpeedRow {
  senderKey: string
  name: string
  medianMs: number
  count: number
}

interface ReplySpeeds {
  rows: ReplySpeedRow[]
  myMedianMs?: number
}

interface StatsExtras {
  topWordsGlobal?: unknown
  emojiLeaderboard?: unknown
  ignoreGraph?: unknown
  replySpeeds?: unknown
}

function pickArray<T>(value: unknown, is: (v: unknown) => v is T): T[] {
  return Array.isArray(value) ? value.filter(is) : []
}

const isWordEntry = (v: unknown): v is GlobalWordEntry =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { word?: unknown }).word === 'string' &&
  typeof (v as { count?: unknown }).count === 'number'

const isEmojiEntry = (v: unknown): v is EmojiLeaderEntry =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { emoji?: unknown }).emoji === 'string' &&
  typeof (v as { count?: unknown }).count === 'number'

const isIgnorePair = (v: unknown): v is IgnorePair =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { chatTitle?: unknown }).chatTitle === 'string' &&
  typeof (v as { aName?: unknown }).aName === 'string' &&
  typeof (v as { bName?: unknown }).bName === 'string' &&
  typeof (v as { aCount?: unknown }).aCount === 'number' &&
  typeof (v as { bReplies?: unknown }).bReplies === 'number' &&
  typeof (v as { leftOnReadPct?: unknown }).leftOnReadPct === 'number'

const isReplySpeedRow = (v: unknown): v is ReplySpeedRow =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { senderKey?: unknown }).senderKey === 'string' &&
  typeof (v as { name?: unknown }).name === 'string' &&
  typeof (v as { medianMs?: unknown }).medianMs === 'number' &&
  typeof (v as { count?: unknown }).count === 'number'

function parseReplySpeeds(value: unknown): ReplySpeeds | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as { rows?: unknown; myMedianMs?: unknown }
  return {
    rows: pickArray<ReplySpeedRow>(raw.rows, isReplySpeedRow),
    myMedianMs:
      typeof raw.myMedianMs === 'number' && Number.isFinite(raw.myMedianMs)
        ? raw.myMedianMs
        : undefined,
  }
}

/** Warm palette for cloud glyphs (no blues/indigos by design). */
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

/** Ease-out count from 0 → target on mount (KPI numbers). Respects
    prefers-reduced-motion by jumping straight to the target. */
function useCountUp(target: number, delay = 0, duration = 1400): number {
  const [val, setVal] = useState(0)
  useEffect(() => {
    let raf = 0
    let start: number | null = null
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const dur = reduce ? 0 : duration
    const t0 = performance.now() + (reduce ? 0 : delay)
    const step = (now: number) => {
      if (start === null) start = Math.max(now, t0)
      const p = dur === 0 ? 1 : Math.min(1, (now - start) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(Math.round(target * eased))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, delay, duration])
  return val
}

/** Scroll-reveal: flip to true (once) when the element scrolls into view
    inside the dialog's scroll area. Below-fold sections stay frozen at
    frame zero until the user actually reaches them. */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      const raf = requestAnimationFrame(() => setShown(true))
      return () => cancelAnimationFrame(raf)
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      {
        root: (el.closest('.wa-scroll') as HTMLElement | null) ?? null,
        threshold: 0.05,
        rootMargin: '0px 0px -4% 0px',
      }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return { ref, shown }
}

function Kpi({
  icon,
  label,
  value,
  accent,
  countTo,
  countSuffix,
  delay = 0,
}: {
  icon: React.ReactNode
  label: string
  value: string
  accent: string
  /** When set, the number counts up from 0 on mount instead of showing value. */
  countTo?: number
  countSuffix?: string
  delay?: number
}) {
  const animated = useCountUp(countTo ?? 0, delay)
  const display =
    countTo != null ? animated.toLocaleString() + (countSuffix ?? '') : value
  return (
    <div
      className="wa-kpi-pop flex items-center gap-3 rounded-xl border border-black/5 bg-(--wa-panel-2)/60 p-3 dark:border-white/5 dark:bg-(--wa-panel-2)/60"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${accent}1f`, color: accent }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[17px] font-semibold leading-tight tabular-nums text-(--wa-text)">
          {display}
        </p>
        <p className="truncate text-[11.5px] text-(--wa-text-2)">
          {label}
        </p>
      </div>
    </div>
  )
}

function Section({
  title,
  icon,
  children,
  delay = 0,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  delay?: number
}) {
  const { ref, shown } = useReveal<HTMLElement>()
  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className={cn('wa-stats-rise', shown && 'wa-revealed')}
      style={{ animationDelay: `${delay}ms` }}
    >
      <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-(--wa-text-2)">
        {icon}
        {title}
      </h4>
      {children}
    </section>
  )
}

function BarRow({
  label,
  value,
  max,
  total,
  accent = 'var(--wa-accent)',
  leading,
  formatValue,
  delay = 0,
}: {
  label: string
  value: number
  max: number
  total: number
  accent?: string
  leading?: React.ReactNode
  formatValue?: (v: number) => string
  delay?: number
}) {
  const pct = max > 0 ? Math.max((value / max) * 100, 2) : 0
  return (
    <div className="flex items-center gap-2.5">
      {leading}
      <span className="w-24 shrink-0 truncate text-[12.5px] text-(--wa-text)">
        {label}
      </span>
      <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
        <div
          className="wa-bar-grow h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: accent,
            animationDelay: `${delay}ms`,
          }}
        />
      </div>
      <span className="w-14 shrink-0 text-right text-[11.5px] tabular-nums text-(--wa-text-2)">
        {formatValue ? formatValue(value) : value.toLocaleString()}
        {total > 0 && (
          <span className="text-[10px] opacity-70">
            {' '}
            {Math.round((value / total) * 100)}%
          </span>
        )}
      </span>
    </div>
  )
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', {
    month: 'short',
    year: '2-digit',
  })
}

function hourLabel(h: number): string {
  const suffix = h < 12 ? 'am' : 'pm'
  const base = h % 12 === 0 ? 12 : h % 12
  return `${base}${suffix}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** Humanized median reply time: "42s" · "3m 20s" · "2h 05m". */
function fmtMedian(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  if (totalSec < 60) return `${totalSec}s`
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  if (mins < 60) return `${mins}m ${String(secs).padStart(2, '0')}s`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${String(mins % 60).padStart(2, '0')}m`
}

/** Spoken variant for row aria-labels: "42 seconds" / "3 minutes 20 seconds"
 *  / "2 hours 5 minutes" (screen readers shouldn't read "3m 20s"). */
function fmtMedianSpoken(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000))
  if (totalSec < 60)
    return `${totalSec} second${totalSec === 1 ? '' : 's'}`
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  if (mins < 60) {
    return secs > 0
      ? `${mins} minute${mins === 1 ? '' : 's'} ${secs} second${secs === 1 ? '' : 's'}`
      : `${mins} minute${mins === 1 ? '' : 's'}`
  }
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0
    ? `${hrs} hour${hrs === 1 ? '' : 's'} ${rem} minute${rem === 1 ? '' : 's'}`
    : `${hrs} hour${hrs === 1 ? '' : 's'}`
}

/* ------------------------------- Heatmap ------------------------------- */

function Heatmap({ grid, total }: { grid: number[][]; total: number }) {
  const max = Math.max(...grid.flat(), 1)
  const level = (v: number) => {
    if (v === 0) return 0
    const r = v / max
    if (r <= 0.25) return 1
    if (r <= 0.5) return 2
    if (r <= 0.75) return 3
    return 4
  }
  const CELL = [
    'bg-black/[0.06] dark:bg-white/[0.06]',
    'bg-(--wa-accent)/25',
    'bg-(--wa-accent)/50',
    'bg-(--wa-accent)/75',
    'bg-(--wa-accent)',
  ]
  return (
    <div className="rounded-xl bg-(--wa-panel-2)/60 p-3 dark:bg-(--wa-panel-2)/60">
      <div className="flex flex-col gap-[3px]">
        {/* hour ruler */}
        <div
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: '30px repeat(24, minmax(0, 1fr))' }}
        >
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span
              key={h}
              className="text-center text-[7.5px] leading-none text-(--wa-text-2)"
            >
              {h % 6 === 0 ? hourLabel(h) : ''}
            </span>
          ))}
        </div>
        {grid.map((row, day) => (
          <div
            key={day}
            className="wa-heat-row grid gap-[3px]"
            style={{
              gridTemplateColumns: '30px repeat(24, minmax(0, 1fr))',
              animationDelay: `${day * 55}ms`,
            }}
          >
            <span className="text-[9px] leading-[14px] text-(--wa-text-2)">
              {WEEKDAY_FULL[day]}
            </span>
            {row.map((count, hour) => (
              <div
                key={hour}
                title={`${WEEKDAY_FULL[day]} ${hourLabel(hour)} — ${count.toLocaleString()} message${count === 1 ? '' : 's'}`}
                className={cn(
                  'h-[14px] rounded-[2.5px] transition-transform hover:scale-125',
                  CELL[level(count)]
                )}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-(--wa-text-2)">
        <span>Rows = weekdays · columns = hours</span>
        <span className="flex items-center gap-1">
          less
          {CELL.map((c, i) => (
            <span key={i} className={cn('h-2.5 w-2.5 rounded-[2px]', c)} />
          ))}
          more
        </span>
      </div>
      <p className="mt-1 text-right text-[10px] tabular-nums text-(--wa-text-2)">
        {total.toLocaleString()} messages mapped
      </p>
    </div>
  )
}

/* --------------------------- Active hours chart -------------------------- */

function HoursChart({ hours }: { hours: StatsData['hours'] }) {
  const max = Math.max(...hours.map((h) => h.count), 1)
  const peak = hours.reduce((a, b) => (b.count > a.count ? b : a), hours[0])
  const total = hours.reduce((s, h) => s + h.count, 0)
  const nightShare =
    total > 0
      ? Math.round(
          (hours
            .filter((h) => h.hour >= 20 || h.hour < 4)
            .reduce((s, h) => s + h.count, 0) /
            total) *
            100
        )
      : 0
  return (
    <div>
      <div className="flex h-24 items-end gap-[3px] rounded-xl bg-(--wa-panel-2)/60 p-3 dark:bg-(--wa-panel-2)/60">
        {hours.map((h, i) => (
          <div
            key={h.hour}
            className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`${hourLabel(h.hour)}: ${h.count.toLocaleString()}`}
          >
            <div
              className={cn(
                'wa-col-grow w-full rounded-t-[3px] transition-colors',
                h.hour === peak.hour && peak.count > 0
                  ? 'bg-[#f2a33c]'
                  : 'bg-(--wa-accent)/70 group-hover:bg-(--wa-accent)'
              )}
              style={{
                height: `${Math.max((h.count / max) * 100, h.count > 0 ? 4 : 1.5)}%`,
                animationDelay: `${i * 18}ms`,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between px-1 text-[8.5px] text-(--wa-text-2)">
        {[0, 6, 12, 18, 23].map((h) => (
          <span key={h}>{hourLabel(h)}</span>
        ))}
      </div>
      <p className="mt-1.5 text-[12px] text-(--wa-text-2)">
        Busiest hour <b className="text-(--wa-text)">{hourLabel(peak.hour)}</b>
        {nightShare >= 25 ? (
          <> — night owls: {nightShare}% of messages after 8pm.</>
        ) : (
          <> — early birds: {100 - nightShare}% land before 8pm.</>
        )}
      </p>
    </div>
  )
}

/* ------------------------------ Fun facts ------------------------------- */

function FunFact({
  icon,
  value,
  label,
  accent,
  countTo,
  countSuffix,
  delay = 0,
}: {
  icon: React.ReactNode
  value: string
  label: string
  accent: string
  countTo?: number
  countSuffix?: string
  delay?: number
}) {
  const animated = useCountUp(countTo ?? 0, delay)
  const display =
    countTo != null ? animated.toLocaleString() + (countSuffix ?? '') : value
  return (
    <div
      className="wa-kpi-pop flex items-center gap-2.5 rounded-xl border border-black/5 bg-(--wa-panel-2)/60 p-2.5 dark:border-white/5 dark:bg-(--wa-panel-2)/60"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${accent}1f`, color: accent }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold leading-tight tabular-nums text-(--wa-text)">
          {display}
        </p>
        <p className="truncate text-[11px] text-(--wa-text-2)">
          {label}
        </p>
      </div>
    </div>
  )
}

/* ------------------------- Task 10-c additions -------------------------- */

/** Global word cloud — font size scales 12→34px by count rank, with color
 *  + opacity variance. Chips are hoverable only (no click in global stats). */
function WordCloud({ words }: { words: GlobalWordEntry[] }) {
  const last = words.length - 1
  return (
    <div className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-0.5 rounded-xl bg-(--wa-panel-2)/60 px-4 py-4 dark:bg-(--wa-panel-2)/60">
      {words.map((w, i) => {
        const rank = last > 0 ? i / last : 1 // 0 = top word
        const size = Math.round(34 - rank * 22) // 34 → 12px by rank
        const color = CLOUD_COLORS[i % CLOUD_COLORS.length]
        return (
          <span
            key={w.word}
            title={`${w.count.toLocaleString()} use${w.count === 1 ? '' : 's'}`}
            className="wa-chip-in cursor-default font-semibold leading-tight transition-transform hover:scale-110"
            style={{
              fontSize: size,
              color,
              opacity: 0.55 + (1 - rank) * 0.45,
              animationDelay: `${i * 22}ms`,
            }}
          >
            {w.word}
          </span>
        )
      })}
    </div>
  )
}

/** Ranked emoji leaderboard — medal emojis for the top 3, numbers after. */
function EmojiLeaderboard({ rows }: { rows: EmojiLeaderEntry[] }) {
  const medals = ['🥇', '🥈', '🥉']
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map((e, i) => (
        <div
          key={`${e.emoji}-${i}`}
          className="wa-kpi-pop flex items-center gap-3 rounded-xl border border-black/5 bg-(--wa-panel-2)/60 p-2.5 dark:border-white/5 dark:bg-(--wa-panel-2)/60"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <span className="w-7 shrink-0 text-center text-[18px] leading-none">
            {i < 3 ? (
              <span aria-hidden>{medals[i]}</span>
            ) : (
              <span
                className="text-[13px] font-bold tabular-nums text-(--wa-text-2)"
                aria-label={`Rank ${i + 1}`}
              >
                {i + 1}
              </span>
            )}
          </span>
          <span className="shrink-0 text-[26px] leading-none">{e.emoji}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-semibold leading-tight tabular-nums text-(--wa-text)">
              {e.count.toLocaleString()}
              <span className="ml-1 text-[11px] font-normal text-(--wa-text-2)">
                use{e.count === 1 ? '' : 's'}
              </span>
            </p>
            <p className="truncate text-[11px] text-(--wa-text-2)">
              {e.topUser ? (
                <>
                  Top user{' '}
                  <b style={{ color: colorForName(e.topUser) }}>{e.topUser}</b>
                </>
              ) : (
                '—'
              )}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

/** One playful "A leaves B on read" row: Avatar → dashed line with the
 *  % label → ArrowRight → Avatar, plus a bar sized by the percentage. */
function IgnoreRow({ pair, index }: { pair: IgnorePair; index: number }) {
  return (
    <div
      className="wa-kpi-pop rounded-xl border border-black/5 bg-(--wa-panel-2)/60 p-3 dark:border-white/5 dark:bg-(--wa-panel-2)/60"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-center gap-2">
        <span className="flex w-14 shrink-0 flex-col items-center gap-0.5">
          <Avatar name={pair.aName} size={28} />
          <span className="w-full truncate text-center text-[10px] font-medium text-(--wa-text)">
            {pair.aName}
          </span>
        </span>
        <div className="relative h-6 min-w-0 flex-1">
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-(--wa-accent)/40 dark:border-(--wa-accent)/50" />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full bg-(--wa-accent)/10 px-2 py-0.5 text-[10.5px] font-semibold tabular-nums text-(--wa-accent-strong) dark:bg-(--wa-accent)/20">
            {pair.leftOnReadPct}% left on read
          </span>
        </div>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-(--wa-text-2)" />
        <span className="flex w-14 shrink-0 flex-col items-center gap-0.5">
          <Avatar name={pair.bName} size={28} />
          <span className="w-full truncate text-center text-[10px] font-medium text-(--wa-text)">
            {pair.bName}
          </span>
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
        <div
          className="wa-bar-grow h-full rounded-full"
          style={{
            width: `${Math.max(pair.leftOnReadPct, 2)}%`,
            backgroundColor: colorForName(pair.aName),
            animationDelay: `${120 + index * 70}ms`,
          }}
        />
      </div>
      <p className="mt-1.5 truncate text-[11px] text-(--wa-text-2)">
        <b className="text-(--wa-text)">{pair.aName}</b> sent{' '}
        {pair.aCount.toLocaleString()} · {pair.bName} replied to{' '}
        {pair.bReplies.toLocaleString()} · in {pair.chatTitle}
      </p>
    </div>
  )
}

/** One "Fastest repliers" row: rank → Avatar → name + humanized median →
 *  a thin bar sized by INVERTED speed (fastest replier = widest bar). */
function SpeedRow({
  row,
  rank,
  fastestMs,
  index,
}: {
  row: ReplySpeedRow
  rank: number
  fastestMs: number
  index: number
}) {
  // width ∝ 1/median, normalized to the fastest row (100%); the 4% floor
  // keeps the slowest visible, mirroring the other bar rows.
  const pct =
    row.medianMs > 0 && fastestMs > 0
      ? Math.max((fastestMs / row.medianMs) * 100, 4)
      : 4
  return (
    <li
      className="wa-kpi-pop flex items-center gap-2.5"
      style={{ animationDelay: `${index * 70}ms` }}
      aria-label={`${row.name}, median reply ${fmtMedianSpoken(row.medianMs)}, ${row.count} replies`}
    >
      <span
        className="w-5 shrink-0 text-center text-[12px] font-bold tabular-nums text-(--wa-text-2)"
        aria-hidden
      >
        {rank}
      </span>
      <span className="shrink-0">
        <Avatar name={row.name} size={26} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="truncate text-[12.5px] font-medium text-(--wa-text)">
            {row.name}
          </span>
          <span className="shrink-0 text-[11.5px] font-semibold tabular-nums text-(--wa-accent-strong)">
            {fmtMedian(row.medianMs)}
          </span>
        </div>
        <div className="h-1.5 min-w-0 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
          <div
            className="wa-bar-grow h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${pct}%`,
              backgroundColor: 'var(--wa-accent)',
              animationDelay: `${120 + index * 70}ms`,
            }}
          />
        </div>
        <p className="mt-0.5 text-[10.5px] tabular-nums text-(--wa-text-2)">
          {row.count.toLocaleString()} {row.count === 1 ? 'reply' : 'replies'}
        </p>
      </div>
    </li>
  )
}

/* ------------------------------ Main dialog ----------------------------- */

export function StatsDashboard({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  // undefined = not fetched yet (loading), null = load error
  const [data, setData] = useState<StatsData | null | undefined>(undefined)
  const [chatQuery, setChatQuery] = useState('')
  const { mode, data: dataClient, ready } = useData()

  useEffect(() => {
    if (!open || mode !== 'server') return
    let alive = true
    fetch('/api/stats', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (alive) setData(d as StatsData)
      })
      .catch(() => {
        if (alive) setData(null)
      })
    return () => {
      alive = false
    }
  }, [open, mode])

  // Device port: gather the same rows the route reads (chats, all messages,
  // per-chat media storage) from the on-device DataClient and run the exact
  // same pure compute core (src/lib/stats-compute.ts). seqRef = latest-load-
  // wins so rapid close/open can't land a stale result (MemoriesDialog's
  // pattern); `ready` keeps the skeleton up while the engine boots.
  const deviceSeqRef = useRef(0)
  useEffect(() => {
    if (!open || mode !== 'device' || !ready) return
    const seq = ++deviceSeqRef.current
    let alive = true
    void (async () => {
      try {
        const chats = await dataClient.listChats()
        if (!alive || deviceSeqRef.current !== seq) return
        // Server orders chats by messageCount desc — mirror that so
        // perChat ties and top-10 slicing behave the same way.
        const ordered = [...chats].sort(
          (a, b) => b.messageCount - a.messageCount
        )
        const [details, mediaLists] = await Promise.all([
          Promise.all(ordered.map((c) => dataClient.getChatDetail(c.id))),
          Promise.all(ordered.map((c) => dataClient.listChatMedia(c.id))),
        ])
        if (!alive || deviceSeqRef.current !== seq) return
        const messages = details.flatMap((d, i) =>
          d.messages.map((m) => ({
            chatId: ordered[i].id,
            ts: m.ts,
            sender: m.sender,
            type: m.type,
            body: m.body,
          }))
        )
        // Device analogue of the server's db/media/<chatId>/ disk walk:
        // per-chat blob sizes from the media store (missing blobs don't
        // count, like vanished files on disk).
        const perChatStorage = mediaLists
          .map((res, i) => ({
            chatId: ordered[i].id,
            bytes: res.items.reduce((s, it) => s + (it.bytes ?? 0), 0),
            files: res.items.filter((it) => it.bytes != null).length,
          }))
          .filter((row) => row.files > 0)
          .sort((a, b) => b.bytes - a.bytes)
        setData(
          computeStats({
            chats: ordered,
            messages,
            storage: {
              totalBytes: perChatStorage.reduce((s, r) => s + r.bytes, 0),
              files: perChatStorage.reduce((s, r) => s + r.files, 0),
              perChat: perChatStorage,
            },
          })
        )
      } catch {
        if (alive && deviceSeqRef.current === seq) setData(null)
      }
    })()
    return () => {
      alive = false
    }
  }, [open, mode, ready, dataClient])

  const loading = data === undefined

  const maxMonth = data ? Math.max(...data.months.map((m) => m.count), 1) : 1
  const maxWeekday = data ? Math.max(...data.weekdays.map((w) => w.count), 1) : 1
  const maxParticipant = data
    ? Math.max(...data.participants.map((p) => p.count), 1)
    : 1

  const q = chatQuery.trim().toLowerCase()
  const filteredChats = data
    ? q
      ? data.perChat.filter((c) => c.title.toLowerCase().includes(q))
      : data.perChat
    : []
  const filteredStorage = data
    ? q
      ? data.storage.perChat.filter((c) => c.title.toLowerCase().includes(q))
      : data.storage.perChat
    : []
  const filteredChatMax = Math.max(...filteredChats.map((c) => c.count), 1)
  const filteredStorageMax = Math.max(...filteredStorage.map((c) => c.bytes), 1)

  const deletedCount = data?.types.find((t) => t.type === 'deleted')?.count ?? 0

  // /api/stats extension fields — parsed defensively (see StatsExtras)
  const extras = (data ?? null) as unknown as StatsExtras | null
  const topWordsGlobal = pickArray<GlobalWordEntry>(
    extras?.topWordsGlobal,
    isWordEntry
  )
  const emojiLeaderboard = pickArray<EmojiLeaderEntry>(
    extras?.emojiLeaderboard,
    isEmojiEntry
  )
  const ignoreGraph = pickArray<IgnorePair>(extras?.ignoreGraph, isIgnorePair)
  // Reply-speed leaderboard — parsed defensively like the other extras so an
  // older/cached payload without it degrades to the empty state. Rows arrive
  // fastest-first with a 3-sample floor already applied.
  const replySpeeds = parseReplySpeeds(extras?.replySpeeds)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="wa-stats-pop flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader className="wa-stats-rise wa-revealed">
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-(--wa-accent)" />
            Insights
          </DialogTitle>
          <DialogDescription>
            Deep analytics across all your imported chats — computed locally.
          </DialogDescription>
        </DialogHeader>

        <div className="wa-scroll -mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1 pb-1">
          {loading && !data ? (
            <div className="flex h-40 items-center justify-center gap-2 text-[13.5px] text-(--wa-text-2)">
              <Loader2 className="h-4 w-4 animate-spin" />
              Crunching numbers...
            </div>
          ) : !data ? (
            <p className="py-10 text-center text-[13.5px] text-(--wa-text-2)">
              Could not load statistics.
            </p>
          ) : (
            <>
              {/* KPI cards */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Kpi
                  icon={<MessageSquare className="h-4 w-4" />}
                  label="Messages"
                  value={data.totals.messages.toLocaleString()}
                  countTo={data.totals.messages}
                  accent="var(--wa-accent)"
                  delay={0}
                />
                <Kpi
                  icon={<Group className="h-4 w-4" />}
                  label={`Chats (${data.totals.groupChats} ${
                    data.totals.groupChats === 1 ? 'group' : 'groups'
                  })`}
                  value={data.totals.chats.toLocaleString()}
                  countTo={data.totals.chats}
                  accent="#e542a3"
                  delay={45}
                />
                <Kpi
                  icon={<Images className="h-4 w-4" />}
                  label="Media items"
                  value={data.totals.media.toLocaleString()}
                  countTo={data.totals.media}
                  accent="#f2a33c"
                  delay={90}
                />
                <Kpi
                  icon={<Type className="h-4 w-4" />}
                  label="Words"
                  value={data.totals.words.toLocaleString()}
                  countTo={data.totals.words}
                  accent="#0ea5a4"
                  delay={135}
                />
                <Kpi
                  icon={<Smile className="h-4 w-4" />}
                  label="Emojis sent"
                  value={data.totals.emojis.toLocaleString()}
                  countTo={data.totals.emojis}
                  accent="#b06ad4"
                  delay={180}
                />
                <Kpi
                  icon={<CalendarDays className="h-4 w-4" />}
                  label="Sent by you"
                  value={
                    data.totals.messages > 0
                      ? `${Math.round((data.totals.outgoing / data.totals.messages) * 100)}%`
                      : '—'
                  }
                  countTo={
                    data.totals.messages > 0
                      ? Math.round(
                          (data.totals.outgoing / data.totals.messages) * 100
                        )
                      : undefined
                  }
                  countSuffix="%"
                  accent="#ef6c6c"
                  delay={225}
                />
                <Kpi
                  icon={<CalendarCheck2 className="h-4 w-4" />}
                  label="Active days"
                  value={data.range.activeDays.toLocaleString()}
                  countTo={data.range.activeDays}
                  accent="#12b886"
                  delay={270}
                />
                <Kpi
                  icon={<Flame className="h-4 w-4" />}
                  label="Longest streak"
                  value={`${data.streak.longest} day${data.streak.longest === 1 ? '' : 's'}`}
                  countTo={data.streak.longest}
                  countSuffix={data.streak.longest === 1 ? ' day' : ' days'}
                  accent="#ef8c6c"
                  delay={315}
                />
                <Kpi
                  icon={<HardDrive className="h-4 w-4" />}
                  label={`Media storage (${data.storage.files} file${data.storage.files === 1 ? '' : 's'})`}
                  value={
                    data.storage.totalBytes > 0
                      ? formatBytes(data.storage.totalBytes)
                      : '0 B'
                  }
                  accent="#0ea5a4"
                  delay={360}
                />
              </div>

              {data.totals.messages === 0 ? (
                <p className="py-6 text-center text-[13px] text-(--wa-text-2)">
                  No messages yet — import a chat to see insights.
                </p>
              ) : (
                <>
                  {data.range.busiestDay && (
                    <p className="wa-stats-rise wa-revealed rounded-lg bg-(--wa-accent)/10 px-3 py-2 text-[12.5px] text-(--wa-accent-strong)" style={{ animationDelay: '30ms' }}>
                      Busiest day:{' '}
                      <b>
                        {new Date(
                          data.range.busiestDay.date + 'T12:00:00'
                        ).toLocaleDateString('en-GB', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                          year: 'numeric',
                        })}
                      </b>{' '}
                      with {data.range.busiestDay.count.toLocaleString()} messages
                      {data.range.avgPerDay > 0 && (
                        <> · {data.range.avgPerDay}/day on active days</>
                      )}
                    </p>
                  )}

                  <Section
                    title="Activity heatmap"
                    icon={<CalendarDays className="h-3 w-3" />}
                    delay={80}
                  >
                    <Heatmap grid={data.heatmap} total={data.totals.messages} />
                  </Section>

                  <Section title="Messages per month" delay={140}>
                    <div className="flex h-28 items-end gap-1.5 rounded-xl bg-(--wa-panel-2)/60 p-3 dark:bg-(--wa-panel-2)/60">
                      {data.months.length === 0 ? (
                        <p className="w-full text-center text-[12px] text-(--wa-text-2)">
                          No dated messages
                        </p>
                      ) : (
                        data.months.map((m, i) => (
                          <div
                            key={m.month}
                            className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                            title={`${monthLabel(m.month)}: ${m.count.toLocaleString()}`}
                          >
                            <span className="text-[9px] font-medium tabular-nums text-(--wa-text-2) opacity-0 transition-opacity group-hover:opacity-100 dark:text-(--wa-text-2)">
                              {m.count}
                            </span>
                            <div
                              className="wa-col-grow w-full max-w-7 rounded-t-sm bg-(--wa-accent)/80 transition-colors group-hover:bg-(--wa-accent)"
                              style={{
                                height: `${Math.max((m.count / maxMonth) * 100, 3)}%`,
                                animationDelay: `${i * 40}ms`,
                              }}
                            />
                            <span className="w-full truncate text-center text-[8.5px] text-(--wa-text-2)">
                              {monthLabel(m.month)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </Section>

                  <Section
                    title="Most active hours"
                    icon={<CalendarCheck2 className="h-3 w-3" />}
                    delay={200}
                  >
                    <HoursChart hours={data.hours} />
                  </Section>

                  <Section title="Activity by weekday" delay={260}>
                    <div className="space-y-1.5">
                      {data.weekdays.map((w, i) => (
                        <BarRow
                          key={w.weekday}
                          label={w.weekday}
                          value={w.count}
                          max={maxWeekday}
                          total={data.totals.messages}
                          delay={i * 60}
                        />
                      ))}
                    </div>
                  </Section>

                  {/* Words + emojis side by side */}
                  {(data.topWords.length > 0 || data.topEmojis.length > 0) && (
                    <div className="grid gap-5 sm:grid-cols-2">
                      {data.topWords.length > 0 && (
                        <Section title="Top words" delay={320}>
                          <div className="flex flex-wrap gap-1.5">
                            {data.topWords.map((w, i) => (
                              <span
                                key={w.word}
                                className="wa-chip-in rounded-full border border-black/5 bg-(--wa-panel-2)/70 px-2.5 py-1 text-[12px] text-(--wa-text) dark:border-white/5 dark:bg-(--wa-panel-2)/70 dark:text-(--wa-text)"
                                style={{ animationDelay: `${i * 30}ms` }}
                              >
                                {w.word}
                                <b className="ml-1.5 tabular-nums text-(--wa-accent)">
                                  {w.count.toLocaleString()}
                                </b>
                              </span>
                            ))}
                          </div>
                        </Section>
                      )}
                      {data.topEmojis.length > 0 && (
                        <Section title="Top emojis" delay={320}>
                          <div className="flex flex-wrap gap-2">
                            {data.topEmojis.map((e, i) => (
                              <div
                                key={e.emoji}
                                className="wa-kpi-pop flex w-[68px] flex-col items-center rounded-lg border border-black/5 bg-(--wa-panel-2)/70 py-2 dark:border-white/5 dark:bg-(--wa-panel-2)/70"
                                style={{ animationDelay: `${240 + i * 60}ms` }}
                              >
                                <span className="text-[22px] leading-none">
                                  {e.emoji}
                                </span>
                                <span className="mt-1 text-[11px] font-medium tabular-nums text-(--wa-text-2)">
                                  ×{e.count.toLocaleString()}
                                </span>
                                {i === 0 && (
                                  <span className="text-[9px] uppercase tracking-wide text-(--wa-accent)">
                                    favorite
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </Section>
                      )}
                    </div>
                  )}

                  <Section title="Fun facts" delay={380}>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <FunFact
                        icon={<Flame className="h-4 w-4" />}
                        value={`${data.streak.current} day${data.streak.current === 1 ? '' : 's'}`}
                        label="Current streak"
                        accent="#ef8c6c"
                        countTo={data.streak.current}
                        countSuffix={data.streak.current === 1 ? ' day' : ' days'}
                        delay={300}
                      />
                      <FunFact
                        icon={<Link2 className="h-4 w-4" />}
                        value={data.fun.links.toLocaleString()}
                        label="Links shared"
                        accent="#0ea5a4"
                        countTo={data.fun.links}
                        delay={355}
                      />
                      <FunFact
                        icon={<HelpCircle className="h-4 w-4" />}
                        value={data.fun.questions.toLocaleString()}
                        label="Questions asked"
                        accent="#f2a33c"
                        countTo={data.fun.questions}
                        delay={410}
                      />
                      <FunFact
                        icon={<Trash2 className="h-4 w-4" />}
                        value={deletedCount.toLocaleString()}
                        label="Deleted messages"
                        accent="#ef6c6c"
                        countTo={deletedCount}
                        delay={465}
                      />
                      <FunFact
                        icon={<CalendarCheck2 className="h-4 w-4" />}
                        value={`${data.range.avgPerDay.toLocaleString()}`}
                        label="Avg msgs / active day"
                        accent="#12b886"
                        countTo={data.range.avgPerDay}
                        delay={520}
                      />
                      <FunFact
                        icon={<Type className="h-4 w-4" />}
                        value={
                          data.fun.longest
                            ? data.fun.longest.chars.toLocaleString()
                            : '—'
                        }
                        label="Longest message (chars)"
                        accent="#b06ad4"
                        countTo={data.fun.longest?.chars}
                        delay={575}
                      />
                    </div>
                    {data.fun.longest && (
                      <div className="mt-2 flex gap-2.5 rounded-xl border border-black/5 bg-(--wa-panel-2)/60 p-3 dark:border-white/5 dark:bg-(--wa-panel-2)/60">
                        <Quote className="h-4 w-4 shrink-0 text-(--wa-accent)" />
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-[12.5px] italic leading-snug text-(--wa-text)">
                            “{data.fun.longest.preview}”
                          </p>
                          <p className="mt-1 text-[11px] text-(--wa-text-2)">
                            <b style={{ color: colorForName(data.fun.longest.sender) }}>
                              {data.fun.longest.sender}
                            </b>{' '}
                            in {data.fun.longest.chatTitle}
                          </p>
                        </div>
                      </div>
                    )}
                  </Section>

                  <Section title="Top chats" delay={440}>
                    {(data.perChat.length > 2 || q) && (
                      <div className="relative mb-2">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--wa-text-2)" />
                        <Input
                          suppressHydrationWarning
                          value={chatQuery}
                          onChange={(e) => setChatQuery(e.target.value)}
                          placeholder="Filter chats by name…"
                          className="h-8 rounded-lg bg-white pl-8 text-[12.5px] dark:bg-(--wa-row-active) dark:text-(--wa-text) dark:placeholder:text-(--wa-text-2)"
                        />
                      </div>
                    )}
                    {q && filteredChats.length === 0 ? (
                      <p className="py-3 text-center text-[12.5px] text-(--wa-text-2)">
                        No chats match &quot;{chatQuery.trim()}&quot;
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {filteredChats.map((c, i) => (
                          <BarRow
                            key={c.id}
                            label={c.title}
                            value={c.count}
                            max={filteredChatMax}
                            total={data.totals.messages}
                            accent={c.isGroup ? '#e542a3' : 'var(--wa-accent)'}
                            delay={i * 50}
                            leading={
                              <span className="shrink-0">
                                <Avatar name={c.title} size={24} />
                              </span>
                            }
                          />
                        ))}
                      </div>
                    )}
                  </Section>

                  {data.participants.length > 0 && (
                    <Section title="Most active people" delay={500}>
                      <div className="space-y-2.5">
                        {data.participants.map((p, i) => (
                          <div
                            key={p.sender}
                            className="wa-kpi-pop flex items-center gap-2.5"
                            style={{ animationDelay: `${400 + i * 70}ms` }}
                          >
                            <span className="shrink-0">
                              <Avatar name={p.sender} size={26} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex items-baseline justify-between gap-2">
                                <span className="truncate text-[12.5px] font-medium text-(--wa-text)">
                                  {p.sender}
                                </span>
                                <span className="shrink-0 text-[11px] tabular-nums text-(--wa-text-2)">
                                  {p.count.toLocaleString()} ·{' '}
                                  {Math.round(
                                    (p.count / Math.max(1, data.totals.messages)) * 100
                                  )}
                                  %
                                </span>
                              </div>
                              <div className="h-2 min-w-0 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                                <div
                                  className="wa-bar-grow h-full rounded-full transition-[width] duration-500"
                                  style={{
                                    width: `${Math.max((p.count / maxParticipant) * 100, 3)}%`,
                                    backgroundColor: colorForName(p.sender),
                                    animationDelay: `${520 + i * 70}ms`,
                                  }}
                                />
                              </div>
                              <p className="mt-0.5 text-[10.5px] tabular-nums text-(--wa-text-2)">
                                {p.words.toLocaleString()} words ·{' '}
                                {p.emojis.toLocaleString()} emojis
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Section>
                  )}

                  <Section title="Message types" delay={560}>
                    <div className="flex flex-wrap gap-1.5">
                      {data.types.map((t, i) => (
                        <span
                          key={t.type}
                          className={cn(
                            'wa-chip-in rounded-full border border-black/5 bg-(--wa-panel-2)/70 px-2.5 py-1 text-[11.5px]',
                            'text-(--wa-text) dark:border-white/5 dark:bg-(--wa-panel-2)/70 dark:text-(--wa-text)'
                          )}
                          style={{ animationDelay: `${440 + i * 35}ms` }}
                        >
                          {TYPE_LABELS[t.type] ?? t.type}
                          <b className="ml-1.5 tabular-nums text-(--wa-accent)">
                            {t.count.toLocaleString()}
                          </b>
                        </span>
                      ))}
                    </div>
                  </Section>

                  {data.storage.perChat.length > 0 && (
                    <Section title="Media storage by chat" delay={620}>
                      <div className="space-y-1.5">
                        {filteredStorage.map((s, i) => (
                          <BarRow
                            key={s.chatId}
                            label={s.title}
                            value={s.bytes}
                            max={filteredStorageMax}
                            total={data.storage.totalBytes}
                            accent="#12b886"
                            formatValue={formatBytes}
                            delay={i * 50}
                            leading={
                              <span className="shrink-0">
                                <Avatar name={s.title} size={24} />
                              </span>
                            }
                          />
                        ))}
                        <p className="pt-0.5 text-right text-[10.5px] text-(--wa-text-2)">
                          Bars show file sizes · total{' '}
                          <b>{formatBytes(data.storage.totalBytes)}</b> on disk
                        </p>
                      </div>
                    </Section>
                  )}

                  {/* Task 10-c: global word cloud, emoji leaderboard,
                      "who leaves who on read" — same scroll-reveal system. */}

                  <Section
                    title="Word cloud"
                    icon={<Cloud className="h-3 w-3" />}
                    delay={700}
                  >
                    {topWordsGlobal.length > 0 ? (
                      <WordCloud words={topWordsGlobal} />
                    ) : (
                      <p className="rounded-xl bg-(--wa-panel-2)/60 px-3 py-4 text-center text-[12.5px] text-(--wa-text-2)">
                        No words yet — import a chat with text messages first.
                      </p>
                    )}
                  </Section>

                  <Section
                    title="Emoji leaderboard"
                    icon={<Smile className="h-3 w-3" />}
                    delay={780}
                  >
                    {emojiLeaderboard.length > 0 ? (
                      <EmojiLeaderboard rows={emojiLeaderboard.slice(0, 8)} />
                    ) : (
                      <p className="rounded-xl bg-(--wa-panel-2)/60 px-3 py-4 text-center text-[12.5px] text-(--wa-text-2)">
                        No emojis yet — send a few and they&apos;ll rank up here.
                      </p>
                    )}
                  </Section>

                  <Section
                    title="Who leaves who on read"
                    icon={<EyeOff className="h-3 w-3" />}
                    delay={860}
                  >
                    {ignoreGraph.length > 0 ? (
                      <div className="space-y-2">
                        {ignoreGraph.map((pair, i) => (
                          <IgnoreRow key={`${pair.chatId}-${pair.aName}-${pair.bName}`} pair={pair} index={i} />
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-xl bg-(--wa-panel-2)/60 px-3 py-4 text-center text-[12.5px] text-(--wa-text-2)">
                        No repeat offenders yet — everyone&apos;s replying (or
                        there isn&apos;t enough history).
                      </p>
                    )}
                    <p className="mt-2 text-[10.5px] leading-snug text-(--wa-text-2)">
                      Playful estimate based on reply timing — a message counts
                      as &quot;left on read&quot; when the other person sends
                      nothing within 24 hours.
                    </p>
                  </Section>

                  <Section
                    title="Fastest repliers"
                    icon={<Timer className="h-3 w-3" />}
                    delay={940}
                  >
                    {replySpeeds && replySpeeds.rows.length > 0 ? (
                      <>
                        <ol className="space-y-2.5">
                          {replySpeeds.rows.slice(0, 8).map((row, i) => (
                            <SpeedRow
                              key={row.senderKey}
                              row={row}
                              rank={i + 1}
                              fastestMs={replySpeeds.rows[0].medianMs}
                              index={i}
                            />
                          ))}
                        </ol>
                        {replySpeeds.myMedianMs != null && (
                          <p className="mt-2 text-[10.5px] tabular-nums text-(--wa-text-2)">
                            Your median reply:{' '}
                            <b className="text-(--wa-text)">
                              {fmtMedian(replySpeeds.myMedianMs)}
                            </b>
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="rounded-xl bg-(--wa-panel-2)/60 px-3 py-4 text-center text-[12.5px] text-(--wa-text-2)">
                        Not enough reply data yet
                      </p>
                    )}
                    <p className="mt-2 text-[10.5px] leading-snug text-(--wa-text-2)">
                      Median time from your message to each person&apos;s next
                      one (replies within 6 hours, 3+ samples). Bars compare
                      speed — the fastest replier is the widest.
                    </p>
                  </Section>
                </>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
