'use client'

import { useMemo, useState } from 'react'
import {
  BarChart3,
  Bell,
  BellOff,
  CalendarCheck2,
  CalendarDays,
  FileText,
  Flame,
  HelpCircle,
  Image as ImageIcon,
  Link2,
  Mic,
  MessageCircle,
  Palette,
  Slash,
  Timer,
  Users,
  Video,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Avatar } from './Avatar'
import type { ChatDetailChat, ChatMessage } from './types'
import { colorForName } from './types'
import {
  EMOJI_RE,
  URL_TEST_RE,
  countWords,
  fmtReply,
  hourLabel,
  median,
} from '@/lib/chat-analytics'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import {
  accentFor,
  CHAT_ACCENTS,
  clearChatTheme,
  isChatMuted,
  readChatTheme,
  setChatMuted,
  writeChatTheme,
  type ChatAccent,
  type ChatTheme,
} from './chat-theme'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function topEmojis(messages: ChatMessage[], limit = 4): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const m of messages) {
    const body = m.body ?? ''
    if (!body) continue
    const matches = body.match(EMOJI_RE)
    if (!matches) continue
    for (const e of matches) {
      counts.set(e, (counts.get(e) ?? 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
}

export function ChatInfo({
  open,
  onOpenChange,
  chat,
  messages,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  chat: ChatDetailChat
  messages: ChatMessage[]
  onJumpToMessage?: () => void
}) {
  const stats = useMemo(() => {
    const senderCounts = new Map<string, number>()
    const senderWords = new Map<string, number>()
    const senderEmojis = new Map<string, number>()
    // reply time deltas per sender (switch-of-turn gaps)
    const replyDeltas = new Map<string, number[]>()
    const wordCount = new Map<string, number>()
    let photos = 0
    let videos = 0
    let audios = 0
    let docs = 0
    let words = 0
    let links = 0
    let questions = 0
    const perDay = new Map<string, number>()
    const hourCounts = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: 0,
    }))
    const emojiRe = EMOJI_RE

    let prev: ChatMessage | null = null
    for (const m of messages) {
      if (m.sender) {
        senderCounts.set(m.sender, (senderCounts.get(m.sender) ?? 0) + 1)
      }
      if (m.type === 'image' || m.type === 'sticker' || m.type === 'media') photos++
      else if (m.type === 'video' || m.type === 'gif') videos++
      else if (m.type === 'audio') audios++
      else if (m.type === 'document') docs++

      const body = m.body ?? ''
      const w = body.split(/\s+/).filter(Boolean).length
      words += w
      if (m.sender) senderWords.set(m.sender, (senderWords.get(m.sender) ?? 0) + w)

      const found = body.match(emojiRe)
      if (found && m.sender) {
        senderEmojis.set(m.sender, (senderEmojis.get(m.sender) ?? 0) + found.length)
      }

      if (URL_TEST_RE.test(body)) links++
      if (body.trimEnd().endsWith('?')) questions++

      // word tokens
      countWords(body, wordCount)

      // turn switch → reply time for the new sender
      if (
        m.sender &&
        prev?.sender &&
        m.sender !== prev.sender &&
        prev.type !== 'system'
      ) {
        const delta = new Date(m.ts).getTime() - new Date(prev.ts).getTime()
        if (delta > 0 && delta < 6 * 3_600_000) {
          const arr = replyDeltas.get(m.sender) ?? []
          arr.push(delta)
          replyDeltas.set(m.sender, arr)
        }
      }

      const d = new Date(m.ts)
      if (!Number.isNaN(d.getTime())) {
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
        perDay.set(key, (perDay.get(key) ?? 0) + 1)
        hourCounts[d.getHours()].count++
      }

      prev = m
    }

    let busiestDay: { key: string; count: number } | null = null
    for (const [key, count] of perDay) {
      if (!busiestDay || count > busiestDay.count) busiestDay = { key, count }
    }

    // longest consecutive-day streak
    const days = [...perDay.keys()]
      .map((k) => new Date(k).getTime())
      .sort((a, b) => a - b)
    let streak = 0
    let run = 0
    let prevT: number | null = null
    for (const t of days) {
      run = prevT != null && t - prevT === 86_400_000 ? run + 1 : 1
      if (run > streak) streak = run
      prevT = t
    }

    const replies = new Map<string, number>()
    for (const [sender, deltas] of replyDeltas) {
      if (deltas.length >= 2) replies.set(sender, median(deltas))
    }

    const topWords = [...wordCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)

    return {
      senders: [...senderCounts.entries()].sort((a, b) => b[1] - a[1]),
      senderWords,
      senderEmojis,
      replies,
      topWords,
      photos,
      videos,
      audios,
      docs,
      words,
      links,
      questions,
      busiestDay,
      hourCounts,
      hoursTotal: messages.length,
      activeDays: perDay.size,
      avgPerDay: perDay.size > 0 ? Math.round(messages.length / perDay.size) : 0,
      streak,
      total: messages.length,
    }
  }, [messages])

  const maxSender = stats.senders.length > 0 ? stats.senders[0][1] : 1
  const emojis = useMemo(() => topEmojis(messages), [messages])
  const peakHour = stats.hourCounts.reduce(
    (a, b) => (b.count > a.count ? b : a),
    stats.hourCounts[0]
  )
  const maxHour = Math.max(...stats.hourCounts.map((h) => h.count), 1)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="wa-scroll max-h-[85vh] overflow-y-auto bg-(--wa-panel-2) p-0 dark:bg-(--wa-panel) sm:max-w-md">
        <DialogHeader className="bg-(--wa-appbar) p-6">
          <div className="anim-fade-up flex flex-col items-center gap-3 text-center">
            <div className="anim-pop">
              <Avatar name={chat.title} size={88} className="ring-4 ring-white/20" />
            </div>
            <div>
              <DialogTitle className="text-xl font-medium text-white dark:text-(--wa-text)">
                {chat.title}
              </DialogTitle>
              <DialogDescription className="text-[13px] text-white/80">
                {chat.isGroup ? 'Group chat' : 'Direct chat'} · imported{' '}
                {fmtDate(chat.firstAt)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 p-6">
          {/* Accent colour (per-chat theme) */}
          <section className="wa-info-sec">
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
              <Palette className="h-3.5 w-3.5" />
              Accent colour
            </h3>
            <AccentSection key={`accent-${chat.id}`} chatId={chat.id} />
          </section>

          {/* Mute notifications */}
          <section className="wa-info-sec">
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
              <BellOff className="h-3.5 w-3.5" />
              Mute notifications
            </h3>
            <MuteSection key={`mute-${chat.id}`} chatId={chat.id} />
          </section>

          {/* Totals */}
          <section className="wa-info-sec">
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
              Overview
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                icon={<MessageCircle className="h-4 w-4" />}
                label="Messages"
                value={stats.total.toLocaleString()}
              />
              <StatCard
                icon={<FileText className="h-4 w-4" />}
                label="Words"
                value={stats.words.toLocaleString()}
              />
              <StatCard
                icon={<CalendarCheck2 className="h-4 w-4" />}
                label="Active days"
                value={stats.activeDays.toLocaleString()}
              />
              <StatCard
                icon={<Flame className="h-4 w-4" />}
                label="Longest streak"
                value={`${stats.streak} day${stats.streak === 1 ? '' : 's'}`}
              />
              <StatCard
                icon={<CalendarDays className="h-4 w-4" />}
                label="First message"
                value={fmtDate(chat.firstAt)}
                small
              />
              <StatCard
                icon={<CalendarDays className="h-4 w-4" />}
                label="Last message"
                value={fmtDate(chat.lastAt)}
                small
              />
            </div>
          </section>

          {/* Media breakdown */}
          <section className="wa-info-sec">
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
              Media
            </h3>
            <div className="grid grid-cols-4 gap-2">
              <StatCard
                icon={<ImageIcon className="h-4 w-4" />}
                label="Photos"
                value={String(stats.photos)}
                center
              />
              <StatCard
                icon={<Video className="h-4 w-4" />}
                label="Videos"
                value={String(stats.videos)}
                center
              />
              <StatCard
                icon={<Mic className="h-4 w-4" />}
                label="Voice"
                value={String(stats.audios)}
                center
              />
              <StatCard
                icon={<FileText className="h-4 w-4" />}
                label="Docs"
                value={String(stats.docs)}
                center
              />
            </div>
          </section>

          {/* Activity by hour */}
          {stats.total > 0 && (
            <section className="wa-info-sec">
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
                Activity by hour
              </h3>
              <div className="rounded-lg bg-white p-3 shadow-sm dark:bg-(--wa-panel-2)">
                <div className="flex h-16 items-end gap-[2px]">
                  {stats.hourCounts.map((h, i) => (
                    <div
                      key={h.hour}
                      className="group relative min-w-0 flex-1"
                      title={`${hourLabel(h.hour)}: ${h.count}`}
                    >
                      <div
                        className={cn(
                          'wa-bar w-full rounded-t-[2px] transition-colors',
                          h.hour === peakHour.hour && peakHour.count > 0
                            ? 'bg-[#f2a33c]'
                            : 'bg-(--wa-accent)/70'
                        )}
                        style={{
                          height: `${Math.max((h.count / maxHour) * 100, h.count > 0 ? 5 : 2)}%`,
                          animationDelay: `${i * 14}ms`,
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[8.5px] text-(--wa-text-2)">
                  <span>12am</span>
                  <span>6am</span>
                  <span>12pm</span>
                  <span>6pm</span>
                  <span>11pm</span>
                </div>
                <p className="mt-1.5 text-[11.5px] text-(--wa-text-2)">
                  Busiest hour:{' '}
                  <b className="text-(--wa-text)">
                    {hourLabel(peakHour.hour)}
                  </b>{' '}
                  · {stats.avgPerDay}/day on active days
                </p>
              </div>
            </section>
          )}

          {/* Participants */}
          <section className="wa-info-sec">
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
              <Users className="h-3.5 w-3.5" />
              Participants ({stats.senders.length})
            </h3>
            <div className="space-y-2.5">
              {stats.senders.map(([name, count], i) => {
                const reply = stats.replies.get(name)
                return (
                  <div key={name} className="flex items-center gap-3">
                    <Avatar name={name} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13.5px] font-medium text-(--wa-text)">
                          {name}
                        </span>
                        <span className="shrink-0 text-[12px] text-(--wa-text-2)">
                          {count.toLocaleString()} ·{' '}
                          {Math.round((count / Math.max(1, stats.total)) * 100)}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                        <div
                          className="wa-fill h-full rounded-full"
                          style={{
                            width: `${Math.max(4, (count / maxSender) * 100)}%`,
                            backgroundColor: colorForName(name),
                            animationDelay: `${i * 70}ms`,
                          }}
                        />
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10.5px] tabular-nums text-(--wa-text-2)">
                        <span>
                          {(stats.senderWords.get(name) ?? 0).toLocaleString()} words
                        </span>
                        <span>
                          {(stats.senderEmojis.get(name) ?? 0).toLocaleString()} emojis
                        </span>
                        {reply != null && (
                          <span className="inline-flex items-center gap-0.5">
                            <Timer className="h-3 w-3" />
                            {fmtReply(reply)} median reply
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Top emojis */}
          {emojis.length > 0 && (
            <section className="wa-info-sec">
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
                Most used emojis
              </h3>
              <div className="flex gap-2">
                {emojis.map(([emoji, count], i) => (
                  <div
                    key={emoji}
                    className="flex flex-1 flex-col items-center rounded-lg bg-white p-3 shadow-sm dark:bg-(--wa-panel-2)"
                  >
                    <span className="text-2xl leading-none">{emoji}</span>
                    <span className="mt-1.5 text-[12px] font-medium text-(--wa-text-2)">
                      ×{count}
                    </span>
                    {i === 0 && (
                      <span className="mt-0.5 text-[10px] uppercase tracking-wide text-(--wa-accent)">
                        favorite
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Top words */}
          {stats.topWords.length > 0 && (
            <section className="wa-info-sec">
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
                Most used words
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {stats.topWords.map(([word, count]) => (
                  <span
                    key={word}
                    className="rounded-full border border-black/5 bg-white px-2.5 py-1 text-[12px] text-(--wa-text) shadow-sm dark:border-white/5 dark:bg-(--wa-panel-2) dark:text-(--wa-text)"
                  >
                    {word}
                    <b className="ml-1.5 tabular-nums text-(--wa-accent)">
                      {count.toLocaleString()}
                    </b>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Fun facts */}
          {stats.total > 0 && (
            <section className="wa-info-sec">
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
                Fun facts
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <MiniFact
                  icon={<Link2 className="h-3.5 w-3.5" />}
                  value={stats.links.toLocaleString()}
                  label="links"
                  accent="#0ea5a4"
                />
                <MiniFact
                  icon={<HelpCircle className="h-3.5 w-3.5" />}
                  value={stats.questions.toLocaleString()}
                  label="questions"
                  accent="#f2a33c"
                />
                <MiniFact
                  icon={<CalendarCheck2 className="h-3.5 w-3.5" />}
                  value={stats.avgPerDay.toLocaleString()}
                  label="avg / day"
                  accent="#12b886"
                />
              </div>
            </section>
          )}

          {/* Busiest day */}
          {stats.busiestDay && (
            <section className="wa-info-sec flex items-center gap-2 rounded-lg bg-(--wa-accent)/10 px-3 py-2.5 text-[13px] text-(--wa-accent-strong) dark:text-(--wa-accent)">
              <BarChart3 className="h-4 w-4 shrink-0" />
              Busiest day:{' '}
              {new Date(stats.busiestDay.key).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}{' '}
              with {stats.busiestDay.count} messages
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Accent-colour picker: 8 curated swatches + Default reset + live preview. */
function AccentSection({ chatId }: { chatId: string }) {
  const [theme, setTheme] = useState<ChatTheme>(() => readChatTheme(chatId))
  const pair = accentFor(theme)

  const pick = (a: ChatAccent) => {
    setTheme({ accent: a.accent })
    writeChatTheme(chatId, { accent: a.accent })
  }
  const reset = () => {
    setTheme({})
    clearChatTheme(chatId)
  }

  return (
    <div className="rounded-lg bg-white p-3 shadow-sm dark:bg-(--wa-panel-2)">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Accent colour">
        <button
          type="button"
          onClick={reset}
          aria-pressed={!theme.accent}
          aria-label="Default accent"
          title="Default"
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-full transition-transform',
            !theme.accent &&
              'ring-2 ring-(--wa-text-2)/50 ring-offset-2 ring-offset-white dark:ring-offset-(--wa-panel-2)'
          )}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-(--wa-text-2)/40 bg-(--wa-panel-2)/70 text-(--wa-text-2)">
            <Slash className="h-3.5 w-3.5" />
          </span>
        </button>
        {CHAT_ACCENTS.map((a) => {
          const active = theme.accent === a.accent
          return (
            <button
              key={a.name}
              type="button"
              onClick={() => pick(a)}
              aria-pressed={active}
              aria-label={`${a.name} accent`}
              title={a.name}
              style={{ '--sw': a.accentStrong } as React.CSSProperties}
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-full transition-transform',
                active
                  ? 'ring-2 ring-(--sw) ring-offset-2 ring-offset-white dark:ring-offset-(--wa-panel-2)'
                  : 'hover:scale-110'
              )}
            >
              <span
                className="h-7 w-7 rounded-full shadow-sm"
                style={{
                  background: `linear-gradient(135deg, ${a.accent} 20%, ${a.accentStrong} 100%)`,
                }}
              />
            </button>
          )
        })}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: pair.accent }}
        />
        <p className="text-[12px] text-(--wa-text-2)">
          Current: <b className="font-semibold text-(--wa-text)">{pair.name}</b>
        </p>
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-(--wa-text-2)">
        Colours this chat’s header, bubbles and buttons.
      </p>

      {/* Live preview — two mini bubbles tinted with the chosen accent */}
      <div className="mt-2.5 overflow-hidden rounded-md bg-(--wa-chat-bg) p-2.5">
        <div className="flex flex-col gap-1.5">
          <div
            className="max-w-[85%] self-start rounded-xl rounded-tl-sm border px-2.5 py-1.5"
            style={{
              backgroundColor: `${pair.accent}1f`,
              borderColor: `${pair.accent}33`,
            }}
          >
            <p className="text-[11.5px] leading-snug text-(--wa-text)">
              Are we still on for lunch?
            </p>
            <p className="mt-0.5 text-right text-[9px] text-(--wa-text-2)">11:24</p>
          </div>
          <div
            className="max-w-[85%] self-end rounded-xl rounded-tr-sm px-2.5 py-1.5 text-white"
            style={{
              background: `linear-gradient(135deg, ${pair.accent}, ${pair.accentStrong})`,
            }}
          >
            <p className="text-[11.5px] leading-snug">Yes — see you there! 🎉</p>
            <p className="mt-0.5 text-right text-[9px] text-white/75">11:25 ✓✓</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Mute toggle for this chat — persists to localStorage + wa-mute-changed event. */
function MuteSection({ chatId }: { chatId: string }) {
  const [muted, setMuted] = useState(() => isChatMuted(chatId))

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-white p-3 shadow-sm dark:bg-(--wa-panel-2)">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            muted
              ? 'bg-black/10 text-(--wa-text-2) dark:bg-white/10'
              : 'bg-(--wa-accent)/10 text-(--wa-accent)'
          )}
        >
          {muted ? <BellOff className="h-4.5 w-4.5" /> : <Bell className="h-4.5 w-4.5" />}
        </span>
        <div className="min-w-0">
          <p className="text-[12.5px] font-medium text-(--wa-text)">
            Mute notification toasts
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-(--wa-text-2)">
            {muted
              ? 'Toast alerts are silenced for this chat.'
              : 'Show toast alerts for new messages here.'}
          </p>
        </div>
      </div>
      <Switch
        checked={muted}
        onCheckedChange={(v) => {
          setMuted(v)
          setChatMuted(chatId, v)
        }}
        aria-label="Mute notification toasts"
      />
    </div>
  )
}

function MiniFact({
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
    <div className="flex flex-col items-center rounded-lg bg-white p-2.5 text-center shadow-sm dark:bg-(--wa-panel-2)">
      <span
        className="mb-1 flex h-6 w-6 items-center justify-center rounded-md"
        style={{ backgroundColor: `${accent}1f`, color: accent }}
      >
        {icon}
      </span>
      <span className="text-[15px] font-semibold leading-none text-(--wa-text)">
        {value}
      </span>
      <span className="mt-0.5 text-[10.5px] text-(--wa-text-2)">
        {label}
      </span>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  center,
  small,
}: {
  icon: React.ReactNode
  label: string
  value: string
  center?: boolean
  small?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-lg bg-white p-3 shadow-sm dark:bg-(--wa-panel-2)',
        center && 'flex flex-col items-center text-center'
      )}
    >
      <p
        className={cn(
          'flex items-center gap-1.5 text-[12px] text-(--wa-text-2)',
          center && 'justify-center'
        )}
      >
        {icon}
        {label}
      </p>
      <p
        className={cn(
          'mt-1 font-semibold text-(--wa-text)',
          small ? 'text-[13px]' : 'text-lg',
          center && 'text-lg'
        )}
      >
        {value}
      </p>
    </div>
  )
}
