/* WA Archiver service worker.
 * 1. Caches only immutable content: chat media, app icons and the manifest.
 *    Everything else (HTML, API data) always goes to the network so imported
 *    chats and chat lists are always fresh. Page navigations fall back to a
 *    precached offline page when the network is unreachable (or 5xx).
 * 2. Web Share Target: intercepts the POST from the OS share sheet
 *    (manifest share_target → /?share-target=1), stashes the shared text and
 *    files in the Cache API, then 303-redirects to /?shared=1 where the app
 *    picks the payload up and files it into Saved Messages. */
const CACHE = 'wa-viewer-media-v3'
const SHARE_CACHE = 'wa-viewer-share-v1'
const SHARE_MARKER = '/__shared-'

/* Base path — derived from the SW's own registration scope, so this same
 * file works at the origin root (dev, standalone server, APK WebView) and
 * under a sub-path (GitHub Pages: /WA-archiver/app/). */
const SCOPE_URL = new URL(self.registration.scope)
const BASE = SCOPE_URL.pathname.endsWith('/')
  ? SCOPE_URL.pathname
  : `${SCOPE_URL.pathname}/`

self.addEventListener('install', (event) => {
  // Precache the offline fallback page. Relative URL → resolved against this
  // SW's own URL (the app root), so it works under GitHub Pages sub-paths too.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['./offline.html']))
      .catch(() => {}) // never block installation on the fallback page
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => k !== CACHE && k !== SHARE_CACHE)
          .map((k) => caches.delete(k))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request

  // ---- Web Share Target (POST from the OS share sheet) -------------------
  if (req.method === 'POST') {
    let url
    try {
      url = new URL(req.url)
    } catch {
      return
    }
    if (url.origin !== self.location.origin) return
    if (url.pathname !== BASE || url.searchParams.get('share-target') !== '1') {
      return
    }
    event.respondWith(handleShareTarget(req))
    return
  }

  if (req.method !== 'GET') return

  let url
  try {
    url = new URL(req.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return

  const cacheable =
    url.pathname.startsWith(`${BASE}api/media/`) ||
    url.pathname.startsWith(`${BASE}icons/`) ||
    url.pathname === `${BASE}manifest.json` ||
    url.pathname === `${BASE}manifest.webmanifest` ||
    // On-device SQLite engine (local-first refactor, Phase 1) — cached so
    // the database engine itself also works with no network.
    url.pathname === `${BASE}sql-wasm.js` ||
    url.pathname === `${BASE}sql-wasm.wasm` ||
    // On-device voice-transcription runtime (Phase 4) — transformers.js
    // bundle + ONNX Runtime wasm binaries. The ASR MODEL files are cached
    // separately by transformers.js (its own Cache-API bucket).
    url.pathname.startsWith(`${BASE}whisper/`)

  if (cacheable) {
    // Stale-while-revalidate: instant from cache, refresh in background.
    // (Runs even when a cacheable path is loaded as a top-level navigation,
    // so e.g. opening a media URL in a new tab while offline still works.)
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const cached = await cache.match(req)
        const network = fetch(req)
          .then((res) => {
            if (res && (res.status === 200 || res.status === 206)) {
              cache.put(req, res.clone()).catch(() => {})
            }
            return res
          })
          .catch(() => cached)
        return cached || network
      })()
    )
    return
  }

  // ---- Offline navigation fallback (network-first) -----------------------
  // HTML document loads (request.mode === 'navigate') always go to the
  // network for freshness; if the device is offline or the server answers
  // 5xx, serve the precached offline page instead of the browser's error
  // screen. The share-target POST above is unaffected.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req)
          if (res && res.status < 500) return res
          throw new Error(`HTTP ${res.status}`)
        } catch {
          const cache = await caches.open(CACHE)
          const offline = await cache.match('./offline.html')
          if (offline) return offline
          return new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/html' },
          })
        }
      })()
    )
  }
})

/**
 * Reads the share-sheet POST (multipart/form-data): title/text/url merged
 * into one text body plus any attached files. The payload is parked in the
 * SHARE_CACHE — JSON index at '/__shared-payload', each file as a raw blob
 * at '/__shared-blob-<ts>-<i>' — then the request is answered with a 303
 * redirect to '/?shared=1' so the app can consume it without re-submitting.
 */
async function handleShareTarget(req) {
  let hasPayload = false
  try {
    const cache = await caches.open(SHARE_CACHE)

    // Drop any stale payload from a previous (unconsumed) share first.
    const oldKeys = await cache.keys()
    await Promise.all(
      oldKeys
        .filter((k) => k.url.includes(SHARE_MARKER))
        .map((k) => cache.delete(k))
    )

    const form = await req.formData()
    const field = (name) => {
      const v = form.get(name)
      return typeof v === 'string' ? v.trim() : ''
    }

    // Merge title/text/url, dropping parts already contained in the body.
    const parts = []
    for (const v of [field('title'), field('text'), field('url')]) {
      if (v && !parts.some((p) => p.includes(v))) parts.push(v)
    }
    const text = parts.join('\n\n').slice(0, 4000)

    const blobs = form
      .getAll('files')
      .filter((f) => f instanceof Blob && f.size > 0)

    const ts = Date.now()
    const files = []
    for (let i = 0; i < blobs.length; i++) {
      const f = blobs[i]
      const key = `${SHARE_MARKER}blob-${ts}-${i}`
      const headers = new Headers()
      headers.set('Content-Type', f.type || 'application/octet-stream')
      if (f.name) headers.set('X-Filename', encodeURIComponent(f.name))
      await cache.put(key, new Response(f, { headers }))
      files.push({ key, name: f.name || `shared-${i}`, type: f.type || '' })
    }

    if (text || files.length > 0) {
      await cache.put(
        `${SHARE_MARKER}payload`,
        new Response(
          JSON.stringify({ ts, text: text || null, files }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
      hasPayload = true
    }
  } catch {
    /* malformed share body — fall through and just redirect home */
  }

  const dest = new URL(
    hasPayload ? '?shared=1' : '',
    SCOPE_URL
  ).toString()
  return Response.redirect(dest, 303)
}
