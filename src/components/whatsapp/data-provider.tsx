'use client'

/**
 * DataProvider — hands every component the active DataClient (Phase 2).
 *
 * The transport is chosen by the persisted storage mode:
 *   server → REST (ServerDataClient), device → on-device engine
 *   (LocalDataClient, awaited until the SQLite-WASM engine is ready).
 *
 * Usage:
 *   const { mode, data, ready } = useData()
 *   const chats = await data.listChats()
 *
 * In device mode every mediaPath on returned messages is a blob: URL already
 * resolved through the media store (see normalizeMessages below) — rendering
 * components keep using mediaPath unchanged. In server mode mediaPath stays
 * the stored name and components derive /api/media/... URLs as before
 * (displayMediaSrc handles both).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  createDataClient,
  getLocalClient,
  type DataClient,
  type StorageMode,
} from '@/lib/data'
import type { ChatMessage } from './types'
import {
  getStorageMode,
  STORAGE_MODE_EVENT,
  subscribeStorageMode,
} from './storage-mode'

interface DataContextValue {
  mode: StorageMode
  data: DataClient
  /** False until the device engine finished loading (always true on server). */
  ready: boolean
  /**
   * False during the very first paint: the persisted storage mode has not
   * been read from localStorage yet (SSR initial state is 'server'). Mount
   * effects that fetch through `data` must wait for this — otherwise a
   * device-mode app (standalone APK, offline PWA) fires one doomed server
   * request first and flashes a spurious error toast (Phase 3 fix).
   */
  modeResolved: boolean
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<StorageMode>('server')
  // Only meaningful in device mode; server transport is always ready.
  const [deviceReady, setDeviceReady] = useState(false)
  // False until the mount sync below read the persisted mode.
  const [modeResolved, setModeResolved] = useState(false)

  // Read the persisted mode after mount (SSR-safe) and follow external changes.
  useEffect(() => {
    const sync = () => {
      setMode(getStorageMode())
      // Flip after the first read — mount effects fetching through `data`
      // wait for this (see modeResolved above).
      setModeResolved(true)
    }
    sync()
    return subscribeStorageMode(sync)
  }, [])

  // Warm the device engine (and surface readiness) when it is the transport.
  // State updates happen in promise callbacks only — never in the effect body.
  useEffect(() => {
    if (mode !== 'device') return
    let alive = true
    getLocalClient()
      .whenReady()
      .then(() => {
        if (alive) setDeviceReady(true)
      })
      .catch(() => {
        if (alive) setDeviceReady(true) // errors surface from the calls themselves
      })
    return () => {
      alive = false
    }
  }, [mode])

  const data = useMemo(() => createDataClient(mode), [mode])
  const ready = mode === 'server' || deviceReady
  const value = useMemo(
    () => ({ mode, data, ready, modeResolved }),
    [mode, data, ready, modeResolved]
  )

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) {
    throw new Error('useData must be used inside <DataProvider>')
  }
  return ctx
}

/**
 * Resolve every mediaPath of freshly loaded device-mode messages into an
 * object URL. Server mode is a passthrough (mediaPath is a stored name and
 * components build /api/media/... from it).
 */
export function useMessageNormalizer() {
  const { mode, data } = useData()
  return useCallback(
    async (chatId: string, messages: ChatMessage[]): Promise<ChatMessage[]> => {
      if (mode !== 'device') return messages
      const out: ChatMessage[] = []
      for (const m of messages) {
        if (m.mediaPath && !m.mediaPath.startsWith('blob:')) {
          const url = await data.mediaUrl(chatId, m.mediaPath)
          out.push({ ...m, mediaPath: url ?? m.mediaPath })
        } else {
          out.push(m)
        }
      }
      return out
    },
    [mode, data]
  )
}

export { STORAGE_MODE_EVENT }
