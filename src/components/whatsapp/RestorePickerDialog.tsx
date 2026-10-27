'use client'

/**
 * v1.9.2 — Selective-restore picker dialog.
 *
 * Shown after a cloud backup (live file or snapshot) has been pulled and
 * decrypted: lists the chats CONTAINED IN THAT BACKUP (title + message
 * count) with checkboxes (all pre-checked), a search filter and
 * select-all/none. Confirming hands the selected chat ids back to the
 * caller, which filters the backup JSON down to those chats and runs the
 * normal restoreJson() pipeline (existing chats merge by id).
 *
 * NOTE: `restsel.*` strings ship via agent-ctx/keys-2a.json and are merged
 * into src/lib/locales/* by the locale agent; t() falls back to the key
 * until then.
 */

import { useMemo, useState } from 'react'
import { ListChecks, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useT, type TParams } from '@/lib/i18n'
import type { TranslationKey } from '@/lib/locales/en'

/** Minimal per-chat metadata extracted from the decrypted backup JSON. */
export interface BackupChatMeta {
  id: string
  title: string
  messageCount: number
}

/** restsel.* keys are pending in locales — translate through a string cast. */
function useTsel() {
  const t = useT()
  return (key: string, params?: TParams) => t(key as TranslationKey, params)
}

/**
 * Parse the chat list out of a decrypted backup JSON
 * (`{version, chats:[{id, title, messages:[…]}]}`). Returns null when the
 * payload is unreadable / has no chats array.
 */
export function parseBackupChats(json: string): BackupChatMeta[] | null {
  try {
    const parsed = JSON.parse(json) as { chats?: unknown }
    if (!Array.isArray(parsed.chats)) return null
    const out: BackupChatMeta[] = []
    for (const c of parsed.chats) {
      if (!c || typeof c !== 'object') continue
      const id = (c as { id?: unknown }).id
      if (typeof id !== 'string' || id.length === 0) continue
      const raw = c as { title?: unknown; messages?: unknown[] }
      out.push({
        id,
        title: typeof raw.title === 'string' && raw.title ? raw.title : id,
        messageCount: Array.isArray(raw.messages) ? raw.messages.length : 0,
      })
    }
    return out
  } catch {
    return null
  }
}

/**
 * Filter a backup JSON down to the chosen chat ids (same shape/semantics as
 * cloud-sync's filterBackupJson — other top-level fields are preserved).
 */
export function filterBackupJsonByIds(json: string, ids: string[]): string {
  const wanted = new Set(ids)
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>
    if (!Array.isArray(parsed.chats)) return json
    parsed.chats = parsed.chats.filter((c) => {
      if (!c || typeof c !== 'object') return false
      const id = (c as { id?: unknown }).id
      return typeof id === 'string' && wanted.has(id)
    })
    return JSON.stringify(parsed)
  } catch {
    return json
  }
}

export function RestorePickerDialog({
  open,
  onOpenChange,
  chats,
  source,
  busy = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  chats: BackupChatMeta[]
  /** Where the backup came from — fills {name} in the subtitle. */
  source: string
  /** True while the parent is running the restore after confirm. */
  busy?: boolean
  onConfirm: (ids: string[]) => void
}) {
  const t = useTsel()
  const [query, setQuery] = useState('')
  /** null = everything selected (default for each newly presented backup). */
  const [selected, setSelected] = useState<Set<string> | null>(null)

  const close = (v: boolean) => {
    if (!v) setQuery('')
    onOpenChange(v)
  }

  const allIds = useMemo(() => new Set(chats.map((c) => c.id)), [chats])
  const effective = selected ?? allIds

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return chats
    return chats.filter(
      (c) =>
        c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
    )
  }, [chats, query])

  const selCount = effective.size
  const selMessages = useMemo(
    () =>
      chats.reduce(
        (sum, c) => (effective.has(c.id) ? sum + c.messageCount : sum),
        0
      ),
    [chats, effective]
  )

  const toggle = (id: string) =>
    setSelected(() => {
      const next = new Set(effective)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectAll = () => setSelected(new Set(shown.map((c) => c.id)))
  const selectNone = () => setSelected(new Set())

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && close(v)}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto wa-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <ListChecks className="h-4 w-4 text-(--wa-accent)" aria-hidden />
            {t('restsel.title')}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {t('restsel.subtitle', { name: source })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {/* Search filter */}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--wa-text-2)"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('restsel.search')}
              className="h-8 pl-8 text-[12px]"
              aria-label={t('restsel.search')}
            />
          </div>

          {/* Select all / none */}
          <div className="flex items-center gap-3 text-[11.5px]">
            <button
              type="button"
              onClick={selectAll}
              disabled={shown.length === 0}
              className="font-medium text-(--wa-accent-strong) underline underline-offset-2 disabled:opacity-50 dark:text-(--wa-accent)"
            >
              {t('restsel.all')}
            </button>
            <button
              type="button"
              onClick={selectNone}
              disabled={selCount === 0}
              className="font-medium text-(--wa-text-2) underline underline-offset-2 disabled:opacity-50"
            >
              {t('restsel.none')}
            </button>
          </div>

          {/* Chat list */}
          <div className="wa-scroll max-h-64 overflow-y-auto rounded-md border border-black/[0.06] p-1.5 dark:border-white/10">
            {shown.length === 0 && (
              <p className="p-2 text-[11.5px] text-(--wa-text-2)">
                {t('restsel.noMatch', { query: query.trim() })}
              </p>
            )}
            {shown.map((c) => {
              const checked = effective.has(c.id)
              return (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[12px] hover:bg-black/[0.03] dark:hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(c.id)}
                    className="h-3.5 w-3.5 accent-(--wa-accent)"
                    aria-label={c.title}
                  />
                  <span className="min-w-0 flex-1 truncate text-(--wa-text)">
                    {c.title}
                  </span>
                  <span className="text-[10.5px] text-(--wa-text-2)">
                    {t('restsel.msgCount', {
                      count: c.messageCount.toLocaleString(),
                    })}
                  </span>
                </label>
              )
            })}
          </div>

          {/* Count summary */}
          <p className="text-[10.5px] leading-snug text-(--wa-text-2)">
            {t('restsel.summary', {
              sel: selCount,
              total: chats.length,
              msgs: selMessages.toLocaleString(),
            })}
          </p>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => close(false)}
              disabled={busy}
            >
              {t('restsel.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => onConfirm([...effective])}
              disabled={busy || selCount === 0}
              className="gap-1.5"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
              {selCount === 1
                ? t('restsel.confirmOne')
                : t('restsel.confirm', { count: selCount })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default RestorePickerDialog
