'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CalendarClock,
  FileText,
  ImageIcon,
  Loader2,
  MapPin,
  Mic,
  Music,
  Plus,
  RefreshCw,
  Reply,
  SendHorizontal,
  Smile,
  Sparkles,
  Trash2,
  UserRound,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LocationDialog } from './LocationDialog'
import { ContactDialog } from './ContactDialog'
import { ScheduleDialog } from './ScheduleDialog'
import { useData, useMessageNormalizer } from './data-provider'
import type { ChatMessage } from './types'
import type { SendMessageInput } from '@/lib/data/types'
import { cn } from '@/lib/utils'
import './composer-extras.css'

const QUICK_EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😜',
  '🤔', '😎', '😢', '😭', '😡', '🥳', '😴', '🤒',
  '👍', '👎', '🙏', '👏', '💪', '🤝', '✌️', '🫶',
  '❤️', '🔥', '⭐', '🎉', '🎂', '🍕', '☕', '🌱',
  '☀️', '🌙', '🌈', '⚽', '🚗', '✈️', '📱', '💡',
  '✅', '❌', '❓', '❗', '💬', '📌', '🔗', '📝',
]

/** One-line preview for the reply strip when the quoted message has no text. */
const REPLY_PLACEHOLDERS: Record<string, string> = {
  image: '📷 Photo',
  video: '🎥 Video',
  gif: '🎞 GIF',
  audio: '🎤 Voice message',
  voice: '🎤 Voice message',
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
 * through the DataClient (server REST or the on-device engine) and are
 * attributed to "You".
 *
 * Task 10-b: the composer is ACTIVE by default in every chat. When a reply
 * is pending it shows a WhatsApp-style quote strip; the send payload carries
 * `replyToId` so the new message renders with its quote.
 *
 * Task 11: the + attach menu gains an **Audio** item (send audio files), and
 * when the input is empty the send button becomes a **mic** that records a
 * real voice note via MediaRecorder — sent through the same send pipeline
 * so it renders as a normal waveform VoicePlayer bubble.
 */
export function Composer({
  chatId,
  onSent,
  onOpenPoll,
  replyTo = null,
  onCancelReply,
  onJumpToReply,
  suggestions = [],
  onShuffleReplies,
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
  /** Smart reply chips (idea #1) — tap to send immediately. */
  suggestions?: string[]
  /** Rotate the suggestion pool (shuffle button). */
  onShuffleReplies?: () => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  // Active transport (Phase 2) — sends go through `data`, and freshly
  // created device-mode messages get their media resolved to a blob URL
  // before being handed to onSent (server mode is a passthrough).
  const { data } = useData()
  const normalizeMessages = useMessageNormalizer()
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [locOpen, setLocOpen] = useState(false)
  const [contactOpen, setContactOpen] = useState(false)
  const [schedOpen, setSchedOpen] = useState(false)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const docInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // --- Voice-note recording (mic button) ---
  const [recording, setRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recStreamRef = useRef<MediaStream | null>(null)
  const recChunksRef = useRef<Blob[]>([])
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recSecondsRef = useRef(0)
  const recCanceledRef = useRef(false)
  const recStartingRef = useRef(false)

  // Focus the input when a reply starts (WhatsApp behavior).
  useEffect(() => {
    if (replyTo) inputRef.current?.focus()
  }, [replyTo])

  async function postJson(payload: SendMessageInput) {
    return data.sendMessage(chatId, payload)
  }

  async function postFile(file: File, caption: string, replyToId?: string) {
    // Both transports infer the message type from the file; the caption
    // maps onto `body`.
    return data.sendMessage(chatId, {
      type: 'text',
      body: caption || undefined,
      media: file,
      mediaName: file.name,
      replyToId,
    })
  }

  async function sendText(override?: string) {
    const body = (typeof override === 'string' ? override : text).trim()
    if (!body || busy) return
    setBusy(true)
    try {
      const msg = await postJson({
        type: 'text',
        body,
        ...(replyTo ? { replyToId: replyTo.id } : {}),
      })
      const [resolved] = await normalizeMessages(chatId, [msg])
      setText('')
      onSent(resolved)
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
        const [resolved] = await normalizeMessages(chatId, [msg])
        onSent(resolved)
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
        const [resolved] = await normalizeMessages(chatId, [msg])
        onSent(resolved)
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
      if (audioInputRef.current) audioInputRef.current.value = ''
    }
  }

  // ---------------- Voice-note recording ----------------

  const MAX_REC_SECONDS = 600 // hard cap: 10 minutes, then auto-send

  function fmtDur(s: number): string {
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
  }

  /** Stop tracks, clear timers — leaves no dangling mic indicator. */
  function teardownRecording() {
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current)
      recTimerRef.current = null
    }
    recorderRef.current = null
    recChunksRef.current = []
    recStreamRef.current?.getTracks().forEach((t) => t.stop())
    recStreamRef.current = null
  }

  /**
   * Finish a recording: cancel=true discards the blob, false sends it.
   * The MediaRecorder onstop handler completes either flow.
   */
  function finishRecording(cancel: boolean) {
    recCanceledRef.current = cancel
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      rec.stop()
    } else {
      teardownRecording()
      setRecording(false)
    }
  }

  /** Upload the finished recording through the normal media pipeline. */
  async function sendVoiceBlob(blob: Blob, seconds: number) {
    const kind = blob.type || 'audio/webm'
    const ext = kind.includes('mp4')
      ? 'm4a'
      : kind.includes('ogg')
        ? 'ogg'
        : 'webm'
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const file = new File([blob], `voice-note-${stamp}.${ext}`, { type: kind })
    setBusy(true)
    const t = toast.loading('Sending voice note…')
    try {
      const msg = await postFile(file, '', replyTo?.id)
      const [resolved] = await normalizeMessages(chatId, [msg])
      onSent(resolved)
      if (replyTo) onCancelReply?.()
      toast.success(`Voice note sent · ${fmtDur(seconds)}`, { id: t })
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not send voice note',
        { id: t }
      )
    } finally {
      setBusy(false)
    }
  }

  async function startRecording() {
    if (recStartingRef.current || recording || busy) return
    recStartingRef.current = true
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      toast.error(
        'Voice recording is not supported here — attach an audio file from the + menu instead'
      )
      recStartingRef.current = false
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recStreamRef.current = stream
      const pick = (...types: string[]) =>
        types.find((t) => MediaRecorder.isTypeSupported(t))
      const mime = pick(
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus'
      )
      const rec = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream)
      recChunksRef.current = []
      recCanceledRef.current = false
      recSecondsRef.current = 0
      setRecSeconds(0)
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) recChunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const canceled = recCanceledRef.current
        const blob = new Blob(recChunksRef.current, {
          type: rec.mimeType || 'audio/webm',
        })
        const dur = recSecondsRef.current
        teardownRecording()
        setRecording(false)
        if (canceled) return
        if (blob.size === 0) {
          toast.error('Recording was empty — please try again')
          return
        }
        void sendVoiceBlob(blob, dur)
      }
      rec.start(250)
      recorderRef.current = rec
      setRecording(true)
      recTimerRef.current = setInterval(() => {
        const next = recSecondsRef.current + 1
        recSecondsRef.current = next
        setRecSeconds(next)
        if (next >= MAX_REC_SECONDS) finishRecording(false)
      }, 1000)
    } catch (err) {
      teardownRecording()
      setRecording(false)
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        toast.error(
          'Microphone access denied — allow the mic in your browser, or attach an audio file from the + menu'
        )
      } else if (name === 'NotFoundError') {
        toast.error(
          'No microphone found on this device — attach an audio file from the + menu'
        )
      } else {
        toast.error(
          'Could not start recording — attach an audio file from the + menu instead'
        )
      }
    } finally {
      recStartingRef.current = false
    }
  }

  // Release the mic + discard any in-flight recording when unmounting.
  useEffect(() => {
    return () => {
      recCanceledRef.current = true
      const rec = recorderRef.current
      if (rec && rec.state !== 'inactive') {
        try {
          rec.stop()
        } catch {
          /* already stopped */
        }
      }
      teardownRecording()
    }
  }, [])

  // Escape cancels an in-progress recording (WhatsApp parity).
  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finishRecording(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recording])

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
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*,.opus,.amr,.m4a,.ogg,.wav,.mp3,.aac,.flac,.webm"
        multiple
        className="hidden"
        onChange={(e) => sendFiles(e.target.files)}
      />

      {/* Smart reply chips (idea #1): tap-to-send pills above the input.
          Hidden while composing, replying or recording — WhatsApp parity. */}
      {!recording && !replyTo && !busy && text === '' && suggestions.length > 0 && (
        <div
          className="wa-smart-replies mb-1.5 flex items-center gap-1.5 overflow-x-auto pb-0.5"
          role="group"
          aria-label="Smart reply suggestions"
        >
          <span
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--wa-accent)/12 text-(--wa-accent)"
            aria-hidden
          >
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          {suggestions.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => sendText(s)}
              style={{ animationDelay: `${i * 55}ms` }}
              className="wa-chip-in h-8 shrink-0 rounded-full border border-black/[0.06] bg-white px-3.5 text-[13px] font-medium text-(--wa-text) shadow-sm transition-all duration-150 hover:border-(--wa-accent)/40 hover:bg-(--wa-accent)/8 hover:text-(--wa-accent-strong) active:scale-95 dark:border-white/10 dark:bg-(--wa-row-active) dark:text-(--wa-text) dark:hover:border-(--wa-accent)/50 dark:hover:text-(--wa-accent)"
            >
              {s}
            </button>
          ))}
          <button
            type="button"
            onClick={onShuffleReplies}
            aria-label="More suggestions"
            title="More suggestions"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-black/5 active:scale-90 dark:hover:bg-white/10"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

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

      {recording ? (
        <div
          className="wa-rec-strip flex items-center gap-2 rounded-full bg-black/[0.04] px-2 py-1.5 dark:bg-white/[0.06]"
          role="status"
          aria-live="polite"
          aria-label="Recording voice note"
        >
          <button
            type="button"
            onClick={() => finishRecording(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-black/10 dark:hover:bg-white/10"
            aria-label="Discard recording"
            title="Discard"
          >
            <Trash2 className="h-5 w-5" />
          </button>
          <span
            className="wa-rec-dot h-3 w-3 shrink-0 rounded-full bg-red-500"
            aria-hidden
          />
          <span className="shrink-0 text-[13.5px] font-semibold tabular-nums text-(--wa-text)">
            {fmtDur(recSeconds)}
          </span>
          <div
            className="wa-rec-bars flex h-6 min-w-0 flex-1 items-center gap-[3px] overflow-hidden"
            aria-hidden
          >
            {Array.from({ length: 18 }, (_, i) => (
              <span
                key={i}
                style={{
                  animationDelay: `${i * 87}ms`,
                  animationDuration: `${680 + (i % 5) * 105}ms`,
                }}
              />
            ))}
          </div>
          <span className="hidden shrink-0 text-[12.5px] text-(--wa-text-2) sm:block">
            Recording voice note…
          </span>
          <Button
            size="icon"
            onClick={() => finishRecording(false)}
            className="h-10 w-10 shrink-0 rounded-full bg-(--wa-accent) text-white shadow-md transition-transform hover:scale-110 hover:bg-(--wa-accent-strong) active:scale-90"
            aria-label="Send voice note"
            title="Send voice note"
          >
            <SendHorizontal className="h-5 w-5" />
          </Button>
        </div>
      ) : (
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
              title="Attach photo, video, audio, document, location, contact or poll"
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
            <DropdownMenuItem
              className="gap-2.5"
              onClick={() => audioInputRef.current?.click()}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                <Music className="h-4 w-4" />
              </span>
              Audio
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2.5"
              onClick={() => setLocOpen(true)}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-500/15 text-teal-600 dark:text-teal-300">
                <MapPin className="h-4 w-4" />
              </span>
              Location
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2.5"
              onClick={() => setContactOpen(true)}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-300">
                <UserRound className="h-4 w-4" />
              </span>
              Contact
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2.5" onClick={onOpenPoll}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 20V10M12 20V4M18 20v-6" strokeLinecap="round" />
                </svg>
              </span>
              Poll
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2.5"
              onClick={() => setSchedOpen(true)}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-500/15 text-slate-600 dark:text-slate-300">
                <CalendarClock className="h-4 w-4" />
              </span>
              Schedule message
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

        {/* Send button — when the input is empty this slot becomes the mic */}
        {canSend || busy ? (
          <Button
            size="icon"
            disabled={busy}
            onClick={() => sendText()}
            className="h-10 w-10 shrink-0 rounded-full bg-(--wa-accent) text-white shadow-md transition-all duration-200 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] hover:scale-110 hover:bg-(--wa-accent-strong) active:scale-90 disabled:hover:scale-100"
            aria-label="Send message"
            title="Send"
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <SendHorizontal className="h-5 w-5" />
            )}
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={startRecording}
            className="h-10 w-10 shrink-0 rounded-full bg-(--wa-text-2)/55 text-white shadow-md transition-all duration-200 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] hover:scale-110 hover:bg-(--wa-text-2)/80 active:scale-90"
            aria-label="Record voice note"
            title="Record a voice note — or attach an audio file from the + menu"
          >
            <Mic className="h-5 w-5" />
          </Button>
        )}
      </div>
      )}

      {/* Location / Contact cards + Scheduled messages (Tasks 12-c, 12-d) */}
      <LocationDialog
        chatId={chatId}
        open={locOpen}
        onOpenChange={setLocOpen}
        onSent={onSent}
      />
      <ContactDialog
        chatId={chatId}
        open={contactOpen}
        onOpenChange={setContactOpen}
        onSent={onSent}
      />
      <ScheduleDialog
        chatId={chatId}
        open={schedOpen}
        onOpenChange={setSchedOpen}
        initialText={text}
      />
    </div>
  )
}
