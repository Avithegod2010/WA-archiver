'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Avatar, SavedAvatar } from './Avatar'
import { SAVED_CHAT_ID, type ChatSummary } from './types'
import { cn } from '@/lib/utils'
import { getFolders, setFolders, type ChatFolder } from './chat-folders'

const FOLDER_EMOJIS = [
  '📁',
  '💬',
  '😀',
  '🎉',
  '🔥',
  '⭐',
  '❤️',
  '🏠',
  '💼',
  '🎯',
  '🎮',
  '⚽',
  '🚀',
  '📚',
  '🎵',
  '🍕',
  '☕',
  '🌍',
  '🛠️',
  '🐱',
  '🌙',
  '🍀',
  '💎',
  '📷',
]

function genFolderId(): string {
  return `fld-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Create / rename / delete custom chat folders. Folders hold a hand-picked
 * list of chat ids; they render as extra tabs in the ChatList tab strip.
 */
export function FolderManagerDialog({
  open,
  onOpenChange,
  chats,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  chats: ChatSummary[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Body mounts fresh on every open — state seeds from the store via
            useState initializers, no effects needed. */}
        {open && <ManagerBody chats={chats} />}
      </DialogContent>
    </Dialog>
  )
}

function ManagerBody({ chats }: { chats: ChatSummary[] }) {
  // Folders only ever contain non-archived chats
  const pickable = useMemo(() => chats.filter((c) => !c.archived), [chats])
  const pickableIds = useMemo(
    () => new Set(pickable.map((c) => c.id)),
    [pickable]
  )

  const [folders, setLocalFolders] = useState<ChatFolder[]>(() => getFolders())
  // null = list view, 'new' = create, folder id = edit
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('📁')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const formOpen = editingId !== null

  const editing =
    editingId && editingId !== 'new'
      ? (folders.find((f) => f.id === editingId) ?? null)
      : null

  function startCreate() {
    setName('')
    setEmoji('📁')
    setPicked(new Set())
    setEditingId('new')
  }

  function startEdit(f: ChatFolder) {
    setName(f.name)
    setEmoji(f.emoji || '📁')
    setPicked(new Set(f.chatIds))
    setEditingId(f.id)
  }

  function backToList() {
    setEditingId(null)
  }

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const trimmedName = name.trim()
  const canSave =
    trimmedName.length > 0 && trimmedName.length <= 24 && picked.size > 0

  function save() {
    if (!canSave) {
      if (!trimmedName) toast.error('Give the folder a name first')
      else if (trimmedName.length > 24)
        toast.error('Folder names are limited to 24 characters')
      else toast.error('Pick at least one chat for this folder')
      return
    }
    // Drop ids that no longer exist / got archived meanwhile
    const chatIds = [...picked].filter((id) => pickableIds.has(id))
    if (chatIds.length === 0) {
      toast.error('Pick at least one chat for this folder')
      return
    }
    if (editingId === 'new') {
      const folder: ChatFolder = {
        id: genFolderId(),
        name: trimmedName,
        emoji: emoji || '📁',
        chatIds,
      }
      const next = [...folders, folder]
      setFolders(next)
      setLocalFolders(next)
      toast.success(`Folder "${trimmedName}" created`)
    } else if (editingId) {
      const next = folders.map((f) =>
        f.id === editingId
          ? { ...f, name: trimmedName, emoji: emoji || '📁', chatIds }
          : f
      )
      setFolders(next)
      setLocalFolders(next)
      toast.success(`Folder "${trimmedName}" updated`)
    }
    backToList()
  }

  function remove(f: ChatFolder) {
    const next = folders.filter((x) => x.id !== f.id)
    setFolders(next)
    setLocalFolders(next)
    toast.success(`Folder "${f.name}" deleted`)
  }

  return (
    <>
      {formOpen ? (
        <>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 rounded-full text-(--wa-text-2)"
                onClick={backToList}
                aria-label="Back to folders"
                title="Back to folders"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              {editing ? 'Edit folder' : 'New folder'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? `Update "${editing.name}" — rename it, change its icon or pick different chats.`
                : 'Group related chats into a folder — it appears as a tab above your chat list.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Name + current emoji */}
            <div className="flex items-center gap-2">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black/5 text-lg dark:bg-white/10"
                aria-hidden
              >
                {emoji}
              </span>
              <Input
                value={name}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    save()
                  }
                }}
                placeholder="Folder name (e.g. Work, Family)"
                aria-label="Folder name"
                autoFocus
                className="h-9 flex-1 border-black/10 bg-white text-[14px] text-(--wa-text) dark:border-white/10 dark:bg-(--wa-panel-2) dark:text-(--wa-text)"
              />
            </div>

            {/* Emoji picker */}
            <div>
              <p className="mb-1.5 text-[12px] font-medium text-(--wa-text-2)">
                Icon
              </p>
              <div
                role="radiogroup"
                aria-label="Folder icon"
                className="grid grid-cols-8 gap-1"
              >
                {FOLDER_EMOJIS.map((e) => {
                  const selected = e === emoji
                  return (
                    <button
                      key={e}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={`Icon ${e}`}
                      onClick={() => setEmoji(e)}
                      className={cn(
                        'flex h-9 items-center justify-center rounded-lg text-lg transition-colors',
                        selected
                          ? 'bg-(--wa-accent)/15 ring-1 ring-(--wa-accent)'
                          : 'hover:bg-black/5 dark:hover:bg-white/10'
                      )}
                    >
                      <span aria-hidden>{e}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Chat picker */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-[12px] font-medium text-(--wa-text-2)">
                  Chats in this folder
                </p>
                <span className="text-[12px] tabular-nums text-(--wa-text-2)">
                  {picked.size} selected
                </span>
              </div>
              <div className="wa-scroll max-h-64 overflow-y-auto rounded-xl border border-black/10 dark:border-white/10">
                {pickable.length === 0 ? (
                  <p className="p-4 text-center text-[13px] text-(--wa-text-2)">
                    No chats available to pick.
                  </p>
                ) : (
                  pickable.map((c) => {
                    const on = picked.has(c.id)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => togglePick(c.id)}
                        className={cn(
                          'flex w-full items-center gap-2.5 border-b border-black/5 px-3 py-2 text-left transition-colors last:border-b-0 dark:border-white/5',
                          on
                            ? 'bg-(--wa-accent)/[0.07]'
                            : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
                        )}
                      >
                        {c.id === SAVED_CHAT_ID ? (
                          <span className="shrink-0 rounded-full">
                            <SavedAvatar size={36} />
                          </span>
                        ) : (
                          <span className="shrink-0">
                            <Avatar name={c.title} size={36} />
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate text-[14px] text-(--wa-text)">
                          {c.title}
                        </span>
                        <span
                          aria-hidden
                          className={cn(
                            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                            on
                              ? 'border-(--wa-accent) bg-(--wa-accent)'
                              : 'border-(--wa-text-2)/50'
                          )}
                        >
                          {on && <Check className="h-3 w-3 text-white" />}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
              {picked.size === 0 && (
                <p className="mt-1.5 text-[12px] text-(--wa-text-2)">
                  Pick at least one chat to save this folder.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="rounded-full text-[13px] text-(--wa-text-2)"
              onClick={backToList}
            >
              Cancel
            </Button>
            <Button
              className="gap-2 rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
              onClick={save}
              disabled={!canSave}
            >
              <Check className="h-4 w-4" />
              {editing ? 'Save changes' : 'Create folder'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span aria-hidden className="text-base">
                📂
              </span>
              Chat folders
            </DialogTitle>
            <DialogDescription>
              Organize chats into their own tabs — All, Unread, Groups and
              Favorites are built in; create your own below.
            </DialogDescription>
          </DialogHeader>

          <div className="wa-scroll -mx-1 max-h-[50vh] space-y-2 overflow-y-auto px-1 py-0.5">
            {folders.length === 0 ? (
              <div className="rounded-xl border border-dashed border-black/15 p-6 text-center dark:border-white/15">
                <p className="text-[13.5px] font-medium text-(--wa-text)">
                  No custom folders yet
                </p>
                <p className="mt-1 text-[12.5px] text-(--wa-text-2)">
                  Create one to group chats the way you like.
                </p>
              </div>
            ) : (
              folders.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-3 rounded-xl border border-black/10 p-3 dark:border-white/10"
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/5 text-lg dark:bg-white/10"
                    aria-hidden
                  >
                    {f.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium text-(--wa-text)">
                      {f.name}
                    </span>
                    <span className="block text-[12px] text-(--wa-text-2)">
                      {f.chatIds.length} chat
                      {f.chatIds.length === 1 ? '' : 's'}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-(--wa-text-2) hover:text-(--wa-accent-strong)"
                    onClick={() => startEdit(f)}
                    aria-label={`Edit folder ${f.name}`}
                    title="Edit folder"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-(--wa-text-2) hover:text-rose-500"
                    onClick={() => remove(f)}
                    aria-label={`Delete folder ${f.name}`}
                    title="Delete folder"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="flex justify-end">
            <Button
              className="gap-2 rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
              onClick={startCreate}
            >
              <Plus className="h-4 w-4" />
              New folder
            </Button>
          </div>
        </>
      )}
    </>
  )
}
