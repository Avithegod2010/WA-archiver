'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  ALargeSmall,
  Check,
  HelpCircle,
  Loader2,
  Moon,
  Paintbrush,
  Sun,
  Upload,
} from 'lucide-react'
import {
  APP_THEMES,
  applyThemeAttribute,
  getAppTheme,
  setAppTheme,
  subscribeAppTheme,
  type AppThemeKey,
} from './app-theme'
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
import { GlobalSearch } from './GlobalSearch'
import { GuideDialog } from './GuideDialog'
import { DemoPickerDialog } from './DemoPickerDialog'
import { WhatsAppLogo } from './icons'
import type { ChatDetail, ChatSummary } from './types'
import { cn } from '@/lib/utils'

export function WhatsAppApp() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [chats, setChats] = useState<ChatSummary[]>([])
  const [chatsLoading, setChatsLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ChatDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [demoPickerOpen, setDemoPickerOpen] = useState(false)
  const importTriggerRef = useRef<(() => void) | null>(null)
  const [textSizeOpen, setTextSizeOpen] = useState(false)
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [globalSearchQuery, setGlobalSearchQuery] = useState('')
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

  useEffect(() => setMounted(true), [])

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

  const refreshChats = useCallback(async () => {
    try {
      const res = await fetch('/api/chats', { cache: 'no-store' })
      const data = await res.json()
      setChats(data.chats ?? [])
    } catch {
      toast.error('Could not load chats')
    } finally {
      setChatsLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshChats()
  }, [refreshChats])

  const openChat = useCallback(async (id: string, jumpMessageId?: string) => {
    setActiveId(id)
    setDetailLoading(true)
    setDetail(null)
    setPendingJumpId(jumpMessageId ?? null)
    try {
      const res = await fetch(`/api/chats/${id}/messages`, { cache: 'no-store' })
      if (!res.ok) throw new Error('failed')
      const data = await res.json()
      setDetail(data)
      try {
        localStorage.setItem('wa-viewer:last-chat', id)
      } catch {
        /* storage unavailable */
      }
    } catch {
      toast.error('Could not load this chat')
      setActiveId(null)
      try {
        localStorage.removeItem('wa-viewer:last-chat')
      } catch {
        /* ignore */
      }
    } finally {
      setDetailLoading(false)
    }
  }, [])

  // Restore the last opened chat across reloads
  useEffect(() => {
    let last: string | null = null
    try {
      last = localStorage.getItem('wa-viewer:last-chat')
    } catch {
      return
    }
    if (last) openChat(last)
  }, [openChat])

  const importFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setImporting(true)
      const batchToastId =
        files.length > 1
          ? toast.loading(`Importing 1 of ${files.length}...`)
          : null
      let lastChatId: string | null = null
      let ok = 0
      let failed = 0
      let totalMessages = 0
      let totalMedia = 0

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const singleToastId =
          files.length > 1 ? undefined : toast.loading(`Importing ${file.name}...`)
        const progressId = batchToastId ?? singleToastId
        try {
          const form = new FormData()
          form.append('file', file)
          const res = await fetch('/api/import', { method: 'POST', body: form })
          const data = await res.json()
          if (!res.ok) {
            throw new Error(data.error ?? 'Import failed')
          }
          ok++
          totalMessages += data.messages ?? 0
          totalMedia += data.mediaFiles ?? 0
          if (data.chatId) lastChatId = data.chatId
          if (files.length === 1 && progressId) {
            toast.success(
              `Imported ${data.messages.toLocaleString()} messages${
                data.mediaFiles > 0
                  ? ` and ${data.mediaFiles.toLocaleString()} media files`
                  : ''
              }`,
              { id: progressId }
            )
          } else if (progressId && i < files.length - 1) {
            toast.loading(`Importing ${i + 2} of ${files.length}...`, {
              id: progressId,
            })
          }
        } catch (err) {
          failed++
          toast.error(
            `${file.name}: ${
              err instanceof Error ? err.message : 'Import failed'
            }`,
            files.length === 1 && progressId ? { id: progressId } : undefined
          )
        }
      }

      if (files.length > 1 && batchToastId) {
        const parts: string[] = []
        if (ok > 0)
          parts.push(
            `Imported ${ok} chat${ok === 1 ? '' : 's'} · ${totalMessages.toLocaleString()} messages${
              totalMedia > 0
                ? ` · ${totalMedia.toLocaleString()} media files`
                : ''
            }`
          )
        if (failed > 0) parts.push(`${failed} failed`)
        toast[failed > 0 && ok === 0 ? 'error' : ok > 0 ? 'success' : 'error'](
          parts.join(' — '),
          { id: batchToastId }
        )
      }

      await refreshChats()
      if (lastChatId) await openChat(lastChatId)
      setImporting(false)
    },
    [refreshChats, openChat]
  )

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

  const deleteChat = useCallback(
    async (id: string) => {
      setDeleting(true)
      try {
        const res = await fetch(`/api/chats/${id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('Failed to delete')
        toast.success('Chat deleted')
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
        toast.error('Could not delete this chat')
      } finally {
        setDeleting(false)
      }
    },
    [activeId, refreshChats]
  )

  const togglePin = useCallback(
    async (id: string, pinned: boolean) => {
      // Optimistic update — revert on failure
      const prev = chats
      setChats((cs) =>
        cs.map((c) => (c.id === id ? { ...c, pinned } : c))
      )
      try {
        const res = await fetch(`/api/chats/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pinned }),
        })
        if (!res.ok) throw new Error('failed')
      } catch {
        setChats(prev)
        toast.error('Could not update pin')
      }
    },
    [chats]
  )

  /** Archive / unarchive a chat (DB-backed, like pinning). */
  const toggleArchive = useCallback(
    async (id: string, archived: boolean) => {
      const prev = chats
      setChats((cs) =>
        cs.map((c) => (c.id === id ? { ...c, archived } : c))
      )
      try {
        const res = await fetch(`/api/chats/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived }),
        })
        if (!res.ok) throw new Error('failed')
        toast.success(archived ? 'Chat archived' : 'Chat unarchived')
      } catch {
        setChats(prev)
        toast.error('Could not update archive')
      }
    },
    [chats]
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
        const res = await fetch(`/api/messages/${messageId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ starred }),
        })
        if (!res.ok) throw new Error('failed')
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
        toast.error('Could not update star')
      }
    },
    []
  )

  const totalMessages = chats.reduce((s, c) => s + c.messageCount, 0)

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
      style={{ fontFamily: FONT_FAMILIES[fontKey].stack }}
    >
      {/* Top app bar */}
      <div className="flex items-center justify-between bg-(--wa-appbar) px-4 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <WhatsAppLogo size={30} className="shrink-0 text-white" />
          <div className="min-w-0">
            <h1 className="truncate text-[16px] font-semibold leading-tight text-white">
              WhatsApp Viewer
            </h1>
            <p className="truncate text-[11px] leading-tight text-white/70">
              Read your exported chats — private &amp; local
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Popover open={textSizeOpen} onOpenChange={setTextSizeOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-white hover:bg-white/10"
                onClick={() => setTextSizeOpen((v) => !v)}
                aria-label="Display settings"
                title="Text size & font"
              >
                <ALargeSmall className="h-5 w-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="wa-scroll max-h-[80vh] w-72 overflow-y-auto p-3"
            >
              <p className="mb-2 text-[13px] font-medium text-(--wa-text)">
                Reading text size
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(TEXT_SIZES) as TextSizeKey[]).map((k) => {
                  const active = textSizeKey === k
                  return (
                    <button
                      key={k}
                      onClick={() => setTextSize(k)}
                      aria-pressed={active}
                      className={cn(
                        'flex flex-col items-center gap-1 rounded-lg py-2 transition-colors',
                        active
                          ? 'bg-(--wa-accent)/10 ring-1 ring-(--wa-accent)'
                          : 'hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      <span
                        className="font-semibold leading-none text-(--wa-text)"
                        style={{ fontSize: TEXT_SIZES[k].px + 3 }}
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
                Applies to message text in every chat.
              </p>

              <div className="my-3 h-px bg-black/10 dark:bg-white/10" />

              <p className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-(--wa-text)">
                <Paintbrush className="h-3.5 w-3.5 text-(--wa-accent)" />
                App theme
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
                        'flex flex-col items-center gap-1 rounded-lg py-1.5 transition-colors',
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
                Recolors the whole app — header, bubbles, buttons and charts.
                Works with light &amp; dark mode.
              </p>

              <div className="my-3 h-px bg-black/10 dark:bg-white/10" />

              <p className="mb-2 text-[13px] font-medium text-(--wa-text)">
                Chat font
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
                        'flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors',
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
                        Hello! How are you?
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-(--wa-text-2)">
                Changes the typeface across the chat list and every
                conversation.
              </p>
            </PopoverContent>
          </Popover>
          {mounted && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-white hover:bg-white/10"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle dark mode"
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
            className="h-9 w-9 text-white hover:bg-white/10"
            onClick={() => setAboutOpen(true)}
            aria-label="About and help"
          >
            <HelpCircle className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Main area */}
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <div className={cn('relative flex min-h-0 w-full md:w-auto', activeId ? 'hidden md:flex' : 'flex')}>
          <ChatList
            chats={chats}
            activeId={activeId}
            loading={chatsLoading}
            importing={importing}
            onSelect={openChat}
            onDelete={deleteChat}
            onImportFiles={importFiles}
            onDemo={loadDemo}
            onTogglePin={togglePin}
            onToggleArchive={toggleArchive}
            onOpenInsights={() => setStatsOpen(true)}
            onOpenGlobalSearch={(q) => {
              setGlobalSearchQuery(q)
              setGlobalSearchOpen(true)
            }}
            bindImportTrigger={(fn) => {
              importTriggerRef.current = fn
            }}
          />
        </div>
        <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', activeId ? 'flex' : 'hidden md:flex')}>
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
          />
        </div>
        {importing && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
            <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 shadow-xl dark:bg-(--wa-panel-2)">
              <Loader2 className="h-5 w-5 animate-spin text-(--wa-accent)" />
              <span className="text-[14px] font-medium text-(--wa-text)">
                Working on it...
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <footer className="mt-auto flex items-center justify-center gap-2 border-t border-(--wa-line) bg-(--wa-panel-2) px-4 py-1.5 text-[11.5px] text-(--wa-text-2) dark:bg-(--wa-panel-2) dark:text-(--wa-text-2)">
        <Upload className="h-3 w-3" />
        {chats.length} chat{chats.length === 1 ? '' : 's'} ·{' '}
        {totalMessages.toLocaleString()} messages · all data stays on this device
      </footer>

      {/* Insights dashboard */}
      <StatsDashboard open={statsOpen} onOpenChange={setStatsOpen} />

      {/* Global search across all chats */}
      <GlobalSearch
        open={globalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
        initialQuery={globalSearchQuery}
        onOpenMessage={openFromSearch}
      />

      {/* Interactive animated guide */}
      <GuideDialog
        open={aboutOpen}
        onOpenChange={closeGuide}
        onImportFiles={() => importTriggerRef.current?.()}
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
    </div>
  )
}
