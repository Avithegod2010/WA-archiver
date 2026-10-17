'use client'

import { Bookmark, CornerDownLeft, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { BookmarkEntry } from '@/lib/bookmarks'

function formatStamp(iso: string): string {
  return new Date(iso).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Named message bookmarks for the open chat (#bookmarks). */
export function BookmarksDialog({
  open,
  onOpenChange,
  bookmarks,
  onJump,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bookmarks: BookmarkEntry[]
  onJump: (entry: BookmarkEntry) => void
  onDelete: (entry: BookmarkEntry) => void
}) {
  const sorted = [...bookmarks].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl p-0">
        <DialogHeader className="px-5 pb-1 pt-5">
          <DialogTitle className="flex items-center gap-2 text-[17px]">
            <Bookmark className="h-4.5 w-4.5 text-(--wa-accent)" />
            Bookmarks
            {sorted.length > 0 && (
              <span className="rounded-full bg-(--wa-accent)/10 px-2 py-0.5 text-[11px] font-bold text-(--wa-accent)">
                {sorted.length}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            Named shortcuts to messages worth revisiting. Click one to jump
            straight back.
          </DialogDescription>
        </DialogHeader>

        {sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 pb-8 pt-2 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-(--wa-accent)/10">
              <Bookmark className="h-6 w-6 text-(--wa-accent)" />
            </div>
            <p className="text-[14px] font-medium text-(--wa-text)">
              No bookmarks yet
            </p>
            <p className="max-w-[280px] text-[12.5px] leading-snug text-(--wa-text-2)">
              Right-click (or long-press) any message and choose{' '}
              <span className="font-medium text-(--wa-text)">
                Bookmark message
              </span>{' '}
              to pin a named shortcut here.
            </p>
          </div>
        ) : (
          <ul className="max-h-[55vh] space-y-1.5 overflow-y-auto px-4 pb-4">
            {sorted.map((b) => (
              <li key={b.id}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`Jump to bookmark: ${b.label}`}
                  onClick={() => onJump(b)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onJump(b)
                    }
                  }}
                  className="group flex cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-(--wa-row-active) focus-visible:bg-(--wa-row-active) focus-visible:outline-none"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--wa-accent)/10">
                    <Bookmark className="h-4 w-4 text-(--wa-accent)" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-(--wa-text)">
                      {b.label}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block break-words text-[12px] leading-snug text-(--wa-text-2)">
                      {b.excerpt}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] text-(--wa-text-2)">
                      {formatStamp(b.ts)}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-center gap-1 self-center">
                    <CornerDownLeft
                      className="h-3.5 w-3.5 text-(--wa-text-2) opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      aria-hidden
                    />
                    <button
                      type="button"
                      aria-label={`Delete bookmark: ${b.label}`}
                      title="Delete bookmark"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(b)
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-full text-(--wa-text-2) transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
