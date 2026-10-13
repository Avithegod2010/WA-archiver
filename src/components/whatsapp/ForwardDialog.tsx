'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Search, SendHorizontal } from 'lucide-react'
import { Avatar, SavedAvatar } from './Avatar'
import { SAVED_CHAT_ID, type ChatMessage, type ChatSummary } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/**
 * Text payload for a forwarded message: the caption/text when present,
 * otherwise a friendly placeholder for media-only messages.
 */
const FORWARD_PLACEHOLDERS: Record<string, string> = {
  image: '📷 Photo',
  video: '🎥 Video',
  gif: '🎞 GIF',
  audio: '🎤 Voice message',
  sticker: '🌟 Sticker',
  document: '📎 Document',
  contact: '👤 Contact card',
  location: '📍 Location',
  poll: '📊 Poll',
  media: '📷 Media',
  deleted: 'This message was deleted',
}

function forwardBody(m: ChatMessage): string {
  const b = (m.body ?? '').trim()
  if (b) return b
  return FORWARD_PLACEHOLDERS[m.type] ?? '[Message]'
}

/**
 * ForwardDialog (Task 10-b) — forwards one or more messages into other chats.
 * Searchable chat list, multi-select targets; each forward POSTs a text
 * message carrying `forwardedFrom` so the copy renders with the
 * "Forwarded from <chat>" chip.
 */
export function ForwardDialog({
  open,
  onOpenChange,
  messages,
  sourceChatId,
  sourceChatTitle,
  onForwarded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Messages to forward (captured by the caller when the dialog was opened). */
  messages: ChatMessage[]
  /** Source chat — hidden from the target list to avoid instant duplication. */
  sourceChatId: string
  sourceChatTitle: string
  /** Called after forwarding finishes with the number of chats that succeeded. */
  onForwarded?: (chatCount: number) => void
}) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  // Load the chat list fresh each time the dialog opens.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setChats(null)
    setLoadFailed(false)
    setQuery('')
    setSelected(new Set())
    ;(async () => {
      try {
        const res = await fetch('/api/chats')
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Could not load chats')
        if (!cancelled) {
          setChats((Array.isArray(data.chats) ? data.chats : []) as ChatSummary[])
        }
      } catch {
        if (!cancelled) setLoadFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const targets = useMemo(() => {
    if (!chats) return []
    const q = query.trim().toLowerCase()
    return chats.filter(
      (c) => c.id !== sourceChatId && (!q || c.title.toLowerCase().includes(q))
    )
  }, [chats, query, sourceChatId])

  function toggleTarget(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function forward() {
    if (selected.size === 0 || busy || !chats) return
    setBusy(true)
    const titleById = new Map(chats.map((c) => [c.id, c.title]))
    const targetIds = [...selected]
    let okChats = 0
    const progress = toast.loading(
      `Forwarding to ${titleById.get(targetIds[0]) ?? 'chat'}…`
    )
    for (const id of targetIds) {
      const title = titleById.get(id) ?? 'chat'
      toast.loading(`Forwarding to ${title}…`, { id: progress })
      let ok = true
      for (const m of messages) {
        try {
          const res = await fetch(`/api/chats/${id}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'text',
              body: forwardBody(m).slice(0, 8000),
              sender: 'You',
              forwardedFrom: sourceChatTitle,
            }),
          })
          if (!res.ok) ok = false
        } catch {
          ok = false
        }
      }
      if (ok) okChats++
    }
    if (okChats > 0) {
      toast.success(
        `Forwarded ${messages.length} message${messages.length === 1 ? '' : 's'} to ${okChats} chat${okChats === 1 ? '' : 's'}`,
        { id: progress }
      )
      onForwarded?.(okChats)
      onOpenChange(false)
    } else {
      toast.error('Could not forward — try again', { id: progress })
    }
    setBusy(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!busy) onOpenChange(v)
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b px-5 pb-3 pt-5">
          <DialogTitle>
            Forward {messages.length === 1 ? 'message' : `${messages.length} messages`}
          </DialogTitle>
          <DialogDescription>
            Pick one or more chats — each copy carries a “Forwarded from{' '}
            {sourceChatTitle}” note.
          </DialogDescription>
        </DialogHeader>

        <div className="px-4 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--wa-text-2)" />
            <Input
              suppressHydrationWarning
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats…"
              className="h-10 rounded-full bg-(--wa-in) pl-9 text-[14px] dark:bg-(--wa-row-active) dark:text-(--wa-text) dark:placeholder:text-(--wa-text-2)"
              aria-label="Search chats to forward to"
            />
          </div>
        </div>

        <div className="wa-scroll min-h-[140px] flex-1 overflow-y-auto px-2 py-2">
          {chats === null && !loadFailed && (
            <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-(--wa-text-2)">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading chats…
            </div>
          )}
          {loadFailed && (
            <p className="py-10 text-center text-[13px] text-(--wa-text-2)">
              Could not load chats — close and try again.
            </p>
          )}
          {chats !== null && targets.length === 0 && (
            <p className="py-10 text-center text-[13px] text-(--wa-text-2)">
              No chats match “{query}”.
            </p>
          )}
          {targets.map((c) => {
            const active = selected.has(c.id)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleTarget(c.id)}
                aria-pressed={active}
                className={cn(
                  'flex min-h-[56px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                  active
                    ? 'bg-(--wa-accent)/10'
                    : 'hover:bg-black/5 dark:hover:bg-white/5'
                )}
              >
                {c.id === SAVED_CHAT_ID ? (
                  <SavedAvatar size={40} />
                ) : (
                  <Avatar name={c.title} size={40} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-(--wa-text)">
                    {c.title}
                  </span>
                  <span className="block truncate text-[12px] text-(--wa-text-2)">
                    {c.messageCount} message{c.messageCount === 1 ? '' : 's'}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors',
                    active
                      ? 'border-(--wa-accent) bg-(--wa-accent) text-white'
                      : 'border-(--wa-text-2)/40 text-transparent'
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                </span>
              </button>
            )
          })}
        </div>

        <DialogFooter className="flex-row items-center gap-2 border-t px-5 py-3">
          <span className="min-w-0 flex-1 truncate text-left text-[12.5px] text-(--wa-text-2)">
            {selected.size === 0
              ? 'Select chats to forward to'
              : `${selected.size} chat${selected.size === 1 ? '' : 's'} selected`}
          </span>
          <Button
            variant="ghost"
            className="rounded-full"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
            disabled={selected.size === 0 || busy}
            onClick={() => void forward()}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizontal className="h-4 w-4" />
            )}
            Forward
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
