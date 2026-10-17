/**
 * Chat display preferences — bubble corner style, bubble density and clock
 * format, all persisted per device. Mirrors text-size.ts / font-family.ts:
 * the display popover (Aa button) is the writer; ChatView / MessageBubble /
 * the app shell consume the values as CSS variables on the root wrapper.
 *
 * Storage keys:
 *   wa-viewer:bubblestyle → 'classic' | 'round' | 'sharp'
 *   wa-viewer:density     → 'cozy' | 'compact'
 *   wa-viewer:timeformat  → 'auto' | 'h12' | 'h24'
 *
 * CSS variables the app shell sets from these prefs (defaults match classic
 * + cozy so older stored states degrade gracefully):
 *   --wa-bubble-r    bubble corner radius (tails still square that corner)
 *   --wa-bubble-py   bubble vertical padding
 *   --wa-gap         top margin between consecutive bubbles
 *   --wa-gap-tail    top margin when a bubble starts a new run (has a tail)
 */

import type { CSSProperties } from 'react'

export const BUBBLE_STYLES = {
  classic: { label: 'Classic', hint: 'WhatsApp look', radius: '7.5px' },
  round: { label: 'Round', hint: 'Extra rounded', radius: '14px' },
  sharp: { label: 'Sharp', hint: 'Crisp edges', radius: '2.5px' },
} as const

export type BubbleStyleKey = keyof typeof BUBBLE_STYLES

export const DENSITIES = {
  cozy: { label: 'Cozy', hint: 'Breathing room', padY: '6px', gap: '2px', gapTail: '10px' },
  compact: { label: 'Compact', hint: 'More on screen', padY: '3.5px', gap: '1px', gapTail: '6px' },
} as const

export type DensityKey = keyof typeof DENSITIES

export const TIME_FORMATS = {
  auto: { label: 'Auto', hint: 'Follow device' },
  h12: { label: '12-hour', hint: '3:45 PM' },
  h24: { label: '24-hour', hint: '15:45' },
} as const

export type TimeFormatKey = keyof typeof TIME_FORMATS

const BUBBLE_STYLE_EVENT = 'wa-bubblestyle'
const DENSITY_EVENT = 'wa-density'
const TIME_FORMAT_EVENT = 'wa-timeformat'
const BUBBLE_STYLE_KEY = 'wa-viewer:bubblestyle'
const DENSITY_STORAGE_KEY = 'wa-viewer:density'
const TIME_FORMAT_KEY = 'wa-viewer:timeformat'

function readKey<T extends string>(storageKey: string, event: string, valid: readonly string[], fallback: T): T {
  try {
    const v = localStorage.getItem(storageKey)
    if (v && valid.includes(v)) return v as T
  } catch {
    /* storage unavailable */
  }
  return fallback
}

function writeKey(storageKey: string, event: string, value: string) {
  try {
    localStorage.setItem(storageKey, value)
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(event))
}

function subscribe(event: string) {
  return (cb: () => void) => {
    window.addEventListener(event, cb)
    window.addEventListener('storage', cb)
    return () => {
      window.removeEventListener(event, cb)
      window.removeEventListener('storage', cb)
    }
  }
}

/* ---------- Bubble corner style ---------- */

export const getBubbleStyle = () =>
  readKey<BubbleStyleKey>(BUBBLE_STYLE_KEY, BUBBLE_STYLE_EVENT, Object.keys(BUBBLE_STYLES), 'classic')

export function setBubbleStyle(k: BubbleStyleKey) {
  writeKey(BUBBLE_STYLE_KEY, BUBBLE_STYLE_EVENT, k)
}

export const subscribeBubbleStyle = subscribe(BUBBLE_STYLE_EVENT)

/* ---------- Bubble density ---------- */

export const getDensity = () =>
  readKey<DensityKey>(DENSITY_STORAGE_KEY, DENSITY_EVENT, Object.keys(DENSITIES), 'cozy')

export function setDensity(k: DensityKey) {
  writeKey(DENSITY_STORAGE_KEY, DENSITY_EVENT, k)
}

export const subscribeDensity = subscribe(DENSITY_EVENT)

/* ---------- Clock format ---------- */

export const getTimeFormat = () =>
  readKey<TimeFormatKey>(TIME_FORMAT_KEY, TIME_FORMAT_EVENT, Object.keys(TIME_FORMATS), 'auto')

export function setTimeFormat(k: TimeFormatKey) {
  writeKey(TIME_FORMAT_KEY, TIME_FORMAT_EVENT, k)
}

export const subscribeTimeFormat = subscribe(TIME_FORMAT_EVENT)

/**
 * Format a timestamp as HH:MM honoring the stored clock preference.
 * Shared by bubbles, lists, galleries and search so the whole app agrees.
 */
export function formatChatTime(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(date.getTime())) return '--:--'
  const pref = getTimeFormat()
  if (pref === 'h24')
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  if (pref === 'h12')
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** True when the live clock pref renders in 24-hour mode (e.g. axis labels). */
export function is24hClock(): boolean {
  const pref = getTimeFormat()
  if (pref === 'h24') return true
  if (pref === 'h12') return false
  try {
    return new Date().toLocaleTimeString().includes('AM') === false &&
      new Date().toLocaleTimeString().includes('PM') === false
  } catch {
    return true
  }
}

/** CSS variables for the app shell root, from the current bubble prefs. */
export function displayVars(style: BubbleStyleKey, density: DensityKey): CSSProperties {
  const b = BUBBLE_STYLES[style]
  const d = DENSITIES[density]
  return {
    '--wa-bubble-r': b.radius,
    '--wa-bubble-py': d.padY,
    '--wa-gap': d.gap,
    '--wa-gap-tail': d.gapTail,
  } as CSSProperties
}
