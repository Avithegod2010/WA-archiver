'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import './chat-folders.css'
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  CalendarHeart,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Command,
  FileText,
  Film,
  Image as ImageIcon,
  Images,
  Loader2,
  MapPin,
  MessagesSquare,
  Mic,
  MoreVertical,
  PhoneMissed,
  Pin,
  PinOff,
  Search,
  Settings2,
  Sparkles,
  Star,
  StickyNote,
  TextSearch,
  Trash2,
  Upload,
  Ban,
  UserRound,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, SavedAvatar } from './Avatar'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FolderManagerDialog } from './FolderManagerDialog'
import { SAVED_CHAT_ID, type ChatSummary } from './types'
import { formatChatTime } from './display'
import { cn } from '@/lib/utils'
import {
  EMPTY_FAVS_SNAPSHOT,
  EMPTY_FOLDERS_SNAPSHOT,
  EMPTY_SEEN_SNAPSHOT,
  getActiveFolderId,
  getFavChats,
  getFolders,
  getSeenMap,
  markAllRead,
  setActiveFolderId,
  subscribeActiveFolder,
  subscribeFavChats,
  subscribeFolders,
  subscribeSeen,
  toggleFavChat,
  unreadFor,
} from './chat-folders'

// Built-in folder ids (custom folders use their own generated ids)
const FOLDER_ALL = 'all'
const FOLDER_UNREAD = 'unread'
const FOLDER_GROUPS = 'groups'
const FOLDER_FAVORITES = 'favorites'
const FOLDER_MANAGE = '__manage'

const BUILT_IN_FOLDER_IDS = new Set([
  FOLDER_ALL,
  FOLDER_UNREAD,
  FOLDER_GROUPS,
  FOLDER_FAVORITES,
])

interface FolderTab {
  id: string
  label: string
  emoji?: string
  Icon?: LucideIcon
}

function formatListTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000)
  if (diffDays === 0) return formatChatTime(d)
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

/** One chat row — shared by the active list and the archived drawer. */
function ChatRow({
  chat,
  index,
  activeId,
  cursor,
  isArchived,
  unread,
  isFav,
  onSelect,
  onTogglePin,
  onToggleArchive,
  onToggleFav,
  onDelete,
}: {
  chat: ChatSummary
  index: number
  activeId: string | null
  cursor: number
  isArchived: boolean
  /** Unread message count (0 = clean); badges only render on active rows. */
  unread: number
  isFav: boolean
  onSelect: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onToggleArchive: (id: string, archived: boolean) => void
  onToggleFav: (id: string) => void
  onDelete: (chat: ChatSummary) => void
}) {
  const isSaved = chat.id === SAVED_CHAT_ID
  const hasUnread = !isArchived && unread > 0
  return (
    <button
      data-chat-idx={index}
      data-chat-id={chat.id}
      style={{ animationDelay: `${Math.min(index * 35, 320)}ms` }}
      className={cn(
        'anim-fade-up group relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-(--wa-row-hover)',
        activeId === chat.id && 'bg-(--wa-row-active)',
        cursor === index &&
          'ring-1 ring-inset ring-(--wa-accent)/70 bg-(--wa-accent)/[0.04] dark:bg-(--wa-panel-2)'
      )}
      onClick={() => onSelect(chat.id)}
    >
      {activeId === chat.id && (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full bg-(--wa-accent)"
        />
      )}
      {isSaved ? (
        <span data-saved-avatar className="inline-flex shrink-0 rounded-full">
          <SavedAvatar size={49} />
        </span>
      ) : (
        <Avatar name={chat.title} size={49} />
      )}
      <div className="min-w-0 flex-1 border-b border-black/5 py-1.5 dark:border-white/5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1">
            <span
              className={cn(
                'truncate text-[16px] leading-tight text-(--wa-text)',
                hasUnread && 'font-semibold',
                isArchived && 'text-(--wa-text-2) dark:text-(--wa-text-2)'
              )}
            >
              {chat.title}
            </span>
            {chat.pinned && !isSaved && (
              <Pin
                className="h-3 w-3 shrink-0 fill-[#8696a0] text-(--wa-text-2)"
                aria-label="Pinned"
              />
            )}
          </span>
          <span
            className={cn(
              'shrink-0 text-[12px]',
              hasUnread
                ? 'font-medium text-(--wa-accent-strong) dark:text-(--wa-accent)'
                : 'text-(--wa-text-2)'
            )}
          >
            {formatListTime(chat.lastAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1 text-(--wa-text-2)">
            {chat.isGroup && chat.lastSender ? (
              <span className="text-[13.5px]">
                {chat.lastSender === 'You' ? (
                  'You: '
                ) : (
                  <>
                    <span className="text-(--wa-text)">
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
          {/* Unread pill (WhatsApp-style: below the timestamp, swaps to the
              hover actions while hovering) */}
          {hasUnread && (
            <span
              className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-(--wa-accent) px-1.5 text-[11px] font-bold leading-none tabular-nums text-white group-hover:hidden"
              aria-label={`${unread} unread message${unread === 1 ? '' : 's'}`}
            >
              {unread > 999 ? '999+' : unread}
            </span>
          )}
          <span className="hidden shrink-0 items-center group-hover:flex">
            {!isSaved && (
              <span
                role="button"
                tabIndex={0}
                aria-label={
                  isFav
                    ? `Remove ${chat.title} from favorites`
                    : `Add ${chat.title} to favorites`
                }
                title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                className="rounded p-1 text-(--wa-text-2) hover:bg-black/10 hover:text-[#f2a33c] dark:hover:bg-white/10"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleFav(chat.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    onToggleFav(chat.id)
                  }
                }}
              >
                <Star
                  className={cn(
                    'h-4 w-4 transition-colors',
                    isFav && 'fill-[#f2a33c] text-[#f2a33c]'
                  )}
                />
              </span>
            )}
            {!isArchived && !isSaved && (
              <span
                role="button"
                tabIndex={0}
                aria-label={
                  chat.pinned ? `Unpin ${chat.title}` : `Pin ${chat.title}`
                }
                title={chat.pinned ? 'Unpin chat' : 'Pin chat'}
                className="rounded p-1 text-(--wa-text-2) hover:bg-black/10 hover:text-(--wa-accent) dark:hover:bg-white/10"
                onClick={(e) => {
                  e.stopPropagation()
                  onTogglePin(chat.id, !chat.pinned)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    onTogglePin(chat.id, !chat.pinned)
                  }
                }}
              >
                {chat.pinned ? (
                  <PinOff className="h-4 w-4" />
                ) : (
                  <Pin className="h-4 w-4" />
                )}
              </span>
            )}
            {!isArchived && !isSaved && (
              <span
                role="button"
                tabIndex={0}
                aria-label={
                  isArchived ? `Unarchive ${chat.title}` : `Archive ${chat.title}`
                }
                title={isArchived ? 'Unarchive chat' : 'Archive chat'}
                className="rounded p-1 text-(--wa-text-2) hover:bg-black/10 hover:text-(--wa-accent) dark:hover:bg-white/10"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleArchive(chat.id, !isArchived)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    onToggleArchive(chat.id, !isArchived)
                  }
                }}
              >
                {isArchived ? (
                  <ArchiveRestore className="h-4 w-4" />
                ) : (
                  <Archive className="h-4 w-4" />
                )}
              </span>
            )}
            {!isSaved && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`Delete ${chat.title}`}
                className="rounded p-1 text-(--wa-text-2) hover:bg-black/10 hover:text-rose-500 dark:hover:bg-white/10"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(chat)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    onDelete(chat)
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </span>
            )}
          </span>
        </div>
      </div>
    </button>
  )
}

/** Collapsible "Archived" header — sticky shortcut when closed, in-flow when open. */
function ArchivedToggle({
  count,
  open,
  onClick,
}: {
  count: number
  open: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-expanded={open}
      className="flex w-full items-center gap-3 border-t border-(--wa-line) bg-(--wa-panel) px-4 py-2.5 text-left transition-colors hover:bg-(--wa-row-hover) dark:border-white/5 dark:bg-(--wa-panel) dark:hover:bg-(--wa-row-hover)"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-(--wa-text-2) dark:bg-white/10 dark:text-(--wa-text-2)">
        <Archive className="h-4 w-4" />
      </span>
      <span className="flex-1 text-[14.5px] font-medium text-(--wa-text)">
        Archived
      </span>
      <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-(--wa-text-2) transition-transform duration-150 active:scale-90 dark:bg-white/10 dark:text-(--wa-text-2)">
        {count}
      </span>
      <ChevronDown
        className={cn(
          'h-4 w-4 text-(--wa-text-2) transition-transform duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]',
          open && 'rotate-180'
        )}
      />
    </button>
  )
}

/** Friendly per-folder empty state shown when a folder filters to nothing. */
function FolderEmptyState({
  folderId,
  folderName,
  onOpenManager,
}: {
  folderId: string
  folderName: string
  onOpenManager: () => void
}) {
  if (folderId === FOLDER_ALL) {
    return (
      <p className="px-4 pb-1 pt-4 text-center text-[13px] text-(--wa-text-2)">
        All chats are archived
      </p>
    )
  }

  let title = 'Nothing here yet'
  let hint: React.ReactNode = null
  if (folderId === FOLDER_UNREAD) {
    title = 'No unread messages 🎉'
    hint = 'You are all caught up.'
  } else if (folderId === FOLDER_GROUPS) {
    title = 'No group chats'
    hint = 'Group conversations you are part of will show up here.'
  } else if (folderId === FOLDER_FAVORITES) {
    title = 'No favorites yet'
    hint = 'Hover a chat and tap the ★ to add it to this folder.'
  } else {
    title = 'No chats in this folder yet'
    hint = 'Pick which chats belong here with the folder manager.'
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 py-12 text-center">
      <p className="text-[14px] font-medium text-(--wa-text)">{title}</p>
      {hint && (
        <p className="max-w-[280px] text-[13px] leading-relaxed text-(--wa-text-2)">
          {hint}
        </p>
      )}
      {!BUILT_IN_FOLDER_IDS.has(folderId) && (
        <Button
          variant="secondary"
          className="mt-2 gap-2 rounded-full bg-(--wa-accent)/10 text-[13px] font-medium text-(--wa-accent-strong) hover:bg-(--wa-accent)/20 dark:bg-(--wa-accent)/15 dark:text-(--wa-accent)"
          onClick={onOpenManager}
        >
          <Settings2 className="h-4 w-4" />
          Manage folders
        </Button>
      )}
    </div>
  )
}

export function ChatList({
  chats,
  activeId,
  loading,
  importing,
  onSelect,
  onDelete,
  onImportFiles,
  onDemo,
  onTogglePin,
  onToggleArchive,
  onOpenPalette,
  onOpenInsights,
  onOpenMemories,
  onOpenMediaHub,
  onOpenGlobalSearch,
  bindImportTrigger,
}: {
  chats: ChatSummary[]
  activeId: string | null
  loading: boolean
  importing: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onImportFiles: (files: File[]) => void
  onDemo: () => void
  onTogglePin: (id: string, pinned: boolean) => void
  onToggleArchive: (id: string, archived: boolean) => void
  onOpenPalette: () => void
  onOpenInsights: () => void
  onOpenMemories: () => void
  onOpenMediaHub: () => void
  onOpenGlobalSearch: (query: string) => void
  /** Lets the parent (guide) open the hidden import file picker. */
  bindImportTrigger?: (fn: () => void) => void
}) {
  const [query, setQuery] = useState('')
  const [pendingDelete, setPendingDelete] = useState<ChatSummary | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const archivedSectionRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const asideRef = useRef<HTMLElement>(null)

  // Folder tab strip refs/state (sliding pill)
  const tabsWrapRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const [pill, setPill] = useState({ left: 0, top: 0, width: 0, height: 0 })
  const [pillAnimated, setPillAnimated] = useState(false)
  const pillAnimatedRef = useRef(false)

  // Local stores (folders / favorites / seen) — SSR-safe via server snapshots
  const folders = useSyncExternalStore(
    subscribeFolders,
    getFolders,
    () => EMPTY_FOLDERS_SNAPSHOT
  )
  const favs = useSyncExternalStore(
    subscribeFavChats,
    getFavChats,
    () => EMPTY_FAVS_SNAPSHOT
  )
  const seen = useSyncExternalStore(
    subscribeSeen,
    getSeenMap,
    () => EMPTY_SEEN_SNAPSHOT
  )

  // Persisted active folder. The server snapshot MUST be a constant: during
  // hydration React calls getServerSnapshot ON THE CLIENT, so reading storage
  // there would diverge from the SSR HTML (classic hydration mismatch). With
  // a constant, the first paint matches the server and the stored folder is
  // picked up in the post-hydration re-render.
  const activeFolderId = useSyncExternalStore(
    subscribeActiveFolder,
    getActiveFolderId,
    () => FOLDER_ALL
  )

  // Fall back to "All" when the stored folder no longer exists
  const folderExists =
    activeFolderId === FOLDER_MANAGE
      ? false
      : BUILT_IN_FOLDER_IDS.has(activeFolderId) ||
        folders.some((f) => f.id === activeFolderId)
  const effectiveFolderId = folderExists ? activeFolderId : FOLDER_ALL

  const favSet = useMemo(() => new Set(favs), [favs])

  // Per-chat unread + per-tab badge counts
  const unreadStats = useMemo(() => {
    const perChat = new Map<string, number>()
    let total = 0
    let unreadChatCount = 0
    let groups = 0
    let favorites = 0
    for (const c of chats) {
      if (c.archived) continue // archived chats never show badges
      const u = unreadFor(c, seen)
      perChat.set(c.id, u)
      total += u
      if (u > 0) unreadChatCount++
      if (c.isGroup) groups += u
      if (favSet.has(c.id)) favorites += u
    }
    const byFolder: Record<string, number> = {}
    for (const f of folders) {
      let sum = 0
      for (const c of chats) {
        if (c.archived) continue
        if (f.chatIds.includes(c.id)) sum += perChat.get(c.id) ?? 0
      }
      byFolder[f.id] = sum
    }
    return { perChat, total, unreadChatCount, groups, favorites, byFolder }
  }, [chats, seen, favSet, folders])

  const tabs = useMemo<FolderTab[]>(
    () => [
      { id: FOLDER_ALL, label: 'All', Icon: MessagesSquare },
      { id: FOLDER_UNREAD, label: 'Unread', Icon: CircleDot },
      { id: FOLDER_GROUPS, label: 'Groups', Icon: Users },
      { id: FOLDER_FAVORITES, label: 'Favorites', Icon: Star },
      ...folders.map((f) => ({ id: f.id, label: f.name, emoji: f.emoji })),
    ],
    [folders]
  )
  const tabsSignature = tabs.map((t) => t.id).join('|')

  const badgeFor = useCallback(
    (tabId: string): number => {
      if (tabId === FOLDER_MANAGE) return 0
      if (tabId === FOLDER_ALL) return unreadStats.total
      if (tabId === FOLDER_UNREAD) return unreadStats.unreadChatCount
      if (tabId === FOLDER_GROUPS) return unreadStats.groups
      if (tabId === FOLDER_FAVORITES) return unreadStats.favorites
      return unreadStats.byFolder[tabId] ?? 0
    },
    [unreadStats]
  )

  const measurePill = useCallback(() => {
    const btn = tabRefs.current.get(effectiveFolderId)
    if (!btn) return
    const left = btn.offsetLeft
    const top = btn.offsetTop
    const width = btn.offsetWidth
    const height = btn.offsetHeight
    setPill((prev) =>
      prev.left === left &&
      prev.top === top &&
      prev.width === width &&
      prev.height === height
        ? prev
        : { left, top, width, height }
    )
  }, [effectiveFolderId])

  // Measure on mount / folder switch / tab-set change; enable the slide
  // transition only after the first measured position has painted.
  useLayoutEffect(() => {
    measurePill()
    if (pillAnimatedRef.current) return
    pillAnimatedRef.current = true
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setPillAnimated(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [measurePill, tabsSignature])

  // Keep the pill glued to the active tab through resizes (fonts, renames…)
  useEffect(() => {
    const ro = new ResizeObserver(() => measurePill())
    tabRefs.current.forEach((btn) => ro.observe(btn))
    if (tabsWrapRef.current) ro.observe(tabsWrapRef.current)
    return () => ro.disconnect()
  }, [measurePill, tabsSignature])

  // Keep the active tab visible (centered) in the scrollable strip
  useEffect(() => {
    const wrap = tabsWrapRef.current
    const btn = tabRefs.current.get(effectiveFolderId)
    if (!wrap || !btn) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const target = Math.max(
      0,
      btn.offsetLeft - (wrap.clientWidth - btn.offsetWidth) / 2
    )
    wrap.scrollTo({ left: target, behavior: reduce ? 'auto' : 'smooth' })
  }, [effectiveFolderId, tabsSignature])

  const setTabRef = useCallback(
    (id: string) => (el: HTMLButtonElement | null) => {
      if (el) tabRefs.current.set(id, el)
      else tabRefs.current.delete(id)
    },
    []
  )

  function selectFolder(id: string) {
    setActiveFolderId(id)
    // List remounts — drop any keyboard cursor from the previous folder
    setCursor(-1)
  }

  const handleToggleFav = useCallback((id: string) => {
    toggleFavChat(id)
  }, [])

  function handleMarkAllRead() {
    markAllRead(chats)
    toast.success('All chats marked as read')
  }

  // When the archived drawer opens, bring it into view (it renders in-flow at
  // the end of the list, below the fold on long chat lists)
  useEffect(() => {
    if (!archivedOpen) return
    const raf = requestAnimationFrame(() => {
      archivedSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [archivedOpen])

  // Expose the hidden file picker to the parent (interactive guide)
  useEffect(() => {
    bindImportTrigger?.(() => fileInputRef.current?.click())
  }, [bindImportTrigger])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matchesQuery = (c: ChatSummary) =>
      !q ||
      c.title.toLowerCase().includes(q) ||
      c.lastPreview.toLowerCase().includes(q)

    // Archived chats: search filter only — folders never apply to them
    const archived = chats.filter((c) => c.archived && matchesQuery(c))

    // Active chats: folder filter + search
    let active = chats.filter((c) => !c.archived)
    if (effectiveFolderId === FOLDER_UNREAD) {
      active = active.filter((c) => (unreadStats.perChat.get(c.id) ?? 0) > 0)
    } else if (effectiveFolderId === FOLDER_GROUPS) {
      active = active.filter((c) => c.isGroup)
    } else if (effectiveFolderId === FOLDER_FAVORITES) {
      active = active.filter((c) => favSet.has(c.id))
    } else {
      const custom = folders.find((f) => f.id === effectiveFolderId)
      if (custom) active = active.filter((c) => custom.chatIds.includes(c.id))
    }
    active = active.filter(matchesQuery)
    // Pinned-first ordering only in "All"; other folders stay recency-sorted
    if (effectiveFolderId === FOLDER_ALL) {
      active = [...active].sort((a, b) => Number(b.pinned) - Number(a.pinned))
    }
    return { active, archived }
  }, [chats, query, effectiveFolderId, folders, favSet, unreadStats])

  const { active: activeChats, archived: archivedChats } = filtered
  const totalUnread = unreadStats.total
  const activeFolderName =
    folders.find((f) => f.id === effectiveFolderId)?.name ?? ''
  const pinnedCount = activeChats.filter((c) => c.pinned).length
  const hasBothSections = pinnedCount > 0 && pinnedCount < activeChats.length

  // Flat display order for keyboard navigation: active chats, then archived
  // (only when the archived drawer is open)
  const displayList = useMemo(
    () => (archivedOpen ? [...activeChats, ...archivedChats] : activeChats),
    [activeChats, archivedChats, archivedOpen]
  )

  // Keyboard shortcuts: j/k or arrows navigate, Enter opens, / focuses search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (pendingDelete) return
      // Skip when any dialog/overlay is open
      if (document.querySelector('[role="dialog"],[role="alertdialog"]')) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const typing =
        tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable
      if (typing || e.key === ' ') return
      // Skip when the list pane is hidden (mobile chat open)
      if (!asideRef.current || asideRef.current.offsetParent === null) return

      if (e.key === '/') {
        e.preventDefault()
        searchInputRef.current?.focus()
        return
      }
      const down = e.key === 'j' || e.key === 'ArrowDown'
      const up = e.key === 'k' || e.key === 'ArrowUp'
      if (down || up) {
        e.preventDefault()
        if (displayList.length === 0) return
        setCursor((c) =>
          Math.min(Math.max(c + (down ? 1 : -1), 0), displayList.length - 1)
        )
      } else if (e.key === 'Enter' && cursor >= 0 && cursor < displayList.length) {
        // Only when the chat list itself has focus context (body)
        if (target && target !== document.body) return
        e.preventDefault()
        onSelect(displayList[cursor].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [displayList, cursor, pendingDelete, onSelect])

  // Keep the highlighted row visible
  useEffect(() => {
    if (cursor < 0) return
    const el = asideRef.current?.querySelector(`[data-chat-idx="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  function collectFiles(list: FileList | null | undefined): File[] {
    if (!list) return []
    return Array.from(list).filter((f) =>
      /\.(zip|txt)$/i.test(f.name)
    )
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const files = collectFiles(e.dataTransfer?.files)
    if (files.length > 0) onImportFiles(files)
  }

  const renderRow = (chat: ChatSummary, index: number, isArchived: boolean) => (
    <ChatRow
      chat={chat}
      index={index}
      activeId={activeId}
      cursor={cursor}
      isArchived={isArchived}
      unread={unreadStats.perChat.get(chat.id) ?? 0}
      isFav={favSet.has(chat.id)}
      onSelect={onSelect}
      onTogglePin={onTogglePin}
      onToggleArchive={onToggleArchive}
      onToggleFav={handleToggleFav}
      onDelete={setPendingDelete}
    />
  )

  return (
    <aside
      ref={asideRef}
      className={cn(
        'min-h-0 w-full flex-col border-r border-black/10 bg-white dark:bg-(--wa-panel)',
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
      {/* Hidden file input (batch import) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,.txt"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = collectFiles(e.target.files)
          if (files.length > 0) onImportFiles(files)
          e.target.value = ''
        }}
      />

      {/* List header */}
      <div className="bg-(--wa-appbar) px-4 pb-2 pt-3">
        <div className="flex items-center justify-between">
          <h1 className="text-[19px] font-semibold text-white dark:text-(--wa-text)">
            Chats
          </h1>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="wa-iconbtn h-9 w-9 rounded-full bg-white/10 text-white hover:bg-white/20 dark:text-(--wa-text)"
              onClick={onOpenPalette}
              disabled={importing}
              title="Command palette — jump to chats & run actions (Ctrl/⌘+K)"
              aria-label="Open command palette"
            >
              <Command className="h-4 w-4" />
            </Button>
            {/* Consolidated sidebar menu — insights / memories / media hub /
                demo live here as labelled sections instead of crowding the
                header row on every width. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  id="wa-more-sidebar"
                  size="icon"
                  variant="ghost"
                  className="wa-iconbtn h-9 w-9 rounded-full bg-white/10 text-white hover:bg-white/20 dark:text-(--wa-text)"
                  disabled={importing}
                  title="More — insights, memories, media hub, demo"
                  aria-label="More sidebar tools"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-(--wa-text-2)">
                  Explore
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={onOpenInsights}
                  className="gap-2"
                  disabled={importing}
                >
                  <BarChart3 className="h-4 w-4 text-(--wa-text-2)" />
                  Insights across all chats
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={onOpenMemories}
                  className="gap-2"
                  disabled={importing}
                >
                  <CalendarHeart className="h-4 w-4 text-(--wa-text-2)" />
                  On this day memories
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={onOpenMediaHub}
                  className="gap-2"
                  disabled={importing}
                >
                  <Images className="h-4 w-4 text-(--wa-text-2)" />
                  Media hub
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-(--wa-text-2)">
                  Try
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={onDemo}
                  className="gap-2"
                  disabled={importing}
                >
                  <Sparkles className="h-4 w-4 text-(--wa-text-2)" />
                  Demo chats
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="ghost"
              className="wa-iconbtn h-9 gap-1.5 rounded-full bg-white/10 px-3 text-[12.5px] font-medium text-white hover:bg-white/20 dark:text-(--wa-text)"
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
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--wa-text-2)" />
          <Input
            suppressHydrationWarning
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (query) {
                  e.stopPropagation()
                  setQuery('')
                }
                e.currentTarget.blur()
              }
            }}
            placeholder="Search or start a new chat"
            className={cn(
              'h-9 rounded-lg border-none bg-(--wa-panel-2) pl-9 text-[14px] text-(--wa-text) dark:bg-(--wa-row-active) dark:text-(--wa-text) dark:placeholder:text-(--wa-text-2)',
              totalUnread > 0 && 'pr-9'
            )}
          />
          {/* Mark all as read — only while there is anything unread */}
          {totalUnread > 0 && (
            <button
              onClick={handleMarkAllRead}
              title="Mark all as read"
              aria-label="Mark all chats as read"
              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-black/10 hover:text-(--wa-accent-strong) dark:hover:bg-white/10 dark:hover:text-(--wa-accent)"
            >
              <CheckCheck className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Folder tab strip (Telegram-style) */}
        <div className="-mx-4 mt-2 px-3">
          <div
            ref={tabsWrapRef}
            role="tablist"
            aria-label="Chat folders"
            className="wa-folder-tabs relative flex items-center gap-1 overflow-x-auto py-1"
          >
            {/* Sliding active-pill indicator */}
            <span
              aria-hidden
              className={cn(
                'wa-folder-pill',
                pillAnimated && 'wa-folder-pill--animated'
              )}
              style={{
                transform: `translateX(${pill.left}px)`,
                top: pill.top,
                width: pill.width,
                height: pill.height,
              }}
            />
            {tabs.map((tab) => {
              const active = tab.id === effectiveFolderId
              const count = badgeFor(tab.id)
              return (
                <button
                  key={tab.id}
                  ref={setTabRef(tab.id)}
                  role="tab"
                  aria-selected={active}
                  title={tab.label}
                  onClick={() => selectFolder(tab.id)}
                  className={cn(
                    'relative z-10 flex h-10 shrink-0 select-none items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors duration-[260ms] motion-reduce:transition-none',
                    active
                      ? 'text-white'
                      : 'text-white/75 hover:bg-white/10 hover:text-white dark:text-(--wa-text-2) dark:hover:bg-white/10 dark:hover:text-(--wa-text)'
                  )}
                >
                  {tab.Icon ? (
                    <tab.Icon className="h-4 w-4" />
                  ) : (
                    <span className="text-[15px] leading-none" aria-hidden>
                      {tab.emoji}
                    </span>
                  )}
                  <span className="whitespace-nowrap">{tab.label}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        'ml-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none tabular-nums transition-colors duration-[260ms] motion-reduce:transition-none',
                        active
                          ? 'bg-white text-(--wa-accent)'
                          : 'bg-(--wa-accent) text-white'
                      )}
                    >
                      {count > 999 ? '999+' : count}
                    </span>
                  )}
                </button>
              )
            })}
            {/* Manage folders tab */}
            <button
              ref={setTabRef(FOLDER_MANAGE)}
              role="tab"
              aria-selected={false}
              title="Manage folders"
              aria-label="Manage folders"
              onClick={() => setManagerOpen(true)}
              className="relative z-10 flex h-10 shrink-0 select-none items-center rounded-full px-3 text-white/75 transition-colors duration-[260ms] motion-reduce:transition-none hover:bg-white/10 hover:text-white dark:text-(--wa-text-2) dark:hover:bg-white/10 dark:hover:text-(--wa-text)"
            >
              <Settings2 className="h-4 w-4" />
              <span className="sr-only">Manage folders</span>
            </button>
          </div>
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
        ) : chats.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 py-10 text-center">
            <div
              className={cn(
                'flex w-full flex-col items-center rounded-2xl border-2 border-dashed px-6 py-10 transition-colors',
                dragOver
                  ? 'border-(--wa-accent) bg-(--wa-accent)/5'
                  : 'border-black/15 dark:border-white/15'
              )}
            >
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-(--wa-accent)/10">
                <Upload className="h-7 w-7 text-(--wa-accent)" />
              </div>
              <p className="text-[15px] font-medium text-(--wa-text)">
                Import your chats
              </p>
              <p className="mt-2 max-w-[260px] text-[13px] leading-relaxed text-(--wa-text-2)">
                Drop WhatsApp export <b>.zip</b> (with media) or <b>.txt</b>{' '}
                files here — several at once works too — or use the Import
                button above.
              </p>
              <Button
                className="mt-5 gap-2 rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
                onClick={onDemo}
                disabled={importing}
              >
                <Sparkles className="h-4 w-4" />
                Try demo chats
              </Button>
            </div>
            <p className="mt-6 text-[12px] leading-relaxed text-(--wa-text-2)">
              Open WhatsApp &gt; a chat &gt; menu &gt; More &gt; Export chat to
              create an export file.
            </p>
          </div>
        ) : query.trim() && activeChats.length === 0 && archivedChats.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8 py-10 text-center">
            <p className="text-[13.5px] text-(--wa-text-2)">
              No chats match &quot;{query}&quot;
            </p>
            <Button
              variant="secondary"
              className="gap-2 rounded-full bg-(--wa-accent)/10 text-[13px] font-medium text-(--wa-accent-strong) hover:bg-(--wa-accent)/20 dark:bg-(--wa-accent)/15 dark:text-(--wa-accent)"
              onClick={() => onOpenGlobalSearch(query.trim())}
            >
              <TextSearch className="h-4 w-4" />
              Search messages instead
            </Button>
          </div>
        ) : (
          <>
            {/* Global message search trigger (WhatsApp-style row above results) */}
            {query.trim() &&
              (activeChats.length > 0 || archivedChats.length > 0) && (
                <button
                  onClick={() => onOpenGlobalSearch(query.trim())}
                  className="anim-fade-up group flex w-full items-center gap-3 border-b border-black/5 px-4 py-2.5 text-left transition-colors hover:bg-(--wa-row-hover) dark:border-white/5 dark:hover:bg-(--wa-row-hover)"
                  title={`Search messages for "${query.trim()}"`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--wa-accent)/10 text-(--wa-accent-strong) transition-colors group-hover:bg-(--wa-accent) group-hover:text-white dark:bg-(--wa-accent)/20 dark:text-(--wa-accent) dark:group-hover:text-white">
                    <TextSearch className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-medium text-(--wa-text)">
                      Search messages for &quot;{query.trim()}&quot;
                    </span>
                    <span className="block truncate text-[12.5px] text-(--wa-text-2)">
                      Find this text inside every chat
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-(--wa-text-2) transition-transform group-hover:translate-x-0.5" />
                </button>
              )}
            {activeChats.length === 0 ? (
              <FolderEmptyState
                folderId={effectiveFolderId}
                folderName={activeFolderName}
                onOpenManager={() => setManagerOpen(true)}
              />
            ) : (
              <ul key={effectiveFolderId} role="list" className="anim-fade-up">
                {activeChats.map((chat, i) => {
                  const prev = activeChats[i - 1]
                  const showPinnedDivider =
                    hasBothSections && chat.pinned && (!prev || !prev.pinned)
                  const showAllDivider =
                    hasBothSections && !chat.pinned && prev?.pinned
                  return (
                    <li key={chat.id}>
                      {(showPinnedDivider || showAllDivider) && (
                        <div className="flex items-center gap-3 bg-(--wa-row-hover)/80 px-4 pb-1 pt-2.5 dark:bg-(--wa-panel)/60">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-(--wa-text-2)">
                            {showPinnedDivider ? 'Pinned' : 'All chats'}
                          </span>
                          <span className="h-px flex-1 bg-black/5 dark:bg-white/5" />
                        </div>
                      )}
                      {renderRow(chat, i, false)}
                    </li>
                  )
                })}
              </ul>
            )}

            {/* Archived drawer (WhatsApp-style collapsible section).
                When open it becomes a normal-flow section with a SOLID
                background — active chats can no longer show through while
                scrolling, and long archived lists stay fully reachable. */}
            {archivedChats.length > 0 && (
              archivedOpen ? (
                <div
                  ref={archivedSectionRef}
                  className="anim-fade-up mt-1 border-t border-(--wa-line) bg-white shadow-[0_-10px_18px_-14px_rgba(0,0,0,0.45)] dark:bg-(--wa-panel)"
                >
                  <ArchivedToggle
                    count={archivedChats.length}
                    open={archivedOpen}
                    onClick={() => setArchivedOpen(false)}
                  />
                  <ul
                    role="list"
                    className="bg-white pb-2 dark:bg-(--wa-panel)"
                  >
                    {archivedChats.map((chat, i) => (
                      <li key={chat.id}>
                        {renderRow(chat, activeChats.length + i, true)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="sticky bottom-0 z-10 mt-1">
                  <ArchivedToggle
                    count={archivedChats.length}
                    open={archivedOpen}
                    onClick={() => setArchivedOpen(true)}
                  />
                </div>
              )
            )}
          </>
        )}
      </div>

      {/* Drag overlay */}
      {dragOver && chats.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-(--wa-accent)/10 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-(--wa-accent) bg-white/95 px-8 py-6 text-center dark:bg-(--wa-panel)/95">
            <Upload className="mx-auto mb-2 h-8 w-8 text-(--wa-accent)" />
            <p className="text-[14px] font-medium text-(--wa-text)">
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

      {/* Folder manager */}
      <FolderManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        chats={chats}
      />
    </aside>
  )
}
