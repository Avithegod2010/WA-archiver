'use client'

import { useEffect, useState } from 'react'
import {
  BarChart3,
  CalendarDays,
  Loader2,
  MessageSquare,
  Images,
  Group,
  Smile,
  Type,
  HardDrive,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Avatar } from './Avatar'
import type { StatsData } from './types'
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
    <div className="flex items-center gap-3 rounded-xl border border-black/5 bg-[#f0f2f5]/60 p-3 dark:border-white/5 dark:bg-[#202c33]/60">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${accent}1f`, color: accent }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[17px] font-semibold leading-tight text-[#111b21] dark:text-[#e9edef]">
          {value}
        </p>
        <p className="truncate text-[11.5px] text-[#667781] dark:text-[#8696a0]">
          {label}
        </p>
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#667781] dark:text-[#8696a0]">
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
  accent = '#00a884',
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
      <span className="w-24 shrink-0 truncate text-[12.5px] text-[#3b4a54] dark:text-[#d1d7db]">
        {label}
      </span>
      <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: accent }}
        />
      </div>
      <span className="w-14 shrink-0 text-right text-[11.5px] tabular-nums text-[#667781] dark:text-[#8696a0]">
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function StatsDashboard({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  // undefined = not fetched yet (loading), null = fetch error
  const [data, setData] = useState<StatsData | null | undefined>(undefined)

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
  const maxChat = data ? Math.max(...data.perChat.map((c) => c.count), 1) : 1
  const maxParticipant = data
    ? Math.max(...data.participants.map((p) => p.count), 1)
    : 1
  const maxStorage = data
    ? Math.max(...data.storage.perChat.map((s) => s.bytes), 1)
    : 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-[#00a884]" />
            Insights
          </DialogTitle>
          <DialogDescription>
            Activity across all your imported chats — computed locally.
          </DialogDescription>
        </DialogHeader>

        <div className="wa-scroll -mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1 pb-1">
          {loading && !data ? (
            <div className="flex h-40 items-center justify-center gap-2 text-[13.5px] text-[#667781] dark:text-[#8696a0]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Crunching numbers...
            </div>
          ) : !data ? (
            <p className="py-10 text-center text-[13.5px] text-[#667781] dark:text-[#8696a0]">
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
                  accent="#00a884"
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
                <p className="py-6 text-center text-[13px] text-[#667781] dark:text-[#8696a0]">
                  No messages yet — import a chat to see insights.
                </p>
              ) : (
                <>
                  {data.range.busiestDay && (
                    <p className="rounded-lg bg-[#00a884]/10 px-3 py-2 text-[12.5px] text-[#0b7a63] dark:text-[#6fd3b6]">
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
                    </p>
                  )}

                  <Section title="Messages per month">
                    <div className="flex h-28 items-end gap-1.5 rounded-xl bg-[#f0f2f5]/60 p-3 dark:bg-[#202c33]/60">
                      {data.months.length === 0 ? (
                        <p className="w-full text-center text-[12px] text-[#8696a0]">
                          No dated messages
                        </p>
                      ) : (
                        data.months.map((m) => (
                          <div
                            key={m.month}
                            className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                            title={`${monthLabel(m.month)}: ${m.count.toLocaleString()}`}
                          >
                            <span className="text-[9px] font-medium tabular-nums text-[#667781] opacity-0 transition-opacity group-hover:opacity-100 dark:text-[#8696a0]">
                              {m.count}
                            </span>
                            <div
                              className="w-full max-w-7 rounded-t-sm bg-[#00a884]/80 transition-colors group-hover:bg-[#00a884]"
                              style={{
                                height: `${Math.max((m.count / maxMonth) * 100, 3)}%`,
                              }}
                            />
                            <span className="w-full truncate text-center text-[8.5px] text-[#667781] dark:text-[#8696a0]">
                              {monthLabel(m.month)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
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

                  <Section title="Top chats">
                    <div className="space-y-1.5">
                      {data.perChat.map((c) => (
                        <BarRow
                          key={c.id}
                          label={c.title}
                          value={c.count}
                          max={maxChat}
                          total={data.totals.messages}
                          accent={c.isGroup ? '#e542a3' : '#00a884'}
                          leading={
                            <span className="shrink-0">
                              <Avatar name={c.title} size={24} />
                            </span>
                          }
                        />
                      ))}
                    </div>
                  </Section>

                  {data.participants.length > 0 && (
                    <Section title="Most active people">
                      <div className="space-y-1.5">
                        {data.participants.map((p) => (
                          <BarRow
                            key={p.sender}
                            label={p.sender}
                            value={p.count}
                            max={maxParticipant}
                            total={data.totals.messages}
                            accent="#f2a33c"
                            leading={
                              <span className="shrink-0">
                                <Avatar name={p.sender} size={24} />
                              </span>
                            }
                          />
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
                            'rounded-full border border-black/5 bg-[#f0f2f5]/70 px-2.5 py-1 text-[11.5px]',
                            'text-[#3b4a54] dark:border-white/5 dark:bg-[#202c33]/70 dark:text-[#d1d7db]'
                          )}
                        >
                          {TYPE_LABELS[t.type] ?? t.type}
                          <b className="ml-1.5 tabular-nums text-[#00a884]">
                            {t.count.toLocaleString()}
                          </b>
                        </span>
                      ))}
                    </div>
                  </Section>

                  {data.storage.perChat.length > 0 && (
                    <Section title="Media storage by chat">
                      <div className="space-y-1.5">
                        {data.storage.perChat.map((s) => (
                          <BarRow
                            key={s.chatId}
                            label={s.title}
                            value={s.bytes}
                            max={maxStorage}
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
                        <p className="pt-0.5 text-right text-[10.5px] text-[#667781] dark:text-[#8696a0]">
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
