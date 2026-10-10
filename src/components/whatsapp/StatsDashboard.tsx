'use client'

import { useEffect, useState } from 'react'
import {
  BarChart3,
  CalendarCheck2,
  CalendarDays,
  Flame,
  HelpCircle,
  Link2,
  Loader2,
  MessageSquare,
  Images,
  Group,
  Search,
  Smile,
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
import type { StatsData } from './types'
import { colorForName } from './types'
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

function Kpi({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  accent: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-black/5 bg-(--wa-panel-2)/60 p-3 dark:border-white/5 dark:bg-(--wa-panel-2)/60">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${accent}1f`, color: accent }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[17px] font-semibold leading-tight text-(--wa-text)">
          {value}
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
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section>
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
}: {
  label: string
  value: number
  max: number
  total: number
  accent?: string
  leading?: React.ReactNode
  formatValue?: (v: number) => string
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
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: accent }}
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
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: '30px repeat(24, minmax(0, 1fr))' }}
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
        {hours.map((h) => (
          <div
            key={h.hour}
            className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`${hourLabel(h.hour)}: ${h.count.toLocaleString()}`}
          >
            <div
              className={cn(
                'w-full rounded-t-[3px] transition-colors',
                h.hour === peak.hour && peak.count > 0
                  ? 'bg-[#f2a33c]'
                  : 'bg-(--wa-accent)/70 group-hover:bg-(--wa-accent)'
              )}
              style={{
                height: `${Math.max((h.count / max) * 100, h.count > 0 ? 4 : 1.5)}%`,
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
}: {
  icon: React.ReactNode
  value: string
  label: string
  accent: string
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-black/5 bg-(--wa-panel-2)/60 p-2.5 dark:border-white/5 dark:bg-(--wa-panel-2)/60">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${accent}1f`, color: accent }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold leading-tight text-(--wa-text)">
          {value}
        </p>
        <p className="truncate text-[11px] text-(--wa-text-2)">
          {label}
        </p>
      </div>
    </div>
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
  // undefined = not fetched yet (loading), null = fetch error
  const [data, setData] = useState<StatsData | null | undefined>(undefined)
  const [chatQuery, setChatQuery] = useState('')

  useEffect(() => {
    if (!open) return
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
  }, [open])

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
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
                  accent="var(--wa-accent)"
                />
                <Kpi
                  icon={<Group className="h-4 w-4" />}
                  label={`Chats (${data.totals.groupChats} ${
                    data.totals.groupChats === 1 ? 'group' : 'groups'
                  })`}
                  value={data.totals.chats.toLocaleString()}
                  accent="#e542a3"
                />
                <Kpi
                  icon={<Images className="h-4 w-4" />}
                  label="Media items"
                  value={data.totals.media.toLocaleString()}
                  accent="#f2a33c"
                />
                <Kpi
                  icon={<Type className="h-4 w-4" />}
                  label="Words"
                  value={data.totals.words.toLocaleString()}
                  accent="#0ea5a4"
                />
                <Kpi
                  icon={<Smile className="h-4 w-4" />}
                  label="Emojis sent"
                  value={data.totals.emojis.toLocaleString()}
                  accent="#b06ad4"
                />
                <Kpi
                  icon={<CalendarDays className="h-4 w-4" />}
                  label="Sent by you"
                  value={
                    data.totals.messages > 0
                      ? `${Math.round((data.totals.outgoing / data.totals.messages) * 100)}%`
                      : '—'
                  }
                  accent="#ef6c6c"
                />
                <Kpi
                  icon={<CalendarCheck2 className="h-4 w-4" />}
                  label="Active days"
                  value={data.range.activeDays.toLocaleString()}
                  accent="#12b886"
                />
                <Kpi
                  icon={<Flame className="h-4 w-4" />}
                  label="Longest streak"
                  value={`${data.streak.longest} day${data.streak.longest === 1 ? '' : 's'}`}
                  accent="#ef8c6c"
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
                />
              </div>

              {data.totals.messages === 0 ? (
                <p className="py-6 text-center text-[13px] text-(--wa-text-2)">
                  No messages yet — import a chat to see insights.
                </p>
              ) : (
                <>
                  {data.range.busiestDay && (
                    <p className="rounded-lg bg-(--wa-accent)/10 px-3 py-2 text-[12.5px] text-(--wa-accent-strong)">
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
                  >
                    <Heatmap grid={data.heatmap} total={data.totals.messages} />
                  </Section>

                  <Section title="Messages per month">
                    <div className="flex h-28 items-end gap-1.5 rounded-xl bg-(--wa-panel-2)/60 p-3 dark:bg-(--wa-panel-2)/60">
                      {data.months.length === 0 ? (
                        <p className="w-full text-center text-[12px] text-(--wa-text-2)">
                          No dated messages
                        </p>
                      ) : (
                        data.months.map((m) => (
                          <div
                            key={m.month}
                            className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                            title={`${monthLabel(m.month)}: ${m.count.toLocaleString()}`}
                          >
                            <span className="text-[9px] font-medium tabular-nums text-(--wa-text-2) opacity-0 transition-opacity group-hover:opacity-100 dark:text-(--wa-text-2)">
                              {m.count}
                            </span>
                            <div
                              className="w-full max-w-7 rounded-t-sm bg-(--wa-accent)/80 transition-colors group-hover:bg-(--wa-accent)"
                              style={{
                                height: `${Math.max((m.count / maxMonth) * 100, 3)}%`,
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
                  >
                    <HoursChart hours={data.hours} />
                  </Section>

                  <Section title="Activity by weekday">
                    <div className="space-y-1.5">
                      {data.weekdays.map((w) => (
                        <BarRow
                          key={w.weekday}
                          label={w.weekday}
                          value={w.count}
                          max={maxWeekday}
                          total={data.totals.messages}
                        />
                      ))}
                    </div>
                  </Section>

                  {/* Words + emojis side by side */}
                  {(data.topWords.length > 0 || data.topEmojis.length > 0) && (
                    <div className="grid gap-5 sm:grid-cols-2">
                      {data.topWords.length > 0 && (
                        <Section title="Top words">
                          <div className="flex flex-wrap gap-1.5">
                            {data.topWords.map((w) => (
                              <span
                                key={w.word}
                                className="rounded-full border border-black/5 bg-(--wa-panel-2)/70 px-2.5 py-1 text-[12px] text-(--wa-text) dark:border-white/5 dark:bg-(--wa-panel-2)/70 dark:text-(--wa-text)"
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
                        <Section title="Top emojis">
                          <div className="flex flex-wrap gap-2">
                            {data.topEmojis.map((e, i) => (
                              <div
                                key={e.emoji}
                                className="flex w-[68px] flex-col items-center rounded-lg border border-black/5 bg-(--wa-panel-2)/70 py-2 dark:border-white/5 dark:bg-(--wa-panel-2)/70"
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

                  <Section title="Fun facts">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <FunFact
                        icon={<Flame className="h-4 w-4" />}
                        value={`${data.streak.current} day${data.streak.current === 1 ? '' : 's'}`}
                        label="Current streak"
                        accent="#ef8c6c"
                      />
                      <FunFact
                        icon={<Link2 className="h-4 w-4" />}
                        value={data.fun.links.toLocaleString()}
                        label="Links shared"
                        accent="#0ea5a4"
                      />
                      <FunFact
                        icon={<HelpCircle className="h-4 w-4" />}
                        value={data.fun.questions.toLocaleString()}
                        label="Questions asked"
                        accent="#f2a33c"
                      />
                      <FunFact
                        icon={<Trash2 className="h-4 w-4" />}
                        value={deletedCount.toLocaleString()}
                        label="Deleted messages"
                        accent="#ef6c6c"
                      />
                      <FunFact
                        icon={<CalendarCheck2 className="h-4 w-4" />}
                        value={`${data.range.avgPerDay.toLocaleString()}`}
                        label="Avg msgs / active day"
                        accent="#12b886"
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

                  <Section title="Top chats">
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
                        {filteredChats.map((c) => (
                          <BarRow
                            key={c.id}
                            label={c.title}
                            value={c.count}
                            max={filteredChatMax}
                            total={data.totals.messages}
                            accent={c.isGroup ? '#e542a3' : 'var(--wa-accent)'}
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
                    <Section title="Most active people">
                      <div className="space-y-2.5">
                        {data.participants.map((p) => (
                          <div key={p.sender} className="flex items-center gap-2.5">
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
                                  className="h-full rounded-full transition-[width] duration-500"
                                  style={{
                                    width: `${Math.max((p.count / maxParticipant) * 100, 3)}%`,
                                    backgroundColor: colorForName(p.sender),
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

                  <Section title="Message types">
                    <div className="flex flex-wrap gap-1.5">
                      {data.types.map((t) => (
                        <span
                          key={t.type}
                          className={cn(
                            'rounded-full border border-black/5 bg-(--wa-panel-2)/70 px-2.5 py-1 text-[11.5px]',
                            'text-(--wa-text) dark:border-white/5 dark:bg-(--wa-panel-2)/70 dark:text-(--wa-text)'
                          )}
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
                    <Section title="Media storage by chat">
                      <div className="space-y-1.5">
                        {filteredStorage.map((s) => (
                          <BarRow
                            key={s.chatId}
                            label={s.title}
                            value={s.bytes}
                            max={filteredStorageMax}
                            total={data.storage.totalBytes}
                            accent="#12b886"
                            formatValue={formatBytes}
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
                </>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
