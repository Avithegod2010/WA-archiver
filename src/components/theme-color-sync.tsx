'use client'

/**
 * Keeps the browser chrome (Android status bar, desktop PWA titlebar) in
 * lockstep with the active app theme, dark mode and accent override — the
 * same --wa-appbar the header paints, resolved after CSS applies.
 *
 * Listens to: theme changes, accent overrides, dark-mode flips and system
 * scheme changes when in Auto mode.
 */

import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import { subscribeAccent, subscribeAppTheme } from './whatsapp/app-theme'

function syncThemeColor(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--wa-appbar')
    .trim()
  if (!value) return ''
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  meta.content = value
  return value
}

export function ThemeColorSync() {
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    // rAF: wait one frame so freshly-applied data-wa-theme / .dark classes
    // are reflected in computed styles before we read --wa-appbar.
    const sync = () => requestAnimationFrame(syncThemeColor)
    sync()
    const t1 = subscribeAppTheme(sync)
    const t2 = subscribeAccent(sync)
    // Auto mode: scheme flips don't change next-themes state we can subscribe
    // to directly — poll once on the media query.
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onScheme = () => sync()
    mq.addEventListener('change', onScheme)
    return () => {
      t1()
      t2()
      mq.removeEventListener('change', onScheme)
    }
  }, [resolvedTheme])

  return null
}
