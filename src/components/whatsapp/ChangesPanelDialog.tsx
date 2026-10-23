'use client'

/**
 * Per-chat "Message changes" panel — the unsend + edit history log.
 *
 * Lists everything that was locally edited or unsent in this chat, newest
 * first (the tombstone rows keep the transcript honest; this panel keeps
 * the *when + what changed*). Data comes from the localStorage-backed
 * change log (src/lib/msg-changes.ts), written by ChatView on every edit /
 * unsend — so it works in BOTH transports.
 */

import { useMemo, useState } from 'react'
import { Eraser, MessageSquareX, Pencil, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  clearMsgChanges,
  getMsgChanges,
  type MsgChange,
} from '@/lib/msg-changes'
import { formatRelativeTime } from './backup-reminder'

export function ChangesPanelDialog({
  open,
  onOpenChange,
  chatId,
  chatTitle,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  chatId: string
  chatTitle: string
}) {
  const [tick, setTick] = useState(0)

  const changes = useMemo(() => {
    if (!open || !chatId) return []
    void tick
    return getMsgChanges(chatId)
  }, [open, chatId, tick])

  const editedCount = changes.filter((c) => c.kind === 'edited').length
  const unsentCount = changes.filter((c) => c.kind === 'unsent').length

  const clearAll = () => {
    clearMsgChanges(chatId)
    setTick((t) => t + 1)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            Message changes
            <span className="text-[12px] font-normal text-(--wa-text-2)">
              · {chatTitle}
            </span>
          </DialogTitle>
          <DialogDescription>
            Local edits and unsends in this chat, newest first —{' '}
            {editedCount} edited · {unsentCount} unsent.
          </DialogDescription>
        </DialogHeader>

        {changes.length === 0 ? (
          <p className="rounded-md bg-black/[0.03] p-3 text-[12.5px] leading-snug text-(--wa-text-2) dark:bg-white/[0.05]">
            No changes recorded yet. Edit or unsend a message here and it will
            appear in this log with before / after content and a timestamp.
          </p>
        ) : (
          <>
            <ScrollArea className="max-h-96 overflow-y-auto pr-2">
              <ul className="flex flex-col gap-2">
                {changes.map((c: MsgChange) => (
                  <li
                    key={c.id}
                    className="flex flex-col gap-1 rounded-md border border-black/[0.06] p-2.5 dark:border-white/10"
                  >
                    <div className="flex items-center gap-1.5 text-[11.5px] font-medium">
                      {c.kind === 'edited' ? (
                        <>
                          <Pencil
                            className="h-3.5 w-3.5 text-(--wa-accent)"
                            aria-hidden
                          />
                          <span className="text-(--wa-accent-strong) dark:text-(--wa-accent)">
                            Edited
                          </span>
                        </>
                      ) : (
                        <>
                          <MessageSquareX
                            className="h-3.5 w-3.5 text-red-500"
                            aria-hidden
                          />
                          <span className="text-red-500">Unsent</span>
                        </>
                      )}
                      {c.sender && (
                        <span className="text-(--wa-text-2)">
                          · {c.sender}
                        </span>
                      )}
                      <span className="ml-auto font-normal text-(--wa-text-2)">
                        {formatRelativeTime(c.at)}
                      </span>
                    </div>
                    <p className="rounded bg-black/[0.03] px-2 py-1 text-[11.5px] leading-snug text-(--wa-text-2) line-through decoration-black/30 dark:bg-white/[0.05] dark:decoration-white/30">
                      {c.before || '(empty)'}
                    </p>
                    {c.kind === 'edited' && c.after !== null && (
                      <p className="rounded bg-(--wa-accent)/10 px-2 py-1 text-[11.5px] leading-snug text-(--wa-text)">
                        {c.after || '(empty)'}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </ScrollArea>
            <div className="flex items-center justify-between">
              <p className="text-[10.5px] text-(--wa-text-2)">
                Stored on this device only.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="gap-1.5 text-red-500 hover:text-red-500"
              >
                <Eraser className="h-3.5 w-3.5" aria-hidden />
                Clear log
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default ChangesPanelDialog
