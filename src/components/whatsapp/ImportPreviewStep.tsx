'use client'

/**
 * Idea #13 — Selective import preview (device imports).
 *
 * Second step of the device import flow: the export has already been
 * parsed (nothing written yet), and this UI narrows what gets committed —
 * date range, senders, and media types — with a live "N of M messages"
 * counter. System notices are always kept (they document the export, not
 * the conversation) and media files are only extracted if a surviving
 * message still references them (handled by commitDeviceImport).
 */

import { useMemo, useState } from 'react'
import {
  AudioLines,
  BarChart3,
  CalendarRange,
  FileText,
  Film,
  Image as ImageIcon,
  MapPin,
  Paperclip,
  Phone,
  Sticker,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react'
import {
  applyImportSelection,
  type ImportPreviewData,
  type ImportSelection,
} from '@/lib/data'
import type { MessageType } from '@/lib/whatsapp-parser'
import { Avatar } from './Avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const DAY_MS = 24 * 60 * 60 * 1000

/** Content types a user can exclude (text/system are always kept). */
const EXCLUDABLE: Record<
  string,
  { label: string; icon: React.ReactNode }
> = {
  image: { label: 'Photos', icon: <ImageIcon className="h-3.5 w-3.5" /> },
  video: { label: 'Videos', icon: <Film className="h-3.5 w-3.5" /> },
  audio: { label: 'Voice', icon: <AudioLines className="h-3.5 w-3.5" /> },
  sticker: { label: 'Stickers', icon: <Sticker className="h-3.5 w-3.5" /> },
  gif: { label: 'GIFs', icon: <Film className="h-3.5 w-3.5" /> },
  document: { label: 'Docs', icon: <FileText className="h-3.5 w-3.5" /> },
  poll: { label: 'Polls', icon: <BarChart3 className="h-3.5 w-3.5" /> },
  location: { label: 'Places', icon: <MapPin className="h-3.5 w-3.5" /> },
  contact: { label: 'Contacts', icon: <UserRound className="h-3.5 w-3.5" /> },
  call: { label: 'Calls', icon: <Phone className="h-3.5 w-3.5" /> },
  media: { label: 'Media', icon: <Paperclip className="h-3.5 w-3.5" /> },
  deleted: { label: 'Deleted', icon: <Trash2 className="h-3.5 w-3.5" /> },
}

/** ISO date (YYYY-MM-DD) for a preset "N days back from the last message". */
function daysBack(lastAtMs: number, days: number): string {
  return new Date(lastAtMs - days * DAY_MS).toISOString().slice(0, 10)
}

function msFromDay(iso: string, endOfDay: boolean): number | null {
  if (!iso) return null
  const t = new Date(`${iso}T${endOfDay ? '23:59:59.999' : '00:00:00'}`).getTime()
  return Number.isFinite(t) ? t : null
}

function SectionLabel({
  icon,
  children,
  aside,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-(--wa-text-2)">
        {icon}
        {children}
      </span>
      {aside}
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors',
        active
          ? 'border-(--wa-accent)/50 bg-(--wa-accent)/12 text-(--wa-text) dark:text-white/90'
          : 'border-(--wa-line) bg-transparent text-(--wa-text-2) opacity-60 hover:opacity-100',
        className
      )}
    >
      {children}
    </button>
  )
}

export function ImportPreviewStep({
  data,
  busy,
  onCommit,
  onCancel,
}: {
  data: ImportPreviewData
  busy: boolean
  onCommit: (selection: ImportSelection) => void
  onCancel: () => void
}) {
  const { summary } = data
  const lastAtMs = Number.isFinite(Date.parse(summary.lastAt))
    ? Date.parse(summary.lastAt)
    : Date.now()

  const [fromDay, setFromDay] = useState('')
  const [toDay, setToDay] = useState('')
  // null = every sender; otherwise the checked set.
  const [senders, setSenders] = useState<Set<string> | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  const selection: ImportSelection = useMemo(
    () => ({
      fromMs: msFromDay(fromDay, false),
      toMs: msFromDay(toDay, true),
      senders: senders === null ? null : [...senders],
      excludedTypes: [...excluded],
    }),
    [fromDay, toDay, senders, excluded]
  )

  const keptCount = useMemo(
    () => applyImportSelection(data.parsed.messages, selection).length,
    [data.parsed.messages, selection]
  )

  const togglSender = (name: string) => {
    setSenders((prev) => {
      const next = new Set(prev ?? summary.senders.map((s) => s.name))
      if (next.has(name)) next.delete(name)
      else next.add(name)
      // Everything re-selected = equivalent to "all".
      return next.size === summary.senders.length ? null : next
    })
  }

  const toggleType = (type: string) => {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const mediaTypes = summary.typeCounts.filter(
    (t) => t.type !== 'text' && t.type !== 'system'
  )

  const datePresets: { label: string; days: number | null }[] = [
    { label: 'All time', days: null },
    { label: '7d', days: 7 },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
    { label: '1y', days: 365 },
  ]

  const applyPreset = (days: number | null) => {
    if (days === null) {
      setFromDay('')
      setToDay('')
    } else {
      setFromDay(daysBack(lastAtMs, days))
      setToDay(new Date(lastAtMs).toISOString().slice(0, 10))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary card */}
      <div className="rounded-xl border border-(--wa-line) bg-(--wa-panel-2) p-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={summary.title || summary.fileName} size={38} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-(--wa-text)">
              {summary.title || summary.fileName}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-(--wa-text-2)">
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" aria-hidden />
                {summary.isGroup ? 'Group' : '1:1 chat'}
              </span>
              <span aria-hidden>·</span>
              <span>{summary.totalMessages.toLocaleString()} messages</span>
              {summary.senders.length > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    {summary.senders.length}{' '}
                    {summary.senders.length === 1 ? 'sender' : 'senders'}
                  </span>
                </>
              )}
              {summary.mediaCandidates > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    {summary.mediaCandidates} media{' '}
                    {summary.mediaCandidates === 1 ? 'file' : 'files'}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        {summary.firstAt && (
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-(--wa-text-2)">
            <CalendarRange className="h-3.5 w-3.5" aria-hidden />
            {new Date(summary.firstAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
            {' → '}
            {new Date(summary.lastAt).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </p>
        )}
      </div>

      {/* Date range */}
      <div className="flex flex-col gap-2">
        <SectionLabel icon={<CalendarRange className="h-3.5 w-3.5" />}>
          Date range
        </SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {datePresets.map((p) => (
            <Chip
              key={p.label}
              active={
                p.days === null
                  ? fromDay === '' && toDay === ''
                  : toDay !== '' &&
                    fromDay === daysBack(lastAtMs, p.days) &&
                    toDay === new Date(lastAtMs).toISOString().slice(0, 10)
              }
              onClick={() => applyPreset(p.days)}
            >
              {p.label}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={fromDay}
            max={toDay || undefined}
            onChange={(e) => setFromDay(e.target.value)}
            aria-label="Import messages from date"
            className="h-9 min-w-0 flex-1 rounded-lg border border-(--wa-line) bg-(--wa-panel-2) px-2.5 text-[12.5px] text-(--wa-text) outline-none focus-visible:ring-2 focus-visible:ring-(--wa-accent)"
          />
          <span className="text-[12px] text-(--wa-text-2)" aria-hidden>
            →
          </span>
          <input
            type="date"
            value={toDay}
            min={fromDay || undefined}
            onChange={(e) => setToDay(e.target.value)}
            aria-label="Import messages to date"
            className="h-9 min-w-0 flex-1 rounded-lg border border-(--wa-line) bg-(--wa-panel-2) px-2.5 text-[12.5px] text-(--wa-text) outline-none focus-visible:ring-2 focus-visible:ring-(--wa-accent)"
          />
        </div>
      </div>

      {/* Senders */}
      {summary.senders.length > 1 && (
        <div className="flex flex-col gap-2">
          <SectionLabel
            icon={<Users className="h-3.5 w-3.5" />}
            aside={
              <span className="flex items-center gap-2 text-[11.5px]">
                <button
                  type="button"
                  className="text-(--wa-accent-strong) hover:underline dark:text-(--wa-accent)"
                  onClick={() => setSenders(null)}
                >
                  All
                </button>
                <button
                  type="button"
                  className="text-(--wa-accent-strong) hover:underline dark:text-(--wa-accent)"
                  onClick={() => setSenders(new Set())}
                >
                  None
                </button>
              </span>
            }
          >
            Senders
          </SectionLabel>
          <div className="wa-scroll max-h-36 overflow-y-auto rounded-xl border border-(--wa-line) bg-(--wa-panel-2) p-2">
            <div className="flex flex-wrap gap-1.5">
              {summary.senders.map((s) => {
                const active =
                  senders === null || senders.has(s.name)
                return (
                  <Chip
                    key={s.name}
                    active={active}
                    onClick={() => togglSender(s.name)}
                  >
                    <Avatar name={s.name} size={14} />
                    {s.name}
                    <span className="text-[10.5px] opacity-70">
                      {s.count.toLocaleString()}
                    </span>
                  </Chip>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Media types */}
      {mediaTypes.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionLabel icon={<Paperclip className="h-3.5 w-3.5" />}>
            Content types
          </SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {mediaTypes.map((t) => {
              const meta = EXCLUDABLE[t.type]
              const active = !excluded.has(t.type)
              return (
                <Chip
                  key={t.type}
                  active={active}
                  onClick={() => toggleType(t.type)}
                >
                  {meta?.icon}
                  {meta?.label ?? t.type}
                  <span className="text-[10.5px] opacity-70">
                    {t.count.toLocaleString()}
                  </span>
                </Chip>
              )
            })}
          </div>
        </div>
      )}

      {/* Live counter + actions */}
      <div className="sticky bottom-0 flex flex-col gap-2.5 border-t border-(--wa-line) bg-background pt-3">
        <p
          className="text-center text-[12.5px] text-(--wa-text-2)"
          aria-live="polite"
        >
          <span className="font-semibold text-(--wa-text)">
            {keptCount.toLocaleString()}
          </span>{' '}
          of {summary.totalMessages.toLocaleString()} messages will be imported
          {summary.systemCount > 0 && (
            <> · system notices always kept</>
          )}
        </p>
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-10"
            onClick={onCancel}
            disabled={busy}
          >
            Back
          </Button>
          <Button
            size="sm"
            className="h-10 gap-2 bg-(--wa-accent) px-4 text-white hover:bg-(--wa-accent-strong)"
            disabled={busy || keptCount === 0}
            onClick={() => onCommit(selection)}
          >
            <FileText className="h-4 w-4" aria-hidden />
            Import {keptCount.toLocaleString()}{' '}
            {keptCount === 1 ? 'message' : 'messages'}
          </Button>
        </div>
      </div>
    </div>
  )
}
