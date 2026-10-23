'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import {
  Ban,
  BarChart3,
  Download,
  FileJson,
  FileText,
  Film,
  ImageIcon,
  Loader2,
  MapPin,
  Mic,
  PhoneMissed,
  Star,
  StarOff,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Avatar } from './Avatar'
import { useData, useMessageNormalizer } from './data-provider'
import type { ChatMessage } from './types'
import { cn } from '@/lib/utils'
import { downloadBlob } from '@/lib/wordcloud-png'

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\u0900-\u097f\u0b80-\u0bff\u0600-\u06ff]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'chat'
  )
}

const TYPE_LABEL: Record<string, string> = {
  image: 'Photo',
  video: 'Video',
  gif: 'GIF',
  audio: 'Voice message',
  sticker: 'Sticker',
  document: 'Document',
  poll: 'Poll',
  location: 'Location',
  contact: 'Contact card',
  call: 'Missed call',
  deleted: 'Deleted message',
  media: 'Media',
}

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Preview({ msg }: { msg: ChatMessage }) {
  if (msg.type === 'deleted') {
    return (
      <span className="flex items-center gap-1 italic text-(--wa-text-2)">
        <Ban className="h-3 w-3" /> {msg.body || 'This message was deleted'}
      </span>
    )
  }
  if (msg.type === 'call') {
    return (
      <span className="flex items-center gap-1 text-(--wa-text-2)">
        <PhoneMissed className="h-3 w-3 text-rose-500" /> {msg.body || 'Missed call'}
      </span>
    )
  }
  if (msg.type === 'poll') {
    return (
      <span className="flex items-center gap-1">
        <BarChart3 className="h-3 w-3" /> POLL: {msg.body}
      </span>
    )
  }
  if (msg.type === 'location') {
    return (
      <span className="flex items-center gap-1">
        <MapPin className="h-3 w-3 text-(--wa-accent)" /> Location
      </span>
    )
  }
  const icon =
    msg.type === 'image' || msg.type === 'sticker' ? (
      <ImageIcon className="h-3 w-3" />
    ) : msg.type === 'video' || msg.type === 'gif' ? (
      <Film className="h-3 w-3" />
    ) : msg.type === 'audio' ? (
      <Mic className="h-3 w-3" />
    ) : msg.type === 'document' ? (
      <FileText className="h-3 w-3" />
    ) : null

  if (icon) {
    return (
      <span className="flex items-center gap-1">
        {icon}
        {msg.body || (
          <span className="italic">
            {TYPE_LABEL[msg.type] ?? 'Media'}
            {msg.mediaName ? ` · ${msg.mediaName}` : ' (not in export)'}
          </span>
        )}
      </span>
    )
  }
  return <span className="whitespace-pre-wrap">{msg.body}</span>
}

/**
 * Lists the chat's starred messages; clicking a row jumps to the message.
 * Star state is viewer-local (stored alongside the imported chat).
 */
export function StarredMessages({
  open,
  onOpenChange,
  chatId,
  chatTitle,
  isGroup,
  onJumpToMessage,
  onUnstar,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  chatId: string
  chatTitle: string
  isGroup: boolean
  onJumpToMessage: (id: string) => void
  onUnstar: (id: string) => void
}) {
  const { data } = useData()
  const normalizeMessages = useMessageNormalizer()
  const [items, setItems] = useState<ChatMessage[] | null | undefined>(undefined)
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  useEffect(() => {
    if (!open) return
    let alive = true
    ;(async () => {
      try {
        // StarredItem[] is a subset of ChatMessage — the preview renderer only
        // reads body/type/mediaName, and the normalizer resolves mediaPath to
        // a blob: URL in device mode (server mode is a passthrough).
        const { items: rows } = await data.listStarred(chatId)
        const normalized = await normalizeMessages(
          chatId,
          rows as unknown as ChatMessage[]
        )
        if (alive) setItems(normalized)
      } catch {
        if (alive) {
          setItems(null)
          toast.error('Could not load starred messages')
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [open, chatId, data, normalizeMessages])

  function handleUnstar(id: string) {
    setItems((list) => (list ? list.filter((m) => m.id !== id) : list))
    onUnstar(id)
    toast.success('Message unstarred')
  }

  /** Trigger a client-side download of the starred list (TXT or JSON). */
  function exportStarred(fmt: 'txt' | 'json') {
    if (!items || items.length === 0) {
      toast.error('Nothing to export yet')
      return
    }
    try {
      const stamp = new Date().toISOString()
      const slug = slugify(chatTitle)
      if (fmt === 'json') {
        const payload = {
          kind: 'whatsapp-viewer-starred',
          version: 1,
          exportedAt: stamp,
          chat: { id: chatId, title: chatTitle, isGroup },
          count: items.length,
          messages: items.map((m) => ({
            id: m.id,
            ts: m.ts,
            sender: m.sender,
            body: m.body,
            type: m.type,
            mediaName: m.mediaName ?? null,
          })),
        }
        downloadBlob(
          new Blob([JSON.stringify(payload, null, 2)], {
            type: 'application/json',
          }),
          `starred-${slug}.json`
        )
      } else {
        const lines: string[] = [
          `Starred messages — ${chatTitle}`,
          `Exported ${new Date().toLocaleString()} · ${items.length} messages · via WA Archiver`,
          '',
        ]
        for (const m of items) {
          const when = new Date(m.ts).toLocaleString([], {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
          lines.push(`[${when}] ${m.sender ?? 'System'}:`)
          const label = TYPE_LABEL[m.type]
          const body = m.body || (label ? label : '')
          for (const l of body.split('\n')) lines.push(`  ${l}`)
          if (m.mediaName && m.body) lines.push(`  (attachment: ${m.mediaName})`)
          lines.push('')
        }
        downloadBlob(
          new Blob([lines.join('\n')], { type: 'text/plain' }),
          `starred-${slug}.txt`
        )
      }
      toast.success('Starred messages exported')
    } catch {
      toast.error('Could not export starred messages')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Star className="h-5 w-5 fill-[#f2a33c] text-[#f2a33c]" />
            Starred messages
          </DialogTitle>
          <DialogDescription>
            Kept in {chatTitle} — click one to jump to it in the chat.
          </DialogDescription>

          {items != null && items.length > 0 && (
            <div className="flex shrink-0 gap-2 pt-1">
              <button
                type="button"
                onClick={() => exportStarred('txt')}
                className="inline-flex items-center gap-1.5 rounded-md border border-black/[0.06] px-2.5 py-1.5 text-[12px] font-medium text-(--wa-text-2) transition-colors hover:bg-(--wa-accent)/10 hover:text-(--wa-accent-strong) dark:border-white/10"
                title="Download starred messages as a .txt file"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Export .txt
              </button>
              <button
                type="button"
                onClick={() => exportStarred('json')}
                className="inline-flex items-center gap-1.5 rounded-md border border-black/[0.06] px-2.5 py-1.5 text-[12px] font-medium text-(--wa-text-2) transition-colors hover:bg-(--wa-accent)/10 hover:text-(--wa-accent-strong) dark:border-white/10"
                title="Download starred messages as .json"
              >
                <FileJson className="h-3.5 w-3.5" aria-hidden />
                Export .json
              </button>
            </div>
          )}
        </DialogHeader>

        <div className="wa-scroll -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {items === undefined && (
            <div className="flex h-32 items-center justify-center gap-2 text-[13.5px] text-(--wa-text-2)">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {items === null && (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10">
                <Star className="h-6 w-6 text-rose-400" />
              </span>
              <p className="text-[14px] font-medium text-(--wa-text)">
                Could not load starred messages
              </p>
              <p className="max-w-[260px] text-[12.5px] leading-relaxed text-(--wa-text-2)">
                Something went wrong. Close and reopen this dialog to retry.
              </p>
            </div>
          )}
          {items != null && items.length === 0 && (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#f2a33c]/10">
                <Star className="h-6 w-6 text-[#f2a33c]" />
              </span>
              <p className="text-[14px] font-medium text-(--wa-text)">
                No starred messages yet
              </p>
              <p className="max-w-[260px] text-[12.5px] leading-relaxed text-(--wa-text-2)">
                Right-click or long-press a message and choose <b>Star</b> to
                bookmark it here.
              </p>
            </div>
          )}
          {items != null && items.length > 0 && (
            <ul className="space-y-1.5 pb-1">
              {items.map((m) => (
                <li key={m.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      onOpenChange(false)
                      onJumpToMessage(m.id)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onOpenChange(false)
                        onJumpToMessage(m.id)
                      }
                    }}
                    className={cn(
                      'group flex w-full cursor-pointer items-start gap-2.5 rounded-lg border border-black/5 bg-(--wa-panel-2)/60 p-2.5 text-left transition-colors',
                      'hover:bg-(--wa-accent)/10 hover:ring-1 hover:ring-(--wa-accent)/40 dark:border-white/5 dark:bg-(--wa-panel-2)/60 dark:hover:bg-(--wa-accent)/15'
                    )}
                  >
                    {isGroup && m.sender ? (
                      <Avatar name={m.sender} size={30} className="mt-0.5 shrink-0" />
                    ) : m.sender === 'You' ? (
                      <span className="mt-0.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-(--wa-accent)/15 text-[10px] font-semibold text-(--wa-accent-strong)">
                        You
                      </span>
                    ) : (
                      <span className="mt-0.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[#f2a33c]/15 text-[#f2a33c]">
                        <Star className="h-3.5 w-3.5 fill-current" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-[12.5px] font-semibold text-(--wa-text)">
                          {m.sender ?? 'System'}
                        </span>
                        <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-(--wa-text-2)">
                          {formatStamp(m.ts)}
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug text-(--wa-text)">
                        <Preview msg={m} />
                      </span>
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleUnstar(m.id)
                      }}
                      aria-label="Unstar message"
                      title="Unstar"
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-(--wa-text-2) opacity-0 transition-all hover:bg-rose-500/10 hover:text-rose-500 focus-visible:opacity-100 group-hover:opacity-100 dark:text-(--wa-text-2)"
                    >
                      <StarOff className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
