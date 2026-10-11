import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * GET /api/link-preview?url=<encoded>
 *
 * Server-side Open Graph scraper for the gallery's Links tab.
 * Contract:
 *  - 200 { ok: true, preview: { url, title, description?, siteName?, image? } }
 *    when the target returned parseable HTML.
 *  - 200 { ok: true, preview: null } for ANY failure (unreachable, timeout,
 *    non-HTML, oversized) — an unreachable site must never 5xx.
 *  - 400 { ok: false, error } only for a missing/invalid ?url= parameter.
 * Results (including negative ones) are cached in memory for 6h, max 300.
 */

const TIMEOUT_MS = 4000
const MAX_BODY_BYTES = 1024 * 1024 // ~1MB is plenty for <head>
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours
const CACHE_MAX_ENTRIES = 300

export interface LinkPreview {
  url: string
  title: string
  description?: string
  siteName?: string
  image?: string
}

interface CacheEntry {
  preview: LinkPreview | null
  ts: number
}

/** Module-level cache shared by all requests in this server process. */
const cache = new Map<string, CacheEntry>()

function cacheGet(url: string): LinkPreview | null | undefined {
  const entry = cache.get(url)
  if (!entry) return undefined
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(url)
    return undefined
  }
  return entry.preview
}

function cacheSet(url: string, preview: LinkPreview | null) {
  // Evict expired entries first, then oldest-inserted (Map keeps order).
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const now = Date.now()
    for (const [key, entry] of cache) {
      if (now - entry.ts > CACHE_TTL_MS) cache.delete(key)
      if (cache.size < CACHE_MAX_ENTRIES) break
    }
  }
  while (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  cache.set(url, { preview, ts: Date.now() })
}

function decodeEntities(input: string): string {
  return input
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code: string) => {
      if (code[0] !== '#') {
        const named: Record<string, string> = {
          amp: '&',
          lt: '<',
          gt: '>',
          quot: '"',
          apos: "'",
          nbsp: ' ',
        }
        return named[code] ?? m
      }
      const num =
        code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10)
      const ch = Number.isFinite(num) ? String.fromCodePoint(num) : ''
      return ch || m
    })
    .trim()
}

/** Pull og:/twitter: meta content out of raw HTML with plain regexes. */
function extractMeta(html: string): {
  ogTitle?: string
  ogDescription?: string
  ogImage?: string
  ogSiteName?: string
  titleTag?: string
} {
  const out: {
    ogTitle?: string
    ogDescription?: string
    ogImage?: string
    ogSiteName?: string
    titleTag?: string
  } = {}

  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of metaTags) {
    const key = tag.match(
      /(?:property|name)\s*=\s*["']\s*(og:title|og:description|og:image|og:image:secure_url|og:site_name|twitter:title|twitter:description|twitter:image)\s*["']/i
    )
    if (!key) continue
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)
    if (!content) continue
    const value = decodeEntities(content[1])
    if (!value) continue
    const k = key[1].toLowerCase()
    if (!out.ogTitle && (k === 'og:title' || k === 'twitter:title')) out.ogTitle = value
    else if (!out.ogDescription && (k === 'og:description' || k === 'twitter:description'))
      out.ogDescription = value
    else if (
      !out.ogImage &&
      (k === 'og:image' || k === 'og:image:secure_url' || k === 'twitter:image')
    )
      out.ogImage = value
    else if (!out.ogSiteName && k === 'og:site_name') out.ogSiteName = value
  }

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) out.titleTag = decodeEntities(titleMatch[1])

  return out
}

function truncate(s: string, max: number): string {
  const t = s.trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`
}

async function scrape(rawUrl: string): Promise<LinkPreview | null> {
  let target: URL
  try {
    target = new URL(rawUrl)
  } catch {
    return null
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(target.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // A real browser-ish UA: many sites refuse requests without one.
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return null

    // Read at most ~1MB — <head> with OG tags is always near the top.
    const reader = res.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        received += value.byteLength
        if (received >= MAX_BODY_BYTES) {
          try {
            await reader.cancel()
          } catch {
            /* already closing */
          }
          break
        }
      }
    }

    let encoding = 'utf-8'
    const charsetMatch = contentType.match(/charset=([\w-]+)/i)
    if (charsetMatch) encoding = charsetMatch[1]
    let decoder: TextDecoder
    try {
      decoder = new TextDecoder(encoding)
    } catch {
      decoder = new TextDecoder('utf-8')
    }
    const html = decoder.decode(Buffer.concat(chunks as unknown as Buffer[])) || ''

    const meta = extractMeta(html)
    const finalUrl = res.url || target.toString()
    const title = truncate(meta.ogTitle || meta.titleTag || '', 300)

    let image: string | undefined
    if (
      meta.ogImage &&
      meta.ogImage.length <= 2000 &&
      !meta.ogImage.startsWith('data:')
    ) {
      try {
        image = new URL(meta.ogImage, finalUrl).toString()
      } catch {
        image = undefined
      }
    }

    const preview: LinkPreview = {
      url: finalUrl,
      title: title || target.hostname,
      ...(meta.ogDescription ? { description: truncate(meta.ogDescription, 500) } : {}),
      ...(meta.ogSiteName ? { siteName: truncate(meta.ogSiteName, 100) } : {}),
      ...(image ? { image } : {}),
    }
    return preview
  } catch {
    // Unreachable, aborted, DNS failure… all get the same graceful null.
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url')
  if (!raw) {
    return NextResponse.json(
      { ok: false, error: 'Missing url parameter' },
      { status: 400 }
    )
  }
  let candidate: URL
  try {
    candidate = new URL(raw)
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid url parameter' },
      { status: 400 }
    )
  }
  if (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') {
    return NextResponse.json(
      { ok: false, error: 'Only http/https urls are supported' },
      { status: 400 }
    )
  }

  const key = candidate.toString()
  const cached = cacheGet(key)
  if (cached !== undefined) {
    return NextResponse.json({ ok: true, preview: cached })
  }

  const preview = await scrape(key)
  cacheSet(key, preview)
  return NextResponse.json({ ok: true, preview })
}
