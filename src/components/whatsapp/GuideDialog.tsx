'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookmarkPlus,
  Calendar,
  Check,
  Command,
  FileUp,
  Images,
  Moon,
  Paintbrush,
  Palette,
  Pencil,
  Search,
  SendHorizontal,
  Sparkles,
  Star,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  APP_THEMES,
  getAppTheme,
  setAppTheme,
  subscribeAppTheme,
  type AppThemeKey,
} from './app-theme'
import { cn } from '@/lib/utils'
import { APP_VERSION, RELEASES_URL } from '@/lib/version'

/**
 * Interactive, animated product tour: short crisp steps with live
 * illustrations, working buttons (import, demo, themes, insights) and
 * keyboard navigation. Replaces the old wall-of-text help dialog.
 */

interface GuideStep {
  id: string
  title: string
  tagline: string
  bullets: { icon: React.ReactNode; text: string }[]
  illustration: React.ReactNode
  actions?: React.ReactNode
}

function IllustrationShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative flex h-40 items-center justify-center overflow-hidden rounded-2xl bg-(--wa-accent)/[0.07]',
        className
      )}
    >
      {children}
    </div>
  )
}

const float = {
  animate: { y: [0, -8, 0] },
  transition: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' as const },
}

function WelcomeIllustration() {
  return (
    <IllustrationShell>
      <motion.div {...float} className="absolute left-[16%] top-8 rounded-xl rounded-bl-none bg-(--wa-in) px-3 py-2 shadow-md">
        <p className="text-[11px] text-(--wa-text)">Hey! 👋</p>
      </motion.div>
      <motion.div
        {...float}
        transition={{ ...float.transition, delay: 0.6 }}
        className="absolute right-[16%] top-16 rounded-xl rounded-br-none bg-(--wa-out) px-3 py-2 shadow-md"
      >
        <p className="text-[11px] text-(--wa-text)">Welcome aboard 🎉</p>
      </motion.div>
      <motion.div
        initial={{ scale: 0, rotate: -30 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 14, delay: 0.15 }}
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-(--wa-accent) shadow-lg"
      >
        <FileUp className="h-7 w-7 text-white" />
      </motion.div>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="absolute bottom-6 h-1.5 w-1.5 rounded-full bg-(--wa-accent)/50"
          animate={{ y: [0, -12, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2, repeat: Infinity, delay: i * 0.3 }}
          style={{ left: `${38 + i * 10}%` }}
        />
      ))}
    </IllustrationShell>
  )
}

function ReadIllustration() {
  return (
    <IllustrationShell>
      <div className="w-64 space-y-2">
        {['Message one', 'Find me! 🔍', 'Message three'].map((t, i) => (
          <motion.div
            key={t}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 + i * 0.25 }}
            className={cn(
              'rounded-lg px-3 py-1.5 text-[11.5px] shadow-sm',
              t.startsWith('Find')
                ? 'ml-auto w-fit rounded-br-none bg-[#ffe084] text-(--wa-text)'
                : 'w-fit rounded-bl-none bg-(--wa-in) text-(--wa-text)'
            )}
          >
            {t}
          </motion.div>
        ))}
      </div>
      <motion.div
        className="absolute right-6 top-6 flex h-9 w-9 items-center justify-center rounded-full bg-(--wa-accent) shadow-md"
        animate={{ scale: [1, 1.12, 1] }}
        transition={{ duration: 1.8, repeat: Infinity }}
      >
        <Search className="h-4 w-4 text-white" />
      </motion.div>
      <motion.div
        className="absolute bottom-5 left-6 flex h-9 w-9 items-center justify-center rounded-full bg-(--wa-accent) shadow-md"
        animate={{ rotate: [0, -12, 12, 0] }}
        transition={{ duration: 2.4, repeat: Infinity }}
      >
        <Calendar className="h-4 w-4 text-white" />
      </motion.div>
    </IllustrationShell>
  )
}

function SavedIllustration() {
  return (
    <IllustrationShell>
      <motion.div
        className="rounded-xl rounded-bl-none bg-(--wa-in) px-3 py-2 text-[11.5px] text-(--wa-text) shadow-md"
        animate={{ x: [0, 46, 46], opacity: [1, 1, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, times: [0, 0.45, 1] }}
      >
        Save this! 📌
      </motion.div>
      <motion.div
        className="absolute right-7 flex h-14 w-14 items-center justify-center rounded-2xl bg-(--wa-accent) shadow-lg"
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ duration: 2.4, repeat: Infinity, times: [0, 0.5, 1] }}
      >
        <BookmarkPlus className="h-6 w-6 text-white" />
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, times: [0, 0.55, 0.9, 1] }}
        className="absolute bottom-6 right-7 rounded-full bg-(--wa-accent) px-2.5 py-1 text-[10px] font-semibold text-white shadow"
      >
        Saved to You ✓
      </motion.div>
      <motion.span
        className="absolute left-8 top-6 text-(--wa-text-2)"
        animate={{ y: [0, -6, 0], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        <Star className="h-4 w-4 fill-[#f2a33c] text-[#f2a33c]" />
      </motion.span>
    </IllustrationShell>
  )
}

function EditIllustration() {
  return (
    <IllustrationShell>
      <motion.div
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-(--wa-accent) shadow-lg"
        animate={{ rotate: [0, -14, 8, 0] }}
        transition={{ duration: 2.2, repeat: Infinity }}
      >
        <Pencil className="h-7 w-7 text-white" />
      </motion.div>
      <motion.div
        className="absolute left-[18%] top-6 flex items-center gap-1.5 rounded-full bg-(--wa-in) px-2.5 py-1 shadow-sm"
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 2, repeat: Infinity, delay: 0.2 }}
      >
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-(--wa-accent)">
          <Check className="h-2.5 w-2.5 text-white" />
        </span>
        <span className="text-[10.5px] text-(--wa-text)">Multi-select</span>
      </motion.div>
      <motion.div
        className="absolute bottom-6 right-[16%] flex items-center gap-1.5 rounded-full bg-(--wa-out) px-2.5 py-1 shadow-sm"
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 2, repeat: Infinity, delay: 0.7 }}
      >
        <SendHorizontal className="h-3 w-3 text-(--wa-text)" />
        <span className="text-[10.5px] text-(--wa-text)">Send · Photo · Poll</span>
      </motion.div>
    </IllustrationShell>
  )
}

function ThemeIllustration() {
  const keys = Object.keys(APP_THEMES) as AppThemeKey[]
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % keys.length), 1400)
    return () => clearInterval(t)
  }, [keys.length])
  const t = APP_THEMES[keys[idx]]
  return (
    <IllustrationShell>
      <div className="flex flex-col items-center gap-3">
        <div className="flex gap-2">
          {(['appbar', 'bubble', 'accent'] as const).map((part) => (
            <motion.div
              key={part}
              layout
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
              className={cn(
                'h-10 rounded-lg shadow-sm ring-1 ring-black/10',
                part === 'appbar' ? 'w-14' : 'w-10'
              )}
              style={{ background: t.swatch[part] }}
            />
          ))}
        </div>
        <span className="text-[11.5px] font-medium text-(--wa-text-2)">
          {t.label} theme
        </span>
      </div>
      <motion.div
        className="absolute right-6 top-6 text-(--wa-text-2)"
        animate={{ rotate: [0, 20, 0], scale: [1, 1.15, 1] }}
        transition={{ duration: 2.5, repeat: Infinity }}
      >
        <Palette className="h-5 w-5" />
      </motion.div>
    </IllustrationShell>
  )
}

function InsightsIllustration() {
  const bars = [40, 65, 30, 85, 55, 70, 45]
  return (
    <IllustrationShell>
      <div className="flex h-24 items-end gap-2">
        {bars.map((h, i) => (
          <motion.div
            key={i}
            className="w-6 rounded-t-md bg-(--wa-accent)"
            initial={{ height: 0 }}
            animate={{ height: `${h}%` }}
            transition={{ delay: 0.15 + i * 0.1, type: 'spring', stiffness: 120, damping: 16 }}
          />
        ))}
      </div>
      <motion.div
        className="absolute right-6 top-6 flex h-9 w-9 items-center justify-center rounded-full bg-(--wa-accent) shadow-md"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 2.2, repeat: Infinity }}
      >
        <Images className="h-4 w-4 text-white" />
      </motion.div>
      <motion.div
        className="absolute bottom-5 left-6 flex items-center gap-1 rounded-full bg-(--wa-panel) px-2 py-1 shadow-sm"
        animate={{ scale: [1, 1.06, 1] }}
        transition={{ duration: 2, repeat: Infinity, delay: 0.4 }}
      >
        <Command className="h-3 w-3 text-(--wa-text-2)" />
        <span className="text-[10px] text-(--wa-text-2)">/ · J · K</span>
      </motion.div>
    </IllustrationShell>
  )
}

export function GuideDialog({
  open,
  onOpenChange,
  onImportFiles,
  onDemo,
  onSelectChat,
  onOpenInsights,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Opens the hidden import file picker. */
  onImportFiles?: () => void
  /** Opens the demo chat picker. */
  onDemo?: () => void
  /** Opens a chat by id (e.g. Saved Messages). */
  onSelectChat?: (id: string) => void
  /** Opens the insights dashboard. */
  onOpenInsights?: () => void
}) {
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const themeKey: AppThemeKey = useSyncExternalStore(
    subscribeAppTheme,
    getAppTheme,
    () => 'classic'
  )

  const steps: GuideStep[] = [
    {
      id: 'welcome',
      title: 'Welcome to your chats',
      tagline: 'Read WhatsApp exports in a familiar, private viewer.',
      bullets: [
        { icon: <FileUp className="h-3.5 w-3.5" />, text: 'Import a .zip (with media) or .txt export — even several at once' },
        { icon: <Sparkles className="h-3.5 w-3.5" />, text: 'No account, no cloud: everything stays on this device' },
        { icon: <Command className="h-3.5 w-3.5" />, text: 'Installable as an app — works offline like a PWA' },
      ],
      illustration: <WelcomeIllustration />,
      actions: (
        <>
          <Button
            size="sm"
            className="gap-1.5 rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
            onClick={() => onImportFiles?.()}
          >
            <FileUp className="h-3.5 w-3.5" /> Import a file
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5 rounded-full bg-(--wa-accent)/10 text-(--wa-accent-strong) hover:bg-(--wa-accent)/20 dark:text-(--wa-accent)"
            onClick={() => onDemo?.()}
          >
            <Sparkles className="h-3.5 w-3.5" /> Try demo chats
          </Button>
        </>
      ),
    },
    {
      id: 'read',
      title: 'Read like WhatsApp',
      tagline: 'Everything you use daily is one tap away.',
      bullets: [
        { icon: <Search className="h-3.5 w-3.5" />, text: 'Press / to search inside a chat — matches highlight, Enter hops between them' },
        { icon: <Calendar className="h-3.5 w-3.5" />, text: 'Jump to any day with the calendar, or tap Oldest / Latest' },
        { icon: <Paintbrush className="h-3.5 w-3.5" />, text: 'Give each chat its own wallpaper from the palette icon' },
      ],
      illustration: <ReadIllustration />,
    },
    {
      id: 'saved',
      title: 'Save messages for yourself',
      tagline: 'Like Telegram’s Saved Messages — always pinned on top.',
      bullets: [
        { icon: <BookmarkPlus className="h-3.5 w-3.5" />, text: 'Hover any message → tap the bookmark to forward it to Saved Messages' },
        { icon: <Star className="h-3.5 w-3.5" />, text: 'Right-click (or long-press) to star, copy or forward — media included' },
        { icon: <BookmarkPlus className="h-3.5 w-3.5" />, text: 'Message yourself notes, links and files in your private space' },
      ],
      illustration: <SavedIllustration />,
      actions: (
        <Button
          size="sm"
          variant="secondary"
          className="gap-1.5 rounded-full bg-(--wa-accent)/10 text-(--wa-accent-strong) hover:bg-(--wa-accent)/20 dark:text-(--wa-accent)"
          onClick={() => {
            onSelectChat?.('saved-messages')
            onOpenChange(false)
          }}
        >
          <BookmarkPlus className="h-3.5 w-3.5" /> Open Saved Messages
        </Button>
      ),
    },
    {
      id: 'edit',
      title: 'Edit anything, locally',
      tagline: 'Tap the pencil in a chat to unlock full editing.',
      bullets: [
        { icon: <Pencil className="h-3.5 w-3.5" />, text: 'Multi-select messages, then delete, star, copy or forward them' },
        { icon: <Pencil className="h-3.5 w-3.5" />, text: 'Edit any text message — an “edited” mark appears, just like WhatsApp' },
        { icon: <SendHorizontal className="h-3.5 w-3.5" />, text: 'Send texts, photos, videos, documents and polls from the composer' },
      ],
      illustration: <EditIllustration />,
    },
    {
      id: 'theme',
      title: 'Make it yours',
      tagline: 'Themes recolor the whole app — try one, it applies live.',
      bullets: [
        { icon: <Palette className="h-3.5 w-3.5" />, text: `${Object.keys(APP_THEMES).length} themes × light & dark: headers, bubbles, wallpapers, charts` },
        { icon: <Paintbrush className="h-3.5 w-3.5" />, text: 'The Aa menu also holds chat fonts, bubble shapes, density & clock format' },
        { icon: <Moon className="h-3.5 w-3.5" />, text: 'Dark mode pairs with any theme — pick your vibe' },
      ],
      illustration: <ThemeIllustration />,
      actions: (
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(APP_THEMES) as AppThemeKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setAppTheme(k)}
              title={APP_THEMES[k].label}
              className={cn(
                'h-7 w-7 overflow-hidden rounded-full ring-2 transition-transform hover:scale-110',
                themeKey === k ? 'ring-(--wa-text)' : 'ring-black/10 dark:ring-white/20'
              )}
            >
              <span className="block h-2.5 w-full" style={{ background: APP_THEMES[k].swatch.appbar }} />
              <span className="block h-2 w-full" style={{ background: APP_THEMES[k].swatch.bubble }} />
              <span className="block h-2.5 w-full" style={{ background: APP_THEMES[k].swatch.accent }} />
            </button>
          ))}
        </div>
      ),
    },
    {
      id: 'more',
      title: 'Insights & everything else',
      tagline: 'Your chats hide fun stories — go find them.',
      bullets: [
        { icon: <BarChart3 className="h-3.5 w-3.5" />, text: 'Insights dashboard: activity heatmap, top words & emojis, reply speeds' },
        { icon: <Images className="h-3.5 w-3.5" />, text: 'Media gallery with multi-select download; voice notes with speed control' },
        { icon: <Command className="h-3.5 w-3.5" />, text: 'Search every chat at once from the chat list; J/K shortcuts included' },
      ],
      illustration: <InsightsIllustration />,
      actions: (
        <Button
          size="sm"
          variant="secondary"
          className="gap-1.5 rounded-full bg-(--wa-accent)/10 text-(--wa-accent-strong) hover:bg-(--wa-accent)/20 dark:text-(--wa-accent)"
          onClick={() => {
            onOpenInsights?.()
            onOpenChange(false)
          }}
        >
          <BarChart3 className="h-3.5 w-3.5" /> Open Insights
        </Button>
      ),
    },
  ]

  const total = steps.length
  const current = steps[Math.min(step, total - 1)]
  const isLast = step === total - 1

  const go = useCallback(
    (d: 1 | -1) => {
      setDir(d)
      setStep((s) => Math.min(Math.max(s + d, 0), total - 1))
    },
    [total]
  )

  // Keyboard navigation while the guide is open
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, go])

  // Reset to the first step each time the tour opens — adjusted during
  // render (React's recommended pattern instead of a setState effect)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setStep(0)
      setDir(1)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Interactive guide</DialogTitle>
        <DialogDescription className="sr-only">
          Step-by-step tour of importing, reading and exploring your chats.
        </DialogDescription>

        {/* Animated progress bar */}
        <div className="h-1 w-full bg-black/5 dark:bg-white/10">
          <motion.div
            className="h-full bg-(--wa-accent)"
            initial={false}
            animate={{ width: `${((step + 1) / total) * 100}%` }}
            transition={{ type: 'spring', stiffness: 180, damping: 24 }}
          />
        </div>

        <div className="px-6 pb-5 pt-4">
          <AnimatePresence mode="wait" custom={dir}>
            <motion.div
              key={current.id}
              custom={dir}
              initial={{ opacity: 0, x: dir * 48 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -48 }}
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            >
              {current.illustration}

              <h3 className="mt-4 text-[19px] font-semibold leading-snug text-(--wa-text)">
                {current.title}
              </h3>
              <p className="mt-0.5 text-[13.5px] text-(--wa-text-2)">
                {current.tagline}
              </p>

              <ul className="mt-3 space-y-1.5">
                {current.bullets.map((b, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.12 + i * 0.09 }}
                    className="flex items-start gap-2 text-[13px] leading-snug text-(--wa-text)"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-(--wa-accent)/12 text-(--wa-accent-strong) dark:text-(--wa-accent)">
                      {b.icon}
                    </span>
                    <span>{b.text}</span>
                  </motion.li>
                ))}
              </ul>

              {current.actions && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {current.actions}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer: dots + nav */}
        <div className="flex items-center justify-between border-t border-(--wa-line) px-4 py-3">
          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => (
              <button
                key={s.id}
                aria-label={`Go to step ${i + 1}`}
                onClick={() => {
                  setDir(i > step ? 1 : -1)
                  setStep(i)
                }}
                className={cn(
                  'h-2 rounded-full transition-all duration-300',
                  i === step
                    ? 'w-6 bg-(--wa-accent)'
                    : 'w-2 bg-black/15 hover:bg-black/25 dark:bg-white/20 dark:hover:bg-white/35'
                )}
              />
            ))}
          </div>
        </div>

        {/* Version footer — doubles as the About line */}
        <div className="flex items-center justify-between gap-3 border-t border-black/5 bg-black/[0.02] px-6 py-2.5 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-[11.5px] text-(--wa-text-2)">
            WhatsApp Viewer{' '}
            <span className="font-semibold text-(--wa-text)">
              v{APP_VERSION}
            </span>{' '}
            · local-first, private, offline
          </p>
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-full bg-(--wa-accent)/10 px-2.5 py-1 text-[11.5px] font-medium text-(--wa-accent-strong) transition-colors hover:bg-(--wa-accent)/20 dark:text-(--wa-accent)"
          >
            What's new ↗
          </a>
        </div>

        <div className="flex items-center justify-between px-6 pb-4 pt-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-[12.5px] text-(--wa-text-2)"
              onClick={() => onOpenChange(false)}
            >
              Skip
            </Button>
            {step > 0 && (
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-full"
                onClick={() => go(-1)}
                aria-label="Previous step"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <Button
              size="sm"
              className="h-8 gap-1 rounded-full bg-(--wa-accent) px-4 text-[12.5px] font-medium text-white hover:bg-(--wa-accent-strong)"
              onClick={() => (isLast ? onOpenChange(false) : go(1))}
            >
              {isLast ? (
                <>Done</>
              ) : (
                <>
                  Next <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

