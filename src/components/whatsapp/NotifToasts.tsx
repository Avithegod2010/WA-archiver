'use client'

/**
 * Notification-style toasts (Task 10-f #3) — a playful "incoming message"
 * simulator. Every 45–90 s (random, only while the tab is visible and no
 * dialog input is focused) it picks a random chat and shows a WhatsApp-style
 * toast derived from that chat's last message. Click opens the chat.
 *
 * Suppressed entirely when:
 *  - `wa-viewer:toasts` === '0' (master switch, Settings — agent G),
 *  - `wa-viewer:mute:<chatId>` === '1' for the picked chat (it just picks
 *    another unmuted chat),
 *  - fewer than 2 chats exist,
 *  - another toast is already visible (max 1 at a time),
 *  - prefers-reduced-motion (the slide/fade animation is skipped).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar } from './Avatar'
import { SAVED_CHAT_ID, type ChatSummary } from './types'

const MASTER_KEY = 'wa-viewer:toasts'
const MUTE_PREFIX = 'wa-viewer:mute:'

const MIN_INTERVAL_MS = 45_000
const MAX_INTERVAL_MS = 90_000
const AUTO_DISMISS_MS = 6_000
const CLOSE_ANIM_MS = 200
const MAX_PREVIEW_CHARS = 140

/** Media-type previews mirror WhatsApp's own placeholders. */
const TYPE_LABELS: Record<string, string> = {
  image: '📷 Photo',
  video: '🎥 Video',
  audio: '🎤 Voice message',
  document: '📎 Document',
  sticker: '🎟️ Sticker',
  gif: '🎞️ GIF',
  poll: '📊 Poll',
  location: '📍 Location',
  call: '📞 Missed call',
}

interface ActiveToast {
  chatId: string
  title: string
  isGroup: boolean
  sender: string | null
  body: string
  timeLabel: string
}

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 60_000) return 'now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

const NOTIF_CSS = `
@keyframes wa-notif-toast-in {
  from { opacity: 0; transform: translateY(-16px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (min-width: 768px) {
  @keyframes wa-notif-toast-in {
    from { opacity: 0; transform: translate(28px, 16px); }
    to { opacity: 1; transform: translate(0, 0); }
  }
}
.wa-notif-toast { animation: wa-notif-toast-in 340ms cubic-bezier(0.22, 1.2, 0.36, 1) backwards; }
.wa-notif-toast-out { opacity: 0 !important; transition: opacity 180ms ease; }
@media (prefers-reduced-motion: reduce) {
  .wa-notif-toast { animation: none; }
  .wa-notif-toast-out { transition: none; }
}
`

export function NotifToasts({
  chats,
  onOpenChat,
}: {
  chats: ChatSummary[]
  onOpenChat: (chatId: string) => void
}) {
  const [toast, setToast] = useState<ActiveToast | null>(null)
  const [closing, setClosing] = useState(false)

  // Latest values without stale closures inside the scheduler
  const chatsRef = useRef(chats)
  useEffect(() => {
    chatsRef.current = chats
  }, [chats])
  const toastRef = useRef<ActiveToast | null>(null)
  useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const dismiss = useCallback(() => {
    setClosing(true)
    window.setTimeout(() => {
      setToast(null)
      setClosing(false)
    }, CLOSE_ANIM_MS)
  }, [])

  const pickAndShow = useCallback(() => {
    // Max 1 visible at a time
    if (toastRef.current) return
    if (document.visibilityState !== 'visible') return

    // Paused while an input inside any dialog is focused (keep it simple)
    const el = document.activeElement as HTMLElement | null
    if (
      el &&
      (el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.isContentEditable) &&
      el.closest('[role="dialog"]')
    ) {
      return
    }

    const chatsNow = chatsRef.current
    if (chatsNow.length < 2) return

    // Master switch (Settings) — read live so toggling applies immediately
    try {
      if (localStorage.getItem(MASTER_KEY) === '0') return
    } catch {
      /* storage unavailable — treat as enabled */
    }

    // Saved Messages never receives "incoming" messages; archived chats are
    // quiet too. Muted chats (wa-viewer:mute:<id> = '1') are skipped —
    // i.e. a muted pick means "pick another".
    const eligible = chatsNow.filter(
      (c) => !c.archived && c.id !== SAVED_CHAT_ID
    )
    let pool = eligible
    try {
      const unmuted = eligible.filter(
        (c) => localStorage.getItem(MUTE_PREFIX + c.id) !== '1'
      )
      if (unmuted.length > 0) pool = unmuted
    } catch {
      /* storage unavailable — keep full pool */
    }
    if (pool.length === 0) return

    const chat = pool[Math.floor(Math.random() * pool.length)]
    const label = TYPE_LABELS[chat.lastType]
    const preview = (
      label ||
      chat.lastPreview ||
      'New message'
    ).slice(0, MAX_PREVIEW_CHARS)

    setToast({
      chatId: chat.id,
      title: chat.title,
      isGroup: chat.isGroup,
      sender: chat.lastSender,
      body: preview,
      timeLabel: relativeTime(chat.lastAt),
    })
  }, [])

  // Random 45–90 s scheduler — runs for the app's lifetime
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      timer = setTimeout(
        () => {
          if (!alive) return
          try {
            pickAndShow()
          } catch {
            /* never let the simulator break the app */
          }
          schedule()
        },
        MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS)
      )
    }
    schedule()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [pickAndShow])

  // Auto-dismiss after 6 s
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(dismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [toast, dismiss])

  if (!toast) return null

  const senderPrefix =
    toast.isGroup && toast.sender ? `${toast.sender}: ` : ''

  return (
    <>
      <style>{NOTIF_CSS}</style>
      <div
        role="status"
        aria-live="polite"
        className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-[60] md:inset-x-auto md:top-auto md:right-5 md:bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] md:w-[360px]"
      >
        <button
          type="button"
          onClick={() => {
            dismiss()
            onOpenChat(toast.chatId)
          }}
          aria-label={`Open chat ${toast.title}`}
          className={`wa-notif-toast relative block w-full cursor-pointer overflow-hidden rounded-xl border border-(--wa-line) bg-(--wa-panel) p-3 text-left shadow-lg transition-colors hover:bg-(--wa-row-active) focus-visible:outline-2 focus-visible:outline-(--wa-accent) ${
            closing ? 'wa-notif-toast-out' : ''
          }`}
        >
          {/* Accent left bar */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-1 bg-(--wa-accent)"
          />
          <span className="flex items-start gap-3 pl-1.5">
            <Avatar name={toast.title} size={40} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13.5px] leading-tight font-semibold text-(--wa-text)">
                  {toast.title}
                </span>
                {toast.timeLabel && (
                  <span className="shrink-0 text-[11px] font-medium text-(--wa-text-2)">
                    {toast.timeLabel}
                  </span>
                )}
              </span>
              <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-(--wa-text-2)">
                {senderPrefix}
                {toast.body}
              </span>
            </span>
          </span>
        </button>
      </div>
    </>
  )
}
