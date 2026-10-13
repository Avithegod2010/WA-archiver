'use client'

import { useEffect, useRef } from 'react'

export interface ShortcutHandlers {
  onOpenSearch: () => void
  onOpenInsights: () => void
  onOpenGuide: () => void
  onToggleDark: () => void
  onNextChat: () => void
  onPrevChat: () => void
  onShowShortcuts: () => void
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function isDialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
}

/**
 * Global keyboard shortcuts (Task 7-e #7).
 * - Skips plain-key shortcuts while typing in inputs or when any dialog is open.
 * - Ignores meta/ctrl/alt combos except Ctrl/Cmd+K. Ignores auto-repeats.
 */
export function useShortcuts(handlers: ShortcutHandlers) {
  const handlersRef = useRef(handlers)

  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return

      const mod = e.metaKey || e.ctrlKey
      if (mod) {
        // Only Ctrl/Cmd+K passes through — and never while a dialog is open
        if (e.key.toLowerCase() === 'k' && !e.altKey && !e.shiftKey) {
          if (isDialogOpen()) return
          e.preventDefault()
          handlersRef.current.onOpenSearch()
        }
        return
      }
      if (e.altKey) return

      if (isTypingTarget(e.target)) return
      if (isDialogOpen()) return

      switch (e.key) {
        case '?':
          e.preventDefault()
          handlersRef.current.onShowShortcuts()
          break
        case 'n':
        case 'N':
          e.preventDefault()
          handlersRef.current.onNextChat()
          break
        case 'p':
        case 'P':
          e.preventDefault()
          handlersRef.current.onPrevChat()
          break
        case 'd':
        case 'D':
          e.preventDefault()
          handlersRef.current.onToggleDark()
          break
        case 'i':
        case 'I':
          e.preventDefault()
          handlersRef.current.onOpenInsights()
          break
        case 'g':
        case 'G':
          e.preventDefault()
          handlersRef.current.onOpenGuide()
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
