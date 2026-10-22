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
  Check,
  FileText,
  Film,
  GitMerge,
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
import {
  estimateNewForMerge,
  type ImportMergeCandidate,
} from '@/lib/import-dedup'
import type { MessageType } from '@/lib/whatsapp-parser'
import { Avatar } from './Avatar'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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

/**
 * Compact month span for the merge banner: "Jan–Mar 2024" (same year) or
 * "Jan 24–Mar 25" (cross-year). Falls back to a friendly dash when the chat
 * has no datable messages.
 */
function monthSpan(
  firstIso: string | null | undefined,
  lastIso: string | null | undefined
): string {
  if (!firstIso || !lastIso) return 'no dates'
  const f = new Date(firstIso)
  const l = new Date(lastIso)
  if (!Number.isFinite(f.getTime()) || !Number.isFinite(l.getTime())) {
    return 'no dates'
  }
  const m = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' })
  if (f.getFullYear() === l.getFullYear()) {
    return `${m(f)}–${m(l)} ${f.getFullYear()}`
  }
  return `${m(f)} ${String(f.getFullYear()).slice(2)}–${m(l)} ${String(
    l.getFullYear()
  ).slice(2)}`
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
  mergeCandidates = [],
  onCommit,
  onCancel,
}: {
  data: ImportPreviewData
  busy: boolean
  /** B1: existing chats matching this export (title or sourceFile). */
  mergeCandidates?: ImportMergeCandidate[]
  /** B1: second arg is the existing chat id when the user chose "Merge". */
  onCommit: (selection: ImportSelection, mergeIntoChatId?: string) => void
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
  // B1 — merge target: 'new' (default) keeps today's behavior, 'merge'
  // folds the filtered transcript into the matched existing chat.
  const [target, setTarget] = useState<'new' | 'merge'>('new')
  const [mergeChatId, setMergeChatId] = useState<string | null>(null)

  const selection: ImportSelection = useMemo(
    () => ({
      fromMs: msFromDay(fromDay, false),
      toMs: msFromDay(toDay, true),
      senders: senders === null ? null : [...senders],
      excludedTypes: [...excluded],
    }),
    [fromDay, toDay, senders, excluded]
  )

  const keptMessages = useMemo(
    () => applyImportSelection(data.parsed.messages, selection),
    [data.parsed.messages, selection]
  )
  const keptCount = keptMessages.length

  // Effective merge candidate: the picked one, else the first match.
  const candidate =
    mergeCandidates.find((c) => c.id === mergeChatId) ?? mergeCandidates[0] ?? null
  // Rough "~N new" estimate: incoming messages outside the existing chat's
  // date span cannot be duplicates. Exact numbers come from commit-time dedup.
  const estimatedNew = candidate
    ? estimateNewForMerge(keptMessages, candidate.firstAt, candidate.lastAt)
    : keptCount

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

      {/* B1 — merge banner: an existing chat looks like this export */}
      {mergeCandidates.length > 0 && (
        <div
          className="rounded-xl border border-(--wa-line) bg-(--wa-panel-2) p-3"
          role="group"
          aria-label="Existing chat match"
        >
          <SectionLabel icon={<GitMerge className="h-3.5 w-3.5" />}>
            Existing chat{mergeCandidates.length > 1 ? `s · ${mergeCandidates.length}` : ''} found
          </SectionLabel>

          {mergeCandidates.length === 1 && candidate && (
            <div className="mt-2 flex items-center gap-2.5">
              <Avatar name={candidate.title} size={28} />
              <p className="min-w-0 flex-1 truncate text-[12.5px] text-(--wa-text-2)">
                <span className="font-semibold text-(--wa-text)">
                  {candidate.title}
                </span>{' '}
                · {candidate.messageCount.toLocaleString()} msgs ·{' '}
                {monthSpan(candidate.firstAt, candidate.lastAt)} · matched by{' '}
                {candidate.matchedBy.join(' + ')}
              </p>
            </div>
          )}

          <RadioGroup
            value={target}
            onValueChange={(v) => setTarget(v as 'new' | 'merge')}
            aria-label="Import target"
            className="mt-1.5 gap-1"
          >
            <label
              htmlFor="import-target-new"
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 transition-colors hover:bg-(--wa-row-hover)"
            >
              <RadioGroupItem
                value="new"
                id="import-target-new"
                aria-label="Import as new chat"
              />
              <span className="text-[13px] font-medium text-(--wa-text)">
                Import as new chat
              </span>
            </label>
            <label
              htmlFor="import-target-merge"
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-1.5 transition-colors hover:bg-(--wa-row-hover)"
            >
              <RadioGroupItem
                value="merge"
                id="import-target-merge"
                aria-label="Merge into existing chat"
              />
              <span className="text-[13px] font-medium text-(--wa-text)">
                Merge into existing chat
              </span>
              <span className="ml-auto text-[11px] text-(--wa-text-2)">
                duplicates are skipped
              </span>
            </label>
          </RadioGroup>

          {target === 'merge' && candidate && (
            <div className="mt-2 flex flex-col gap-2">
              {mergeCandidates.length > 1 && (
                <div
                  role="radiogroup"
                  aria-label="Choose the existing chat to merge into"
                  className="wa-scroll flex max-h-40 flex-col gap-1.5 overflow-y-auto"
                >
                  {mergeCandidates.map((c) => {
                    const picked = c.id === candidate.id
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={picked}
                        aria-label={`Merge into ${c.title}`}
                        onClick={() => setMergeChatId(c.id)}
                        className={cn(
                          'flex min-h-11 w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors',
                          picked
                            ? 'border-(--wa-accent)/50 bg-(--wa-accent)/10'
                            : 'border-(--wa-line) hover:bg-(--wa-row-hover)'
                        )}
                      >
                        <Avatar name={c.title} size={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-(--wa-text)">
                            {c.title}
                          </span>
                          <span className="block truncate text-[11px] text-(--wa-text-2)">
                            {c.messageCount.toLocaleString()} msgs ·{' '}
                            {monthSpan(c.firstAt, c.lastAt)} · matched by{' '}
                            {c.matchedBy.join(' + ')}
                          </span>
                        </span>
                        {picked && (
                          <Check
                            className="h-4 w-4 shrink-0 text-(--wa-accent)"
                            aria-hidden
                          />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
              <p
                className="rounded-lg bg-(--wa-accent)/8 px-2.5 py-2 text-[12px] leading-relaxed text-(--wa-text-2)"
                aria-live="polite"
              >
                Merge into{' '}
                <span className="font-semibold text-(--wa-text)">
                  ‘{candidate.title}’
                </span>{' '}
                — existing{' '}
                <span className="font-semibold text-(--wa-text)">
                  {candidate.messageCount.toLocaleString()}
                </span>{' '}
                msgs ({monthSpan(candidate.firstAt, candidate.lastAt)}), incoming{' '}
                <span className="font-semibold text-(--wa-text)">
                  {keptCount.toLocaleString()}
                </span>{' '}
                ({monthSpan(summary.firstAt, summary.lastAt)}), ~
                {estimatedNew.toLocaleString()} new
              </p>
            </div>
          )}
        </div>
      )}

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
          of {summary.totalMessages.toLocaleString()} messages will be{' '}
          {target === 'merge' ? 'merged' : 'imported'}
          {summary.systemCount > 0 && (
            <> · system notices always kept</>
          )}
          {target === 'merge' && <> · exact duplicates are skipped</>}
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
            disabled={busy || (keptCount === 0 && target !== 'merge')}
            onClick={() =>
              onCommit(
                selection,
                target === 'merge' && candidate ? candidate.id : undefined
              )
            }
          >
            {target === 'merge' ? (
              <GitMerge className="h-4 w-4" aria-hidden />
            ) : (
              <FileText className="h-4 w-4" aria-hidden />
            )}
            {target === 'merge'
              ? `Merge ${keptCount.toLocaleString()} ${
                  keptCount === 1 ? 'message' : 'messages'
                }`
              : `Import ${keptCount.toLocaleString()} ${
                  keptCount === 1 ? 'message' : 'messages'
                }`}
          </Button>
        </div>
      </div>
    </div>
  )
}
