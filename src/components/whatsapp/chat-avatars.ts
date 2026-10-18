/**
 * Per-chat custom photo store (localStorage-backed).
 *
 * Lets the user set their own media (any image) as a chat's avatar — the
 * custom photo then shows everywhere the chat's initials avatar did: chat
 * list row, chat header, chat info panel.
 *
 * Storage:
 *   wa-viewer:avatars → JSON { [chatId]: dataURL }
 *   Data URLs are canvas-downscaled (square center-crop, ≤192px, JPEG q0.85)
 *   before being stored, so a photo costs ~8–20KB — hundreds fit in the 5MB
 *   localStorage budget with room for the rest of the app's settings.
 *
 * Event (window CustomEvent, bubbles to all listeners):
 *   'wa-avatar-changed' → detail { chatId }  — after set/remove
 *
 * Mirrors the store pattern in chat-theme.ts (defensive reads + custom event
 * + cross-tab 'storage' subscription + module-level cache so
 * useSyncExternalStore snapshots stay referentially stable).
 */

export const CHAT_AVATAR_EVENT = 'wa-avatar-changed'

const AVATARS_KEY = 'wa-viewer:avatars'

/** Max edge of the stored square thumbnail (covers the 88px info avatar @2x). */
const MAX_EDGE = 192
const JPEG_QUALITY = 0.85

type AvatarMap = Record<string, string>

let cache: AvatarMap | null = null

function readMap(): AvatarMap {
  if (typeof window === 'undefined') return {}
  if (cache) return cache
  try {
    const raw = localStorage.getItem(AVATARS_KEY)
    if (!raw) {
      cache = {}
      return cache
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      cache = {}
      return cache
    }
    // Keep only string data-URL values (defensive against hand-edited storage)
    const out: AvatarMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v.startsWith('data:image/')) out[k] = v
    }
    cache = out
    return cache
  } catch {
    cache = {}
    return cache
  }
}

function writeMap(map: AvatarMap): void {
  cache = map
  try {
    if (Object.keys(map).length > 0) {
      localStorage.setItem(AVATARS_KEY, JSON.stringify(map))
    } else {
      localStorage.removeItem(AVATARS_KEY)
    }
  } catch {
    /* storage full/unavailable — cache still holds the value for this session */
  }
}

/** The chat's custom photo as a data URL, or null when unset. */
export function getChatAvatar(chatId: string): string | null {
  if (!chatId) return null
  return readMap()[chatId] ?? null
}

/**
 * Set (dataUrl) or remove (null) a chat's custom photo and notify listeners.
 */
export function setChatAvatar(chatId: string, dataUrl: string | null): void {
  if (typeof window === 'undefined' || !chatId) return
  const map = { ...readMap() }
  if (dataUrl && dataUrl.startsWith('data:image/')) map[chatId] = dataUrl
  else delete map[chatId]
  writeMap(map)
  try {
    window.dispatchEvent(
      new CustomEvent(CHAT_AVATAR_EVENT, { detail: { chatId } })
    )
  } catch {
    /* ignore */
  }
}

/** Remove every chat's custom photo (Settings "reset" helpers may use this). */
export function clearAllChatAvatars(): void {
  if (typeof window === 'undefined') return
  writeMap({})
  try {
    window.dispatchEvent(new CustomEvent(CHAT_AVATAR_EVENT, { detail: {} }))
  } catch {
    /* ignore */
  }
}

/** Subscribe to avatar changes (custom event + cross-tab 'storage'). */
export function subscribeChatAvatars(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(CHAT_AVATAR_EVENT, cb)
  // Cross-tab writes bypass writeMap() — drop the cache so the next read
  // sees the fresh localStorage contents before notifying React.
  const onStorage = () => {
    cache = null
    cb()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHAT_AVATAR_EVENT, cb)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * Downscale an image File into a square center-cropped JPEG data URL
 * (≤ MAX_EDGE). Rejects when the browser cannot decode the file (e.g. HEIC).
 */
export function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !file.type.startsWith('image/')) {
      reject(new Error('Not an image'))
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const edge = Math.min(img.naturalWidth, img.naturalHeight)
        const size = Math.min(edge, MAX_EDGE)
        const sx = (img.naturalWidth - edge) / 2
        const sy = (img.naturalHeight - edge) / 2
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas unavailable')
        ctx.drawImage(img, sx, sy, edge, edge, 0, 0, size, size)
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Crop failed'))
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not decode this image'))
    }
    img.src = url
  })
}
