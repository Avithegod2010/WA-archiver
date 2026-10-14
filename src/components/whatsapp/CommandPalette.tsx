'use client'

/**
 * CommandPalette — Ctrl/⌘+K quick launcher (backlog #17).
 *
 * A single fuzzy-searchable surface that:
 *   • jumps to any chat (avatar + last-message preview)
 *   • runs every global action (search, media hub, insights, memories,
 *     import, demo chats, settings, theme, shortcuts, guide)
 *   • remembers the last 5 actions you ran (localStorage) and offers
 *     them as "Recent" the next time you open the palette
 *
 * Built on the shadcn cmdk `CommandDialog`; keyboard-first (↑↓/Enter/Esc)
 * and fully usable on mobile via the header button that opens it.
 */

import { useCallback, useMemo } from 'react'
import { MessageSquare } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Avatar } from './Avatar'
import type { ChatSummary } from './types'

const RECENTS_KEY = 'wa-viewer:cmd-recents'
const RECENTS_MAX = 5

export interface PaletteAction {
  id: string
  label: string
  icon: React.ReactNode
  keywords?: string
  run: () => void
}

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function pushRecent(id: string): void {
  const next = [id, ...readRecents().filter((x) => x !== id)].slice(0, RECENTS_MAX)
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch {
    /* storage unavailable — recents are best-effort */
  }
}

/** Format a chat's last activity like the chat list does. */
function chatMeta(c: ChatSummary): string {
  const parts: string[] = []
  if (c.lastSender) parts.push(c.lastSender)
  if (c.lastPreview) parts.push(c.lastPreview)
  const preview = parts.join(': ').trim()
  return preview || `${c.messageCount.toLocaleString()} messages`
}

export function CommandPalette({
  open,
  onOpenChange,
  chats,
  actions,
  onOpenChat,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  chats: ChatSummary[]
  /** App-provided action registry (search, media hub, insights, theme, …). */
  actions: PaletteAction[]
  /** Jump to a chat (closes the palette, opens the conversation). */
  onOpenChat: (chatId: string) => void
}) {
  // Recents are read straight from localStorage when the palette opens —
  // no effect-setState needed (the dialog content only mounts while open).
  const recents = useMemo(() => (open ? readRecents() : []), [open])

  const runAction = useCallback(
    (action: PaletteAction) => {
      pushRecent(action.id)
      onOpenChange(false)
      // Defer so the dialog unmounts before the next overlay opens.
      setTimeout(() => action.run(), 30)
    },
    [onOpenChange]
  )

  const openChat = useCallback(
    (chatId: string) => {
      onOpenChange(false)
      // Defer so the dialog unmounts before the chat view mounts.
      setTimeout(() => onOpenChat(chatId), 30)
    },
    [onOpenChat, onOpenChange]
  )

  const byId = useMemo(() => new Map(actions.map((a) => [a.id, a])), [actions])

  const recentActions = useMemo(
    () => recents.map((id) => byId.get(id)).filter((a): a is PaletteAction => Boolean(a)),
    [recents, byId]
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search chats and run actions"
      className="top-[7%] max-w-[min(92vw,560px)] translate-y-0 sm:top-[12%]"
    >
      <CommandInput placeholder="Type a command or search chats…" />
      <CommandList className="max-h-[min(60vh,420px)]">
        <CommandEmpty>No matching chats or commands.</CommandEmpty>

        {recentActions.length > 0 && (
          <CommandGroup heading="Recent">
            {recentActions.map((a) => (
              <CommandItem
                key={`recent-${a.id}`}
                value={`recent ${a.label} ${a.keywords ?? ''}`}
                onSelect={() => runAction(a)}
              >
                {a.icon}
                <span>{a.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {chats.length > 0 && (
          <CommandGroup heading={`Chats · ${chats.length}`}>
            {chats.map((c) => (
              <CommandItem
                key={c.id}
                value={`chat ${c.title} ${chatMeta(c)} ${c.id}`}
                onSelect={() => openChat(c.id)}
              >
                <Avatar name={c.title} size={28} className="text-[11px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.title}</span>
                  <span className="block truncate text-[12px] text-(--wa-text-2)">
                    {chatMeta(c)}
                  </span>
                </span>
                <MessageSquare className="ml-auto h-3.5 w-3.5 opacity-40" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        <CommandGroup heading="Actions">
          {actions.map((a) => (
            <CommandItem
              key={a.id}
              value={`${a.label} ${a.keywords ?? ''}`}
              onSelect={() => runAction(a)}
            >
              {a.icon}
              <span>{a.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
