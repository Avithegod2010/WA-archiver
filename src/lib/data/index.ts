/**
 * Data layer entry point.
 *
 * Phase 1 (storage seam): the on-device LocalDataClient — SQLite-WASM engine,
 * OPFS persistence, IndexedDB media, client-side import.
 *
 * Phase 2 (feature swap): the UI consumes a DataClient from DataProvider
 * (see src/components/whatsapp/data-provider.tsx). Two transports implement
 * the same interface:
 *
 *   • ServerDataClient — REST wrapper over /api/* (hosted/demo mode).
 *   • LocalDataClient  — fully on-device engine (offline / APK mode).
 *
 * The storage mode is a user preference persisted in localStorage and
 * switched from Settings → Data & storage; switching reloads the app.
 */

export type {
  BackupImportResult,
  DataClient,
  DeviceStatus,
  ImportParsedInput,
  MediaItem,
  MemoriesResult,
  MemoryGroup,
  MemoryItem,
  ScheduledItem,
  SearchChatGroup,
  SearchHit,
  SearchResult,
  SendMessageInput,
  StarredItem,
} from './types'
export { DataError } from './types'
export { LocalDataClient, getLocalClient } from './local/client'
export { ServerDataClient, serverDataClient } from './server'
export {
  importFileToDevice,
  previewDeviceImport,
  commitDeviceImport,
  applyImportSelection,
  LocalImportError,
  type ImportPreviewData,
  type ImportPreviewSummary,
  type ImportSelection,
  type LocalImportProgress,
  type LocalImportResult,
} from './local/import'
export { getEngine, type PersistenceKind } from './local/engine'

import { getLocalClient } from './local/client'
import { serverDataClient } from './server'
import type { DataClient } from './types'

/** Storage modes, mirrored by storage-mode.ts (UI store). */
export type StorageMode = 'server' | 'device'

/**
 * Resolve the DataClient for a mode. Returns singletons on both sides:
 * the server transport is stateless, the device transport owns the engine.
 */
export function createDataClient(mode: StorageMode): DataClient {
  return mode === 'device' ? getLocalClient() : serverDataClient
}
