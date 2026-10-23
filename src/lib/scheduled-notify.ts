/**
 * Scheduled-message delivery bridge for the Android APK (v1.9).
 *
 * Web builds deliver due scheduled messages through
 * ScheduledDispatchPoller (20 s tick while the tab is open). The device
 * build adds a native layer: every pending ScheduledMessage is mirrored to
 * a Capacitor LOCAL NOTIFICATION at its deliverAt — Android's AlarmManager
 * fires it even when the app is closed — and tapping the notification (or
 * receiving it) triggers an immediate dispatch run, which claims + inserts
 * the message into the archive.
 *
 * Design notes:
 *   • The notification is a REMINDER, not the delivery itself — delivery
 *     (writing the message row) always goes through dispatchScheduled() so
 *     the claim check keeps web + device runs idempotent.
 *   • Notification ids are stable 32-bit hashes of the row id, so
 *     rescheduling after edits/cancels updates in place.
 *   • The plugin is imported dynamically — the web bundle never loads it.
 */

import type { ScheduledItem } from './data/types'
import { fireScheduledCheck } from '@/components/whatsapp/ScheduledDispatchPoller'

const TRACK_KEY = 'wa-viewer:sched-notif-ids'
const CHANNEL_ID = 'scheduled-messages'

export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false
  const ua = window.navigator.userAgent ?? ''
  if (/capacitor/i.test(ua)) return true
  // Capacitor 8 also injects CapacitorCookies/native bridge markers — the
  // UA check covers the stock Android WebView case well enough.
  return Boolean((window as unknown as Record<string, unknown>).Capacitor)
}

/** Stable 32-bit notification id from the row id. */
function notifIdOf(rowId: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < rowId.length; i++) {
    h ^= rowId.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // LocalNotifications ids are Int32; keep them positive.
  return (h >>> 0) % 2_000_000_000
}

function readTracked(): number[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(TRACK_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((n): n is number => typeof n === 'number') : []
  } catch {
    return []
  }
}

function writeTracked(ids: number[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TRACK_KEY, JSON.stringify(ids))
  } catch {
    /* ignore */
  }
}

interface PluginShape {
  checkPermissions: () => Promise<{ display: 'granted' | 'denied' | 'prompt' }>
  requestPermissions: () => Promise<{ display: 'granted' | 'denied' | 'prompt' }>
  registerChannel?: (c: unknown) => Promise<void>
  schedule: (o: {
    notifications: {
      id: number
      title: string
      body: string
      schedule: { at: Date; allowWhileIdle: boolean }
      channelId?: string
      actionTypeId?: string
      extra?: Record<string, unknown>
    }[]
  }) => Promise<void>
  cancel: (o: { notifications: { id: number }[] }) => Promise<void>
  addListener: (
    event: string,
    cb: (data: unknown) => void
  ) => Promise<{ remove: () => Promise<void> }>
}

let pluginPromise: Promise<PluginShape | null> | null = null

/** Load the native plugin (device builds only). Null on web. */
async function loadPlugin(): Promise<PluginShape | null> {
  if (!isNativePlatform()) return null
  if (!pluginPromise) {
    pluginPromise = import('@capacitor/local-notifications')
      .then((m) => (m.LocalNotifications as unknown as PluginShape) ?? null)
      .catch(() => null)
  }
  return pluginPromise
}

/** Cap how far ahead we pre-arm notifications (28 days). */
const HORIZON_MS = 28 * 24 * 60 * 60 * 1000

/**
 * Mirror the pending schedule to native notifications:
 * cancels every tracked id that is no longer a pending future row and
 * schedules the rest. Never throws — worst case the app keeps delivering
 * in the foreground via the poller.
 */
export async function syncScheduledNotifications(
  items: ScheduledItem[]
): Promise<void> {
  const plugin = await loadPlugin()
  if (!plugin) return
  try {
    const perm = await plugin.checkPermissions()
    if (perm.display !== 'granted') {
      const req = await plugin.requestPermissions()
      if (req.display !== 'granted') return
    }
    try {
      await plugin.registerChannel?.({
        id: CHANNEL_ID,
        name: 'Scheduled messages',
        importance: 5, // high — heads-up
        visibility: 1, // public
      })
    } catch {
      /* channels are Android-only + best-effort */
    }

    const now = Date.now()
    const pending = items.filter(
      (s) =>
        s.status === 'pending' &&
        Date.parse(s.deliverAt) > now &&
        Date.parse(s.deliverAt) - now < HORIZON_MS
    )
    const keep = new Map<number, ScheduledItem>()
    for (const s of pending) keep.set(notifIdOf(s.id), s)

    const tracked = readTracked()
    const stale = tracked.filter((id) => !keep.has(id))
    if (stale.length > 0) {
      await plugin
        .cancel({ notifications: stale.map((id) => ({ id })) })
        .catch(() => undefined)
    }

    const scheduled = tracked.filter((id) => keep.has(id))
    const fresh = [...keep.keys()].filter((id) => !scheduled.includes(id))
    if (fresh.length === 0) {
      writeTracked([...keep.keys()])
      return
    }
    const notifications = fresh.map((id) => {
      const s = keep.get(id)!
      const at = new Date(Date.parse(s.deliverAt))
      const body = s.body.length > 140 ? `${s.body.slice(0, 139)}…` : s.body
      return {
        id,
        title: 'Scheduled message due',
        body,
        schedule: { at, allowWhileIdle: true },
        channelId: CHANNEL_ID,
        extra: { chatId: s.chatId, scheduledId: s.id },
      }
    })
    await plugin.schedule({ notifications })
    writeTracked([...keep.keys()])
  } catch {
    /* notifications are best-effort */
  }
}

/** Whether an installed tap handler should navigate to a chat. */
export interface NotifTap {
  chatId: string | null
}

/**
 * Listen for notification taps → immediate dispatch + hand back the chat
 * id so the shell can open it. Returns an unsubscribe (web: no-op).
 */
export function onScheduledNotificationTap(
  cb: (tap: NotifTap) => void
): () => void {
  let off: (() => void) | null = null
  void (async () => {
    const plugin = await loadPlugin()
    if (!plugin) return
    try {
      const handle = await plugin.addListener(
        'localNotificationActionPerformed',
        (data: unknown) => {
          const extra =
            (data as {
              notification?: { extra?: { chatId?: unknown } }
            })?.notification?.extra ?? {}
          const chatId =
            typeof extra.chatId === 'string' ? extra.chatId : null
          fireScheduledCheck()
          cb({ chatId })
        }
      )
      off = () => void handle.remove()
    } catch {
      /* ignore */
    }
  })()
  return () => off?.()
}
