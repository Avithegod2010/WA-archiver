'use client'

import { useEffect, useState } from 'react'
import { Loader2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
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
import { initialsForName, type ChatMessage } from './types'
import { cn } from '@/lib/utils'

/** Loose phone check: digits, spaces and + ( ) - only (per WhatsApp-ish UX). */
const PHONE_RE = /^[0-9()+\-\s]+$/

/**
 * Send-a-contact-card dialog — the + menu "Contact" entry.
 *
 * Controlled: { chatId, open, onOpenChange, onSent }. Simple form:
 * Name (required, ≤80) + Phone (required, ≤32, loose validation). Shows a
 * live preview with an accent-gradient initials avatar.
 *
 * Sends POST /api/chats/:id/messages with:
 *   { type: 'contact', body: JSON.stringify({ name, phone }) }
 * The created message is handed to onSent(msg) so the caller can append it
 * (same prop style Composer uses).
 */
export function ContactDialog({
  chatId,
  open,
  onOpenChange,
  onSent,
}: {
  chatId: string
  open: boolean
  onOpenChange: (v: boolean) => void
  onSent: (msg: ChatMessage) => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName('')
      setPhone('')
      setError('')
      setBusy(false)
    }
  }, [open])

  const cleanName = name.trim().slice(0, 80)
  const cleanPhone = phone.trim().slice(0, 32)
  const phoneOk = cleanPhone === '' || PHONE_RE.test(cleanPhone)
  const canSend =
    cleanName.length > 0 &&
    cleanPhone.length > 0 &&
    phoneOk &&
    !busy

  async function send() {
    if (!cleanName) {
      setError('Add the contact’s name first.')
      return
    }
    if (!cleanPhone) {
      setError('Add a phone number for the contact.')
      return
    }
    if (!phoneOk) {
      setError('Phone can only contain digits, spaces and + ( ) -.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'contact',
          body: JSON.stringify({ name: cleanName, phone: cleanPhone }),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not send contact')
      onSent(data.message as ChatMessage)
      toast.success('Contact card sent')
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send contact')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-300">
              <UserRound className="h-4 w-4" />
            </span>
            Send contact
          </DialogTitle>
          <DialogDescription>
            Share a person’s name and number as a contact card.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Live preview */}
          <div
            className={cn(
              'flex items-center gap-3 rounded-lg border border-black/5 bg-black/[0.035] px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.05]',
              !cleanName && !cleanPhone && 'opacity-60'
            )}
            aria-live="polite"
          >
            <div
              aria-hidden
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--wa-accent),var(--wa-accent-strong))] text-[15px] font-semibold text-white shadow-sm"
            >
              {initialsForName(cleanName || '?')}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold text-(--wa-text)">
                {cleanName || 'Contact name'}
              </p>
              <p className="truncate text-[12.5px] text-(--wa-text-2)">
                {cleanPhone || 'Phone number'}
              </p>
            </div>
          </div>

          <div>
            <label
              htmlFor="contact-name"
              className="mb-1 block text-[12.5px] font-medium text-(--wa-text)"
            >
              Name
            </label>
            <Input
              suppressHydrationWarning
              id="contact-name"
              autoFocus
              value={name}
              maxLength={80}
              placeholder="e.g. Priya Sharma"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  send()
                }
              }}
            />
          </div>

          <div>
            <label
              htmlFor="contact-phone"
              className="mb-1 block text-[12.5px] font-medium text-(--wa-text)"
            >
              Phone
            </label>
            <Input
              suppressHydrationWarning
              id="contact-phone"
              inputMode="tel"
              value={phone}
              maxLength={32}
              placeholder="e.g. +91 98765 43210"
              aria-invalid={!phoneOk}
              className={cn(
                !phoneOk &&
                  'border-rose-400 focus-visible:ring-rose-300 dark:border-rose-500/60'
              )}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  send()
                }
              }}
            />
            {!phoneOk && (
              <p className="mt-1 text-[12px] font-medium text-rose-600 dark:text-rose-400">
                Phone can only contain digits, spaces and + ( ) -.
              </p>
            )}
          </div>

          {error && (
            <p
              className="text-[12.5px] font-medium text-rose-600 dark:text-rose-400"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
            disabled={!canSend}
            onClick={send}
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Sending…
              </>
            ) : (
              'Send contact'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
