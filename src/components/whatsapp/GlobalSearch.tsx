'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart3,
  Ban,
  FileText,
  Film,
  Loader2,
  MapPin,
  TextSearch,
  Mic,
  PhoneMissed,
  Search,
  StickyNote,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import type { SearchChatGroup, SearchHit, SearchResult } from '@/lib/data'
import { Avatar } from './Avatar'
import { colorForName } from './types'
import { useData } from './data-provider'
import { formatChatTime } from './display'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const HIT_TYPE_META: Record<string, { icon: React.ReactNode; label: string }> = {
  image: { icon: <Film className="h-3 w-3" />, label: 'Photo' },
  sticker: { icon: <StickyNote className="h-3 w-3" />, label: 'Sticker' },
  gif: { icon: <Film className="h-3 w-3" />, label: 'GIF' },
  video: { icon: <Film className="h-3 w-3" />, label: 'Video' },
  audio: { icon: <Mic className="h-3 w-3" />, label: 'Voice' },
  document: { icon: <FileText className="h-3 w-3" />, label: 'Document' },
  location: { icon: <MapPin className="h-3 w-3" />, label: 'Location' },
  contact: { icon: <UserRound className="h-3 w-3" />, label: 'Contact' },
  poll: { icon: <BarChart3 className="h-3 w-3" />, label: 'Poll' },
  call: { icon: <PhoneMissed className="h-3 w-3" />, label: 'Call' },
  deleted: { icon: <Ban className="h-3 w-3" />, label: 'Deleted' },
  media: { icon: <Film className="h-3 w-3" />, label: 'Media' },
}

/** Per-chat result bucket (mirrors the /api/search + data.searchAll shape). */
type ChatGroup = SearchChatGroup

function formatHitTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameYear = d.getFullYear() === now.getFullYear()
  const date = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  return `${date}, ${formatChatTime(d)}`
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Highlights the query (case-insensitive substring, matching the API's
 *  LIKE behaviour) inside a hit body using a soft accent <mark>. */
function HighlightedBody({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  const parts: React.ReactNode[] = []
  if (!q) return <>{text}</>
  let re: RegExp
  try {
    re = new RegExp(escapeRegExp(q), 'gi')
  } catch {
    return <>{text}</>
  }
  let i = 0
  let key = 0
  let guard = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1
      continue
    }
    if (++guard > 500) break // safety valve for pathological inputs
    if (m.index > i) parts.push(text.slice(i, m.index))
    parts.push(
      <mark
        key={key++}
        className="rounded bg-(--wa-accent)/20 px-0.5 text-(--wa-text)"
      >
        {m[0]}
      </mark>
    )
    i = m.index + m[0].length
  }
  if (i < text.length) parts.push(text.slice(i))
  return <>{parts}</>
}

/**
 * WhatsApp-style search across messages of every chat. Results are grouped by
 * chat; clicking a hit opens that chat and jumps to the message.
 */
export function GlobalSearch({
  open,
  onOpenChange,
  initialQuery,
  onOpenMessage,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialQuery: string
  onOpenMessage: (chatId: string, messageId: string) => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [data, setData] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  // Keyboard selection across the flattened result list
  const [selIdx, setSelIdx] = useState(0)
  const { data: dataClient } = useData()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const seqRef = useRef(0)

  // Sync the input each time the dialog is (re)opened with a new seed query
  const lastSeedRef = useRef<string | null>(null)
  if (open && lastSeedRef.current !== initialQuery) {
    lastSeedRef.current = initialQuery
    setQuery(initialQuery)
  }
  if (!open && lastSeedRef.current !== null) {
    lastSeedRef.current = null
    setData(null)
  }

  // Flatten results (chat order preserved) for keyboard navigation, and
  // reset the selection whenever a new result set lands.
  const flat = useMemo(() => {
    const list: { g: ChatGroup; h: SearchHit }[] = []
    const indexOf = new Map<string, number>()
    if (data) {
      for (const g of data.chats) {
        for (const h of g.hits) {
          indexOf.set(h.id, list.length)
          list.push({ g, h })
        }
      }
    }
    return { list, indexOf }
  }, [data])
  const lastResultsRef = useRef<SearchResult | null>(null)
  if (data !== lastResultsRef.current) {
    lastResultsRef.current = data
    setSelIdx(0)
  }

  const trimmed = query.trim()

  // Debounced search
  useEffect(() => {
    if (!open) return
    if (!trimmed) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const seq = ++seqRef.current
    const t = setTimeout(async () => {
      try {
        const json = await dataClient.searchAll(trimmed)
        if (seqRef.current === seq) setData(json)
      } catch {
        if (seqRef.current === seq) {
          setData(null)
          toast.error('Search failed — try again')
        }
      } finally {
        if (seqRef.current === seq) setLoading(false)
      }
    }, 220)
    return () => clearTimeout(t)
  }, [trimmed, open, dataClient])

  // Autofocus + select the input when opened
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 50)
    return () => clearTimeout(t)
  }, [open])

  // Keep the keyboard-selected hit in view
  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selIdx, data, open])

  const totalHits = data?.totalHits ?? 0
  const totalChats = data?.totalChats ?? 0

  const hint = useMemo(() => {
    if (!trimmed) return null
    if (loading) return null
    if (!data) return null
    const parts: string[] = []
    parts.push(
      `${totalHits.toLocaleString()} message${totalHits === 1 ? '' : 's'} in ${totalChats} chat${totalChats === 1 ? '' : 's'}`
    )
    if (data.truncated) parts.push('showing the 200 most recent')
    if (data.chats.length > 0)
      parts.push('↑↓ to navigate · Enter to open')
    return parts.join(' · ')
  }, [trimmed, loading, data, totalHits, totalChats])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="gap-0 border-b border-black/5 px-4 pb-3 pt-4 dark:border-white/5">
          <DialogTitle className="flex items-center gap-2 text-[15.5px]">
            <TextSearch className="h-4.5 w-4.5 text-(--wa-accent)" />
            Search messages
          </DialogTitle>
          <DialogDescription className="sr-only">
            Search message text across all chats
          </DialogDescription>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--wa-text-2)" />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-(--wa-accent)" />
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  if (flat.list.length > 0)
                    setSelIdx((i) => Math.min(i + 1, flat.list.length - 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSelIdx((i) => Math.max(i - 1, 0))
                } else if (e.key === 'Enter') {
                  const sel = flat.list[Math.min(selIdx, flat.list.length - 1)]
                  if (sel) {
                    e.preventDefault()
                    onOpenChange(false)
                    onOpenMessage(sel.g.id, sel.h.id)
                  }
                }
              }}
              placeholder="Search all chats…"
              aria-label="Search all chats"
              role="searchbox"
              aria-keyshortcuts="Enter ArrowUp ArrowDown"
              className="h-10 w-full rounded-lg border-none bg-(--wa-panel-2) pl-9 pr-9 text-[14px] text-(--wa-text) outline-none ring-(--wa-accent)/60 placeholder:text-(--wa-text-2) focus:ring-2 dark:bg-(--wa-row-active) dark:text-(--wa-text) dark:placeholder:text-(--wa-text-2)"
            />
          </div>
          {hint && (
            <p className="mt-2 text-[12px] text-(--wa-text-2)">
              {hint}
            </p>
          )}
        </DialogHeader>

        <div
          ref={listRef}
          className="wa-scroll min-h-[160px] flex-1 overflow-y-auto overscroll-contain"
        >
          {!trimmed ? (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-(--wa-accent)/10">
                <TextSearch className="h-6 w-6 text-(--wa-accent)" />
              </div>
              <p className="text-[14px] font-medium text-(--wa-text)">
                Search every chat at once
              </p>
              <p className="mt-1.5 max-w-[300px] text-[12.5px] leading-relaxed text-(--wa-text-2)">
                Type above to find messages across all your chats — matches are
                grouped per chat. Click one to jump straight to it.
              </p>
            </div>
          ) : !loading && (!data || data.chats.length === 0) ? (
            <div className="flex flex-col items-center px-6 py-12 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-black/5 dark:bg-white/5">
                <Search className="h-6 w-6 text-(--wa-text-2)" />
              </div>
              <p className="text-[14px] font-medium text-(--wa-text)">
                No messages found
              </p>
              <p className="mt-1.5 text-[12.5px] text-(--wa-text-2)">
                Nothing matches &quot;{trimmed}&quot; in any chat.
              </p>
            </div>
          ) : (
            <div className="pb-2">
              {data?.chats.map((group) => (
                <section key={group.id} aria-label={`Matches in ${group.title}`}>
                  {/* Sticky chat header */}
                  <div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-black/5 bg-white/95 px-4 py-2 backdrop-blur-sm dark:border-white/5 dark:bg-(--wa-panel)/95">
                    <Avatar name={group.title} size={30} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-(--wa-text)">
                      {group.title}
                    </span>
                    {group.isGroup && (
                      <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-(--wa-text-2) dark:bg-white/10 dark:text-(--wa-text-2)">
                        Group
                      </span>
                    )}
                    <span className="rounded-full bg-(--wa-accent)/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-(--wa-accent-strong) dark:bg-(--wa-accent)/20">
                      {group.count}
                    </span>
                  </div>
                  <ul role="list">
                    {group.hits.map((hit) => {
                      const meta = HIT_TYPE_META[hit.type]
                      const idx = flat.indexOf.get(hit.id) ?? -1
                      const isSelected = idx === selIdx
                      return (
                        <li key={hit.id}>
                          <button
                            onClick={() => {
                              onOpenChange(false)
                              onOpenMessage(group.id, hit.id)
                            }}
                            data-selected={isSelected || undefined}
                            aria-current={isSelected ? 'true' : undefined}
                            className={cn(
                              'group flex w-full items-start gap-3 px-4 py-2 text-left transition-colors hover:bg-(--wa-row-hover)',
                              isSelected &&
                                'bg-(--wa-row-hover) shadow-[inset_2px_0_0_var(--wa-accent)]'
                            )}
                          >
                            <span
                              className="mt-1 w-[64px] shrink-0 text-right text-[11px] leading-snug text-(--wa-text-2)"
                              aria-hidden
                            >
                              {formatHitTime(hit.ts)}
                            </span>
                            <span className="min-w-0 flex-1">
                              {group.isGroup && hit.sender && (
                                <span
                                  className="mr-1.5 text-[12.5px] font-semibold"
                                  style={{ color: colorForName(hit.sender) }}
                                >
                                  {hit.sender === 'You'
                                    ? 'You'
                                    : hit.sender}
                                </span>
                              )}
                              {hit.sender === 'You' && !group.isGroup && (
                                <span className="mr-1.5 text-[12.5px] font-semibold text-(--wa-accent-strong)">
                                  You
                                </span>
                              )}
                              <span
                                className={cn(
                                  'text-[13.5px] leading-snug text-(--wa-text)',
                                  hit.type === 'system' && 'italic'
                                )}
                              >
                                {meta && (
                                  <span className="mr-1 inline-flex translate-y-[1px] items-center gap-0.5 rounded bg-black/5 px-1 py-px align-[1px] text-[10px] font-semibold uppercase tracking-wide text-(--wa-text-2) dark:bg-white/10 dark:text-(--wa-text-2)">
                                    {meta.icon}
                                    {meta.label}
                                  </span>
                                )}
                                <HighlightedBody text={hit.body} query={trimmed} />
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                    {group.count > group.hits.length && (
                      <li className="px-4 pb-2 pt-0.5 text-[11.5px] text-(--wa-text-2)">
                        + {(group.count - group.hits.length).toLocaleString()}{' '}
                        more in this chat
                      </li>
                    )}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
