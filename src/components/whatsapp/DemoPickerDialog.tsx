'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DEMO_CATALOG, type DemoChatMeta } from '@/lib/demo-catalog'
import { buildDemoScript, v2Key } from '@/lib/demo-scripts'
import { parseWhatsAppText } from '@/lib/whatsapp-parser'
import { cn } from '@/lib/utils'
import { useData } from './data-provider'

/**
 * Lets the user pick which demo chats to load — WhatsApp-style selectable
 * cards with a live selection counter and spring animations.
 *
 * Transport-aware (Phase 2): on the server transport it POSTs /api/demo as
 * before; on the device transport the same transcript is built locally
 * (buildDemoScript) and inserted straight into the on-device database via
 * data.importParsed — nothing leaves the device.
 */
export function DemoPickerDialog({
  open,
  onOpenChange,
  onLoaded,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  /** Called with the chats that were just created (empty when skipped). */
  onLoaded: (created: { id: string; title: string }[]) => void
}) {
  const { mode, data } = useData()
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(DEMO_CATALOG.map((d) => d.id))
  )
  const [busy, setBusy] = useState(false)

  const allSelected = selected.size === DEMO_CATALOG.length
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const load = useMemo(
    () =>
      async function load(ids: string[]) {
        if (ids.length === 0 || busy) return
        setBusy(true)
        const toastId = toast.loading('Creating demo chats...')
        try {
          if (mode === 'device') {
            // On-device seeding: mirror the server route's duplicate guard
            // (a chat with the same demo sourceFile is silently skipped).
            const chats = await data.listChats()
            const existing = new Set(chats.map((c) => c.sourceFile))
            const created: { id: string; title: string }[] = []
            for (const id of ids) {
              const meta = DEMO_CATALOG.find((d) => d.id === id)
              if (!meta) continue
              if (existing.has(v2Key(id))) continue
              const text = buildDemoScript(id)
              if (text == null) {
                throw new Error(`Unknown demo chat "${id}"`)
              }
              const parsed = parseWhatsAppText(text)
              const { chatId } = await data.importParsed({
                title: meta.title,
                sourceFile: v2Key(id),
                isGroup: meta.isGroup,
                messages: parsed.messages.map((m) => ({
                  ts: m.ts,
                  sender: m.sender,
                  body: m.body,
                  type: m.type,
                  mediaName: m.mediaName ?? null,
                  pollOptions: m.pollOptions ?? null,
                })),
              })
              created.push({ id: chatId, title: meta.title })
            }
            toast.success(
              created.length === 0
                ? 'Already loaded — refreshed your list'
                : created.length === 1
                  ? `Demo chat ready: ${created[0].title}`
                  : `${created.length} demo chats ready`,
              { id: toastId }
            )
            onOpenChange(false)
            onLoaded(created)
            return
          }
          const res = await fetch('/api/demo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
          })
          const payload = await res.json()
          if (!res.ok) throw new Error(payload.error ?? 'Failed')
          toast.success(
            payload.skipped
              ? 'Already loaded — refreshed your list'
              : payload.created.length === 1
                ? `Demo chat ready: ${payload.created[0]}`
                : `${payload.created.length} demo chats ready`,
            { id: toastId }
          )
          onOpenChange(false)
          const created = (payload.skipped
            ? []
            : ((payload.createdIds ?? []) as string[]).map(
                (id: string, i: number) => ({ id, title: payload.created[i] })
              )) as { id: string; title: string }[]
          onLoaded(created)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Failed', {
            id: toastId,
          })
        } finally {
          setBusy(false)
        }
      },
    [busy, onLoaded, onOpenChange, mode, data]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4.5 w-4.5 text-(--wa-accent)" />
            Pick your demo chats
          </DialogTitle>
          <DialogDescription>
            Choose which conversations to load — each one shows off different
            features. You can always load more later.
          </DialogDescription>
        </DialogHeader>

        <div className="wa-scroll -mx-1 max-h-[52vh] space-y-2 overflow-y-auto px-1 py-0.5">
          {DEMO_CATALOG.map((d: DemoChatMeta, i) => {
            const active = selected.has(d.id)
            return (
              <motion.button
                key={d.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.045, duration: 0.25 }}
                type="button"
                onClick={() => toggle(d.id)}
                aria-pressed={active}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                  active
                    ? 'border-(--wa-accent) bg-(--wa-accent)/[0.07]'
                    : 'border-black/10 hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.04]'
                )}
              >
                <span
                  className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl',
                    active ? 'bg-(--wa-accent)/15' : 'bg-black/5 dark:bg-white/10'
                  )}
                  aria-hidden
                >
                  {d.emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[14.5px] font-semibold text-(--wa-text)">
                      {d.title}
                    </span>
                    {d.isGroup && (
                      <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-(--wa-text-2) dark:bg-white/10">
                        Group
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-(--wa-text-2)">
                    {d.description}
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-[11px] text-(--wa-text-2)">
                    <span className="truncate">
                      {d.members.join(' · ')}
                    </span>
                    <span className="shrink-0 opacity-70">{d.size}</span>
                  </span>
                </span>
                <span
                  className={cn(
                    'mt-0.5 flex h-5.5 w-5.5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                    active
                      ? 'border-(--wa-accent) bg-(--wa-accent)'
                      : 'border-(--wa-text-2)'
                  )}
                  aria-hidden
                >
                  {active && <Check className="h-3 w-3 text-white" />}
                </span>
              </motion.button>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full text-[12.5px] text-(--wa-text-2)"
            onClick={() =>
              setSelected(
                allSelected ? new Set() : new Set(DEMO_CATALOG.map((d) => d.id))
              )
            }
            disabled={busy}
          >
            {allSelected ? 'Clear all' : 'Select all'}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full bg-(--wa-accent)/10 text-[12.5px] font-medium text-(--wa-accent-strong) hover:bg-(--wa-accent)/20 dark:text-(--wa-accent)"
              onClick={() => load(DEMO_CATALOG.map((d) => d.id))}
              disabled={busy}
            >
              Load all
            </Button>
            <Button
              className="gap-2 rounded-full bg-(--wa-accent) text-white hover:bg-(--wa-accent-strong)"
              onClick={() => load([...selected])}
              disabled={busy || selected.size === 0}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Load {selected.size} chat{selected.size === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
