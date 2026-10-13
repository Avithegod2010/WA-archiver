import { NextRequest, NextResponse } from 'next/server'
import { assertAppUnlocked } from '@/lib/server-lock'

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

/**
 * SSRF guard: refuse hostnames that resolve to loopback / private /
 * link-local / cloud-metadata targets. Covers IP-literal forms (v4, v6,
 * decimal/octal/hex integer encodings) and obvious localhost spellings.
 * Redirects are followed manually (max 5) and every hop is re-validated.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true
  }
  // IPv6 literals are wrapped in brackets in URL.hostname
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  // Integer forms (decimal/hex/octal) like 2130706433 / 0x7f000001
  if (/^0x[0-9a-f]+$/i.test(bare) || /^\d{8,}$/.test(bare)) return true
  // IPv4 (possibly shortened forms like 127.1)
  const parts = bare.split('.')
  if (parts.length >= 1 && parts.length <= 4 && parts.every((p) => /^\d+$/.test(p))) {
    const nums = parts.map((p) => parseInt(p, 10))
    if (nums.some((n) => n > 255)) return true // weird numeric host, be safe
    let ip: number[]
    if (nums.length === 4) {
      ip = nums
    } else if (nums.length === 1) {
      ip = [(nums[0] >>> 24) & 255, (nums[0] >>> 16) & 255, (nums[0] >>> 8) & 255, nums[0] & 255]
    } else {
      // 127.1 / 10.1 style: last part covers the remaining bytes
      ip = [...nums.slice(0, -1)]
      let last = nums[nums.length - 1]
      while (ip.length < 3) {
        ip.push((last >>> 8) & 255) // order: high byte of last part fills left
        last = last & 255
      }
      ip.push(last)
      ip = ip.slice(0, 4)
    }
    const [a, b] = ip
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 169 && b === 254) return true // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 192 && b === 0) return true // 192.0.0.0/24 (IETF protocol)
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    if (a >= 224) return true // multicast + reserved
  }
  // IPv6 loopback/mapped/link-local
  if (bare.includes(':')) {
    const h = bare.replace(/^0+/, '')
    if (bare === '::' || bare === '::1' || /^:1$/.test(h)) return true
    if (/^f[cd]/i.test(bare)) return true // fc00::/7 unique-local
    if (/^fe[89ab]/i.test(bare)) return true // fe80::/10 link-local
    if (/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.test(bare)) {
      return isPrivateHost(bare.replace(/^::ffff:/i, ''))
    }
  }
  return false
}

async function fetchWithGuards(target: URL): Promise<Response | null> {
  let current = target
  for (let hop = 0; hop < 5; hop++) {
    if (current.protocol !== 'http:' && current.protocol !== 'https:') return null
    if (isPrivateHost(current.hostname)) return null
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(current.toString(), {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          // A real browser-ish UA: many sites refuse requests without one.
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      })
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        if (!loc) return null
        try {
          current = new URL(loc, current)
        } catch {
          return null
        }
        continue
      }
      return res
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }
  return null // too many redirects
}

async function scrape(rawUrl: string): Promise<LinkPreview | null> {
  let target: URL
  try {
    target = new URL(rawUrl)
  } catch {
    return null
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null
  if (isPrivateHost(target.hostname)) return null

  try {
    const res = await fetchWithGuards(target)
    if (!res) return null

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
        const resolved = new URL(meta.ogImage, finalUrl)
        // Only http(s) image URLs are safe to hand to the client — anything
        // else (javascript:, vbscript:, …) must never reach an <img src>.
        if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
          image = resolved.toString()
        }
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
  }
}

export async function GET(req: NextRequest) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

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
  if (isPrivateHost(candidate.hostname)) {
    return NextResponse.json(
      { ok: false, error: 'This url is not allowed' },
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
