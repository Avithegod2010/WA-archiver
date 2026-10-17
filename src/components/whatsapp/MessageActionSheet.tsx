'use client'

import { useState, type ReactNode } from 'react'
import {
  Bookmark,
  BookmarkPlus,
  Copy,
  Download,
  Languages,
  ListChecks,
  Pencil,
  Pin,
  PinOff,
  Reply,
  SmilePlus,
  Square,
  Star,
  StarOff,
  Volume2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { colorForName, type ChatMessage } from './types'
import { cn } from '@/lib/utils'

export type ReactionMap = Record<string, string[]>

/** Full quick-reaction grid (hover popover + action sheet). */
export const QUICK_REACTIONS = [
  '👍',
  '❤️',
  '😂',
  '😮',
  '😢',
  '🙏',
  '🔥',
  '🎉',
  '👏',
  '💯',
  '😍',
  '🤝',
]

/** Compact 6-emoji row at the top of the desktop context menu. */
export const MENU_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

const COPY_LABEL: Record<string, string> = {
  image: '[Photo]',
  video: '[Video]',
  gif: '[GIF]',
  audio: '[Voice message]',
  sticker: '[Sticker]',
  document: '[Document]',
  contact: '[Contact card]',
  location: '[Location]',
  poll: '[Poll]',
  media: '[Media omitted]',
}

function baseTextFor(msg: ChatMessage): string {
  return (
    msg.body || COPY_LABEL[msg.type] || (msg.mediaName ? `[${msg.mediaName}]` : '')
  )
}

/** Plain-text representation used by "Copy message". */
export function copyTextFor(msg: ChatMessage): string {
  const prefix = msg.sender && msg.sender !== 'You' ? `${msg.sender}: ` : ''
  return prefix + baseTextFor(msg)
}

export async function copyMessage(msg: ChatMessage) {
  try {
    await navigator.clipboard.writeText(copyTextFor(msg))
    toast.success('Message copied')
  } catch {
    toast.error('Could not copy')
  }
}

/** Reactions map (emoji -> senders, "You" included if I reacted). */
export function getReactions(msg: ChatMessage): ReactionMap | null {
  return msg.reactions ?? null
}

/** Whether I reacted with a given emoji on this message. */
export function iReacted(msg: ChatMessage, emoji: string): boolean {
  return !!msg.reactions?.[emoji]?.includes('You')
}

/** Whether the message is pinned. */
export function isPinned(msg: ChatMessage): boolean {
  return !!msg.pinned
}

/** Browser speech synthesis availability (SSR-safe). */
function speechAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.speechSynthesis !== 'undefined'
  )
}

/** Whether the browser is currently reading text aloud (SSR-safe). */
function speechActive(): boolean {
  return speechAvailable() && window.speechSynthesis.speaking
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function SheetRow({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 w-full shrink-0 items-center gap-3 rounded-xl px-3 text-left text-[15px] text-(--wa-text) transition-colors hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-(--wa-text-2)">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  )
}

interface MessageActionSheetProps {
  msg: ChatMessage | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Resolved media URL — enables the Download row when present. */
  src?: string | null
  /** Starts a reply to this message (quote in the composer). */
  onReply?: (msg: ChatMessage) => void
  /** Starts an inline edit for this message (outgoing text only). */
  onEdit?: (msg: ChatMessage) => void
  /** Selection-mode starter — alternative to onToggleSelect. */
  onSelect?: (msg: ChatMessage) => void
  onReact?: (msgId: string, emoji: string) => void
  onToggleStar?: (id: string, starred: boolean) => void
  onForwardSaved?: (msg: ChatMessage) => void
  onBookmark?: (msg: ChatMessage) => void
  onPinMessage?: (msg: ChatMessage) => void
  onTranslate?: (msg: ChatMessage) => void
  onToggleSelect?: (id: string) => void
}

/** WhatsApp-style bottom action sheet, opened by long-press on touch devices. */
export function MessageActionSheet({
  msg,
  open,
  onOpenChange,
  src,
  onReply,
  onEdit,
  onSelect,
  onReact,
  onToggleStar,
  onForwardSaved,
  onBookmark,
  onPinMessage,
  onTranslate,
  onToggleSelect,
}: MessageActionSheetProps) {
  const [reactOpen, setReactOpen] = useState(false)
  const [speaking, setSpeaking] = useState(false)

  // Reset the inline reaction grid on every close path (overlay, X, Esc, action).
  const handleOpenChange = (o: boolean) => {
    if (!o) setReactOpen(false)
    onOpenChange(o)
  }

  if (!msg) return null

  const close = () => onOpenChange(false)
  const pinned = isPinned(msg)
  const sender = msg.sender ?? ''
  const senderIsMe = sender === 'You'

  const speakable = !!msg.body?.trim()
  const isSpeaking = speaking || speechActive()

  /** Reads the message body aloud with the browser's built-in speech engine. */
  const handleSpeak = () => {
    if (!speechAvailable()) {
      toast.error('Speech is not available in this browser')
      return
    }
    const synth = window.speechSynthesis
    if (synth.speaking) {
      synth.cancel()
      setSpeaking(false)
      return
    }
    const text = msg.body.trim()
    if (!text) return
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1
    try {
      const voices = synth.getVoices()
      const english = voices.find((v) =>
        v.lang?.toLowerCase().startsWith('en')
      )
      if (english) utterance.voice = english
    } catch {
      // Voice list unavailable — the default voice is fine.
    }
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    setSpeaking(true)
    synth.speak(utterance)
    toast('Reading aloud…', {
      action: {
        label: 'Stop',
        onClick: () => {
          synth.cancel()
          setSpeaking(false)
        },
      },
    })
    close()
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] gap-2 overflow-y-auto rounded-t-2xl border-t-0 px-3 pt-2 pb-[calc(12px+env(safe-area-inset-bottom))]"
      >
        <SheetTitle className="sr-only">Message actions</SheetTitle>
        <SheetDescription className="sr-only">
          Choose an action for this message
        </SheetDescription>

        {/* Drag handle */}
        <div
          className="mx-auto h-1.5 w-12 shrink-0 rounded-full bg-black/15 dark:bg-white/20"
          aria-hidden="true"
        />

        {/* Message preview */}
        <div className="shrink-0 rounded-[7.5px] bg-(--wa-in) px-3 py-2 text-(--wa-text) shadow-sm">
          {sender && (
            <p
              className="text-[12.5px] font-semibold leading-tight"
              style={{
                color: senderIsMe ? 'var(--wa-accent-strong)' : colorForName(sender),
              }}
            >
              {senderIsMe ? 'You' : sender}
            </p>
          )}
          <p className="line-clamp-2 break-words text-[13.5px] leading-snug whitespace-pre-wrap">
            {baseTextFor(msg) || 'Media message'}
          </p>
          <p className="mt-0.5 text-right text-[10.5px] text-(--wa-text-2)">
            {formatTime(msg.ts)}
          </p>
        </div>

        {/* Action rows */}
        <div className="flex shrink-0 flex-col pb-1">
          {onReply && (
            <SheetRow
              icon={<Reply className="h-5 w-5 text-(--wa-accent)" />}
              label="Reply"
              onClick={() => {
                onReply(msg)
                close()
              }}
            />
          )}
          {onReact && (
            <>
              <SheetRow
                icon={<SmilePlus className="h-5 w-5" />}
                label={reactOpen ? 'Pick a reaction' : 'React'}
                onClick={() => setReactOpen((v) => !v)}
              />
              {reactOpen && (
                <div className="wa-chip-pop grid grid-cols-6 gap-1 px-1 pt-0.5 pb-1">
                  {QUICK_REACTIONS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      aria-label={iReacted(msg, em) ? `Remove ${em} reaction` : `React ${em}`}
                      onClick={() => {
                        onReact(msg.id, em)
                        toast.success(iReacted(msg, em) ? 'Reaction removed' : `Reacted ${em}`)
                        close()
                      }}
                      className={cn(
                        'flex h-11 w-11 items-center justify-center justify-self-center rounded-full text-2xl transition-transform hover:scale-110 active:scale-95 motion-reduce:transition-none',
                        iReacted(msg, em) && 'bg-(--wa-accent)/15 ring-2 ring-(--wa-accent)'
                      )}
                    >
                      {em}
                    </button>
                  ))}
                </div>
              )}
              <div
                className="mx-3 my-1 h-px shrink-0 bg-black/8 dark:bg-white/10"
                aria-hidden="true"
              />
            </>
          )}
          {onEdit && (
            <SheetRow
              icon={<Pencil className="h-5 w-5" />}
              label="Edit message"
              onClick={() => {
                onEdit(msg)
                close()
              }}
            />
          )}
          <SheetRow
            icon={<Copy className="h-5 w-5" />}
            label="Copy"
            onClick={() => {
              copyMessage(msg)
              close()
            }}
          />
          {onForwardSaved && (
            <SheetRow
              icon={<BookmarkPlus className="h-5 w-5 text-(--wa-accent)" />}
              label="Forward to Saved Messages"
              onClick={() => {
                onForwardSaved(msg)
                close()
              }}
            />
          )}
          {onBookmark && (
            <SheetRow
              icon={<Bookmark className="h-5 w-5 text-(--wa-accent)" />}
              label="Bookmark message"
              onClick={() => {
                onBookmark(msg)
                close()
              }}
            />
          )}
          {onToggleStar && (
            <SheetRow
              icon={
                msg.starred ? (
                  <StarOff className="h-5 w-5 text-[#f2a33c]" />
                ) : (
                  <Star className="h-5 w-5 text-[#f2a33c]" />
                )
              }
              label={msg.starred ? 'Unstar message' : 'Star message'}
              onClick={() => {
                onToggleStar(msg.id, !msg.starred)
                close()
              }}
            />
          )}
          {onPinMessage && (
            <SheetRow
              icon={
                pinned ? (
                  <PinOff className="h-5 w-5" />
                ) : (
                  <Pin className="h-5 w-5" />
                )
              }
              label={pinned ? 'Unpin message' : 'Pin message'}
              onClick={() => {
                onPinMessage(msg)
                close()
              }}
            />
          )}
          {onTranslate && (
            <SheetRow
              icon={<Languages className="h-5 w-5 text-(--wa-accent)" />}
              label="Translate with AI"
              onClick={() => {
                onTranslate(msg)
                close()
              }}
            />
          )}
          {speakable && (
            <SheetRow
              icon={
                isSpeaking ? (
                  <Square className="h-5 w-5 text-rose-500" />
                ) : (
                  <Volume2 className="h-5 w-5 text-(--wa-accent)" />
                )
              }
              label={isSpeaking ? 'Stop reading' : 'Speak'}
              onClick={handleSpeak}
            />
          )}
          {src && (
            <a
              href={src}
              download={msg.mediaName ?? true}
              onClick={close}
              className="flex h-12 w-full shrink-0 items-center gap-3 rounded-xl px-3 text-left text-[15px] text-(--wa-text) transition-colors hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center text-(--wa-text-2)">
                <Download className="h-5 w-5" />
              </span>
              <span className="truncate">Download media</span>
            </a>
          )}
          {(onToggleSelect || onSelect) && (
            <SheetRow
              icon={<ListChecks className="h-5 w-5" />}
              label="Select message"
              onClick={() => {
                if (onToggleSelect) onToggleSelect(msg.id)
                else onSelect?.(msg)
                close()
              }}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
