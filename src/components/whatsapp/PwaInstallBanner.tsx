'use client'

/**
 * PWA install banner (Task 10-f #1).
 *
 * Captures `beforeinstallprompt` at module level (as early as possible — the
 * event usually fires before React hydrates and Chrome allows it to be
 * consumed only once), then renders a dismissible floating banner:
 *  - bottom-center card on desktop / bottom-sheet style card on mobile,
 *    always above the sticky footer and safe-area aware;
 *  - hidden when the app already runs standalone (display-mode), when the
 *    user dismissed it before (`wa-viewer:pwa-install-dismissed` = '1'), or
 *    when no install prompt is available;
 *  - on iOS Safari (where beforeinstallprompt never fires) it shows manual
 *    "Share → Add to Home Screen" instructions instead;
 *  - "Install" calls prompt() on the captured event; success feedback comes
 *    via a toast on `appinstalled`.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Download, Share, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISMISS_KEY = 'wa-viewer:pwa-install-dismissed'

// ---- Module-level capture of the deferred install prompt -------------------
let deferredPrompt: BeforeInstallPromptEvent | null = null
const promptListeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e as BeforeInstallPromptEvent
    promptListeners.forEach((fn) => {
      try {
        fn()
      } catch {
        /* listener errors must never break the capture */
      }
    })
  })
}

function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
    const nav = navigator as Navigator & { standalone?: boolean }
    return nav.standalone === true
  } catch {
    return false
  }
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const iosUa = /iphone|ipod/i.test(ua)
  // iPadOS 13+ masquerades as desktop Safari
  const ipadUa =
    /ipad/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  return iosUa || ipadUa
}

type BannerState = 'hidden' | 'prompt' | 'ios'

export function PwaInstallBanner() {
  const [state, setState] = useState<BannerState>('hidden')

  const hide = useCallback(() => setState('hidden'), [])

  // Decide visibility after mount (hydration-safe: all storage/matchMedia
  // reads happen client-side, first paint is always "hidden"). The decision
  // runs in a deferred task so the effect body never calls setState directly.
  useEffect(() => {
    const decide = () => {
      if (isStandalone()) return

      let dismissed = false
      try {
        dismissed = localStorage.getItem(DISMISS_KEY) === '1'
      } catch {
        /* storage unavailable — treat as not dismissed */
      }
      if (dismissed) return

      if (isIosSafari()) {
        setState('ios')
        return
      }

      if (getDeferredPrompt()) setState('prompt')
    }

    const grace = setTimeout(decide, 0)

    // The prompt may arrive slightly after hydration — subscribe, and give
    // it a short grace period before giving up (banner stays hidden).
    const onPrompt = () => {
      if (!isStandalone() && getDeferredPrompt()) setState('prompt')
    }
    promptListeners.add(onPrompt)
    const fallback = setTimeout(onPrompt, 4000)
    return () => {
      clearTimeout(grace)
      clearTimeout(fallback)
      promptListeners.delete(onPrompt)
    }
  }, [])

  // Success feedback + hide once the app is actually installed
  useEffect(() => {
    const onInstalled = () => {
      setState('hidden')
      toast.success('WhatsApp Viewer installed — find it on your Home screen')
    }
    window.addEventListener('appinstalled', onInstalled)
    return () => window.removeEventListener('appinstalled', onInstalled)
  }, [])

  const handleInstall = useCallback(async () => {
    const ev = getDeferredPrompt()
    if (!ev) {
      hide()
      return
    }
    try {
      await ev.prompt()
      await ev.userChoice
    } catch {
      /* user closed the native dialog — nothing to do */
    }
    // The captured event is one-shot; never prompt from this banner again.
    hide()
  }, [hide])

  const handleDismiss = useCallback(() => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* storage unavailable — banner just hides for this session */
    }
    hide()
  }, [hide])

  if (state === 'hidden') return null

  return (
    <aside
      aria-label="Install WhatsApp Viewer"
      className="animate-in fade-in slide-in-from-bottom-4 fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-40 rounded-2xl border border-(--wa-line) bg-(--wa-panel) shadow-lg duration-300 sm:inset-x-auto sm:left-1/2 sm:w-[26.5rem] sm:-translate-x-1/2 motion-reduce:animate-none motion-reduce:transition-none"
    >
      <div className="flex items-center gap-3 p-4">
        {/* App icon */}
        <img
          src="/icon.svg"
          alt="WhatsApp Viewer app icon"
          className="h-11 w-11 shrink-0 rounded-xl shadow-sm"
        />

        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-tight font-semibold text-(--wa-text)">
            Install WhatsApp Viewer
          </p>
          {state === 'ios' ? (
            <p className="mt-1 flex items-center gap-1.5 text-[12px] leading-snug text-(--wa-text-2)">
              <Share className="h-3.5 w-3.5 shrink-0 text-(--wa-accent)" aria-hidden />
              <span>
                In Safari, tap <strong className="font-medium text-(--wa-text)">Share</strong>,
                then <strong className="font-medium text-(--wa-text)">Add to Home Screen</strong>.
              </span>
            </p>
          ) : (
            <p className="mt-1 text-[12px] leading-snug text-(--wa-text-2)">
              Add to Home Screen for a full-screen, offline-friendly experience
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {state === 'prompt' && (
            <Button
              size="sm"
              className="h-10 gap-1.5 rounded-full bg-(--wa-accent) px-4 text-[13px] font-medium text-white hover:bg-(--wa-accent-strong)"
              onClick={() => void handleInstall()}
              aria-label="Install WhatsApp Viewer"
            >
              <Download className="h-4 w-4" aria-hidden />
              Install
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-full text-(--wa-text-2) hover:bg-black/5 hover:text-(--wa-text) dark:hover:bg-white/10"
            onClick={handleDismiss}
            aria-label="Dismiss install banner"
            title="Don't show again"
          >
            <X className="h-4.5 w-4.5" aria-hidden />
          </Button>
        </div>
      </div>
    </aside>
  )
}
