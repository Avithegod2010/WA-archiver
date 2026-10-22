'use client'

import { Keyboard } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface ShortcutRow {
  keys: string[]
  label: string
}

interface ShortcutGroup {
  title: string
  rows: ShortcutRow[]
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'General',
    rows: [
      { keys: ['?'], label: 'Show keyboard shortcuts' },
      { keys: ['d'], label: 'Toggle dark / light mode' },
      { keys: ['i'], label: 'Insights dashboard' },
      { keys: ['m'], label: 'Media hub — photos, videos & docs' },
      { keys: ['g'], label: 'Open the guide' },
    ],
  },
  {
    title: 'Chats & search',
    rows: [
      { keys: ['Ctrl / ⌘', 'K'], label: 'Command palette — jump to chats & run actions' },
      { keys: ['/'], label: 'Focus chat search' },
      { keys: ['Ctrl / ⌘', '⇧', 'F'], label: 'Search across all chats' },
      { keys: ['j / k'], label: 'Move up / down the chat list' },
      { keys: ['↑ / ↓'], label: 'Move up / down the chat list' },
      { keys: ['Enter'], label: 'Open selected chat' },
      { keys: ['n / p'], label: 'Jump to next / previous chat' },
      { keys: ['Esc'], label: 'Close dialog / back to chats' },
    ],
  },
]

function Kbd({ children, wide }: { children: string; wide?: boolean }) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center rounded border border-black/15 bg-black/5 px-1.5 py-0.5 font-mono text-[12px] font-medium leading-none text-(--wa-text) shadow-sm dark:border-white/15 dark:bg-white/10',
        wide ? 'min-w-[3.25rem]' : 'min-w-[1.6rem]'
      )}
    >
      {children}
    </kbd>
  )
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="wa-scroll max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-left">
            <Keyboard className="h-4.5 w-4.5 text-(--wa-accent)" aria-hidden />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription className="text-left">
            Work anywhere in the app — except while typing in a field or when a
            dialog is open.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {GROUPS.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-(--wa-text-2) uppercase">
                {group.title}
              </h3>
              <ul className="flex flex-col gap-2">
                {group.rows.map((row) => (
                  <li
                    key={row.label + row.keys.join()}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="min-w-0 text-[13px] text-(--wa-text)">
                      {row.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((k, idx) => (
                        <Kbd key={k + idx} wide={k.length > 2}>
                          {k}
                        </Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <p className="text-[11.5px] leading-snug text-(--wa-text-2)">
          Tip: press <Kbd>?</Kbd> anytime to reopen this list.
        </p>
      </DialogContent>
    </Dialog>
  )
}
