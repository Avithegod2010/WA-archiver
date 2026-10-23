'use client'

import './app-extras.css'
import { assetUrl } from '@/lib/asset-base'
import { checkForUpdate, markUpdateSeen } from '@/lib/update-check'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  ALargeSmall,
  BarChart3,
  CalendarHeart,
  Check,
  Clock3,
  Compass,
  HelpCircle,
  Images,
  Keyboard,
  Loader2,
  MessageSquareDot,
  MonitorSmartphone,
  Moon,
  Paintbrush,
  Pipette,
  Settings,
  Sparkles,
  Sun,
  SunMoon,
  TextSearch,
  Upload,
  WifiOff,
} from 'lucide-react'
import {
  ACCENT_PRESETS,
  APP_THEMES,
  applyAccentOverride,
  applyThemeAttribute,
  getAppTheme,
  getAccentOverride,
  setAppTheme,
  setAccentOverride,
  subscribeAccent,
  subscribeAppTheme,
  type AppThemeKey,
} from './app-theme'
import {
  BUBBLE_STYLES,
  DENSITIES,
  TIME_FORMATS,
  displayVars,
  getBubbleStyle,
  getDensity,
  getTimeFormat,
  setBubbleStyle,
  setDensity,
  setTimeFormat,
  subscribeBubbleStyle,
  subscribeDensity,
  subscribeTimeFormat,
  type BubbleStyleKey,
  type DensityKey,
  type TimeFormatKey,
} from './display'
import {
  FONT_FAMILIES,
  getFontFamily,
  setFontFamily,
  subscribeFontFamily,
  type FontFamilyKey,
} from './font-family'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  TEXT_SIZES,
  getTextSize,
  setTextSize,
  subscribeTextSize,
  type TextSizeKey,
} from './text-size'
import { ChatList } from './ChatList'
import { ChatView } from './ChatView'
import { StatsDashboard } from './StatsDashboard'
import { MemoriesDialog } from './MemoriesDialog'
import { scheduleBackupReminder, writeLastBackupAt } from './backup-reminder'
import { GlobalSearch } from './GlobalSearch'
import { CommandPalette, type PaletteAction } from './CommandPalette'
import { MediaHub } from './MediaHub'
import { GuideDialog } from './GuideDialog'
import { DemoPickerDialog } from './DemoPickerDialog'
import { SettingsDialog } from './SettingsDialog'
import { ShortcutsDialog } from './ShortcutsDialog'
import { AppLock, LOCK_CHANGED_EVENT } from './AppLock'
import { ImportPanel } from './ImportPanel'
import { PwaInstallBanner } from './PwaInstallBanner'
import { NotifToasts } from './NotifToasts'
import { AudioDock } from './AudioDock'
import { ScheduledDispatchPoller } from './ScheduledDispatchPoller'
import { useShortcuts } from './useShortcuts'
import { WhatsAppLogo } from './icons'
import { SAVED_CHAT_ID, type ChatDetail, type ChatSummary } from './types'
import { DataError, importFileToDevice } from '@/lib/data'
import {
  findMergeCandidates,
  type ImportMergeCandidate,
} from '@/lib/import-dedup'
import { guessTitleFromFilename } from '@/lib/whatsapp-parser'
import {
  DataProvider,
  useData,
  useMessageNormalizer,
} from './data-provider'
import { cn } from '@/lib/utils'
import { installIntentRouter } from '@/lib/intent-router'
import { useT } from '@/lib/i18n'

// ---- Offline caches (Task 7-e #6) --------------------------------------
const CHATS_CACHE_KEY = 'wa-viewer:cache:chats'
const CHAT_CACHE_PREFIX = 'wa-viewer:cache:chat:'
const SEEN_CHATS_KEY = 'wa-viewer:seen-chats'
const MAX_CACHE_JSON_LENGTH = 1_500_000

// ---- Web Share Target (Task 10-f #2) -------------------------------------
// Must mirror the cache name + keys used by public/sw.js
const SHARE_CACHE_NAME = 'wa-viewer-share-v1'
const SHARE_PAYLOAD_KEY = '/__shared-payload'
const SHARE_ENTRY_MARKER = '/__shared-'

/** Merge title/text/url into one deduped message body (≤4000 chars). */
function composeShareText(parts: (string | null | undefined)[]): string {
  const out: string[] = []
  for (const raw of parts) {
    const v = (raw ?? '').trim()
    if (!v) continue
    if (out.some((p) => p.includes(v))) continue
    out.push(v)
  }
  return out.join('\n\n').slice(0, 4000)
}

/** Size-guarded localStorage write — quota/serialization failures are ignored. */
function cacheSet(key: string, value: unknown) {
  try {
    const json = JSON.stringify(value)
    if (json.length > MAX_CACHE_JSON_LENGTH) return
    localStorage.setItem(key, json)
  } catch {
    /* quota exceeded or storage unavailable — ignore */
  }
}

function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function WhatsAppAppInner() {
  const t = useT()
  const { theme, resolvedTheme, setTheme } = useTheme()
  // Active transport (Phase 2): 'server' = REST /api/*, 'device' = on-device
  // SQLite-WASM. Every data flow below goes through `data`.
  const { mode, data, modeResolved } = useData()
  const normalizeMessages = useMessageNormalizer()
  const [mounted, setMounted] = useState(false)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [chatsLoading, setChatsLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ChatDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [demoPickerOpen, setDemoPickerOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [memoriesOpen, setMemoriesOpen] = useState(false)
  const [mediaHubOpen, setMediaHubOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [importPanelOpen, setImportPanelOpen] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const [textSizeOpen, setTextSizeOpen] = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [pendingJumpId, setPendingJumpId] = useState<string | null>(null)
  const textSizeKey: TextSizeKey = useSyncExternalStore(
    subscribeTextSize,
    getTextSize,
    () => 'md'
  )
  const fontKey: FontFamilyKey = useSyncExternalStore(
    subscribeFontFamily,
    getFontFamily,
    () => 'default'
  )
  const themeKey: AppThemeKey = useSyncExternalStore(
    subscribeAppTheme,
    getAppTheme,
    () => 'classic'
  )
  const accentKey: string | null = useSyncExternalStore(
    subscribeAccent,
    getAccentOverride,
    () => null
  )
  const bubbleStyleKey: BubbleStyleKey = useSyncExternalStore(
    subscribeBubbleStyle,
    getBubbleStyle,
    () => 'classic'
  )
  const densityKey: DensityKey = useSyncExternalStore(
    subscribeDensity,
    getDensity,
    () => 'cozy'
  )
  const timeFormatKey: TimeFormatKey = useSyncExternalStore(
    subscribeTimeFormat,
    getTimeFormat,
    () => 'auto'
  )

  // Latest chats / activeId without stale closures (markChatSeen + shortcuts)
  const chatsRef = useRef(chats)
  useEffect(() => {
    chatsRef.current = chats
  }, [chats])
  const activeIdRef = useRef(activeId)
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  useEffect(() => setMounted(true), [])

  // Device transport owns its data locally — drop any server-shape localStorage
  // caches written there historically (they can't be trusted across modes).
  useEffect(() => {
    if (mode !== 'device') return
    try {
      localStorage.removeItem(CHATS_CACHE_KEY)
      localStorage.removeItem('wa-viewer:last-chat')
      const stale: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(CHAT_CACHE_PREFIX)) stale.push(k)
      }
      stale.forEach((k) => localStorage.removeItem(k))
    } catch {
      /* storage unavailable — nothing to clean */
    }
  }, [mode])

  // App-level backup reminder (Task 14-j): when a backup is due per the saved
  // cadence, a once-per-session toast offers "Back up now" — reusing the same
  // download flow as Settings' backup button.
  const runAppBackup = useCallback(async () => {
    try {
      const blob = await data.exportBackup()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `wa-archiver-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      writeLastBackupAt()
    } catch {
      /* offline / failed — the reminder simply returns next session */
    }
  }, [data])
  useEffect(() => {
    if (!mounted) return
    const t = setTimeout(
      () => scheduleBackupReminder(() => void runAppBackup()),
      4000
    )
    return () => clearTimeout(t)
  }, [mounted, runAppBackup])

  // Offline detection for the reading banner
  useEffect(() => {
    const update = () => setIsOffline(!navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // First visit: auto-open the interactive guide once
  useEffect(() => {
    if (!mounted) return
    let seen = false
    try {
      seen = localStorage.getItem('wa-viewer:guide-seen') === '1'
    } catch {
      return
    }
    if (!seen) {
      const t = setTimeout(() => setAboutOpen(true), 700)
      return () => clearTimeout(t)
    }
  }, [mounted])

  const closeGuide = useCallback((v: boolean) => {
    setAboutOpen(v)
    if (!v) {
      try {
        localStorage.setItem('wa-viewer:guide-seen', '1')
      } catch {
        /* ignore */
      }
    }
  }, [])

  // Mirror the persisted theme onto <html>; animate the repaint while the
  // new palette cascades through every surface
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('theme-switching')
    applyThemeAttribute(themeKey)
    const t = setTimeout(() => root.classList.remove('theme-switching'), 320)
    return () => clearTimeout(t)
  }, [themeKey])

  // Custom accent override rides on top of any theme (inline style on <html>)
  useEffect(() => {
    applyAccentOverride(accentKey)
  }, [accentKey])

  const refreshChats = useCallback(async () => {
    try {
      const list = await data.listChats()
      setChats(list)
      // Keep the list available for offline reads (size-guarded; server
      // transport only — device data is already local, caching it here would
      // let a stale cross-transport copy leak back in)
      if (mode === 'server') cacheSet(CHATS_CACHE_KEY, list)
      // The open chat is on screen — anything that changed in it (e.g. the
      // user's own sends) must not show up as an unread badge.
      const openId = activeIdRef.current
      if (openId) {
        const openChat = list.find((c) => c.id === openId)
        if (openChat) {
          try {
            const raw = localStorage.getItem(SEEN_CHATS_KEY)
            const map: Record<string, { lastAt: string; count: number }> = raw
              ? JSON.parse(raw)
              : {}
            const prev = map[openId]
            const nextEntry = {
              lastAt: openChat.lastAt ?? '',
              count: openChat.messageCount,
            }
            if (
              !prev ||
              prev.lastAt !== nextEntry.lastAt ||
              prev.count !== nextEntry.count
            ) {
              map[openId] = nextEntry
              localStorage.setItem(SEEN_CHATS_KEY, JSON.stringify(map))
              window.dispatchEvent(new Event('wa-seen-changed'))
            }
          } catch {
            /* storage unavailable — ignore */
          }
        }
      }
    } catch {
      // Offline: fall back to the cached chat list when present
      const cached = cacheGet<ChatSummary[]>(CHATS_CACHE_KEY)
      if (cached && Array.isArray(cached) && cached.length > 0) {
        setChats(cached)
      } else {
        toast.error(t('shell.toast.loadChatsFailed'))
      }
    } finally {
      setChatsLoading(false)
    }
  }, [data, mode, t])

  // Re-sync after app-lock transitions (Task 14-c): while the lock screen is
  // up, data fetches 401 — when the user unlocks (or disables the lock in
  // Settings), reload the chat list so nothing stays stuck on an empty state.
  useEffect(() => {
    const onLockChanged = () => void refreshChats()
    window.addEventListener(LOCK_CHANGED_EVENT, onLockChanged)
    return () => window.removeEventListener(LOCK_CHANGED_EVENT, onLockChanged)
  }, [refreshChats])

  useEffect(() => {
    // Phase 3: wait until the persisted storage mode has been read — the
    // initial 'server' state is a guess, and in device mode (standalone APK,
    // offline PWA) a premature server fetch can only fail.
    if (!modeResolved) return
    refreshChats()
    // One-shot v1→v2 demo upgrade (server transport only): swap the short v1
    // demo conversations for the richer v2 scripts. Idempotent.
    if (mode !== 'server') return
    fetch('/api/demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ migrateOnly: true }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { migrated?: string[] } | null) => {
        if (data?.migrated?.length) {
          void refreshChats()
          toast.info(
            t('shell.toast.demoUpgraded', { names: data.migrated.join(', ') })
          )
        }
      })
      .catch(() => {})
  }, [modeResolved, refreshChats, mode, t])

  // ---- Web Share Target (Task 10-f #2) ------------------------------------
  // Resolve the Saved Messages chat id. GET /api/chats guarantees the chat
  // exists (ensureSavedMessagesChat) — the id itself is the fixed
  // SAVED_CHAT_ID constant.
  const resolveSavedChatId = useCallback(async (): Promise<string | null> => {
    try {
      const list = await data.listChats()
      return list.some((c) => c.id === SAVED_CHAT_ID) ? SAVED_CHAT_ID : null
    } catch {
      return null
    }
  }, [data])

  const postTextToSaved = useCallback(
    async (body: string) => {
      await data.sendMessage(SAVED_CHAT_ID, { type: 'text', body })
    },
    [data]
  )

  /**
   * Consume incoming shared content:
   *  - POST share-target flow: the service worker parked the payload in the
   *    Cache API ('/__shared-payload' + '/__shared-blob-*') and redirected to
   *    /?shared=1 → upload text + files into Saved Messages, then clean up.
   *  - GET fallback: ?title=&text=&url= query params → post as one text
   *    message (desktop browsers / links without the SW flow).
   * The URL is always cleaned afterwards so refreshes never duplicate.
   */
  const processSharedContent = useCallback(async () => {
    const params = new URLSearchParams(window.location.search)

    if (params.get('shared') === '1') {
      let consumed = false
      try {
        if (typeof caches !== 'undefined') {
          const cache = await caches.open(SHARE_CACHE_NAME)
          const payloadRes = await cache.match(SHARE_PAYLOAD_KEY)
          if (payloadRes) {
            const payload = (await payloadRes.json()) as {
              ts?: number
              text?: string | null
              files?: { key: string; name: string; type: string }[]
            }
            // Only consume fresh payloads (<2 min) — stale ones belong to an
            // unconsumed earlier session and were already superseded.
            const fresh = Date.now() - (payload.ts ?? 0) < 120_000
            if (fresh) {
              const savedId = await resolveSavedChatId()
              if (!savedId) {
                toast.error(t('shell.toast.savedMissing'))
              } else {
                let ok = 0
                let failed = 0
                if (payload.text) {
                  try {
                    await postTextToSaved(payload.text)
                    ok++
                  } catch {
                    failed++
                  }
                }
                for (const f of payload.files ?? []) {
                  try {
                    const blobRes = await cache.match(f.key)
                    if (!blobRes) throw new Error('shared blob missing')
                    const blob = await blobRes.blob()
                    const file = new File([blob], f.name || 'shared-file', {
                      type: f.type || blob.type || 'application/octet-stream',
                    })
                    await data.sendMessage(savedId, {
                      type: 'text',
                      media: file,
                      mediaName: file.name,
                    })
                    ok++
                  } catch {
                    failed++
                  }
                }
                if (ok > 0) {
                  toast.success(
                    failed > 0
                      ? failed === 1
                        ? t('shell.toast.sharePartialOne')
                        : t('shell.toast.sharePartialMany', { count: failed })
                      : t('shell.toast.shared')
                  )
                } else {
                  toast.error(t('shell.toast.shareFailed'))
                }
                consumed = true
              }
            }
            // Remove every share entry (fresh or stale) after handling
            const keys = await cache.keys()
            await Promise.all(
              keys
                .filter((k) => k.url.includes(SHARE_ENTRY_MARKER))
                .map((k) => cache.delete(k))
            )
          }
        }
      } catch {
        /* cache unavailable — still clean the URL below */
      }
      if (consumed) void refreshChats()
      try {
        window.history.replaceState(null, '', window.location.pathname)
      } catch {
        /* ignore */
      }
      return
    }

    // GET-style fallback (?title=&text=&url=)
    const hasShareParams =
      params.has('title') || params.has('text') || params.has('url')
    if (!hasShareParams) return
    const body = composeShareText([
      params.get('title'),
      params.get('text'),
      params.get('url'),
    ])
    try {
      window.history.replaceState(null, '', window.location.pathname)
    } catch {
      /* ignore */
    }
    if (!body) return
    const savedId = await resolveSavedChatId()
    if (!savedId) {
      toast.error(t('shell.toast.savedMissingText'))
      return
    }
    try {
      await postTextToSaved(body)
      toast.success(t('shell.toast.shared'))
      void refreshChats()
    } catch {
      toast.error(t('shell.toast.shareTextFailed'))
    }
  }, [resolveSavedChatId, postTextToSaved, refreshChats, data, t])

  // Run once after mount (all URL/localStorage reads stay client-side)
  useEffect(() => {
    if (!mounted) return
    void processSharedContent()
  }, [mounted, processSharedContent])

  // Service worker — already registered by <PWARegister /> in the layout;
  // this guarded duplicate is idempotent (same script URL) and covers the
  // case where the app tree mounts before the layout hook fires.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }
    navigator.serviceWorker.register(assetUrl('/sw.js')).catch(() => {
      /* SW is a progressive enhancement — ignore failures */
    })
  }, [])

  // ---- Auto-update checker (v1.7.0) ----------------------------------------
  // Once a day (localStorage-throttled) query the GitHub Releases API; when a
  // strictly newer release exists, toast once per tag with a link to the
  // release page. Silent on every failure path — offline APKs never nag.
  useEffect(() => {
    if (!mounted) return
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const update = await checkForUpdate()
          if (!update) return
          markUpdateSeen(update.tag)
          toast.success(`WA Archiver ${update.version} is available`, {
            description:
              update.notes || 'A newer release is ready — see what changed.',
            duration: 15000,
            action: {
              label: 'View release',
              onClick: () => window.open(update.url, '_blank', 'noopener'),
            },
          })
        } catch {
          /* offline / rate-limited / same version — silent */
        }
      })()
    }, 6000) // let startup (import, DB open, first render) finish first
    return () => clearTimeout(timer)
  }, [mounted])

  // ---- Auto-clean executor (Task 10-f #4) ---------------------------------
  // When enabled in Settings (`wa-viewer:auto-clean` = '1'), delete archived
  // chats whose last activity is older than 30 days. Non-archived chats are
  // never touched; silent when nothing qualifies.
  useEffect(() => {
    if (!mounted) return
    let enabled = false
    try {
      enabled = localStorage.getItem('wa-viewer:auto-clean') === '1'
    } catch {
      return
    }
    if (!enabled) return
    void (async () => {
      try {
        const list = await data.listChats()
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
        const stale = list.filter((c) => {
          if (!c.archived || !c.lastAt) return false
          const t = new Date(c.lastAt).getTime()
          return !Number.isNaN(t) && t < cutoff
        })
        let deleted = 0
        for (const chat of stale) {
          try {
            await data.deleteChat(chat.id)
            deleted++
          } catch {
            /* leave this chat in place */
          }
        }
        if (deleted > 0) {
          toast.success(
            deleted === 1
              ? t('shell.toast.autoCleanedOne')
              : t('shell.toast.autoCleanedMany', { count: deleted })
          )
          void refreshChats()
        }
      } catch {
        /* offline etc. — silently skip */
      }
    })()
  }, [mounted, refreshChats, data, t])


  /**
   * Mark a chat as seen/read — Task 7-e contract:
   * `wa-viewer:seen-chats` = Record<chatId, { lastAt: string; count: number }>
   * where count = chat.messageCount and lastAt = chat.lastAt ?? ''.
   * Dispatches `wa-seen-changed` so ChatList (folders module) updates.
   * NOTE: deliberately local — chat-folders.ts is owned by a parallel agent.
   */
  const markChatSeen = useCallback((id: string) => {
    try {
      const chat = chatsRef.current.find((c) => c.id === id)
      if (!chat) return
      const raw = localStorage.getItem(SEEN_CHATS_KEY)
      const map: Record<string, { lastAt: string; count: number }> = raw
        ? JSON.parse(raw)
        : {}
      if (typeof map !== 'object' || map === null || Array.isArray(map)) return
      map[id] = { lastAt: chat.lastAt ?? '', count: chat.messageCount }
      // Cap growth — keep only the 500 most recently read chats.
      const entries = Object.entries(map)
      const capped =
        entries.length > 500
          ? Object.fromEntries(
              entries
                .sort((a, b) => (b[1].lastAt ?? '').localeCompare(a[1].lastAt ?? ''))
                .slice(0, 500)
            )
          : map
      localStorage.setItem(SEEN_CHATS_KEY, JSON.stringify(capped))
      window.dispatchEvent(new Event('wa-seen-changed'))
    } catch {
      /* storage unavailable — ignore */
    }
  }, [])

  // Sequence guard for openChat: a slow response for chat A must never
  // overwrite the detail of a chat opened after it (out-of-order fetch race).
  const openChatSeqRef = useRef(0)
  const openChat = useCallback(async (id: string, jumpMessageId?: string) => {
    const seq = ++openChatSeqRef.current
    setActiveId(id)
    setDetailLoading(true)
    setDetail(null)
    setPendingJumpId(jumpMessageId ?? null)
    // The offline localStorage cache is a SERVER-transport feature. In device
    // mode the data is already local — caching there would mix transports
    // (a device chat id restored in server mode would show stale junk).
    const lsCache = mode === 'server'
    const lastChatKey =
      mode === 'server' ? 'wa-viewer:last-chat' : 'wa-viewer:last-chat:device'
    try {
      const fresh = await data.getChatDetail(id)
      if (seq !== openChatSeqRef.current) return // a newer openChat superseded this one
      // Device transport: resolve media blobs to object URLs before render.
      const messages = await normalizeMessages(id, fresh.messages)
      const loaded: ChatDetail = { ...fresh, messages }
      setDetail(loaded)
      // Keep an offline copy of this chat (size-guarded)
      if (lsCache) cacheSet(CHAT_CACHE_PREFIX + id, loaded)
      markChatSeen(id)
      try {
        localStorage.setItem(lastChatKey, id)
      } catch {
        /* storage unavailable */
      }
    } catch (err) {
      if (seq !== openChatSeqRef.current) return
      // The server ANSWERED with a DataError (e.g. the chat doesn't exist on
      // this transport — a cross-transport id) → never show a cached copy.
      // Only true network failures get the offline cache fallback.
      const serverAnswered = err instanceof DataError
      const cached = !serverAnswered && lsCache
        ? cacheGet<ChatDetail>(CHAT_CACHE_PREFIX + id)
        : null
      if (cached && cached.chat && Array.isArray(cached.messages)) {
        setDetail(cached)
        toast.info(t('shell.toast.offlineCached'))
        markChatSeen(id)
        // activeId intentionally kept — the cached chat stays open
      } else {
        toast.error(
          serverAnswered && mode === 'server'
            ? t('shell.toast.deviceStorage')
            : t('shell.toast.loadChatFailed')
        )
        setActiveId(null)
        try {
          localStorage.removeItem(lastChatKey)
        } catch {
          /* ignore */
        }
      }
    } finally {
      if (seq === openChatSeqRef.current) {
        setDetailLoading(false)
      }
    }
  }, [markChatSeen, data, normalizeMessages, mode, t])

  // AudioDock tap (Task 12-a): open — or re-focus — the chat the currently
  // playing voice note belongs to, optionally jumping to the message.
  useEffect(() => {
    const onDockOpen = (e: Event) => {
      const d = (e as CustomEvent<{ chatId?: string; messageId?: string }>)
        .detail
      if (typeof d?.chatId === 'string' && d.chatId) {
        openChat(d.chatId, d.messageId)
      }
    }
    window.addEventListener('wa-audio-dock-open', onDockOpen)
    return () => window.removeEventListener('wa-audio-dock-open', onDockOpen)
  }, [openChat])

  // Restore the last opened chat across reloads (key is transport-scoped —
  // a device-mode chat id must never be restored in server mode or vice versa)
  useEffect(() => {
    let last: string | null = null
    try {
      last = localStorage.getItem(
        mode === 'server' ? 'wa-viewer:last-chat' : 'wa-viewer:last-chat:device'
      )
    } catch {
      return
    }
    if (last) openChat(last)
  }, [openChat, mode])

  const importFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setImporting(true)
      const batchToastId =
        files.length > 1
          ? toast.loading(t('shell.import.progressOf', { index: 1, total: files.length }))
          : null
      let lastChatId: string | null = null
      let ok = 0
      let failed = 0
      let totalMessages = 0
      let totalMedia = 0

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const singleToastId =
          files.length > 1
            ? undefined
            : toast.loading(t('shell.import.progressFile', { name: file.name }))
        const progressId = batchToastId ?? singleToastId
        try {
          // B1 parity — detect existing chats this export could merge into
          // BEFORE importing (the ImportPanel dialog path does the same via
          // its preview step). Matching is filename-based here: the parsed
          // title guess mirrors guessTitleFromFilename, and zip transcripts
          // match by source-file basename. Auto-merge keeps drag-drop /
          // batch / share-intent re-imports duplicate-free; the commit is
          // append-only with per-message dedup, so merging is lossless.
          let mergeTarget: ImportMergeCandidate | null = null
          try {
            const existing = await data.listChats()
            const candidates = findMergeCandidates({
              title: guessTitleFromFilename(file.name),
              sourceFile: file.name,
              chats: existing,
            })
            mergeTarget =
              candidates.sort(
                (a, b) => b.matchedBy.length - a.matchedBy.length
              )[0] ?? null
          } catch {
            mergeTarget = null // listChats failed → plain import still works
          }
          // Device transport: parse + store entirely in the browser.
          // Server transport: multipart upload to /api/import.
          const result =
            mode === 'device'
              ? await importFileToDevice(file, {
                  mergeIntoChatId: mergeTarget?.id,
                })
              : await (async () => {
                  const form = new FormData()
                  form.append('file', file)
                  if (mergeTarget)
                    form.append('mergeIntoChatId', mergeTarget.id)
                  const res = await fetch('/api/import', {
                    method: 'POST',
                    body: form,
                  })
                  const json = (await res.json().catch(() => null)) as {
                    error?: string
                    messages?: number
                    mediaFiles?: number
                    chatId?: string
                    merged?: boolean
                    added?: number
                    duplicatesSkipped?: number
                  } | null
                  if (!res.ok) {
                    throw new Error(json?.error ?? t('shell.import.failed'))
                  }
                  return {
                    messages: json?.messages ?? 0,
                    mediaFiles: json?.mediaFiles ?? 0,
                    chatId: json?.chatId,
                    merged: json?.merged,
                    added: json?.added,
                    duplicatesSkipped: json?.duplicatesSkipped,
                  }
                })()
          ok++
          totalMessages += result.messages ?? 0
          totalMedia += result.mediaFiles ?? 0
          if (result.chatId) lastChatId = result.chatId
          if (files.length === 1 && progressId) {
            if (result.merged) {
              toast.success(
                t('shell.import.merged', {
                  chat: mergeTarget?.title ?? '',
                  added: (result.added ?? 0).toLocaleString(),
                  skipped: (result.duplicatesSkipped ?? 0).toLocaleString(),
                }),
                { id: progressId }
              )
            } else {
              const msgCount = (result.messages ?? 0).toLocaleString()
              const mediaCount = (result.mediaFiles ?? 0).toLocaleString()
              toast.success(
                (result.mediaFiles ?? 0) > 0
                  ? t('shell.import.doneWithMedia', {
                      count: msgCount,
                      media: mediaCount,
                    })
                  : t('shell.import.doneMessages', { count: msgCount }),
                { id: progressId }
              )
            }
          } else if (progressId && i < files.length - 1) {
            toast.loading(
              t('shell.import.progressOf', {
                index: i + 2,
                total: files.length,
              }),
              {
                id: progressId,
              }
            )
          }
        } catch (err) {
          failed++
          toast.error(
            t('shell.import.fileFailed', {
              name: file.name,
              reason: err instanceof Error ? err.message : t('shell.import.failed'),
            }),
            files.length === 1 && progressId ? { id: progressId } : undefined
          )
        }
      }

      if (files.length > 1 && batchToastId) {
        const parts: string[] = []
        if (ok > 0) {
          const msgs = totalMessages.toLocaleString()
          parts.push(
            totalMedia > 0
              ? ok === 1
                ? t('shell.import.batchOkMediaOne', {
                    messages: msgs,
                    media: totalMedia.toLocaleString(),
                  })
                : t('shell.import.batchOkMediaMany', {
                    count: ok,
                    messages: msgs,
                    media: totalMedia.toLocaleString(),
                  })
              : ok === 1
                ? t('shell.import.batchOkOne', { messages: msgs })
                : t('shell.import.batchOkMany', { count: ok, messages: msgs })
          )
        }
        if (failed > 0)
          parts.push(t('shell.import.batchFailed', { count: failed }))
        toast[failed > 0 && ok === 0 ? 'error' : ok > 0 ? 'success' : 'error'](
          parts.join(' — '),
          { id: batchToastId }
        )
      }

      await refreshChats()
      if (lastChatId) await openChat(lastChatId)
      setImporting(false)
    },
    [refreshChats, openChat, mode, t, data]
  )

  // Android intent router (A4): the Capacitor shell forwards VIEW/SEND intents
  // to window.__WA_INTENT__ (src/lib/intent-router.ts). Files reuse importFiles
  // (same pipeline as the import panel); raw shared text lands in Saved
  // Messages, mirroring the share-target fallback above.
  useEffect(() => {
    if (!mounted) return
    installIntentRouter({
      onFiles: (files, text) => {
        if (files.length > 0) void importFiles(files)
        if (text) {
          void (async () => {
            const savedId = await resolveSavedChatId()
            if (!savedId) {
              toast.error(t('shell.toast.savedMissingText'))
              return
            }
            try {
              await postTextToSaved(text)
              toast.success(t('shell.toast.shared'))
              void refreshChats()
            } catch {
              toast.error(t('shell.toast.shareTextFailed'))
            }
          })()
        }
      },
      // Launcher shortcuts (Android 7.1+): long-press icon → surface.
      onShortcut: (target) => {
        if (target === 'import') setImportPanelOpen(true)
        else if (target === 'search') {
          setGlobalSearchQuery('')
          setGlobalSearchOpen(true)
        } else if (target === 'insights') setStatsOpen(true)
      },
    })
  }, [mounted, importFiles, resolveSavedChatId, postTextToSaved, refreshChats, t])

  const loadDemo = useCallback(() => {
    setDemoPickerOpen(true)
  }, [])

  /** After the picker creates chats, refresh and open the first one. */
  const handleDemoLoaded = useCallback(
    async (created: { id: string; title: string }[]) => {
      await refreshChats()
      if (created.length > 0) await openChat(created[0].id)
    },
    [refreshChats, openChat]
  )

  /** After the ImportPanel imports chats, refresh the list. */
  const handleImportPanelImported = useCallback(
    async (_chatIds: string[]) => {
      await refreshChats()
    },
    [refreshChats]
  )

  const deleteChat = useCallback(
    async (id: string) => {
      setDeleting(true)
      try {
        await data.deleteChat(id)
        toast.success(t('shell.toast.chatDeleted'))
        if (activeId === id) {
          setActiveId(null)
          setDetail(null)
          try {
            localStorage.removeItem('wa-viewer:last-chat')
          } catch {
            /* ignore */
          }
        }
        await refreshChats()
      } catch {
        toast.error(t('shell.toast.deleteFailed'))
      } finally {
        setDeleting(false)
      }
    },
    [activeId, refreshChats, data, t]
  )

  const togglePin = useCallback(
    async (id: string, pinned: boolean) => {
      // Optimistic update — revert on failure
      const prev = chats
      setChats((cs) =>
        cs.map((c) => (c.id === id ? { ...c, pinned } : c))
      )
      try {
        await data.setChatFlags(id, { pinned })
      } catch {
        setChats(prev)
        toast.error(t('shell.toast.pinFailed'))
      }
    },
    [chats, data, t]
  )

  /** Archive / unarchive a chat (DB-backed, like pinning). */
  const toggleArchive = useCallback(
    async (id: string, archived: boolean) => {
      const prev = chats
      setChats((cs) =>
        cs.map((c) => (c.id === id ? { ...c, archived } : c))
      )
      try {
        await data.setChatFlags(id, { archived })
        toast.success(archived ? t('shell.toast.archived') : t('shell.toast.unarchived'))
      } catch {
        setChats(prev)
        toast.error(t('shell.toast.archiveFailed'))
      }
    },
    [chats, data, t]
  )

  /** Star/unstar a message: optimistic DB-backed bookmark with revert. */
  const toggleStar = useCallback(
    async (messageId: string, starred: boolean) => {
      setDetail((d) =>
        d
          ? {
              ...d,
              messages: d.messages.map((m) =>
                m.id === messageId ? { ...m, starred } : m
              ),
            }
          : d
      )
      try {
        await data.toggleStar(messageId, starred)
      } catch {
        setDetail((d) =>
          d
            ? {
                ...d,
                messages: d.messages.map((m) =>
                  m.id === messageId ? { ...m, starred: !starred } : m
                ),
              }
            : d
        )
        toast.error(t('shell.toast.starFailed'))
      }
    },
    [data, t]
  )

  const totalMessages = chats.reduce((s, c) => s + c.messageCount, 0)

  // Command palette action registry (backlog #17). The theme entry flips
  // label/icon with the active theme, hence the resolvedTheme dependency.
  const paletteActions: PaletteAction[] = useMemo(
    () => [
      {
        id: 'search',
        label: t('shell.palette.search'),
        icon: <TextSearch />,
        keywords: 'find full text grep messages',
        run: () => {
          setGlobalSearchQuery('')
          setGlobalSearchOpen(true)
        },
      },
      {
        id: 'media',
        label: t('shell.palette.media'),
        icon: <Images />,
        keywords: 'gallery photos videos media export storage',
        run: () => setMediaHubOpen(true),
      },
      {
        id: 'insights',
        label: t('shell.palette.insights'),
        icon: <BarChart3 />,
        keywords: 'stats statistics charts analytics',
        run: () => setStatsOpen(true),
      },
      {
        id: 'memories',
        label: t('shell.palette.memories'),
        icon: <CalendarHeart />,
        keywords: 'memories history time machine nostalgia',
        run: () => setMemoriesOpen(true),
      },
      {
        id: 'import',
        label: t('shell.palette.import'),
        icon: <Upload />,
        keywords: 'add export upload whatsapp zip txt',
        run: () => setImportPanelOpen(true),
      },
      {
        id: 'demo',
        label: t('shell.palette.demo'),
        icon: <Sparkles />,
        keywords: 'sample try example playground',
        run: () => setDemoPickerOpen(true),
      },
      {
        id: 'settings',
        label: t('settings.title'),
        icon: <Settings />,
        keywords: 'preferences lock backup wallpaper font storage',
        run: () => setSettingsOpen(true),
      },
      {
        id: 'theme',
        label: resolvedTheme === 'dark'
          ? t('shell.palette.lightMode')
          : t('shell.palette.darkMode'),
        icon: resolvedTheme === 'dark' ? <Sun /> : <Moon />,
        keywords: 'dark light theme appearance night',
        run: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'shortcuts',
        label: t('settings.section.shortcuts'),
        icon: <Keyboard />,
        keywords: 'keys hotkeys help bindings',
        run: () => setShortcutsOpen(true),
      },
      {
        id: 'guide',
        label: t('shell.palette.guide'),
        icon: <Compass />,
        keywords: 'help about tutorial walkthrough',
        run: () => setAboutOpen(true),
      },
    ],
    [resolvedTheme, setTheme, t]
  )

  // Global keyboard shortcuts (Task 7-e #7)
  useShortcuts({
    onOpenPalette: () => setPaletteOpen(true),
    onOpenInsights: () => setStatsOpen(true),
    onOpenGuide: () => setAboutOpen(true),
    onToggleDark: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
    onNextChat: () => {
      const list = chatsRef.current
      if (list.length === 0) return
      const idx = list.findIndex((c) => c.id === activeIdRef.current)
      const next = idx === -1 ? 0 : (idx + 1) % list.length
      openChat(list[next].id)
    },
    onPrevChat: () => {
      const list = chatsRef.current
      if (list.length === 0) return
      const idx = list.findIndex((c) => c.id === activeIdRef.current)
      const prev = idx === -1 ? 0 : (idx - 1 + list.length) % list.length
      openChat(list[prev].id)
    },
    onShowShortcuts: () => setShortcutsOpen(true),
    onOpenMediaHub: () => setMediaHubOpen(true),
    onOpenGlobalSearch: () => {
      setGlobalSearchQuery('')
      setGlobalSearchOpen(true)
    },
  })

  /** Open a chat from a global-search hit and jump straight to the message. */
  const openFromSearch = useCallback(
    (chatId: string, messageId: string) => {
      openChat(chatId, messageId)
    },
    [openChat]
  )

  return (
    <div
      className="flex h-dvh min-h-0 flex-col bg-(--wa-chat-bg)"
      style={{
        fontFamily: FONT_FAMILIES[fontKey].stack,
        ...displayVars(bubbleStyleKey, densityKey),
      }}
    >
      {/* #21 — skip link: first tab stop jumps straight to the conversation */}
      <a
        href="#wa-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-(--wa-accent) focus:px-3 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-white focus:shadow-lg"
      >
        {t('shell.skipToChat')}
      </a>
      {/* Top app bar */}
      <div className="flex items-center justify-between bg-(--wa-appbar) px-4 py-2">
        <div className="anim-fade-up flex min-w-0 items-center gap-2.5">
          <span data-app-logo className="shrink-0">
            <WhatsAppLogo size={30} className="text-white" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-[16px] font-semibold leading-tight text-white">
              {t('app.name')}
            </h1>
            <p className="truncate text-[11px] leading-tight text-white/70">
              {t('app.tagline')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Popover open={textSizeOpen} onOpenChange={setTextSizeOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="wa-iconbtn h-9 w-9 text-white hover:bg-white/10"
                onClick={() => setTextSizeOpen((v) => !v)}
                aria-label={t('shell.aria.displaySettings')}
                title={t('shell.display.title')}
                suppressHydrationWarning
              >
                <ALargeSmall className="h-5 w-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="wa-scroll max-h-[80vh] w-72 overflow-y-auto p-3"
            >
              <p className="mb-2 text-[13px] font-medium text-(--wa-text)">
                {t('shell.display.textSize')}
              </p>
              <div className="grid grid-cols-4 gap-2">
                {(Object.keys(TEXT_SIZES) as TextSizeKey[]).map((k) => {
                  const active = textSizeKey === k
                  return (
                    <button
                      key={k}
                      onClick={() => setTextSize(k)}
                      aria-pressed={active}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-lg py-2 transition-transform duration-150 hover:scale-[1.04] active:scale-95',
                        active
                          ? 'bg-(--wa-accent)/10 ring-1 ring-(--wa-accent)'
                          : 'hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      <span
                        className="font-semibold leading-none text-(--wa-text)"
                        style={{ fontSize: Math.min(TEXT_SIZES[k].px + 3, 19) }}
                      >
                        Aa
                      </span>
                      <span className="flex items-center gap-0.5 text-[11px] font-medium text-(--wa-text)">
                        {active && <Check className="h-3 w-3 text-(--wa-accent)" />}
                        {TEXT_SIZES[k].label}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-(--wa-text-2)">
                {t('shell.display.textSizeHint')}
              </p>

              <div className="my-3 h-px bg-black/10 dark:bg-white/10" />

              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-(--wa-text)">
                <Paintbrush className="h-3.5 w-3.5 text-(--wa-accent)" />
                {t('shell.display.appTheme')}
              </p>
              <div className="grid grid-cols-4 gap-2">
                {(Object.keys(APP_THEMES) as AppThemeKey[]).map((k) => {
                  const t = APP_THEMES[k]
                  const active = themeKey === k
                  return (
                    <button
                      key={k}
                      onClick={() => setAppTheme(k)}
                      aria-pressed={active}
                      title={`${t.label} — ${t.hint}`}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-lg py-1.5 transition-transform duration-150 hover:scale-[1.06] active:scale-95',
                        active
                          ? 'bg-(--wa-accent)/10 ring-1 ring-(--wa-accent)'
                          : 'hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      <span
                        className={cn(
                          'relative flex h-9 w-full flex-col overflow-hidden rounded-md ring-1 ring-black/10 dark:ring-white/10',
                          active && 'ring-2 ring-(--wa-accent)'
                        )}
                      >
                        <span
                          className="h-2.5 w-full shrink-0"
                          style={{ background: t.swatch.appbar }}
                        />
                        <span className="flex flex-1 items-center justify-center gap-0.5 bg-(--wa-chat-bg) pb-0.5">
                          <i
                            className="block h-2 w-4 rounded-sm rounded-bl-none"
                            style={{ background: t.swatch.bubble }}
                          />
                          <i
                            className="block h-2 w-4 rounded-sm rounded-br-none"
                            style={{ background: t.swatch.accent }}
                          />
                        </span>
                        {active && (
                          <span className="absolute inset-0 flex items-center justify-center">
                            <Check className="h-3.5 w-3.5 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]" />
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          'w-full truncate text-center text-[10px] font-medium',
                          active
                            ? 'text-(--wa-accent-strong) dark:text-(--wa-accent)'
                            : 'text-(--wa-text)'
                        )}
                      >
                        {t.label}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-(--wa-text-2)">
                {t('shell.display.appThemeHint')}
              </p>

              <div className="my-3 h-px bg-black/10 dark:bg-white/10" />

              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-(--wa-text)">
                <Pipette className="h-3.5 w-3.5 text-(--wa-accent)" />
                {t('shell.display.accent')}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {ACCENT_PRESETS.map((a) => {
                  const active = accentKey === a.hex.toLowerCase()
                  return (
                    <button
                      key={a.hex}
                      onClick={() => setAccentOverride(a.hex)}
                      aria-pressed={active}
                      title={a.label}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full ring-1 ring-black/15 transition-transform duration-150 hover:scale-110 active:scale-95 dark:ring-white/25',
                        active && 'ring-2 ring-(--wa-text) ring-offset-2 ring-offset-(--wa-panel)'
                      )}
                      style={{ background: a.hex }}
                    >
                      {active && <Check className="h-3.5 w-3.5 text-white drop-shadow" />}
                    </button>
                  )
                })}
                <label
                  className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full ring-1 ring-black/15 transition-transform duration-150 hover:scale-110 active:scale-95 dark:ring-white/25"
                  title={t('shell.display.customColor')}
                  style={{
                    background:
                      'conic-gradient(#ef4444,#f59e0b,#84cc16,#14b8a6,#3b82f6,#8b5cf6,#ec4899,#ef4444)',
                  }}
                >
                  <input
                    type="color"
                    aria-label={t('shell.display.customColorAria')}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    value={accentKey ?? '#00a884'}
                    onChange={(e) => setAccentOverride(e.target.value)}
                  />
                </label>
                <button
                  onClick={() => setAccentOverride(null)}
                  aria-pressed={accentKey === null}
                  title={t('shell.display.followTheme')}
                  className={cn(
                    'ml-auto rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                    accentKey === null
                      ? 'bg-(--wa-accent)/15 text-(--wa-accent-strong) dark:text-(--wa-accent)'
                      : 'text-(--wa-text-2) hover:bg-black/5 dark:hover:bg-white/5'
                  )}
                >
                  {t('shell.display.themeDefault')}
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-(--wa-text-2)">
                {t('shell.display.accentHint')}
              </p>

              <div className="my-3 h-px bg-black/10 dark:bg-white/10" />

              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-(--wa-text)">
                <SunMoon className="h-3.5 w-3.5 text-(--wa-accent)" />
                {t('settings.section.appearance')}
              </p>
              <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-black/[0.04] p-1 dark:bg-white/[0.06]">
                {(
                  [
                    ['system', 'shell.display.auto', MonitorSmartphone],
                    ['light', 'shell.display.light', Sun],
                    ['dark', 'shell.display.dark', Moon],
                  ] as const
                ).map(([val, labelKey, Icon]) => {
                  const active = (theme ?? 'system') === val
                  return (
                    <button
                      key={val}
                      onClick={() => setTheme(val)}
                      aria-pressed={active}
                      className={cn(
                        'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-medium transition-colors',
                        active
                          ? 'bg-(--wa-panel) text-(--wa-text) shadow-sm'
                          : 'text-(--wa-text-2) hover:text-(--wa-text)'
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {t(labelKey)}
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-(--wa-text-2)">
                {theme === 'system'
                  ? t('shell.display.followingDevice', {
                      mode: resolvedTheme ?? '…',
                    })
                  : t('shell.display.autoHint')}
              </p>

              <div className="my-3 h-px bg-black/10 dark:bg-white/10" />

              <p className="mb-2 text-[13px] font-medium text-(--wa-text)">
                {t('shell.display.chatFont')}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(FONT_FAMILIES) as FontFamilyKey[]).map((k) => {
                  const f = FONT_FAMILIES[k]
                  const active = fontKey === k
                  return (
                    <button
                      key={k}
                      onClick={() => setFontFamily(k)}
                      aria-pressed={active}
                      title={f.hint}
                      className={cn(
                        'flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-transform duration-150 hover:scale-[1.03] active:scale-[0.97]',
                        active
                          ? 'bg-(--wa-accent)/10 ring-1 ring-(--wa-accent)'
                          : 'hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      <span
                        className="flex w-full items-center gap-1 text-[15px] font-semibold leading-tight text-(--wa-text)"
                        style={{ fontFamily: f.stack }}
                      >
                        <span className="truncate">Aa</span>
                        {active && (
                          <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-(--wa-accent)" />
                        )}
                      </span>
                      <span className="truncate text-[11px] font-medium text-(--wa-text)">
                        {f.label}
                      </span>
                      <span
                        className="w-full truncate text-[10.5px] leading-tight text-(--wa-text-2)"
                        style={{ fontFamily: f.stack }}
                      >
                        {t('shell.display.fontSample')}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-(--wa-text-2)">
                {t('shell.display.chatFontHint')}
              </p>

              <div className="my-3 h-px bg-black/10 dark:bg-white/10" />

              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-(--wa-text)">
                <MessageSquareDot className="h-3.5 w-3.5 text-(--wa-accent)" />
                {t('shell.display.bubbleStyle')}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(BUBBLE_STYLES) as BubbleStyleKey[]).map((k) => {
                  const active = bubbleStyleKey === k
                  return (
                    <button
                      key={k}
                      onClick={() => setBubbleStyle(k)}
                      aria-pressed={active}
                      title={BUBBLE_STYLES[k].hint}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-lg py-2 transition-transform duration-150 hover:scale-[1.04] active:scale-95',
                        active
                          ? 'bg-(--wa-accent)/10 ring-1 ring-(--wa-accent)'
                          : 'hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      <span className="flex w-full items-end justify-center gap-1 px-2">
                        <i
                          className={cn(
                            'block h-4 w-7 bg-(--wa-in) ring-1 ring-black/15 dark:ring-white/20',
                            k === 'classic' && 'rounded-[7.5px] rounded-tl-none',
                            k === 'round' && 'rounded-[14px] rounded-tl-none',
                            k === 'sharp' && 'rounded-[2.5px]'
                          )}
                        />
                      </span>
                      <span className="flex items-center gap-0.5 text-[11px] font-medium text-(--wa-text)">
                        {active && <Check className="h-3 w-3 text-(--wa-accent)" />}
                        {BUBBLE_STYLES[k].label}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                {(Object.keys(DENSITIES) as DensityKey[]).map((k) => {
                  const active = densityKey === k
                  return (
                    <button
                      key={k}
                      onClick={() => setDensity(k)}
                      aria-pressed={active}
                      title={DENSITIES[k].hint}
                      className={cn(
                        'flex flex-col items-start gap-1 rounded-lg px-2.5 py-2 text-left transition-transform duration-150 hover:scale-[1.03] active:scale-[0.97]',
                        active
                          ? 'bg-(--wa-accent)/10 ring-1 ring-(--wa-accent)'
                          : 'hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      <span className="flex w-full flex-col gap-[3px]">
                        <i className="block h-1.5 w-4/5 rounded-full bg-(--wa-text)/20" />
                        <i className="block h-1.5 w-full rounded-full bg-(--wa-text)/20" />
                        <i
                          className={cn(
                            'block h-1.5 rounded-full bg-(--wa-accent)/50',
                            k === 'cozy' ? 'w-3/5' : 'w-2/3'
                          )}
                        />
                      </span>
                      <span className="flex items-center gap-0.5 text-[11px] font-medium text-(--wa-text)">
                        {active && <Check className="h-3 w-3 text-(--wa-accent)" />}
                        {DENSITIES[k].label}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-(--wa-text-2)">
                {t('shell.display.bubbleHint')}
              </p>

              <div className="my-3 h-px bg-black/10 dark:bg-white/10" />

              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-(--wa-text)">
                <Clock3 className="h-3.5 w-3.5 text-(--wa-accent)" />
                {t('shell.display.clock')}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(TIME_FORMATS) as TimeFormatKey[]).map((k) => {
                  const active = timeFormatKey === k
                  return (
                    <button
                      key={k}
                      onClick={() => setTimeFormat(k)}
                      aria-pressed={active}
                      title={TIME_FORMATS[k].hint}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-lg py-2 transition-transform duration-150 hover:scale-[1.04] active:scale-95',
                        active
                          ? 'bg-(--wa-accent)/10 ring-1 ring-(--wa-accent)'
                          : 'hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      <span className="text-[12px] font-semibold leading-none text-(--wa-text)">
                        {k === 'h12' ? '3:45 PM' : k === 'h24' ? '15:45' : 'Aa'}
                      </span>
                      <span className="flex items-center gap-0.5 text-[11px] font-medium text-(--wa-text)">
                        {active && <Check className="h-3 w-3 text-(--wa-accent)" />}
                        {TIME_FORMATS[k].label}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-(--wa-text-2)">
                {t('shell.display.clockHint')}
              </p>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className="wa-iconbtn h-9 w-9 text-white hover:bg-white/10"
            onClick={() => setSettingsOpen(true)}
            aria-label={t('settings.title')}
            title={t('shell.aria.settingsTip')}
          >
            <Settings className="h-5 w-5" />
          </Button>
          {mounted && (
            <Button
              variant="ghost"
              size="icon"
              className="wa-iconbtn h-9 w-9 text-white hover:bg-white/10"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              aria-label={t('shell.aria.toggleDark')}
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="wa-iconbtn h-9 w-9 text-white hover:bg-white/10"
            onClick={() => setAboutOpen(true)}
            aria-label={t('shell.aria.aboutHelp')}
          >
            <HelpCircle className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Offline reading banner (Task 7-e #6) */}
      {isOffline && (
        <div
          role="status"
          className="wa-offline-banner flex items-center gap-2 bg-amber-400/90 px-4 py-1 text-[12.5px] text-black"
        >
          <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {mode === 'device'
              ? t('shell.offline.device')
              : t('shell.offline.server')}
          </span>
        </div>
      )}

      {/* Main area */}
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <div
          role="navigation"
          aria-label={t('chats.title')}
          className={cn('relative flex min-h-0 w-full md:w-auto', activeId ? 'hidden md:flex' : 'flex')}
        >
          <ChatList
            chats={chats}
            activeId={activeId}
            loading={chatsLoading}
            importing={importing}
            onSelect={openChat}
            onDelete={deleteChat}
            onImportFiles={importFiles}
            onDemo={loadDemo}
            onOpenMediaHub={() => setMediaHubOpen(true)}
            onTogglePin={togglePin}
            onToggleArchive={toggleArchive}
            onOpenPalette={() => setPaletteOpen(true)}
            onOpenInsights={() => setStatsOpen(true)}
            onOpenMemories={() => setMemoriesOpen(true)}
            onOpenGlobalSearch={(q) => {
              setGlobalSearchQuery(q)
              setGlobalSearchOpen(true)
            }}
            onRefreshChats={refreshChats}
            onAfterBulkDelete={async (deletedIds) => {
              // B2 bulk delete: close the chat if it was deleted, then refresh
              if (activeId && deletedIds.includes(activeId)) {
                setActiveId(null)
                setDetail(null)
                try {
                  localStorage.removeItem('wa-viewer:last-chat')
                } catch {
                  /* ignore */
                }
              }
              await refreshChats()
            }}
          />
        </div>
        <main
          id="wa-main"
          className={cn('flex min-h-0 min-w-0 flex-1 flex-col', activeId ? 'flex' : 'hidden md:flex')}
        >
          <ChatView
            key={activeId ?? 'empty'}
            detail={detail}
            setDetail={setDetail}
            loading={detailLoading}
            onBack={() => {
              setActiveId(null)
              setDetail(null)
              try {
                localStorage.removeItem('wa-viewer:last-chat')
              } catch {
                /* ignore */
              }
            }}
            onDelete={deleteChat}
            deleting={deleting}
            onStarMessage={toggleStar}
            initialJumpMessageId={pendingJumpId}
            onChatChanged={refreshChats}
            hasChats={chats.some((c) => c.id !== SAVED_CHAT_ID)}
            onOpenDemo={() => setDemoPickerOpen(true)}
            onOpenImport={() => setImportPanelOpen(true)}
          />
        </main>
        {importing && (
          <div className="animate-in fade-in absolute inset-0 z-30 flex items-center justify-center bg-black/20 backdrop-blur-[2px] duration-200">
            <div className="anim-pop flex items-center gap-3 rounded-xl bg-white px-5 py-4 shadow-xl dark:bg-(--wa-panel-2)">
              <Loader2 className="h-5 w-5 animate-spin text-(--wa-accent)" />
              <span className="text-[14px] font-medium text-(--wa-text)">
                {t('shell.working')}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <footer className="mt-auto border-t border-(--wa-line) bg-(--wa-panel-2) dark:bg-(--wa-panel-2)">
        <button
          type="button"
          onClick={() => setImportPanelOpen(true)}
          title={t('shell.palette.import')}
          aria-label={t('shell.footer.importAria')}
          className="flex w-full cursor-pointer items-center justify-center gap-2 px-4 py-2 text-[11.5px] text-(--wa-text-2) transition-colors hover:text-(--wa-accent-strong) dark:text-(--wa-text-2) dark:hover:text-(--wa-accent)"
        >
          <Upload className="h-3 w-3" />
          {chats.length === 1
            ? t('shell.footer.statsOne', {
                chats: chats.length,
                messages: totalMessages.toLocaleString(),
              })
            : t('shell.footer.statsMany', {
                chats: chats.length,
                messages: totalMessages.toLocaleString(),
              })}
        </button>
      </footer>

      {/* Insights dashboard */}
      <StatsDashboard open={statsOpen} onOpenChange={setStatsOpen} />

      {/* "On this day" memories across chats */}
      <MemoriesDialog open={memoriesOpen} onOpenChange={setMemoriesOpen} onOpenMessage={openFromSearch} />

      {/* Global search across all chats */}
      <GlobalSearch
        open={globalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
        initialQuery={globalSearchQuery}
        onOpenMessage={openFromSearch}
      />

      {/* Ctrl/⌘+K command palette — chat jump + actions (backlog #17) */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        chats={chats}
        actions={paletteActions}
        onOpenChat={openChat}
      />

      {/* Global media hub — every photo/video/voice/doc across all chats (#6) */}
      <MediaHub
        open={mediaHubOpen}
        onClose={() => setMediaHubOpen(false)}
        onOpenMessage={openFromSearch}
      />

      {/* Interactive animated guide */}
      <GuideDialog
        open={aboutOpen}
        onOpenChange={closeGuide}
        onImportFiles={() => setImportPanelOpen(true)}
        onDemo={() => setDemoPickerOpen(true)}
        onSelectChat={(id) => {
          openChat(id)
        }}
        onOpenInsights={() => setStatsOpen(true)}
      />

      {/* Demo chat picker */}
      <DemoPickerDialog
        open={demoPickerOpen}
        onOpenChange={setDemoPickerOpen}
        onLoaded={handleDemoLoaded}
      />

      {/* Settings: backup/restore, app lock, shortcuts, install/offline (#14) */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        onRefreshChats={refreshChats}
      />

      {/* Keyboard shortcuts list (#7) */}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* Import panel — drag & drop / browse for .zip & .txt exports */}
      <ImportPanel
        open={importPanelOpen}
        onOpenChange={setImportPanelOpen}
        onImported={handleImportPanelImported}
      />

      {/* Notification-style incoming-message toasts (playful simulator) */}
      <NotifToasts chats={chats} onOpenChat={openChat} />

      {/* Floating voice-note mini player — playback survives chat switches.
          Raised above the composer while a chat is open (no overlap). */}
      <AudioDock raised={!!activeId} />
      <ScheduledDispatchPoller />

      {/* PWA install banner — floating above the sticky footer. Hidden while
          a chat is open: the fixed card sat on top of the composer / smart
          replies (overlap), and no install nudge belongs mid-conversation. */}
      {!activeId && <PwaInstallBanner />}

      {/* App lock overlay — top-most (#15) */}
      <AppLock />
    </div>
  )
}

/** Root: supplies the active DataClient to the whole app tree. */
export function WhatsAppApp() {
  return (
    <DataProvider>
      <WhatsAppAppInner />
    </DataProvider>
  )
}
