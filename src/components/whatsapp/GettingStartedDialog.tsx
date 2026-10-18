'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, ExternalLink, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getGeminiKey, setGeminiKey } from '@/lib/ai-client'

/**
 * Warm step-by-step tutorial for the AI features (Translate / Explain / Reply).
 *
 * Self-sufficient: no required props, manages its own open state and listens
 * for the 'wa-open-getting-started' CustomEvent, so any component (settings,
 * onboarding, empty states) can open it via openGettingStarted() without
 * prop wiring.
 */

export const GETTING_STARTED_EVENT = 'wa-open-getting-started'

/** Opens the Getting started dialog from anywhere in the app. */
export function openGettingStarted() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(GETTING_STARTED_EVENT))
  }
}

const KEY_LINK = 'https://aistudio.google.com/apikey'

export function GettingStartedDialog() {
  const [open, setOpen] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [saved, setSaved] = useState(false)

  // Self-listening: opens itself when the event fires from anywhere
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(GETTING_STARTED_EVENT, onOpen)
    return () => window.removeEventListener(GETTING_STARTED_EVENT, onOpen)
  }, [])

  // Prefill from storage each time the dialog opens — adjusted during render
  // (React's recommended pattern instead of a setState effect)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      const stored = getGeminiKey()
      setKeyDraft(stored)
      setSaved(!!stored)
    }
  }

  const saveKey = () => {
    const trimmed = keyDraft.trim()
    setGeminiKey(trimmed)
    setKeyDraft(trimmed)
    setSaved(!!trimmed)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="px-5 pt-5">
          <DialogTitle className="flex items-center gap-2 text-left">
            <Sparkles className="h-4.5 w-4.5 text-(--wa-accent)" aria-hidden />
            Getting started with AI
          </DialogTitle>
          <DialogDescription className="text-left">
            Three quick steps to unlock Translate, Explain &amp; Reply — takes
            about a minute.
          </DialogDescription>
        </DialogHeader>

        <div className="wa-scroll max-h-[60vh] space-y-5 overflow-y-auto px-5 py-4">
          {/* Step 1 — what this app does */}
          <div className="anim-fade-up flex gap-3" style={{ animationDelay: '40ms' }}>
            <StepCircle n={1} />
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-semibold text-(--wa-text)">
                What this app does
              </h3>
              <p className="mt-0.5 text-[12.5px] leading-snug text-(--wa-text-2)">
                Chat Archiver opens your exported WhatsApp chats right in the
                browser — private, offline and fully interactive.
              </p>
            </div>
          </div>

          {/* Step 2 — get a free Gemini key */}
          <div className="anim-fade-up flex gap-3" style={{ animationDelay: '90ms' }}>
            <StepCircle n={2} />
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-semibold text-(--wa-text)">
                Get your free Gemini key
              </h3>
              <ol className="mt-1.5 space-y-1.5">
                <MiniStep n={1} text="Open Google AI Studio's API key page" />
                <MiniStep n={2} text="Sign in with your Google account" />
                <MiniStep n={3} text='Press "Create API key"' />
                <MiniStep n={4} text="Copy the key" />
              </ol>
              <a
                href={KEY_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-(--wa-accent)/10 px-3 text-[12.5px] font-medium text-(--wa-accent-strong) transition-colors hover:bg-(--wa-accent)/20 dark:text-(--wa-accent)"
              >
                Open aistudio.google.com/apikey
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          </div>

          {/* Step 3 — paste it here */}
          <div className="anim-fade-up flex gap-3" style={{ animationDelay: '140ms' }}>
            <StepCircle n={3} />
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-semibold text-(--wa-text)">
                Paste it here
              </h3>
              <p className="mt-0.5 text-[12.5px] leading-snug text-(--wa-text-2)">
                Saved only in this browser — never uploaded anywhere.
              </p>
              <div className="mt-2 flex gap-2">
                <Input
                  type="password"
                  value={keyDraft}
                  onChange={(e) => {
                    setKeyDraft(e.target.value)
                    setSaved(false)
                  }}
                  placeholder="Paste your Gemini API key"
                  aria-label="Gemini API key"
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={saveKey}
                  className="shrink-0 bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
                >
                  Save
                </Button>
              </div>
              {saved && (
                <p
                  role="status"
                  className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-emerald-600 dark:text-emerald-400"
                >
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  Key saved — you&rsquo;re all set
                </p>
              )}
            </div>
          </div>

          {/* Step 4 — try it */}
          <div className="anim-fade-up flex gap-3" style={{ animationDelay: '190ms' }}>
            <StepCircle n={4} />
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-semibold text-(--wa-text)">
                Try it
              </h3>
              <p className="mt-0.5 text-[12.5px] leading-snug text-(--wa-text-2)">
                Open any chat → right-click (or long-press) a message →
                <span className="font-medium text-(--wa-text)">
                  {' '}
                  Translate with AI
                </span>
                .
              </p>
            </div>
          </div>

          {/* Fallback note */}
          <div className="rounded-lg bg-black/[0.03] p-3 text-[12px] leading-snug text-(--wa-text-2) dark:bg-white/[0.04]">
            No key? Translate/Explain still work using the built-in provider on
            this server.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-(--wa-line) px-5 py-3">
          <Button
            size="sm"
            className="h-8 rounded-full bg-(--wa-accent) px-5 text-[12.5px] font-medium text-white hover:bg-(--wa-accent-strong)"
            onClick={() => setOpen(false)}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Big numbered circle for a main step (accent background). */
function StepCircle({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-(--wa-accent) text-[13px] font-semibold text-white"
    >
      {n}
    </span>
  )
}

/** Small numbered mini-step row (accent-tinted circle). */
function MiniStep({ n, text }: { n: number; text: string }) {
  return (
    <li className="flex items-center gap-2 text-[12.5px] leading-snug text-(--wa-text)">
      <span
        aria-hidden
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--wa-accent)/12 text-[11px] font-semibold text-(--wa-accent-strong) dark:text-(--wa-accent)"
      >
        {n}
      </span>
      {text}
    </li>
  )
}
