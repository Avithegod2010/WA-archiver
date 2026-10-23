/**
 * i18n groundwork (C1 #14) — tiny, dependency-free translation layer.
 *
 * Design (mirrors app-theme.ts / display.ts conventions):
 *   • Two locales, `en` (source of truth) + `hi`, as flat string maps in
 *     src/lib/locales/*.ts with compile-time 1:1 key parity.
 *   • Persisted per device under `wa-viewer:locale` (same key style as
 *     every other viewer pref).
 *   • `setLocale` dispatches a `wa-locale-change` window event and keeps
 *     <html lang> in sync; `useLocale()` re-renders subscribers via
 *     useSyncExternalStore, so components never hold locale state.
 *   • `t(locale, key, params?)` does `{name}` interpolation and falls
 *     back en → the key itself, so a missing key can never crash.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { strings as enStrings, type TranslationKey } from './locales/en'
import { strings as hiStrings } from './locales/hi'
import { strings as urStrings } from './locales/ur'
import { strings as mrStrings } from './locales/mr'
import { strings as taStrings } from './locales/ta'

export type Locale = 'en' | 'hi' | 'ur' | 'mr' | 'ta'

export interface LocaleMeta {
  code: Locale
  label: string
  /** Text direction — Urdu renders RTL; i18n keeps <html dir> in sync. */
  dir: 'ltr' | 'rtl'
}

/** Picker metadata — `label` is intentionally NOT translated (endonyms). */
export const LOCALES: LocaleMeta[] = [
  { code: 'en', label: 'English', dir: 'ltr' },
  { code: 'hi', label: 'हिन्दी', dir: 'ltr' },
  { code: 'ur', label: 'اردو', dir: 'rtl' },
  { code: 'mr', label: 'मराठी', dir: 'ltr' },
  { code: 'ta', label: 'தமிழ்', dir: 'ltr' },
]

const STRINGS: Record<Locale, Record<TranslationKey, string>> = {
  en: enStrings,
  hi: hiStrings,
  ur: urStrings,
  mr: mrStrings,
  ta: taStrings,
}

const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_EVENT = 'wa-locale-change'
export const LOCALE_STORAGE_KEY = 'wa-viewer:locale'

export type TParams = Record<string, string | number>

const LOCALE_CODES = LOCALES.map((l) => l.code)

function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALE_CODES as string[]).includes(v)
}

/** Read the persisted locale (SSR-safe: returns the default off-client). */
export function getLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isLocale(v)) return v
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_LOCALE
}

/** Persist the locale, sync <html lang> and notify subscribers. */
export function setLocale(l: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, l)
  } catch {
    /* storage unavailable */
  }
  syncDocumentLang(l)
  window.dispatchEvent(new Event(LOCALE_EVENT))
}

/** Keep <html lang> (and <html dir> for RTL locales) in sync. */
export function syncDocumentLang(locale?: Locale): void {
  if (typeof document === 'undefined') return
  const l = locale ?? getLocale()
  document.documentElement.lang = l
  const dir = LOCALES.find((m) => m.code === l)?.dir ?? 'ltr'
  document.documentElement.dir = dir
}

/** Subscribe to locale changes (event + cross-tab storage). */
export function subscribeLocale(cb: () => void): () => void {
  window.addEventListener(LOCALE_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(LOCALE_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

/**
 * Translate `key` into `locale` with `{name}` interpolation.
 * Falls back to the English string, then the raw key — never throws.
 */
export function t(locale: Locale, key: TranslationKey, params?: TParams): string {
  const raw = STRINGS[locale]?.[key] ?? STRINGS.en[key] ?? key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  )
}

/* ------------------------------------------------------------------ */
/* React glue (dependency-free)                                        */
/* ------------------------------------------------------------------ */

/** Current locale, re-rendering on `wa-locale-change` / cross-tab writes. */
export function useLocale(): Locale {
  return useSyncExternalStore(
    subscribeLocale,
    getLocale,
    () => DEFAULT_LOCALE
  )
}

/** `t` bound to the current locale: const t = useT(); t('settings.title'). */
export function useT(): (key: TranslationKey, params?: TParams) => string {
  const locale = useLocale()
  return useCallback(
    (key, params) => t(locale, key, params),
    [locale]
  )
}
