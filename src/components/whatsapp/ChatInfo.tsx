'use client'

import { useMemo } from 'react'
import {
  BarChart3,
  CalendarDays,
  FileText,
  Image as ImageIcon,
  Mic,
  MessageCircle,
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
import { cn } from '@/lib/utils'

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
  const re = /\p{Extended_Pictographic}/gu
  for (const m of messages) {
    const body = m.body ?? ''
    if (!body) continue
    const matches = body.match(re)
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
    let photos = 0
    let videos = 0
    let audios = 0
    let docs = 0
    let words = 0
    const perDay = new Map<string, number>()

    for (const m of messages) {
      if (m.sender) {
        senderCounts.set(m.sender, (senderCounts.get(m.sender) ?? 0) + 1)
      }
      if (m.type === 'image' || m.type === 'sticker' || m.type === 'media') photos++
      else if (m.type === 'video' || m.type === 'gif') videos++
      else if (m.type === 'audio') audios++
      else if (m.type === 'document') docs++
      words += (m.body ?? '').split(/\s+/).filter(Boolean).length

      const d = new Date(m.ts)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      perDay.set(key, (perDay.get(key) ?? 0) + 1)
    }

    let busiestDay: { key: string; count: number } | null = null
    for (const [key, count] of perDay) {
      if (!busiestDay || count > busiestDay.count) busiestDay = { key, count }
    }

    return {
      senders: [...senderCounts.entries()].sort((a, b) => b[1] - a[1]),
      photos,
      videos,
      audios,
      docs,
      words,
      busiestDay,
      total: messages.length,
    }
  }, [messages])

  const maxSender = stats.senders.length > 0 ? stats.senders[0][1] : 1
  const emojis = useMemo(() => topEmojis(messages), [messages])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="wa-scroll max-h-[85vh] overflow-y-auto bg-[#f0f2f5] p-0 dark:bg-[#111b21] sm:max-w-md">
        <DialogHeader className="bg-[#008069] p-6 dark:bg-[#202c33]">
          <div className="flex flex-col items-center gap-3 text-center">
            <Avatar name={chat.title} size={88} className="ring-4 ring-white/20" />
            <div>
              <DialogTitle className="text-xl font-medium text-white dark:text-[#e9edef]">
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
          {/* Totals */}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[#667781] dark:text-[#8696a0]">
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
          <section>
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[#667781] dark:text-[#8696a0]">
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

          {/* Participants */}
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-[#667781] dark:text-[#8696a0]">
              <Users className="h-3.5 w-3.5" />
              Participants ({stats.senders.length})
            </h3>
            <div className="space-y-2.5">
              {stats.senders.map(([name, count]) => (
                <div key={name} className="flex items-center gap-3">
                  <Avatar name={name} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13.5px] font-medium text-[#111b21] dark:text-[#e9edef]">
                        {name}
                      </span>
                      <span className="shrink-0 text-[12px] text-[#667781] dark:text-[#8696a0]">
                        {count.toLocaleString()} ·{' '}
                        {Math.round((count / Math.max(1, stats.total)) * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(4, (count / maxSender) * 100)}%`,
                          backgroundColor: colorForName(name),
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Top emojis */}
          {emojis.length > 0 && (
            <section>
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[#667781] dark:text-[#8696a0]">
                Most used emojis
              </h3>
              <div className="flex gap-2">
                {emojis.map(([emoji, count], i) => (
                  <div
                    key={emoji}
                    className="flex flex-1 flex-col items-center rounded-lg bg-white p-3 shadow-sm dark:bg-[#202c33]"
                  >
                    <span className="text-2xl leading-none">{emoji}</span>
                    <span className="mt-1.5 text-[12px] font-medium text-[#667781] dark:text-[#8696a0]">
                      ×{count}
                    </span>
                    {i === 0 && (
                      <span className="mt-0.5 text-[10px] uppercase tracking-wide text-[#00a884]">
                        favorite
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Busiest day */}
          {stats.busiestDay && (
            <section className="flex items-center gap-2 rounded-lg bg-[#008069]/10 px-3 py-2.5 text-[13px] text-[#008069] dark:bg-[#00a884]/10 dark:text-[#00a884]">
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
        'rounded-lg bg-white p-3 shadow-sm dark:bg-[#202c33]',
        center && 'flex flex-col items-center text-center'
      )}
    >
      <p
        className={cn(
          'flex items-center gap-1.5 text-[12px] text-[#667781] dark:text-[#8696a0]',
          center && 'justify-center'
        )}
      >
        {icon}
        {label}
      </p>
      <p
        className={cn(
          'mt-1 font-semibold text-[#111b21] dark:text-[#e9edef]',
          small ? 'text-[13px]' : 'text-lg',
          center && 'text-lg'
        )}
      >
        {value}
      </p>
    </div>
  )
}
