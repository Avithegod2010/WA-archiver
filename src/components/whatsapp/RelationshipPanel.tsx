'use client'

/**
 * Idea #2 — Relationship insights panel (per 1:1 chat).
 *
 * A compact, honest dashboard computed entirely on-device from the chat's
 * messages (see src/lib/relationship-insights.ts for every definition):
 * balance of messages/words, who initiates, reply speed per side, the
 * unanswered tail ("left on read"), the longest silence, monologue records,
 * a 24-hour rhythm sparkline and top emojis per side.
 */

import { useMemo } from 'react'
import {
  AlarmClockOff,
  BarChart3,
  CalendarDays,
  Clock3,
  Flame,
  Hourglass,
  MessagesSquare,
  Moon,
  ShieldCheck,
  Sparkles,
  Timer,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Avatar } from './Avatar'
import type { ChatMessage } from './types'
import {
  computeRelationshipInsights,
  formatDuration,
  hourLabel,
  type RelationshipInsights,
  type Side,
} from '@/lib/relationship-insights'
import { cn } from '@/lib/utils'

const SIDE_LABEL: Record<Side, string> = { you: 'You', them: 'Them' }

function shareBar(share: number): string {
  const pct = Math.round(Math.min(1, Math.max(0, share)) * 100)
  return `${pct}%`
}

/** Small labelled metric tile. */
function Tile({
  icon,
  label,
  value,
  sub,
  className,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-black/8 bg-(--wa-panel-2) p-3 dark:border-white/8',
        className
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 text-[17px] font-bold leading-tight text-(--wa-text)">
        {value}
      </div>
      {sub !== undefined && (
        <div className="mt-0.5 text-[11.5px] leading-snug text-(--wa-text-2)">
          {sub}
        </div>
      )}
    </div>
  )
}

/** Reply-speed tile with a who's-faster accent. */
function ReplyTile({
  side,
  median,
  avg,
  samples,
  faster,
}: {
  side: Side
  median: number | null
  avg: number | null
  samples: number
  faster: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-3 transition-colors',
        faster
          ? 'border-(--wa-accent)/40 bg-(--wa-accent)/8'
          : 'border-black/8 bg-(--wa-panel-2) dark:border-white/8'
      )}
    >
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
        <span className="truncate">{SIDE_LABEL[side]} replies in</span>
        {faster && (
          <span className="flex items-center gap-0.5 text-(--wa-accent-strong) dark:text-(--wa-accent)">
            <Sparkles className="h-3 w-3" /> fastest
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5 text-(--wa-text)">
        <span className="text-[17px] font-bold leading-tight">
          {formatDuration(median)}
        </span>
        <span className="text-[11.5px] text-(--wa-text-2)">median</span>
      </div>
      <div className="mt-0.5 text-[11.5px] text-(--wa-text-2)">
        avg {formatDuration(avg)} · {samples} replies
      </div>
    </div>
  )
}

/** Who-initiates pair with a proportional two-sided bar. */
function InitiationBars({
  you,
  them,
}: {
  you: number
  them: number
}) {
  const total = Math.max(1, you + them)
  const youPct = Math.round((you / total) * 100)
  return (
    <div className="rounded-xl border border-black/8 bg-(--wa-panel-2) p-3 dark:border-white/8">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
        <MessagesSquare className="h-3.5 w-3.5" />
        Who starts the chat
      </div>
      <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className="h-full bg-(--wa-accent) transition-[width] duration-500"
          style={{ width: `${youPct}%` }}
          role="presentation"
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11.5px] text-(--wa-text-2)">
        <span className="font-semibold text-(--wa-text)">
          You {you} ({youPct}%)
        </span>
        <span className="font-semibold text-(--wa-text)">
          Them {them} ({100 - youPct}%)
        </span>
      </div>
    </div>
  )
}

/** 24-hour rhythm sparkline — 24 cells, green intensity by share. */
function HourRhythm({ hours }: { hours: number[] }) {
  const max = Math.max(1, ...hours)
  const busiest = hours.indexOf(max)
  return (
    <div className="rounded-xl border border-black/8 bg-(--wa-panel-2) p-3 dark:border-white/8">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
        <Clock3 className="h-3.5 w-3.5" />
        Day rhythm
      </div>
      <div
        className="mt-2 flex h-8 items-end gap-[2px]"
        role="img"
        aria-label={`Messages by hour of day, busiest ${hourLabel(busiest)}`}
      >
        {hours.map((count, h) => (
          <div
            key={h}
            title={`${hourLabel(h)} — ${count} messages`}
            className="flex-1 rounded-sm bg-(--wa-accent) transition-[height]"
            style={{
              height: `${Math.max(8, Math.round((count / max) * 100))}%`,
              opacity: count === 0 ? 0.15 : 0.35 + 0.65 * (count / max),
            }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] text-(--wa-text-2)">
        <span>12AM</span>
        <span>12PM</span>
        <span>11PM</span>
      </div>
      <div className="mt-1 text-[11.5px] text-(--wa-text-2)">
        Peak hour: <span className="font-semibold text-(--wa-text)">{hourLabel(busiest)}</span>
      </div>
    </div>
  )
}

function InsightBody({
  ins,
  chatTitle,
  partner,
}: {
  ins: RelationshipInsights
  chatTitle: string
  partner: string
}) {
  const left = ins.leftOnRead
  const fasterSide =
    ins.reply.you.medianMs !== null || ins.reply.them.medianMs !== null
      ? (ins.reply.you.medianMs ?? Infinity) <= (ins.reply.them.medianMs ?? Infinity)
        ? 'you'
        : 'them'
      : null

  return (
    <div className="space-y-3">
      {/* Unanswered tail callout — the emotional headline. */}
      {left && (
        <div
          className={cn(
            'flex items-start gap-3 rounded-xl border p-3',
            left.holder === 'you'
              ? 'border-(--wa-accent)/35 bg-(--wa-accent)/8'
              : 'border-[#f2a33c]/40 bg-[#f2a33c]/10'
          )}
          role="status"
        >
          {left.holder === 'you' ? (
            <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-(--wa-accent-strong) dark:text-(--wa-accent)" />
          ) : (
            <AlarmClockOff className="mt-0.5 h-5 w-5 shrink-0 text-[#f2a33c]" />
          )}
          <div className="min-w-0 text-[13px] leading-snug text-(--wa-text)">
            {left.holder === 'you' ? (
              <>
                <span className="font-semibold">You have the last word</span> —{' '}
                {left.count === 1 ? 'one message' : `${left.count} messages`} still
                awaiting a reply for {formatDuration(left.waitingMs)}.
              </>
            ) : (
              <>
                <span className="font-semibold">{chatTitle} left you on read</span>{' '}
                — {left.count === 1 ? 'one message' : `${left.count} messages`}{' '}
                unanswered for {formatDuration(left.waitingMs)}.
              </>
            )}
          </div>
        </div>
      )}

      {/* Ghosting callout. */}
      {ins.ghost && (
        <div className="flex items-start gap-3 rounded-xl border border-black/8 bg-(--wa-panel-2) p-3 dark:border-white/8">
          <Moon className="mt-0.5 h-5 w-5 shrink-0 text-(--wa-text-2)" />
          <div className="min-w-0 text-[13px] leading-snug text-(--wa-text)">
            <span className="font-semibold">
              {ins.ghost.days}-day silence
            </span>{' '}
            after {SIDE_LABEL[ins.ghost.after].toLowerCase()} sent{' '}
            {ins.ghost.ongoing ? '— still quiet' : '— the chat later resumed'}.
            {ins.ghost.preview && (
              <span className="mt-1 block truncate rounded-md bg-black/5 px-2 py-1 text-[12px] italic text-(--wa-text-2) dark:bg-white/5">
                “{ins.ghost.preview.slice(0, 90)}
                {ins.ghost.preview.length > 90 ? '…' : ''}”
              </span>
            )}
          </div>
        </div>
      )}

      {/* Balance split — messages + words share one bar. */}
      <div className="rounded-xl border border-black/8 bg-(--wa-panel-2) p-3 dark:border-white/8">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
          <BarChart3 className="h-3.5 w-3.5" />
          Conversation balance
        </div>
        <div
          className="mt-2 flex h-3 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
          role="img"
          aria-label={`You sent ${shareBar(ins.messages.youShare)} of messages`}
        >
          <div
            className="h-full bg-(--wa-accent) transition-[width] duration-500"
            style={{ width: shareBar(ins.messages.youShare) }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[12px]">
          <span className="flex items-center gap-1.5 font-semibold text-(--wa-text)">
            <Avatar name="You" size={18} /> You · {ins.messages.you} msgs ·{' '}
            {shareBar(ins.messages.youShare)}
          </span>
          <span className="flex items-center gap-1.5 font-semibold text-(--wa-text)">
            {shareBar(1 - ins.messages.youShare)} · {ins.messages.them} msgs ·{' '}
            <Avatar name={partner} size={18} /> {chatTitle}
          </span>
        </div>
        <div className="mt-1 text-[11.5px] text-(--wa-text-2)">
          Words: you {ins.words.you.toLocaleString()} vs them{' '}
          {ins.words.them.toLocaleString()}
        </div>
      </div>

      {/* Reply speed pair. */}
      <div className="grid grid-cols-2 gap-3">
        <ReplyTile
          side="you"
          median={ins.reply.you.medianMs}
          avg={ins.reply.you.avgMs}
          samples={ins.reply.you.samples}
          faster={fasterSide === 'you'}
        />
        <ReplyTile
          side="them"
          median={ins.reply.them.medianMs}
          avg={ins.reply.them.avgMs}
          samples={ins.reply.them.samples}
          faster={fasterSide === 'them'}
        />
      </div>

      <InitiationBars you={ins.initiations.you} them={ins.initiations.them} />
      <HourRhythm hours={ins.hours} />

      {/* Assorted records. */}
      <div className="grid grid-cols-2 gap-3">
        <Tile
          icon={<Flame className="h-3.5 w-3.5" />}
          label="Monologue record"
          value={
            <>
              You {ins.runs.you} · Them {ins.runs.them}
            </>
          }
          sub="Longest streak of back-to-back messages"
        />
        <Tile
          icon={<CalendarDays className="h-3.5 w-3.5" />}
          label="Days known"
          value={ins.daysKnown.toLocaleString()}
          sub={`${ins.total.toLocaleString()} messages total`}
        />
        <Tile
          icon={<Timer className="h-3.5 w-3.5" />}
          label="First contact"
          value={
            ins.firstAt
              ? new Date(ins.firstAt).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })
              : '—'
          }
          sub={
            ins.lastAt
              ? `Last activity ${formatDuration(Date.now() - Date.parse(ins.lastAt))} ago`
              : undefined
          }
        />
        <Tile
          icon={<MessagesSquare className="h-3.5 w-3.5" />}
          label="Top emojis"
          value={
            ins.topEmojis.you.length + ins.topEmojis.them.length > 0 ? (
              <span className="flex flex-wrap gap-1.5">
                {ins.topEmojis.them.map((e) => (
                  <span key={`t-${e.emoji}`} title={`Them: ${e.count}×`}>
                    {e.emoji}
                  </span>
                ))}
                {ins.topEmojis.you.map((e) => (
                  <span
                    key={`y-${e.emoji}`}
                    className="rounded bg-(--wa-accent)/15 px-1"
                    title={`You: ${e.count}×`}
                  >
                    {e.emoji}
                  </span>
                ))}
              </span>
            ) : (
              '—'
            )
          }
          sub="Highlighted = yours"
        />
      </div>

      {/* Privacy footer. */}
      <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-[11.5px] text-(--wa-text-2)">
        <ShieldCheck className="h-3.5 w-3.5" />
        Computed on-device — definitions are transparent heuristics, nothing
        leaves your browser.
      </p>
    </div>
  )
}

export function RelationshipPanel({
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
  messages: readonly ChatMessage[]
}) {
  // Recompute while open (cheap: linear scan) so fresh messages count.
  const insights = useMemo(
    () => (open ? computeRelationshipInsights(messages) : null),
    [open, messages]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <Avatar name={chatTitle} size={30} />
            <span className="min-w-0 truncate">
              {isGroup ? 'Group insights' : `You & ${chatTitle}`}
            </span>
          </DialogTitle>
          <DialogDescription className="text-left">
            {isGroup
              ? 'Group dynamics — computed from this export.'
              : 'Friendship dynamics — who reaches out, reply speed, and the silences.'}
          </DialogDescription>
        </DialogHeader>
        {insights && insights.ok ? (
          <InsightBody ins={insights} chatTitle={chatTitle} partner={chatTitle} />
        ) : (
          <p className="py-6 text-center text-[13px] text-(--wa-text-2)">
            Not enough dated messages in this chat to compute insights.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
