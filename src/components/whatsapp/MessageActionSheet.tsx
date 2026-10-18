'use client'

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
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
import { type ChatMessage } from './types'
import { cn } from '@/lib/utils'

export type ReactionMap = Record<string, string[]>

/** Full quick-reaction grid (hover popover + action popup). */
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

/** Compact 6-emoji row at the top of the desktop context menu + long-press popup. */
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

function PopupRow({
  icon,
  label,
  onClick,
  refCb,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  refCb?: (el: HTMLButtonElement | null) => void
}) {
  return (
    <button
      type="button"
      ref={refCb}
      onClick={onClick}
      role="menuitem"
      tabIndex={refCb ? 0 : -1}
      className="flex h-11 w-full shrink-0 items-center gap-3 rounded-lg px-3 text-left text-[14.5px] text-(--wa-text) transition-colors hover:bg-black/[0.06] active:bg-black/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--wa-accent) dark:hover:bg-white/[0.07]"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-(--wa-text-2)">
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  )
}

export type PopupPoint = { x: number; y: number }

interface MessageActionSheetProps {
  msg: ChatMessage | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Long-press point (viewport coords) — the popup anchors near it. */
  point?: PopupPoint | null
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

const VIEWPORT_MARGIN = 8
const POINT_GAP = 14

/**
 * WhatsApp-style long-press popup (floating card anchored to the pressed
 * message, reaction pill on top — replaces the old bottom action sheet).
 *
 * Rendered through a portal (message rows sit inside animated wrappers whose
 * transforms would otherwise become the containing block for fixed children).
 * Position is measured after mount: centered horizontally on the press point,
 * preferring the space ABOVE it (WhatsApp pops the menu over the finger) and
 * flipping below when near the top edge, always clamped to the viewport.
 */
export function MessageActionSheet({
  msg,
  open,
  onOpenChange,
  point,
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
  const [speaking, setSpeaking] = useState(false)
  const [pos, setPos] = useState<{
    left: number
    top: number
    above: boolean
  } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const firstItemRef = useRef<HTMLButtonElement | null>(null)

  // Measure + place the card once it is mounted (hidden pre-measure pass).
  // Runs pre-paint, so the new position lands before the browser draws —
  // reopening never shows a stale position. setState here is the standard
  // DOM-measurement pattern (rule flagged as informational only).
  useLayoutEffect(() => {
    if (!open || !msg) return
    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const W = rect.width
    const H = rect.height
    const px = point?.x ?? vw / 2
    const py = point?.y ?? vh / 2
    const left = Math.min(
      Math.max(px - W / 2, VIEWPORT_MARGIN),
      Math.max(vw - W - VIEWPORT_MARGIN, VIEWPORT_MARGIN)
    )
    let above = true
    let top = py - H - POINT_GAP
    if (top < VIEWPORT_MARGIN) {
      top = py + 28 + POINT_GAP // flip below the finger
      above = false
    }
    if (top + H > vh - VIEWPORT_MARGIN) {
      top = Math.max(vh - H - VIEWPORT_MARGIN, VIEWPORT_MARGIN)
      above = py > top + H / 2
    }
    // DOM-measurement setState — runs pre-paint (standard measure pattern).
    setPos({ left, top, above })
    // Focus the first action for keyboard users (touch users never see it).
    window.setTimeout(() => firstItemRef.current?.focus(), 0)
  }, [open, msg, point?.x, point?.y])

  // Escape closes; body scroll is locked while the popup is up.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onOpenChange(false)
      }
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onOpenChange])

  // Reset the inline reaction state on every close path.
  const handleOpenChange = (o: boolean) => onOpenChange(o)

  if (!msg || !open || typeof document === 'undefined') return null

  const close = () => handleOpenChange(false)
  const pinned = isPinned(msg)

  /** Only the first rendered row gets the initial focus. */
  const firstRow = onReply ? 'reply' : onEdit ? 'edit' : 'copy'
  const firstRef = (row: string) =>
    row === firstRow
      ? (el: HTMLButtonElement | null) => {
          firstItemRef.current = el
        }
      : undefined

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

  const popup = (
    <div
      className="fixed inset-0 z-[60]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
      onContextMenu={(e) => e.preventDefault()}
      role="presentation"
    >
      {/* WhatsApp keeps the chat visible behind the popup — the backdrop is
          a plain event catcher (no dim) and the card carries the surface. */}
      <div
        ref={cardRef}
        role="menu"
        aria-label="Message actions"
        style={{
          left: pos?.left ?? 0,
          top: pos?.top ?? -9999,
          visibility: pos ? 'visible' : 'hidden',
          transformOrigin: pos ? (pos.above ? '50% 100%' : '50% 0%') : undefined,
        }}
        className={cn(
          'wa-msg-popup absolute w-[248px] max-w-[calc(100vw-16px)] rounded-2xl border border-(--wa-line) bg-(--wa-panel) p-1.5 shadow-[0_12px_40px_rgba(11,20,26,0.35)] dark:bg-(--wa-panel-2)',
          pos && 'wa-msg-popup-in'
        )}
      >
        {/* Reaction pill — WhatsApp's signature row on top of the menu */}
        {onReact && (
          <>
            <div
              className="mb-1 flex items-center justify-between gap-0.5 rounded-xl bg-black/[0.045] px-1 py-1 dark:bg-white/[0.06]"
              role="group"
              aria-label="React to this message"
            >
              {MENU_REACTIONS.map((em) => (
                <button
                  key={em}
                  type="button"
                  role="menuitemradio"
                  aria-checked={iReacted(msg, em)}
                  aria-label={iReacted(msg, em) ? `Remove ${em} reaction` : `React ${em}`}
                  onClick={() => {
                    onReact(msg.id, em)
                    toast.success(
                      iReacted(msg, em) ? 'Reaction removed' : `Reacted ${em}`
                    )
                    close()
                  }}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-full text-[22px] leading-none transition-transform hover:scale-125 active:scale-95 motion-reduce:transition-none',
                    iReacted(msg, em) && 'bg-(--wa-accent)/20 ring-1 ring-(--wa-accent)'
                  )}
                >
                  {em}
                </button>
              ))}
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full text-(--wa-text-2)"
                title="Open the message menu for more reactions"
                aria-hidden
              >
                <SmilePlus className="h-4.5 w-4.5" />
              </span>
            </div>
            <div
              className="mx-2 mb-1 h-px shrink-0 bg-black/8 dark:bg-white/10"
              aria-hidden="true"
            />
          </>
        )}

        {/* Action rows */}
        <div className="flex flex-col">
          {onReply && (
            <PopupRow
              refCb={firstRef('reply')}
              icon={<Reply className="h-4.5 w-4.5 text-(--wa-accent)" />}
              label="Reply"
              onClick={() => {
                onReply(msg)
                close()
              }}
            />
          )}
          {onEdit && (
            <PopupRow
              refCb={firstRef('edit')}
              icon={<Pencil className="h-4.5 w-4.5" />}
              label="Edit message"
              onClick={() => {
                onEdit(msg)
                close()
              }}
            />
          )}
          <PopupRow
            refCb={firstRef('copy')}
            icon={<Copy className="h-4.5 w-4.5" />}
            label="Copy"
            onClick={() => {
              copyMessage(msg)
              close()
            }}
          />
          {onForwardSaved && (
            <PopupRow
              icon={<BookmarkPlus className="h-4.5 w-4.5 text-(--wa-accent)" />}
              label="Forward to Saved"
              onClick={() => {
                onForwardSaved(msg)
                close()
              }}
            />
          )}
          {onBookmark && (
            <PopupRow
              icon={<Bookmark className="h-4.5 w-4.5 text-(--wa-accent)" />}
              label="Bookmark message"
              onClick={() => {
                onBookmark(msg)
                close()
              }}
            />
          )}
          {onToggleStar && (
            <PopupRow
              icon={
                msg.starred ? (
                  <StarOff className="h-4.5 w-4.5 text-[#f2a33c]" />
                ) : (
                  <Star className="h-4.5 w-4.5 text-[#f2a33c]" />
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
            <PopupRow
              icon={
                pinned ? (
                  <PinOff className="h-4.5 w-4.5" />
                ) : (
                  <Pin className="h-4.5 w-4.5" />
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
            <PopupRow
              icon={<Languages className="h-4.5 w-4.5 text-(--wa-accent)" />}
              label="Translate with AI"
              onClick={() => {
                onTranslate(msg)
                close()
              }}
            />
          )}
          {speakable && (
            <PopupRow
              icon={
                isSpeaking ? (
                  <Square className="h-4.5 w-4.5 text-rose-500" />
                ) : (
                  <Volume2 className="h-4.5 w-4.5 text-(--wa-accent)" />
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
              role="menuitem"
              className="flex h-11 w-full shrink-0 items-center gap-3 rounded-lg px-3 text-left text-[14.5px] text-(--wa-text) transition-colors hover:bg-black/[0.06] active:bg-black/10 dark:hover:bg-white/[0.07]"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-(--wa-text-2)">
                <Download className="h-4.5 w-4.5" />
              </span>
              <span className="truncate">Download media</span>
            </a>
          )}
          {(onToggleSelect || onSelect) && (
            <PopupRow
              icon={<ListChecks className="h-4.5 w-4.5" />}
              label="Select message"
              onClick={() => {
                if (onToggleSelect) onToggleSelect(msg.id)
                else onSelect?.(msg)
                close()
              }}
            />
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(popup, document.body)
}
