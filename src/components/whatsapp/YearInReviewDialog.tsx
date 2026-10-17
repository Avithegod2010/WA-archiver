'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CalendarDays,
  CalendarRange,
  Flame,
  PartyPopper,
  Quote,
  Type,
  Users,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ChatMessage } from './types'
import { cn } from '@/lib/utils'

/** Local YYYY-MM-DD day key (timezone-safe, matches ChatView's dayKey). */
function dayKeyOf(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  })
}

function fmtMonth(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })
}

const EMOJI_RE = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu

interface Stats {
  count: number
  busiest: { key: string; iso: string; count: number } | null
  topMonth: { key: string; count: number } | null
  streak: { days: number; startIso: string; endIso: string } | null
  topEmoji: { emoji: string; count: number } | null
  topSpeaker: { name: string; count: number } | null
  words: number
  activeDays: number
}

/** Zeroed stats used while the dialog is closed (compute is gated on open). */
const EMPTY_STATS: Stats = {
  count: 0,
  busiest: null,
  topMonth: null,
  streak: null,
  topEmoji: null,
  topSpeaker: null,
  words: 0,
  activeDays: 0,
}

/** Stable empty array so the closed-dialog memos never churn identity. */
const NO_MESSAGES: ChatMessage[] = []

function computeStats(messages: ChatMessage[]): Stats {
  const perDay = new Map<string, { count: number; iso: string }>()
  const perMonth = new Map<string, number>()
  const perSender = new Map<string, number>()
  const perEmoji = new Map<string, number>()
  let words = 0

  for (const m of messages) {
    const d = new Date(m.ts)
    if (Number.isNaN(d.getTime())) continue
    const dk = dayKeyOf(m.ts)
    const day = perDay.get(dk)
    if (day) day.count++
    else perDay.set(dk, { count: 1, iso: m.ts })
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    perMonth.set(mk, (perMonth.get(mk) ?? 0) + 1)
    if (m.sender && m.sender !== 'You' && m.type !== 'system') {
      perSender.set(m.sender, (perSender.get(m.sender) ?? 0) + 1)
    }
    if (m.body) {
      words += m.body.trim().split(/\s+/).filter(Boolean).length
      for (const match of m.body.matchAll(EMOJI_RE)) {
        perEmoji.set(match[0], (perEmoji.get(match[0]) ?? 0) + 1)
      }
    }
  }

  let busiest: Stats['busiest'] = null
  for (const [key, v] of perDay) {
    if (!busiest || v.count > busiest.count) busiest = { key, iso: v.iso, count: v.count }
  }
  let topMonth: Stats['topMonth'] = null
  for (const [key, count] of perMonth) {
    if (!topMonth || count > topMonth.count) topMonth = { key, count }
  }
  let topSpeaker: Stats['topSpeaker'] = null
  for (const [name, count] of perSender) {
    if (!topSpeaker || count > topSpeaker.count) topSpeaker = { name, count }
  }
  let topEmoji: Stats['topEmoji'] = null
  for (const [emoji, count] of perEmoji) {
    if (!topEmoji || count > topEmoji.count) topEmoji = { emoji, count }
  }

  // Longest run of consecutive active days (local calendar days).
  let streak: Stats['streak'] = null
  const dayStarts = [...perDay.keys()]
    .map((k) => {
      const [y, m, d] = k.split('-').map(Number)
      return { key: k, t: new Date(y, m, d).getTime() }
    })
    .sort((a, b) => a.t - b.t)
  let runStart = 0
  for (let i = 1; i <= dayStarts.length; i++) {
    const prev = dayStarts[i - 1]
    const cur = dayStarts[i]
    const contiguous = cur && cur.t - prev.t === 86_400_000
    if (!contiguous) {
      const len = i - runStart
      if (len >= 2 && (!streak || len > streak.days)) {
        const first = messages.find((m) => dayKeyOf(m.ts) === dayStarts[runStart].key)
        const last = messages.find((m) => dayKeyOf(m.ts) === dayStarts[i - 1].key)
        if (first && last) {
          streak = { days: len, startIso: first.ts, endIso: last.ts }
        }
      }
      runStart = i
    }
  }

  return {
    count: messages.length,
    busiest,
    topMonth,
    streak,
    topEmoji,
    topSpeaker,
    words,
    activeDays: perDay.size,
  }
}

/** Wrapped-style per-chat rewind: the year (or all time) at a glance. */
export function YearInReviewDialog({
  open,
  onOpenChange,
  chatTitle,
  isGroup,
  messages,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chatTitle: string
  isGroup: boolean
  messages: ChatMessage[]
}) {
  const years = useMemo(() => {
    // Compute only while the rewind is actually open — ChatView keeps this
    // dialog mounted, so ungated work would rescan every message on each
    // transcript change.
    if (!open) return []
    const set = new Set<number>()
    for (const m of messages) {
      const d = new Date(m.ts)
      if (!Number.isNaN(d.getTime())) set.add(d.getFullYear())
    }
    return [...set].sort((a, b) => b - a)
  }, [open, messages])

  const [scopeChoice, setScopeChoice] = useState<number | 'all' | null>(null)

  // Default scope (no explicit choice yet): the busiest year, wrapped-style.
  const defaultScope = useMemo<number | 'all'>(() => {
    if (!open || years.length === 0) return 'all'
    const perYear = new Map<number, number>()
    for (const m of messages) {
      const d = new Date(m.ts)
      if (!Number.isNaN(d.getTime())) {
        perYear.set(d.getFullYear(), (perYear.get(d.getFullYear()) ?? 0) + 1)
      }
    }
    let best = years[0]
    for (const y of years) {
      if ((perYear.get(y) ?? 0) > (perYear.get(best) ?? 0)) best = y
    }
    return best
  }, [open, messages, years])

  const scope = scopeChoice ?? defaultScope

  const scoped = useMemo(() => {
    if (!open) return NO_MESSAGES
    if (scope === 'all' || scope === null) return messages
    return messages.filter((m) => new Date(m.ts).getFullYear() === scope)
  }, [open, messages, scope])

  const stats = useMemo(() => (open ? computeStats(scoped) : EMPTY_STATS), [open, scoped])
  const avgPerDay =
    stats.activeDays > 0 ? Math.round(stats.count / stats.activeDays) : 0

  const cards: Array<{
    icon: React.ReactNode
    label: string
    value: string
    sub?: string
    emoji?: string
  }> = [
    stats.busiest && {
      icon: <Flame className="h-4 w-4 text-orange-500" />,
      label: 'Busiest day',
      value: `${stats.busiest.count} messages`,
      sub: fmtDay(stats.busiest.iso),
    },
    stats.topMonth && {
      icon: <CalendarRange className="h-4 w-4 text-(--wa-accent)" />,
      label: 'Most active month',
      value: `${stats.topMonth.count} messages`,
      sub: fmtMonth(stats.topMonth.key),
    },
    stats.streak && {
      icon: <CalendarDays className="h-4 w-4 text-rose-500" />,
      label: 'Longest daily streak',
      value: `${stats.streak.days} days in a row`,
      sub: `${fmtDay(stats.streak.startIso)} → ${fmtDay(stats.streak.endIso)}`,
    },
    stats.topSpeaker && isGroup && {
      icon: <Users className="h-4 w-4 text-(--wa-accent)" />,
      label: 'Loudest voice',
      value: stats.topSpeaker.name,
      sub: `${stats.topSpeaker.count} messages`,
    },
    stats.topEmoji && {
      icon: <Quote className="h-4 w-4 text-(--wa-accent)" />,
      label: 'Signature emoji',
      value: stats.topEmoji.emoji,
      sub: `${stats.topEmoji.count} uses`,
      emoji: stats.topEmoji.emoji,
    },
    stats.words > 0 && {
      icon: <Type className="h-4 w-4 text-(--wa-accent)" />,
      label: 'Words typed',
      value: stats.words.toLocaleString(),
      sub: `≈${avgPerDay} per active day`,
    },
  ].filter(Boolean) as typeof cards

  const yearLabel = scope === 'all' || scope === null ? 'All time' : String(scope)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden rounded-2xl p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Year in review — {chatTitle}</DialogTitle>
          <DialogDescription>
            Wrapped-style statistics for this chat
          </DialogDescription>
        </DialogHeader>

        {/* Scope chips */}
        <div className="flex flex-wrap gap-1.5 px-5 pt-4">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setScopeChoice(y)}
              className={cn(
                'rounded-full px-3 py-1 text-[12px] font-medium transition-colors',
                scope === y
                  ? 'bg-(--wa-accent) text-white'
                  : 'bg-(--wa-in) text-(--wa-text-2) hover:bg-(--wa-row-active)'
              )}
            >
              {y}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setScopeChoice('all')}
            className={cn(
              'rounded-full px-3 py-1 text-[12px] font-medium transition-colors',
              scope === 'all'
                ? 'bg-(--wa-accent) text-white'
                : 'bg-(--wa-in) text-(--wa-text-2) hover:bg-(--wa-row-active)'
            )}
          >
            All time
          </button>
        </div>

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="mx-5 mt-3 overflow-hidden rounded-2xl bg-gradient-to-br from-(--wa-accent) to-(--wa-accent-strong,#075e54) p-5 text-white shadow-lg"
        >
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/80">
            <PartyPopper className="h-4 w-4" />
            {yearLabel} in review
          </div>
          <p className="mt-2 truncate text-[13px] text-white/85">{chatTitle}</p>
          <p className="mt-1 text-[34px] font-bold leading-none">
            {stats.count.toLocaleString()}
          </p>
          <p className="mt-1 text-[13px] text-white/85">
            {stats.count === 1 ? 'message' : 'messages'} across{' '}
            {stats.activeDays.toLocaleString()} active{' '}
            {stats.activeDays === 1 ? 'day' : 'days'}
          </p>
        </motion.div>

        {/* Stat cards */}
        {stats.count === 0 ? (
          <p className="px-6 py-8 text-center text-[13px] text-(--wa-text-2)">
            No messages in this period.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 px-5 pb-5 pt-3 sm:grid-cols-2">
            {cards.map((c, i) => (
              <motion.div
                key={c.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.08 + i * 0.06, ease: 'easeOut' }}
                className="rounded-xl bg-(--wa-in) p-3.5"
              >
                <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-(--wa-text-2)">
                  {c.icon}
                  {c.label}
                </div>
                {c.emoji ? (
                  <p className="mt-1.5 text-[28px] leading-none">{c.value}</p>
                ) : (
                  <p className="mt-1.5 truncate text-[15px] font-semibold leading-snug text-(--wa-text)">
                    {c.value}
                  </p>
                )}
                {c.sub && (
                  <p className="mt-0.5 text-[11.5px] leading-snug text-(--wa-text-2)">
                    {c.sub}
                  </p>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
