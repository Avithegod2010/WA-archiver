'use client'

import { useMemo, useRef, useState } from 'react'
import {
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Mic,
  PhoneMissed,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  Upload,
  Ban,
  BarChart3,
  UserRound,
} from 'lucide-react'
import { Avatar } from './Avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { ChatSummary } from './types'
import { cn } from '@/lib/utils'

function formatListTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000)
  if (diffDays === 0)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7)
    return d.toLocaleDateString('en-GB', { weekday: 'long' })
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

const TYPE_META: Record<
  string,
  { icon: React.ReactNode; label: string }
> = {
  image: { icon: <ImageIcon className="h-3.5 w-3.5" />, label: 'Photo' },
  sticker: { icon: <StickyNote className="h-3.5 w-3.5" />, label: 'Sticker' },
  gif: { icon: <Film className="h-3.5 w-3.5" />, label: 'GIF' },
  video: { icon: <Film className="h-3.5 w-3.5" />, label: 'Video' },
  audio: { icon: <Mic className="h-3.5 w-3.5" />, label: 'Voice message' },
  document: { icon: <FileText className="h-3.5 w-3.5" />, label: 'Document' },
  location: { icon: <MapPin className="h-3.5 w-3.5" />, label: 'Location' },
  contact: { icon: <UserRound className="h-3.5 w-3.5" />, label: 'Contact card' },
  poll: { icon: <BarChart3 className="h-3.5 w-3.5" />, label: 'Poll' },
  call: { icon: <PhoneMissed className="h-3.5 w-3.5" />, label: 'Missed call' },
  deleted: { icon: <Ban className="h-3.5 w-3.5" />, label: 'Deleted message' },
  media: { icon: <ImageIcon className="h-3.5 w-3.5" />, label: 'Media' },
}

function Preview({ chat }: { chat: ChatSummary }) {
  if (chat.lastType === 'system') {
    return <p className="truncate italic text-[13.5px]">{chat.lastPreview}</p>
  }
  const meta = TYPE_META[chat.lastType]
  if (meta) {
    return (
      <p className="truncate text-[13.5px]">
        <span className="inline-flex items-center gap-1 align-[1px]">
          {meta.icon}
          {meta.label}
        </span>
        {chat.lastPreview && chat.lastType !== 'media' && (
          <span>: {chat.lastPreview}</span>
        )}
      </p>
    )
  }
  return <p className="truncate text-[13.5px]">{chat.lastPreview}</p>
}

export function ChatList({
  chats,
  activeId,
  loading,
  importing,
  onSelect,
  onDelete,
  onImportFile,
  onDemo,
}: {
  chats: ChatSummary[]
  activeId: string | null
  loading: boolean
  importing: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onImportFile: (file: File) => void
  onDemo: () => void
}) {
  const [query, setQuery] = useState('')
  const [pendingDelete, setPendingDelete] = useState<ChatSummary | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    if (!query.trim()) return chats
    const q = query.toLowerCase()
    return chats.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.lastPreview.toLowerCase().includes(q)
    )
  }, [chats, query])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) onImportFile(file)
  }

  return (
    <aside
      className={cn(
        'min-h-0 w-full flex-col border-r border-black/10 bg-white dark:border-black/30 dark:bg-[#111b21]',
        'md:flex md:w-[400px] md:shrink-0',
        'flex'
      )}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.txt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onImportFile(f)
          e.target.value = ''
        }}
      />

      {/* List header */}
      <div className="bg-[#008069] px-4 pb-2 pt-3 dark:bg-[#202c33]">
        <div className="flex items-center justify-between">
          <h1 className="text-[19px] font-semibold text-white dark:text-[#e9edef]">
            Chats
          </h1>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-9 gap-1.5 rounded-full bg-white/10 px-3 text-[12.5px] font-medium text-white hover:bg-white/20 dark:text-[#e9edef]"
              onClick={onDemo}
              disabled={importing}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Demo
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-9 gap-1.5 rounded-full bg-white/10 px-3 text-[12.5px] font-medium text-white hover:bg-white/20 dark:text-[#e9edef]"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              {importing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Import
            </Button>
          </div>
        </div>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8696a0]" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or start a new chat"
            className="h-9 rounded-lg border-none bg-[#f0f2f5] pl-9 text-[14px] text-[#111b21] dark:bg-[#2a3942] dark:text-[#e9edef] dark:placeholder:text-[#8696a0]"
          />
        </div>
      </div>

      {/* List body */}
      <div className="wa-scroll flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-1 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                <div className="h-12 w-12 animate-pulse rounded-full bg-black/10 dark:bg-white/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/3 animate-pulse rounded bg-black/10 dark:bg-white/10" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-black/10 dark:bg-white/10" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 py-10 text-center">
            {chats.length === 0 ? (
              <>
                <div
                  className={cn(
                    'flex w-full flex-col items-center rounded-2xl border-2 border-dashed px-6 py-10 transition-colors',
                    dragOver
                      ? 'border-[#00a884] bg-[#00a884]/5'
                      : 'border-black/15 dark:border-white/15'
                  )}
                >
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#00a884]/10">
                    <Upload className="h-7 w-7 text-[#00a884]" />
                  </div>
                  <p className="text-[15px] font-medium text-[#111b21] dark:text-[#e9edef]">
                    Import your chats
                  </p>
                  <p className="mt-2 max-w-[260px] text-[13px] leading-relaxed text-[#667781] dark:text-[#8696a0]">
                    Drop a WhatsApp export <b>.zip</b> (with media) or <b>.txt</b>{' '}
                    file here, or use the Import button above.
                  </p>
                  <Button
                    className="mt-5 gap-2 rounded-full bg-[#00a884] text-white hover:bg-[#029374]"
                    onClick={onDemo}
                    disabled={importing}
                  >
                    <Sparkles className="h-4 w-4" />
                    Try demo chats
                  </Button>
                </div>
                <p className="mt-6 text-[12px] leading-relaxed text-[#8696a0]">
                  Open WhatsApp &gt; a chat &gt; menu &gt; More &gt; Export chat to
                  create an export file.
                </p>
              </>
            ) : (
              <p className="text-[13.5px] text-[#667781] dark:text-[#8696a0]">
                No chats match &quot;{query}&quot;
              </p>
            )}
          </div>
        ) : (
          <ul role="list">
            {filtered.map((chat) => (
              <li key={chat.id}>
                <button
                  className={cn(
                    'group flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[#f5f6f6] dark:hover:bg-[#202c33]',
                    activeId === chat.id && 'bg-[#f0f2f5] dark:bg-[#2a3942]'
                  )}
                  onClick={() => onSelect(chat.id)}
                >
                  <Avatar name={chat.title} size={49} />
                  <div className="min-w-0 flex-1 border-b border-black/5 py-1.5 dark:border-white/5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[16px] leading-tight text-[#111b21] dark:text-[#e9edef]">
                        {chat.title}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 text-[12px]',
                          'text-[#667781] dark:text-[#8696a0]'
                        )}
                      >
                        {formatListTime(chat.lastAt)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1 text-[#667781] dark:text-[#8696a0]">
                        {chat.isGroup && chat.lastSender ? (
                          <span className="text-[13.5px]">
                            {chat.lastSender === 'You' ? (
                              'You: '
                            ) : (
                              <>
                                <span className="text-[#111b21] dark:text-[#d1d7db]">
                                  {chat.lastSender}
                                </span>
                                {': '}
                              </>
                            )}
                          </span>
                        ) : null}
                        <span className="align-[1px]">
                          <Preview chat={chat} />
                        </span>
                      </div>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Delete ${chat.title}`}
                        className="hidden shrink-0 rounded p-1 text-[#8696a0] hover:bg-black/10 hover:text-rose-500 group-hover:block dark:hover:bg-white/10"
                        onClick={(e) => {
                          e.stopPropagation()
                          setPendingDelete(chat)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.stopPropagation()
                            setPendingDelete(chat)
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Drag overlay */}
      {dragOver && chats.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#00a884]/10 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-[#00a884] bg-white/95 px-8 py-6 text-center dark:bg-[#111b21]/95">
            <Upload className="mx-auto mb-2 h-8 w-8 text-[#00a884]" />
            <p className="text-[14px] font-medium text-[#111b21] dark:text-[#e9edef]">
              Drop to import chat export
            </p>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(v) => !v && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{pendingDelete?.title}&quot; and its messages will be removed
              from this viewer. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id)
                setPendingDelete(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
