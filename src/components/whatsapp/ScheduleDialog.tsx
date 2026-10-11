'use client'

import { useState } from 'react'
import { CalendarClock, Clock, Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { fireScheduledCheck } from './ScheduledDispatchPoller'

const MAX_BODY = 4000
const MAX_HORIZON_MS = 30 * 24 * 60 * 60 * 1000

/** Format a Date for `datetime-local` input (local time, minute precision). */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Friendly date for the success toast, e.g. "Tue, Mar 4, 8:00 PM". */
function niceDate(d: Date): string {
  return d.toLocaleString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Controlled dialog: compose a message now, deliver it later (simulated).
 * Props: { chatId, open, onOpenChange, initialText? }
 */
export function ScheduleDialog({
  chatId,
  open,
  onOpenChange,
  initialText,
}: {
  chatId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  initialText?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && (
          <ScheduleForm
            chatId={chatId}
            initialText={initialText}
            onOpenChange={onOpenChange}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Inner form — mounted only while the dialog is open, so defaults
 * (now + 1 h, prefilled text) are recomputed on every open.
 */
function ScheduleForm({
  chatId,
  initialText,
  onOpenChange,
}: {
  chatId: string
  initialText?: string
  onOpenChange: (v: boolean) => void
}) {
  const now = new Date()
  const defaultWhen = toLocalInput(new Date(now.getTime() + 60 * 60 * 1000))

  const [body, setBody] = useState((initialText ?? '').slice(0, MAX_BODY))
  const [when, setWhen] = useState(defaultWhen)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const chips = (() => {
    const in1h = new Date(now.getTime() + 60 * 60 * 1000)
    const tonight = new Date(now)
    tonight.setHours(20, 0, 0, 0)
    if (tonight.getTime() <= now.getTime()) {
      tonight.setDate(tonight.getDate() + 1)
    }
    const tomorrow9 = new Date(now)
    tomorrow9.setDate(tomorrow9.getDate() + 1)
    tomorrow9.setHours(9, 0, 0, 0)
    return [
      { label: 'In 1 hour', value: in1h },
      { label: 'Tonight 8 PM', value: tonight },
      { label: 'Tomorrow 9 AM', value: tomorrow9 },
    ]
  })()

  function applyChip(value: Date) {
    setWhen(toLocalInput(value))
    setError(null)
  }

  async function submit() {
    if (sending) return
    const text = body.trim()
    if (!text) {
      setError('Type a message first')
      return
    }
    if (!when) {
      setError('Pick a date and time')
      return
    }
    const at = new Date(when)
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
      setError('Pick a time in the future')
      return
    }
    if (at.getTime() > Date.now() + MAX_HORIZON_MS) {
      setError('Pick a time within the next 30 days')
      return
    }

    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/scheduled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          body: text,
          deliverAt: at.toISOString(),
        }),
      })
      const data = (await res.json().catch(() => null)) as
        | { item?: unknown; error?: string }
        | null
      if (!res.ok || !data?.item) {
        setError(data?.error ?? 'Could not schedule the message — try again')
        return
      }
      toast.success(`Message scheduled for ${niceDate(at)}`)
      onOpenChange(false)
      fireScheduledCheck()
    } catch {
      setError('Could not schedule the message — check your connection')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <div
          className="mx-auto mb-1 flex h-14 w-14 items-center justify-center rounded-full bg-(--wa-accent)/15 text-(--wa-accent-strong) dark:text-(--wa-accent)"
          aria-hidden="true"
        >
          <Clock className="h-7 w-7" />
        </div>
        <DialogTitle>Schedule message</DialogTitle>
        <DialogDescription>
          Write it now — it lands in the chat at the time you pick.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-(--wa-text-2)">
            Message
          </span>
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value.slice(0, MAX_BODY))
              setError(null)
            }}
            rows={3}
            placeholder="Type your message…"
            aria-label="Message to schedule"
            className="w-full resize-none rounded-xl border border-(--wa-line) bg-black/[0.03] p-3 text-[14.5px] leading-snug text-(--wa-text) placeholder:text-(--wa-text-2) focus-visible:outline-2 focus-visible:outline-(--wa-accent) dark:bg-white/5"
          />
          <span className="text-right text-[11px] text-(--wa-text-2)">
            {body.length}/{MAX_BODY}
          </span>
        </label>

        {/* Quick chips */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick times">
          {chips.map((chip) => {
            const active = when === toLocalInput(chip.value)
            return (
              <button
                key={chip.label}
                type="button"
                onClick={() => applyChip(chip.value)}
                aria-pressed={active}
                className={cn(
                  'flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors',
                  active
                    ? 'bg-(--wa-accent)/15 text-(--wa-accent-strong) ring-1 ring-(--wa-accent) dark:text-(--wa-accent)'
                    : 'bg-black/5 text-(--wa-text-2) hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10'
                )}
              >
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                {chip.label}
              </button>
            )
          })}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-(--wa-text-2)">
            Deliver at
          </span>
          <input
            type="datetime-local"
            value={when}
            min={toLocalInput(new Date())}
            max={toLocalInput(new Date(Date.now() + MAX_HORIZON_MS))}
            onChange={(e) => {
              setWhen(e.target.value)
              setError(null)
            }}
            aria-label="Delivery date and time"
            className="h-11 w-full rounded-xl border border-(--wa-line) bg-black/[0.03] px-3 text-[14px] text-(--wa-text) [color-scheme:light] focus-visible:outline-2 focus-visible:outline-(--wa-accent) dark:bg-white/5 dark:[color-scheme:dark]"
          />
        </label>

        {error && (
          <p role="alert" className="text-[12.5px] font-medium text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}

        <Button
          className="h-11 gap-1.5 rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
          disabled={sending}
          onClick={() => void submit()}
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
          Schedule message
        </Button>
      </div>
    </>
  )
}

export default ScheduleDialog
