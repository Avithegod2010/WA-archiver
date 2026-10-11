'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  FileText,
  ImageIcon,
  Loader2,
  Plus,
  Reply,
  SendHorizontal,
  Smile,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ChatMessage } from './types'
import { cn } from '@/lib/utils'

const QUICK_EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😜',
  '🤔', '😎', '😢', '😭', '😡', '🥳', '😴', '🤒',
  '👍', '👎', '🙏', '👏', '💪', '🤝', '✌️', '🫶',
  '❤️', '🔥', '⭐', '🎉', '🎂', '🍕', '☕', '🌱',
  '☀️', '🌙', '🌈', '⚽', '🚗', '✈️', '📱', '💡',
  '✅', '❌', '❓', '❗', '💬', '📌', '🔗', '📝',
]

type ApiMessageLike = ChatMessage

/** One-line preview for the reply strip when the quoted message has no text. */
const REPLY_PLACEHOLDERS: Record<string, string> = {
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

function replyPreviewText(m: ChatMessage): string {
  const body = (m.body ?? '').trim()
  if (body) return body
  return REPLY_PLACEHOLDERS[m.type] ?? '[Message]'
}

/**
 * WhatsApp-style composer for local editing: text input with emoji picker,
 * attachment menu (photos/videos/documents) and a poll button. All sends go
 * through /api/chats/:id/messages and are attributed to "You".
 *
 * Task 10-b: the composer is ACTIVE by default in every chat. When a reply
 * is pending it shows a WhatsApp-style quote strip; the send payload carries
 * `replyToId` so the new message renders with its quote.
 */
export function Composer({
  chatId,
  onSent,
  onOpenPoll,
  replyTo = null,
  onCancelReply,
  onJumpToReply,
}: {
  chatId: string
  onSent: (msg: ChatMessage) => void
  onOpenPoll: () => void
  /** Message currently being replied to (quote strip shown when set). */
  replyTo?: ChatMessage | null
  /** Clear the active reply — X button, and auto-clear after a send. */
  onCancelReply?: () => void
  /** Optional nicety: tap the quote preview to jump to + flash the original. */
  onJumpToReply?: () => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const docInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the input when a reply starts (WhatsApp behavior).
  useEffect(() => {
    if (replyTo) inputRef.current?.focus()
  }, [replyTo])

  async function postJson(payload: Record<string, unknown>) {
    const res = await fetch(`/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Send failed')
    return data.message as ApiMessageLike
  }

  async function postFile(file: File, caption: string, replyToId?: string) {
    const form = new FormData()
    form.append('file', file)
    if (caption) form.append('caption', caption)
    if (replyToId) form.append('replyToId', replyToId)
    const res = await fetch(`/api/chats/${chatId}/messages`, {
      method: 'POST',
      body: form,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Upload failed')
    return data.message as ApiMessageLike
  }

  async function sendText() {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      const msg = await postJson({
        type: 'text',
        body,
        ...(replyTo ? { replyToId: replyTo.id } : {}),
      })
      setText('')
      onSent(msg)
      if (replyTo) onCancelReply?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send message')
    } finally {
      setBusy(false)
    }
  }

  async function sendFiles(list: FileList | null) {
    const files = list ? Array.from(list) : []
    if (files.length === 0 || busy) return
    setBusy(true)
    const caption = text.trim()
    let ok = 0
    const firstToast = toast.loading(
      files.length > 1 ? `Sending 1 of ${files.length}…` : 'Sending…'
    )
    try {
      // Caption applies to a single attachment; multiple files send as-is.
      // A pending reply is attached to the first file only.
      for (let i = 0; i < files.length; i++) {
        const msg = await postFile(
          files[i],
          files.length === 1 ? caption : i === 0 && caption ? caption : '',
          i === 0 && replyTo ? replyTo.id : undefined
        )
        onSent(msg)
        ok++
        if (files.length > 1 && i < files.length - 1) {
          toast.loading(`Sending ${i + 2} of ${files.length}…`, {
            id: firstToast,
          })
        }
      }
      // Leftover text sent as its own message when it wasn't used as caption
      // (the reply, if any, was already consumed by the first attachment).
      if (files.length > 1 && caption) {
        const msg = await postJson({ type: 'text', body: caption })
        onSent(msg)
      }
      setText('')
      if (replyTo) onCancelReply?.()
      toast.success(
        ok === 1 ? 'Sent' : `Sent ${ok} files`,
        ok > 0 ? { id: firstToast } : undefined
      )
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not send file',
        { id: firstToast }
      )
    } finally {
      setBusy(false)
      if (mediaInputRef.current) mediaInputRef.current.value = ''
      if (docInputRef.current) docInputRef.current.value = ''
    }
  }

  const canSend = text.trim().length > 0 && !busy

  return (
    <div className="relative z-10 border-t border-black/5 bg-(--wa-panel-2) px-2 py-2 dark:bg-(--wa-panel-2)">
      {/* Hidden inputs for attachments */}
      <input
        ref={mediaInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => sendFiles(e.target.files)}
      />
      <input
        ref={docInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => sendFiles(e.target.files)}
      />

      {/* Reply quote strip (WhatsApp-style): accent bar + sender + 1-line body */}
      {replyTo && (
        <div
          className="wa-reply-strip mb-1.5 flex items-center overflow-hidden rounded-lg bg-black/[0.045] dark:bg-white/[0.06]"
          role="group"
          aria-label={`Replying to ${replyTo.sender ?? 'message'}`}
        >
          <span
            aria-hidden
            className="w-1 shrink-0 self-stretch bg-(--wa-accent)"
          />
          <button
            type="button"
            onClick={onJumpToReply}
            className="flex h-11 min-w-0 flex-1 items-center gap-2 px-2.5 text-left"
            title="Jump to the message you're replying to"
          >
            <Reply className="h-4 w-4 shrink-0 text-(--wa-accent)" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-semibold leading-tight text-(--wa-accent-strong) dark:text-(--wa-accent)">
                Replying to {replyTo.sender ?? 'message'}
              </span>
              <span className="block truncate text-[12.5px] leading-tight text-(--wa-text-2)">
                {replyPreviewText(replyTo)}
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            title="Cancel reply"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-black/10 dark:hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-1.5">
        {/* Attach menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              className="wa-iconbtn group/plus h-10 w-10 shrink-0 rounded-full text-(--wa-text-2) hover:bg-black/5 dark:text-(--wa-text-2) dark:hover:bg-white/10"
              aria-label="Attach"
              title="Attach photo, video, document or poll"
            >
              <Plus
                className={cn(
                  'h-6 w-6 transition-transform duration-200',
                  'group-hover/plus:rotate-90 group-active/plus:rotate-90'
                )}
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[190px]">
            <DropdownMenuItem
              className="gap-2.5"
              onClick={() => mediaInputRef.current?.click()}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-(--wa-accent)/15 text-(--wa-accent)">
                <ImageIcon className="h-4 w-4" />
              </span>
              Photo or video
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2.5"
              onClick={() => docInputRef.current?.click()}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-300">
                <FileText className="h-4 w-4" />
              </span>
              Document
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5" onClick={onOpenPoll}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 20V10M12 20V4M18 20v-6" strokeLinecap="round" />
                </svg>
              </span>
              Poll
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Emoji picker */}
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              className="wa-iconbtn h-10 w-10 shrink-0 rounded-full text-(--wa-text-2) hover:bg-black/5 dark:text-(--wa-text-2) dark:hover:bg-white/10"
              aria-label="Emoji"
              title="Emoji"
            >
              <Smile className="h-6 w-6" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="top"
            className="w-[264px] p-2"
          >
            <div className="wa-scroll grid max-h-[220px] grid-cols-8 gap-0.5 overflow-y-auto">
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[19px] transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => setText((t) => t + e)}
                  aria-label={`Insert ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Text input */}
        <Input
          ref={inputRef}
          suppressHydrationWarning
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendText()
            }
          }}
          disabled={busy}
          placeholder="Type a message"
          className="h-10 flex-1 rounded-full border-none bg-white px-4 text-[14.5px] text-(--wa-text) shadow-sm dark:bg-(--wa-row-active) dark:text-(--wa-text) dark:placeholder:text-(--wa-text-2)"
          aria-label="Message text"
        />

        {/* Send button */}
        <Button
          size="icon"
          disabled={busy}
          onClick={sendText}
          className={cn(
            'h-10 w-10 shrink-0 rounded-full text-white shadow-md transition-all duration-200 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] hover:scale-110 active:scale-90 disabled:hover:scale-100',
            canSend || busy
              ? 'bg-(--wa-accent) hover:bg-(--wa-accent-strong)'
              : 'bg-(--wa-text-2)/60'
          )}
          aria-label="Send message"
          title="Send"
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <SendHorizontal className="h-5 w-5" />
          )}
        </Button>
      </div>
    </div>
  )
}
