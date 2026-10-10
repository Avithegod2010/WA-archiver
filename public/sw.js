/* WhatsApp Viewer service worker.
 * Caches only immutable content: chat media, app icons and the manifest.
 * Everything else (HTML, API data) always goes to the network so imported
 * chats and chat lists are always fresh. */
const CACHE = 'wa-viewer-media-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  let url
  try {
    url = new URL(req.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) return

  const cacheable =
    url.pathname.startsWith('/api/media/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json'

  if (!cacheable) return

  // Stale-while-revalidate: instant from cache, refresh in background.
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
})
