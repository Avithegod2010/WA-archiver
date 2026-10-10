'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  HelpCircle,
  Loader2,
  Moon,
  Sun,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ChatList } from './ChatList'
import { ChatView } from './ChatView'
import { StatsDashboard } from './StatsDashboard'
import { WhatsAppLogo } from './icons'
import type { ChatDetail, ChatSummary } from './types'
import { cn } from '@/lib/utils'

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-black/15 bg-[#f0f2f5] px-1.5 font-sans text-[11px] font-semibold text-[#3b4a54] shadow-[0_1.5px_0_rgba(11,20,26,0.15)] dark:border-white/15 dark:bg-[#2a3942] dark:text-[#d1d7db] dark:shadow-[0_1.5px_0_rgba(0,0,0,0.4)]">
      {children}
    </kbd>
  )
}

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

  useEffect(() => setMounted(true), [])

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

  const openChat = useCallback(async (id: string) => {
    setActiveId(id)
    setDetailLoading(true)
    setDetail(null)
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

  const loadDemo = useCallback(async () => {
    setImporting(true)
    const toastId = toast.loading('Creating demo chats...')
    try {
      const res = await fetch('/api/demo', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      toast.success(
        data.skipped
          ? 'Demo chats already loaded'
          : data.created?.length === 1
            ? `Demo chat restored: ${data.created[0]}`
            : 'Demo chats ready',
        { id: toastId }
      )
      await refreshChats()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed', {
        id: toastId,
      })
    } finally {
      setImporting(false)
    }
  }, [refreshChats])

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

  const totalMessages = chats.reduce((s, c) => s + c.messageCount, 0)

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-[#efeae2] dark:bg-[#0b141a]">
      {/* Top app bar */}
      <div className="flex items-center justify-between bg-[#008069] px-4 py-2 dark:bg-[#1f2c33]">
        <div className="flex items-center gap-2.5">
          <WhatsAppLogo size={30} className="text-white" />
          <div>
            <h1 className="text-[16px] font-semibold leading-tight text-white">
              WhatsApp Viewer
            </h1>
            <p className="text-[11px] leading-tight text-white/70">
              Read your exported chats — private &amp; local
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
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
            onOpenInsights={() => setStatsOpen(true)}
          />
        </div>
        <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', activeId ? 'flex' : 'hidden md:flex')}>
          <ChatView
            key={activeId ?? 'empty'}
            detail={detail}
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
          />
        </div>
        {importing && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
            <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 shadow-xl dark:bg-[#202c33]">
              <Loader2 className="h-5 w-5 animate-spin text-[#00a884]" />
              <span className="text-[14px] font-medium text-[#111b21] dark:text-[#e9edef]">
                Working on it...
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Sticky footer */}
      <footer className="mt-auto flex items-center justify-center gap-2 border-t border-black/10 bg-[#f0f2f5] px-4 py-1.5 text-[11.5px] text-[#667781] dark:border-black/30 dark:bg-[#202c33] dark:text-[#8696a0]">
        <Upload className="h-3 w-3" />
        {chats.length} chat{chats.length === 1 ? '' : 's'} ·{' '}
        {totalMessages.toLocaleString()} messages · all data stays on this device
      </footer>

      {/* Insights dashboard */}
      <StatsDashboard open={statsOpen} onOpenChange={setStatsOpen} />

      {/* About / help dialog */}
      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>How to import your WhatsApp chats</DialogTitle>
            <DialogDescription>
              This viewer reads official WhatsApp chat exports. Nothing is sent to
              any server — chats and media stay in your local database.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-[13.5px] leading-relaxed text-[#3b4a54] dark:text-[#d1d7db]">
            <div>
              <h4 className="mb-1 font-semibold">On Android</h4>
              <ol className="ml-4 list-decimal space-y-0.5">
                <li>Open the chat, tap the menu (three dots)</li>
                <li>Choose More &gt; Export chat</li>
                <li>Pick <b>with media</b> (a .zip) or <b>without media</b> (a .txt)</li>
                <li>Save/share the file, then upload it here</li>
              </ol>
            </div>
            <div>
              <h4 className="mb-1 font-semibold">On iPhone</h4>
              <ol className="ml-4 list-decimal space-y-0.5">
                <li>Open the chat, tap the contact name</li>
                <li>Scroll down and choose Export Chat</li>
                <li>Select <b>Attach Media</b> for photos and videos, or without</li>
                <li>Save the .zip and upload it here</li>
              </ol>
            </div>
            <div className="rounded-lg bg-[#00a884]/10 p-3 text-[13px] text-[#0b7a63] dark:text-[#6fd3b6]">
              <b>Tip:</b> Choose &quot;with media&quot; to see photos, videos and
              voice messages inside the viewer. Exports without media still show
              message text, dates and senders.
            </div>
            <div>
              <h4 className="mb-1 font-semibold">Install like an app</h4>
              <p>
                On Android, open the Chrome menu and choose <b>Add to Home
                Screen</b> (iPhone: Share &gt; Add to Home Screen). The viewer
                installs as a full-screen app with its own icon.
              </p>
            </div>
            <div>
              <h4 className="mb-1.5 font-semibold">Keyboard shortcuts</h4>
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-[13px]">
                <Kbd>/</Kbd>
                <span>Focus chat search</span>
                <div className="flex gap-1">
                  <Kbd>J</Kbd>
                  <Kbd>K</Kbd>
                </div>
                <span>Move up / down the chat list</span>
                <Kbd>Enter</Kbd>
                <span>Open highlighted chat</span>
                <Kbd>Esc</Kbd>
                <span>Clear search / close panels / back</span>
              </div>
            </div>
            <p className="text-[12px] text-[#667781] dark:text-[#8696a0]">
              Supported: Android &amp; iOS exports (.zip with media or .txt only).
              End-to-end encryption notices, group events, deleted messages,
              polls and locations are detected automatically.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
