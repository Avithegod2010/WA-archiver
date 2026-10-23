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
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Command,
  FileDown,
  FileText,
  Film,
  FolderInput,
  Image as ImageIcon,
  Images,
  ListChecks,
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
  StarOff,
  StickyNote,
  TextSearch,
  Trash2,
  Upload,
  X,
  Ban,
  UserRound,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, SavedAvatar, useChatAvatar } from './Avatar'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FolderManagerDialog } from './FolderManagerDialog'
import { SAVED_CHAT_ID, type ChatSummary } from './types'
import { formatChatTime } from './display'
import { cn } from '@/lib/utils'
import { useData } from './data-provider'
import {
  bulkDeleteChats,
  bulkExportChatsText,
  bulkMoveChatsToFolder,
  bulkSetChatFavorite,
  bulkSetChatPin,
} from '@/lib/chat-ops'
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
  computeSmartFolders,
  isSmartFolderId,
  SMART_FOLDERS,
  type ChatFolder,
} from './chat-folders'
import { getLocale, t as translate, useT } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/locales/en'

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
  if (diffDays === 1) return translate(getLocale(), 'chats.time.yesterday')
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
  { icon: React.ReactNode; labelKey: TranslationKey }
> = {
  image: { icon: <ImageIcon className="h-3.5 w-3.5" />, labelKey: 'chats.type.photo' },
  sticker: { icon: <StickyNote className="h-3.5 w-3.5" />, labelKey: 'chats.type.sticker' },
  gif: { icon: <Film className="h-3.5 w-3.5" />, labelKey: 'chats.type.gif' },
  video: { icon: <Film className="h-3.5 w-3.5" />, labelKey: 'chats.type.video' },
  audio: { icon: <Mic className="h-3.5 w-3.5" />, labelKey: 'chats.type.voice' },
  document: { icon: <FileText className="h-3.5 w-3.5" />, labelKey: 'chats.type.document' },
  location: { icon: <MapPin className="h-3.5 w-3.5" />, labelKey: 'chats.type.location' },
  contact: { icon: <UserRound className="h-3.5 w-3.5" />, labelKey: 'chats.type.contact' },
  poll: { icon: <BarChart3 className="h-3.5 w-3.5" />, labelKey: 'chats.type.poll' },
  call: { icon: <PhoneMissed className="h-3.5 w-3.5" />, labelKey: 'chats.type.missedCall' },
  deleted: { icon: <Ban className="h-3.5 w-3.5" />, labelKey: 'chats.type.deleted' },
  media: { icon: <ImageIcon className="h-3.5 w-3.5" />, labelKey: 'chats.type.media' },
}

/**
 * Inline group-sender prefix ("Priya Nair: ") — kept INSIDE the same <p> as
 * the preview so the row stays WhatsApp's single truncated line. Rendering it
 * as a sibling block made rows wrap onto 3+ lines and clip at the list edge.
 */
function SenderPrefix({ sender }: { sender: string }) {
  const t = useT()
  // 'You' is chat DATA (exported sender name) — compare raw, localize display.
  if (sender === 'You')
    return <span className="text-[13.5px]">{t('common.you')}: </span>
  return (
    <span className="text-[13.5px]">
      <span className="text-(--wa-text)">{sender}</span>{': '}
    </span>
  )
}

function Preview({
  chat,
  sender,
}: {
  chat: ChatSummary
  /** Group sender shown inline before the preview ("Sender: preview"). */
  sender?: string | null
}) {
  const t = useT()
  if (chat.lastType === 'system') {
    return (
      <p className="truncate text-[13.5px] italic">
        {sender ? <SenderPrefix sender={sender} /> : null}
        {chat.lastPreview}
      </p>
    )
  }
  const meta = TYPE_META[chat.lastType]
  if (meta) {
    return (
      <p className="truncate text-[13.5px]">
        {sender ? <SenderPrefix sender={sender} /> : null}
        <span className="inline-flex items-center gap-1 align-[1px]">
          {meta.icon}
          {t(meta.labelKey)}
        </span>
        {chat.lastPreview && chat.lastType !== 'media' && (
          <span>: {chat.lastPreview}</span>
        )}
      </p>
    )
  }
  return (
    <p className="truncate text-[13.5px]">
      {sender ? <SenderPrefix sender={sender} /> : null}
      {chat.lastPreview}
    </p>
  )
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
  selectMode = false,
  selected = false,
  onSelect,
  onTogglePin,
  onToggleArchive,
  onToggleFav,
  onDelete,
  onToggleSelect,
  onEnterSelect,
}: {
  chat: ChatSummary
  index: number
  activeId: string | null
  cursor: number
  isArchived: boolean
  /** Unread message count (0 = clean); badges only render on active rows. */
  unread: number
  isFav: boolean
  /** B2: when true the row is a checkbox row — tap toggles the selection. */
  selectMode?: boolean
  selected?: boolean
  onSelect: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onToggleArchive: (id: string, archived: boolean) => void
  onToggleFav: (id: string) => void
  onDelete: (chat: ChatSummary) => void
  onToggleSelect: (id: string) => void
  /** Enter select mode with this chat preselected (long-press / hover ✚). */
  onEnterSelect: (id: string) => void
}) {
  const t = useT()
  const isSaved = chat.id === SAVED_CHAT_ID
  const hasUnread = !isArchived && unread > 0
  const customAvatar = useChatAvatar(isSaved ? '' : chat.id)

  // Long-press (≈500ms) enters select mode with this chat preselected,
  // mirroring the message-level select in ChatView. Pointer travel >12px
  // (scroll intent) cancels the timer; the click that lands right after a
  // fired long-press is swallowed once so the row doesn't also open.
  const pressRef = useRef({ timer: 0, x: 0, y: 0, fired: false })

  function cancelPress() {
    if (pressRef.current.timer) {
      window.clearTimeout(pressRef.current.timer)
      pressRef.current.timer = 0
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (selectMode || e.button !== 0) return
    pressRef.current.x = e.clientX
    pressRef.current.y = e.clientY
    pressRef.current.fired = false
    cancelPress()
    pressRef.current.timer = window.setTimeout(() => {
      pressRef.current.timer = 0
      pressRef.current.fired = true
      onEnterSelect(chat.id)
    }, 500)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!pressRef.current.timer) return
    const dx = e.clientX - pressRef.current.x
    const dy = e.clientY - pressRef.current.y
    if (dx * dx + dy * dy > 144) cancelPress()
  }

  function handleClick() {
    if (pressRef.current.fired) {
      pressRef.current.fired = false
      return
    }
    if (selectMode) {
      if (!isSaved) onToggleSelect(chat.id)
      return
    }
    onSelect(chat.id)
  }

  return (
    <button
      data-chat-idx={index}
      data-chat-id={chat.id}
      style={{ animationDelay: `${Math.min(index * 35, 320)}ms` }}
      className={cn(
        'anim-fade-up group relative flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-(--wa-row-hover)',
        activeId === chat.id && 'bg-(--wa-row-active)',
        cursor === index &&
          'ring-1 ring-inset ring-(--wa-accent)/70 bg-(--wa-accent)/[0.04] dark:bg-(--wa-panel-2)',
        selectMode &&
          selected &&
          'bg-(--wa-accent)/[0.08] dark:bg-(--wa-accent)/[0.14]',
        selectMode &&
          (isSaved
            ? 'cursor-not-allowed opacity-60'
            : 'cursor-pointer select-none')
      )}
      // B2 select mode: the row itself becomes a real checkbox control
      // (role + aria-checked), keeping the same layout/row classes.
      role={selectMode ? 'checkbox' : undefined}
      aria-checked={selectMode ? selected : undefined}
      aria-label={
        selectMode ? t('chats.row.aria.select', { name: chat.title }) : undefined
      }
      aria-disabled={selectMode && isSaved ? true : undefined}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={(e) => {
        // A fired long-press must not also open the text-selection menu
        if (pressRef.current.fired) e.preventDefault()
      }}
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
        <Avatar name={chat.title} size={49} src={customAvatar} />
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
                aria-label={t('chats.row.aria.pinned')}
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
            <Preview
              chat={chat}
              sender={chat.isGroup ? chat.lastSender : null}
            />
          </div>
          {/* B2 select mode: checkbox replaces the unread pill + hover
              actions; the row carries role="checkbox" aria-checked. */}
          {selectMode ? (
            <span
              aria-hidden
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border-2 transition-colors',
                selected
                  ? 'border-(--wa-accent) bg-(--wa-accent) text-white'
                  : 'border-black/25 dark:border-white/30',
                isSaved && 'opacity-40'
              )}
            >
              <Check
                className={cn('h-3 w-3', selected ? 'opacity-100' : 'opacity-0')}
              />
            </span>
          ) : (
            <>
              {/* Unread pill (WhatsApp-style: below the timestamp, swaps to the
                  hover actions while hovering) */}
              {hasUnread && (
                <span
                  className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-(--wa-accent) px-1.5 text-[11px] font-bold leading-none tabular-nums text-white group-hover:hidden"
                  aria-label={
                    unread === 1
                      ? t('chats.row.aria.unreadOne')
                      : t('chats.row.aria.unreadMany', { count: unread })
                  }
                >
                  {unread > 999 ? '999+' : unread}
                </span>
              )}
              <span className="hidden shrink-0 items-center group-hover:flex">
            {/* B2: trailing "Select" hover action — enters select mode with
                this chat preselected (mirrors ChatView's per-message entry). */}
            <span
              role="button"
              tabIndex={0}
              aria-label={t('chats.row.aria.select', { name: chat.title })}
              title={t('chats.row.select')}
              className="rounded p-1 text-(--wa-text-2) hover:bg-black/10 hover:text-(--wa-accent) dark:hover:bg-white/10"
              onClick={(e) => {
                e.stopPropagation()
                onEnterSelect(chat.id)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation()
                  onEnterSelect(chat.id)
                }
              }}
            >
              <ListChecks className="h-4 w-4" />
            </span>
            {!isSaved && (
              <span
                role="button"
                tabIndex={0}
                aria-label={
                  isFav
                    ? t('chats.row.aria.unfav', { name: chat.title })
                    : t('chats.row.aria.fav', { name: chat.title })
                }
                title={
                  isFav ? t('chats.row.title.unfav') : t('chats.row.title.fav')
                }
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
                  chat.pinned
                    ? t('chats.row.aria.unpin', { name: chat.title })
                    : t('chats.row.aria.pin', { name: chat.title })
                }
                title={
                  chat.pinned ? t('chats.row.title.unpin') : t('chats.row.title.pin')
                }
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
                  isArchived
                    ? t('chats.row.aria.unarchive', { name: chat.title })
                    : t('chats.row.aria.archive', { name: chat.title })
                }
                title={
                  isArchived
                    ? t('chats.row.title.unarchive')
                    : t('chats.row.title.archive')
                }
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
                aria-label={t('chats.row.aria.delete', { name: chat.title })}
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
            </>
          )}
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
  const t = useT()
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
        {t('chats.archived')}
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
  const t = useT()
  if (folderId === FOLDER_ALL) {
    return (
      <p className="px-4 pb-1 pt-4 text-center text-[13px] text-(--wa-text-2)">
        {t('chats.folderEmpty.allArchived')}
      </p>
    )
  }

  let title = t('chats.folderEmpty.generic')
  let hint: React.ReactNode = null
  if (folderId === FOLDER_UNREAD) {
    title = t('chats.folderEmpty.unread')
    hint = t('chats.folderEmpty.unreadHint')
  } else if (folderId === FOLDER_GROUPS) {
    title = t('chats.folderEmpty.groups')
    hint = t('chats.folderEmpty.groupsHint')
  } else if (folderId === FOLDER_FAVORITES) {
    title = t('chats.folderEmpty.favorites')
    hint = t('chats.folderEmpty.favoritesHint')
  } else {
    title = t('chats.folderEmpty.custom')
    hint = t('chats.folderEmpty.customHint')
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
          {t('chats.folders.manage')}
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
  onRefreshChats,
  onAfterBulkDelete,
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
  /** B2: re-fetch the chat list after a bulk mutation (pin/delete). */
  onRefreshChats: () => void | Promise<void>
  /** B2: post-bulk-delete hook — lets the parent close a deleted open chat. */
  onAfterBulkDelete?: (deletedIds: string[]) => void | Promise<void>
  /** Lets the parent (guide) open the hidden import file picker. */
  bindImportTrigger?: (fn: () => void) => void
}) {
  const { data } = useData()
  const t = useT()
  const [query, setQuery] = useState('')
  const [pendingDelete, setPendingDelete] = useState<ChatSummary | null>(null)
  // ---- B2: chat multi-select -------------------------------------------
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
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
        isSmartFolderId(activeFolderId) ||
        folders.some((f) => f.id === activeFolderId)
  const effectiveFolderId = folderExists ? activeFolderId : FOLDER_ALL

  const favSet = useMemo(() => new Set(favs), [favs])

  // ---- B2: chat multi-select — state + derived sets ---------------------
  const enterSelect = useCallback((preselectId?: string) => {
    setSelectMode(true)
    if (preselectId) setSelectedIds(new Set([preselectId]))
  }, [])

  const exitSelect = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  const toggleSelectChat = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectedChats = useMemo(
    () => chats.filter((c) => selectedIds.has(c.id)),
    [chats, selectedIds]
  )
  // Per-op targets mirror the per-row hover-action gating exactly: Saved
  // Messages can't be favorited/deleted, archived chats can't be pinned or
  // foldered (folders only hold non-archived chats).
  const favTargets = useMemo(
    () => selectedChats.filter((c) => c.id !== SAVED_CHAT_ID),
    [selectedChats]
  )
  const pinnable = useMemo(
    () =>
      selectedChats.filter(
        (c) => !c.archived && c.id !== SAVED_CHAT_ID
      ),
    [selectedChats]
  )
  const movable = useMemo(
    () => selectedChats.filter((c) => !c.archived),
    [selectedChats]
  )
  const deletable = useMemo(
    () => selectedChats.filter((c) => c.id !== SAVED_CHAT_ID),
    [selectedChats]
  )
  const allFav =
    favTargets.length > 0 && favTargets.every((c) => favSet.has(c.id))
  const allPinned =
    pinnable.length > 0 && pinnable.every((c) => c.pinned)

  // Prune the selection when chats disappear (bulk delete / cross-tab);
  // auto-exit select mode once the selection becomes empty.
  useEffect(() => {
    if (selectedIds.size === 0) return
    const live = new Set(chats.map((c) => c.id))
    const next = [...selectedIds].filter((id) => live.has(id))
    if (next.length === selectedIds.size) return
    setSelectedIds(new Set(next))
    if (next.length === 0) setSelectMode(false)
  }, [chats, selectedIds])

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

  // Smart collections (v1.8): read-only, recomputed from the live chats.
  const smartIds = useMemo(() => computeSmartFolders(chats), [chats])

  const tabs = useMemo<FolderTab[]>(
    () => [
      { id: FOLDER_ALL, label: t('chats.tab.all'), Icon: MessagesSquare },
      { id: FOLDER_UNREAD, label: t('chats.tab.unread'), Icon: CircleDot },
      { id: FOLDER_GROUPS, label: t('chats.tab.groups'), Icon: Users },
      { id: FOLDER_FAVORITES, label: t('chats.tab.favorites'), Icon: Star },
      ...folders.map((f) => ({ id: f.id, label: f.name, emoji: f.emoji })),
      ...SMART_FOLDERS.map((f) => ({ id: f.id, label: f.name, emoji: f.emoji })),
    ],
    [folders, t]
  )
  const tabsSignature = tabs.map((t) => t.id).join('|')

  const badgeFor = useCallback(
    (tabId: string): number => {
      if (tabId === FOLDER_MANAGE) return 0
      if (tabId === FOLDER_ALL) return unreadStats.total
      if (tabId === FOLDER_UNREAD) return unreadStats.unreadChatCount
      if (tabId === FOLDER_GROUPS) return unreadStats.groups
      if (tabId === FOLDER_FAVORITES) return unreadStats.favorites
      if (isSmartFolderId(tabId)) {
        const ids = new Set(smartIds[tabId] ?? [])
        let sum = 0
        for (const c of chats) {
          if (!c.archived && ids.has(c.id)) sum += unreadStats.perChat.get(c.id) ?? 0
        }
        return sum
      }
      return unreadStats.byFolder[tabId] ?? 0
    },
    [unreadStats, smartIds, chats]
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
    // B2: a folder switch invalidates the selection context — clear it
    // (selection is empty afterwards, so select mode exits with it)
    if (selectMode) exitSelect()
  }

  const handleToggleFav = useCallback((id: string) => {
    toggleFavChat(id)
  }, [])

  function handleMarkAllRead() {
    markAllRead(chats)
    toast.success(t('chats.toast.markAllRead'))
  }

  // ---- B2: bulk actions -------------------------------------------------
  function handleBulkFav() {
    const ids = favTargets.map((c) => c.id)
    if (ids.length === 0) return
    const favorite = !allFav
    const r = bulkSetChatFavorite(ids, favorite)
    if (r.ok.length > 0) {
      const n = r.ok.length
      if (favorite) {
        toast.success(
          n === 1
            ? t('chats.toast.favoritedOne')
            : t('chats.toast.favoritedMany', { count: n })
        )
      } else {
        toast.success(
          n === 1
            ? t('chats.toast.unfavoritedOne')
            : t('chats.toast.unfavoritedMany', { count: n })
        )
      }
    }
  }

  async function handleBulkPin() {
    const ids = pinnable.map((c) => c.id)
    if (ids.length === 0 || bulkBusy) return
    const pinned = !allPinned
    setBulkBusy(true)
    try {
      const r = await bulkSetChatPin(data, ids, pinned)
      if (r.ok.length > 0) {
        const n = r.ok.length
        if (pinned) {
          toast.success(
            n === 1
              ? t('chats.toast.pinnedOne')
              : t('chats.toast.pinnedMany', { count: n })
          )
        } else {
          toast.success(
            n === 1
              ? t('chats.toast.unpinnedOne')
              : t('chats.toast.unpinnedMany', { count: n })
          )
        }
      }
      if (r.failed.length > 0) {
        toast.error(
          r.failed.length === 1
            ? t('chats.toast.updateFailedOne')
            : t('chats.toast.updateFailedMany', { count: r.failed.length })
        )
      }
      if (r.ok.length > 0) await onRefreshChats()
    } finally {
      setBulkBusy(false)
    }
  }

  function handleBulkMove(folder: ChatFolder) {
    const ids = movable.map((c) => c.id)
    if (ids.length === 0) return
    const r = bulkMoveChatsToFolder(ids, folder.id)
    if (r.ok.length > 0) {
      toast.success(
        r.ok.length === 1
          ? t('chats.toast.movedOne', { folder: folder.name })
          : t('chats.toast.movedMany', {
              count: r.ok.length,
              folder: folder.name,
            })
      )
      setMoveOpen(false)
    } else {
      toast.error(t('chats.toast.moveFailed'))
    }
  }

  async function handleBulkDelete() {
    const ids = deletable.map((c) => c.id)
    setBulkDeleteOpen(false)
    if (ids.length === 0 || bulkBusy) return
    setBulkBusy(true)
    try {
      const r = await bulkDeleteChats(data, ids)
      if (r.ok.length > 0) {
        toast.success(
          r.ok.length === 1
            ? t('chats.toast.deletedOne')
            : t('chats.toast.deletedMany', { count: r.ok.length })
        )
        // The selection is gone with the chats — leave select mode
        exitSelect()
        await onAfterBulkDelete?.(r.ok)
      }
      if (r.failed.length > 0) {
        toast.error(
          r.failed.length === 1
            ? t('chats.toast.deleteFailedOne')
            : t('chats.toast.deleteFailedMany', { count: r.failed.length })
        )
      }
    } finally {
      setBulkBusy(false)
    }
  }

  async function handleBulkExport() {
    if (selectedChats.length === 0 || bulkBusy) return
    setBulkBusy(true)
    try {
      const r = await bulkExportChatsText(
        data,
        selectedChats.map((c) => ({ id: c.id, title: c.title }))
      )
      if (r.blob) {
        const url = URL.createObjectURL(r.blob)
        const a = document.createElement('a')
        a.href = url
        a.download = r.filename
        document.body.appendChild(a)
        a.click()
        a.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 5000)
        toast.success(
          r.ok.length === 1
            ? t('chats.toast.exportedOne')
            : t('chats.toast.exportedMany', { count: r.ok.length })
        )
      } else {
        toast.error(t('chats.toast.exportSelectedFailed'))
      }
      if (r.failed.length > 0) {
        toast.error(
          r.failed.length === 1
            ? t('chats.toast.exportFailedOne')
            : t('chats.toast.exportFailedMany', { count: r.failed.length })
        )
      }
    } catch {
      toast.error(t('chats.toast.exportFailed'))
    } finally {
      setBulkBusy(false)
    }
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
    } else if (isSmartFolderId(effectiveFolderId)) {
      const ids = new Set(smartIds[effectiveFolderId] ?? [])
      active = active.filter((c) => ids.has(c.id))
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
  }, [chats, query, effectiveFolderId, folders, favSet, unreadStats, smartIds])

  const { active: activeChats, archived: archivedChats } = filtered
  const totalUnread = unreadStats.total
  const activeFolderName =
    folders.find((f) => f.id === effectiveFolderId)?.name ??
    SMART_FOLDERS.find((f) => f.id === effectiveFolderId)?.name ??
    ''
  const pinnedCount = activeChats.filter((c) => c.pinned).length
  const hasBothSections = pinnedCount > 0 && pinnedCount < activeChats.length

  // Flat display order for keyboard navigation: active chats, then archived
  // (only when the archived drawer is open)
  const displayList = useMemo(
    () => (archivedOpen ? [...activeChats, ...archivedChats] : activeChats),
    [activeChats, archivedChats, archivedOpen]
  )

  // Keyboard shortcuts: j/k or arrows navigate, Enter opens (or toggles the
  // selection in select mode), / focuses search, Esc exits select mode
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

      // B2: Escape exits select mode (after the dialog check above, so the
      // app's Esc cascade — dialogs first — is respected)
      if (e.key === 'Escape') {
        if (selectMode) {
          e.preventDefault()
          exitSelect()
        }
        return
      }
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
        if (selectMode) toggleSelectChat(displayList[cursor].id)
        else onSelect(displayList[cursor].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    displayList,
    cursor,
    pendingDelete,
    onSelect,
    selectMode,
    exitSelect,
    toggleSelectChat,
  ])

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
      selectMode={selectMode}
      selected={selectedIds.has(chat.id)}
      onSelect={onSelect}
      onTogglePin={onTogglePin}
      onToggleArchive={onToggleArchive}
      onToggleFav={handleToggleFav}
      onDelete={setPendingDelete}
      onToggleSelect={toggleSelectChat}
      onEnterSelect={enterSelect}
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
            {t('chats.title')}
          </h1>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="wa-iconbtn h-9 w-9 rounded-full bg-white/10 text-white hover:bg-white/20 dark:text-(--wa-text)"
              onClick={onOpenPalette}
              disabled={importing}
              title={t('chats.header.paletteTip')}
              aria-label={t('chats.header.paletteAria')}
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
                  title={t('chats.header.moreTip')}
                  aria-label={t('chats.header.moreAria')}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-(--wa-text-2)">
                  {t('chats.menu.explore')}
                </DropdownMenuLabel>
                {/* B2: enter chat multi-select */}
                <DropdownMenuItem
                  onClick={() => enterSelect()}
                  className="gap-2"
                  disabled={importing || chats.length === 0}
                >
                  <ListChecks className="h-4 w-4 text-(--wa-text-2)" />
                  {t('select.title')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={onOpenInsights}
                  className="gap-2"
                  disabled={importing}
                >
                  <BarChart3 className="h-4 w-4 text-(--wa-text-2)" />
                  {t('chats.menu.insights')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={onOpenMemories}
                  className="gap-2"
                  disabled={importing}
                >
                  <CalendarHeart className="h-4 w-4 text-(--wa-text-2)" />
                  {t('chats.menu.memories')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={onOpenMediaHub}
                  className="gap-2"
                  disabled={importing}
                >
                  <Images className="h-4 w-4 text-(--wa-text-2)" />
                  {t('chats.menu.mediaHub')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-(--wa-text-2)">
                  {t('chats.menu.try')}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={onDemo}
                  className="gap-2"
                  disabled={importing}
                >
                  <Sparkles className="h-4 w-4 text-(--wa-text-2)" />
                  {t('chats.menu.demo')}
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
              {t('chats.header.import')}
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
            placeholder={t('chats.search.placeholder')}
            className={cn(
              'h-9 rounded-lg border-none bg-(--wa-panel-2) pl-9 text-[14px] text-(--wa-text) dark:bg-(--wa-row-active) dark:text-(--wa-text) dark:placeholder:text-(--wa-text-2)',
              totalUnread > 0 && 'pr-9'
            )}
          />
          {/* Mark all as read — only while there is anything unread */}
          {totalUnread > 0 && (
            <button
              onClick={handleMarkAllRead}
              title={t('chats.search.markAllTip')}
              aria-label={t('chats.search.markAllAria')}
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
            aria-label={t('chats.folders.aria')}
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
              title={t('chats.folders.manage')}
              aria-label={t('chats.folders.manage')}
              onClick={() => setManagerOpen(true)}
              className="relative z-10 flex h-10 shrink-0 select-none items-center rounded-full px-3 text-white/75 transition-colors duration-[260ms] motion-reduce:transition-none hover:bg-white/10 hover:text-white dark:text-(--wa-text-2) dark:hover:bg-white/10 dark:hover:text-(--wa-text)"
            >
              <Settings2 className="h-4 w-4" />
              <span className="sr-only">{t('chats.folders.manage')}</span>
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
                {t('chats.empty.importTitle')}
              </p>
              <p className="mt-2 max-w-[260px] text-[13px] leading-relaxed text-(--wa-text-2)">
                {t('chats.empty.importBodyPre')} <b>.zip</b>{' '}
                {t('chats.empty.importBodyMid')} <b>.txt</b>{' '}
                {t('chats.empty.importBodyPost')}
              </p>
              <Button
                className="mt-5 gap-2 rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
                onClick={onDemo}
                disabled={importing}
              >
                <Sparkles className="h-4 w-4" />
                {t('chats.empty.tryDemo')}
              </Button>
            </div>
            <p className="mt-6 text-[12px] leading-relaxed text-(--wa-text-2)">
              {t('chats.empty.exportHint')}
            </p>
          </div>
        ) : query.trim() && activeChats.length === 0 && archivedChats.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8 py-10 text-center">
            <p className="text-[13.5px] text-(--wa-text-2)">
              {t('chats.search.noMatch', { query })}
            </p>
            <Button
              variant="secondary"
              className="gap-2 rounded-full bg-(--wa-accent)/10 text-[13px] font-medium text-(--wa-accent-strong) hover:bg-(--wa-accent)/20 dark:bg-(--wa-accent)/15 dark:text-(--wa-accent)"
              onClick={() => onOpenGlobalSearch(query.trim())}
            >
              <TextSearch className="h-4 w-4" />
              {t('chats.search.messagesInstead')}
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
                  title={t('chats.search.searchMessagesFor', {
                    query: query.trim(),
                  })}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--wa-accent)/10 text-(--wa-accent-strong) transition-colors group-hover:bg-(--wa-accent) group-hover:text-white dark:bg-(--wa-accent)/20 dark:text-(--wa-accent) dark:group-hover:text-white">
                    <TextSearch className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-medium text-(--wa-text)">
                      {t('chats.search.searchMessagesFor', {
                        query: query.trim(),
                      })}
                    </span>
                    <span className="block truncate text-[12.5px] text-(--wa-text-2)">
                      {t('chats.search.findInAll')}
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
                            {showPinnedDivider
                              ? t('chats.divider.pinned')
                              : t('chats.divider.allChats')}
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

      {/* B2: bulk-selection toolbar — an in-flow flex child at the bottom of
          the sidebar (never covers list content or the app footer). All
          controls are ≥44px with aria-labels. */}
      {selectMode && (
        <div
          role="toolbar"
          aria-label={t('chats.bulk.aria.toolbar')}
          className="border-t border-black/10 bg-(--wa-panel-2) px-2 pt-1 dark:border-white/5 dark:bg-(--wa-panel-2)"
          style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}
        >
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-11 w-11 shrink-0"
              onClick={exitSelect}
              disabled={bulkBusy}
              aria-label={t('chats.bulk.aria.close')}
              title={t('chats.bulk.title.close')}
            >
              <X className="h-5 w-5 text-(--wa-text-2)" />
            </Button>
            <span
              className="min-w-0 flex-1 truncate px-1 text-[13.5px] font-medium text-(--wa-text)"
              aria-live="polite"
            >
              {t('select.toolbar.selected', { count: selectedChats.length })}
            </span>
            <Button
              variant="ghost"
              className="h-11 shrink-0 gap-1.5 rounded-full px-3 text-[13px] font-medium text-(--wa-text)"
              onClick={() =>
                setSelectedIds(
                  new Set(
                    displayList
                      .filter((c) => c.id !== SAVED_CHAT_ID)
                      .map((c) => c.id)
                  )
                )
              }
              disabled={bulkBusy || displayList.length === 0}
              title={t('chats.bulk.selectAllTip')}
              aria-label={t('chats.bulk.selectAllTip')}
            >
              <ListChecks className="h-4 w-4 text-(--wa-text-2)" />
              {t('chats.bulk.selectAll')}
            </Button>
            <Button
              variant="ghost"
              className="h-11 shrink-0 gap-1.5 rounded-full px-3 text-[13px] font-medium text-(--wa-text)"
              onClick={() => setSelectedIds(new Set())}
              disabled={bulkBusy || selectedChats.length === 0}
              title={t('chats.bulk.clearTip')}
              aria-label={t('chats.bulk.clearTip')}
            >
              <X className="h-4 w-4 text-(--wa-text-2)" />
              {t('select.action.clear')}
            </Button>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-11 w-11 shrink-0"
              onClick={handleBulkFav}
              disabled={bulkBusy || favTargets.length === 0}
              aria-label={
                allFav
                  ? t('chats.bulk.aria.unfavAll')
                  : t('chats.bulk.aria.favAll')
              }
              title={allFav ? t('chats.bulk.title.unfav') : t('chats.bulk.title.fav')}
            >
              {allFav ? (
                <StarOff className="h-5 w-5 text-[#f2a33c]" />
              ) : (
                <Star className="h-5 w-5 text-[#f2a33c]" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-11 w-11 shrink-0"
              onClick={handleBulkPin}
              disabled={bulkBusy || pinnable.length === 0}
              aria-label={
                allPinned
                  ? t('chats.bulk.aria.unpinAll')
                  : t('chats.bulk.aria.pinAll')
              }
              title={allPinned ? t('chats.bulk.title.unpin') : t('chats.bulk.title.pin')}
            >
              {allPinned ? (
                <PinOff className="h-5 w-5 text-(--wa-accent)" />
              ) : (
                <Pin className="h-5 w-5 text-(--wa-accent)" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-11 w-11 shrink-0"
              onClick={() => setMoveOpen(true)}
              disabled={bulkBusy || movable.length === 0}
              aria-label={t('chats.bulk.aria.move')}
              title={t('select.action.moveFolder')}
            >
              <FolderInput className="h-5 w-5 text-(--wa-text-2)" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-11 w-11 shrink-0"
              onClick={handleBulkExport}
              disabled={bulkBusy || selectedChats.length === 0}
              aria-label={t('chats.bulk.aria.export')}
              title={t('chats.bulk.title.export')}
            >
              {bulkBusy ? (
                <Loader2 className="h-5 w-5 animate-spin text-(--wa-text-2)" />
              ) : (
                <FileDown className="h-5 w-5 text-(--wa-text-2)" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-11 w-11 shrink-0 hover:bg-rose-500/10"
              onClick={() => setBulkDeleteOpen(true)}
              disabled={bulkBusy || deletable.length === 0}
              aria-label={t('chats.bulk.aria.delete')}
              title={t('common.delete')}
            >
              <Trash2 className="h-5 w-5 text-rose-500" />
            </Button>
          </div>
        </div>
      )}

      {/* Drag overlay */}
      {dragOver && chats.length > 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-(--wa-accent)/10 backdrop-blur-[1px]">
          <div className="rounded-2xl border-2 border-dashed border-(--wa-accent) bg-white/95 px-8 py-6 text-center dark:bg-(--wa-panel)/95">
            <Upload className="mx-auto mb-2 h-8 w-8 text-(--wa-accent)" />
            <p className="text-[14px] font-medium text-(--wa-text)">
              {t('chats.drop.title')}
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
            <AlertDialogTitle>{t('chats.delete.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('chats.delete.body', { name: pendingDelete?.title ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id)
                setPendingDelete(null)
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* B2: move-to-folder picker — reads the same folder store as the
          FolderManagerDialog (read-only use here; the bulk op writes via
          chat-folders.setFolders). */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('select.action.moveFolder')}</DialogTitle>
            <DialogDescription>
              {movable.length === 1
                ? t('chats.move.pickOne')
                : t('chats.move.pickMany', { count: movable.length })}
            </DialogDescription>
          </DialogHeader>
          {folders.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <p className="text-[13.5px] text-(--wa-text-2)">
                {t('chats.move.noFolders')}
              </p>
              <Button
                variant="secondary"
                className="gap-2 rounded-full bg-(--wa-accent)/10 text-[13px] font-medium text-(--wa-accent-strong) hover:bg-(--wa-accent)/20 dark:bg-(--wa-accent)/15 dark:text-(--wa-accent)"
                onClick={() => {
                  setMoveOpen(false)
                  setManagerOpen(true)
                }}
              >
                <Settings2 className="h-4 w-4" />
                {t('chats.move.create')}
              </Button>
            </div>
          ) : (
            <div className="wa-scroll max-h-72 space-y-0.5 overflow-y-auto">
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => handleBulkMove(f)}
                  disabled={bulkBusy}
                  className="flex h-11 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors hover:bg-(--wa-row-hover)"
                >
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/5 text-[15px] dark:bg-white/10"
                  >
                    {f.emoji}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] text-(--wa-text)">
                    {f.name}
                  </span>
                  <span className="shrink-0 text-[12px] tabular-nums text-(--wa-text-2)">
                    {f.chatIds.length}
                  </span>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* B2: bulk delete confirmation */}
      <AlertDialog
        open={bulkDeleteOpen}
        onOpenChange={(v) => !v && setBulkDeleteOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deletable.length === 1
                ? t('chats.bulkDelete.titleOne')
                : t('chats.bulkDelete.titleMany', { count: deletable.length })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('chats.bulkDelete.body')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={handleBulkDelete}
            >
              {t('common.delete')}
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
