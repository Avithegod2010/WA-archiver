/**
 * Data layer entry point.
 *
 * Phase 1 (storage seam): the on-device LocalDataClient lives here; the UI
 * consumes it where a device-local feature is explicitly wanted (device
 * import + Device storage card).
 *
 * Phase 2 will add the ServerDataClient (a fetch wrapper over /api/*) and
 * a mode selector, then move feature modules one by one.
 */

export type {
  DataClient,
  DeviceStatus,
  ImportParsedInput,
  ScheduledItem,
  SendMessageInput,
} from './types'
export { DataError } from './types'
export { LocalDataClient, getLocalClient } from './local/client'
export {
  importFileToDevice,
  LocalImportError,
  type LocalImportProgress,
  type LocalImportResult,
} from './local/import'
export { getEngine, type PersistenceKind } from './local/engine'
