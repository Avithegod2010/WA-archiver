import { NextRequest, NextResponse } from 'next/server'
import { assertAppUnlocked } from '@/lib/server-lock'
import { s3BucketUrl, s3SignedFetch } from '@/lib/s3-sign'

export const runtime = 'nodejs'

/**
 * POST /api/cloud-sync — storage-adapter proxy for cloud-ready persistence.
 *
 * The browser hands us a fully ENCRYPTED `.wasync` envelope (client-side
 * AES-GCM); this route is a dumb transport to the configured provider and
 * never sees plaintext chat data. Avoids CORS friction in the web build —
 * device (Capacitor) builds talk to providers directly instead.
 *
 * Body: { action, provider, …provider fields, payload?, target? }
 *   test   → reachability + auth check
 *   push   → PUT the encrypted envelope (target: main file or snapshot name)
 *   pull   → GET the file, return its text
 *   list   → list remote file names (history snapshots)
 *   delete → DELETE one remote file (prune)
 *
 * Providers: 'webdav' (default) | 's3' (SigV4) | 'gdrive' (OAuth bearer).
 *
 * SSRF guard: only http(s) URLs and no loopback targets. Private/LAN ranges
 * are deliberately ALLOWED — self-hosted Nextcloud on a home LAN is a
 * first-class use case for a local-first app, and this server runs on the
 * user's own machine (single-tenant, so classic multi-tenant SSRF risk does
 * not apply).
 */
function validateUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    /^127\./.test(host)
  ) {
    return null
  }
  return u
}

interface Body {
  action?: string
  provider?: string
  url?: string
  username?: string
  password?: string
  filename?: string
  payload?: string
  target?: string
  // s3
  s3Region?: string
  s3Bucket?: string
  s3AccessKey?: string
  s3SecretKey?: string
  s3Endpoint?: string
  s3Prefix?: string
  // gdrive
  gdriveToken?: string
  gdriveFolderId?: string
}

type Action = 'test' | 'push' | 'pull' | 'list' | 'delete'

// ---- WebDAV ----------------------------------------------------------------

function davHeaders(b: Body, action: Action): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization:
      'Basic ' +
      Buffer.from(`${b.username}:${b.password}`).toString('base64'),
  }
  if (action === 'push') headers['Content-Type'] = 'application/json'
  if (action === 'list') headers.Depth = '1'
  return headers
}

function davMethod(action: Action): string {
  return action === 'push'
    ? 'PUT'
    : action === 'pull'
      ? 'GET'
      : action === 'delete'
        ? 'DELETE'
        : 'PROPFIND'
}

function davUrl(b: Body, action: Action): URL | null {
  const base = (b.url ?? '').replace(/\/+$/, '')
  if (action === 'list') return validateUrl(base)
  return validateUrl(`${base}/${(b.target ?? b.filename ?? '').replace(/^\/+/, '')}`)
}

// ---- S3 --------------------------------------------------------------------

function s3Ready(b: Body): boolean {
  return Boolean(b.s3Bucket && b.s3Region && b.s3AccessKey && b.s3SecretKey)
}

function s3Key(b: Body, file: string): string {
  const prefix = (b.s3Prefix || 'wa-archiver/').replace(/^\/+/, '')
  const withSlash = prefix.endsWith('/') || prefix === '' ? prefix : `${prefix}/`
  return `${withSlash}${file.replace(/^\/+/, '')}`
}

async function s3Action(
  b: Body,
  action: Action
): Promise<NextResponse> {
  const baseUrl = s3BucketUrl({
    accessKeyId: b.s3AccessKey ?? '',
    secretAccessKey: b.s3SecretKey ?? '',
    region: b.s3Region ?? '',
    bucket: b.s3Bucket ?? '',
    endpoint: b.s3Endpoint || undefined,
  })
  try {
    let res: Response
    if (action === 'list') {
      res = await s3SignedFetch(
        {
          accessKeyId: b.s3AccessKey ?? '',
          secretAccessKey: b.s3SecretKey ?? '',
          region: b.s3Region ?? '',
          bucket: b.s3Bucket ?? '',
          endpoint: b.s3Endpoint || undefined,
        },
        {
          method: 'GET',
          baseUrl,
          key: '',
          query: { 'list-type': '2', prefix: s3Key(b, '') },
        }
      )
      const text = await res.text().catch(() => '')
      const names = [...text.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1])
      return NextResponse.json({ ok: res.ok, status: res.status, names })
    }
    const method =
      action === 'push' ? 'PUT' : action === 'pull' ? 'GET' : 'DELETE'
    res = await s3SignedFetch(
      {
        accessKeyId: b.s3AccessKey ?? '',
        secretAccessKey: b.s3SecretKey ?? '',
        region: b.s3Region ?? '',
        bucket: b.s3Bucket ?? '',
        endpoint: b.s3Endpoint || undefined,
      },
      {
        method,
        baseUrl,
        key: s3Key(b, b.target ?? b.filename ?? ''),
        body: action === 'push' ? b.payload : undefined,
      }
    )
    const text = action === 'pull' ? await res.text().catch(() => '') : ''
    return NextResponse.json({ ok: res.ok, status: res.status, text })
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error:
        err instanceof Error ? `S3 request failed: ${err.message}` : 'S3 request failed',
    })
  }
}

// ---- Google Drive ----------------------------------------------------------

const GDRIVE_API = 'https://www.googleapis.com/drive/v3'
const GDRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

function gdriveHeaders(b: Body): Record<string, string> {
  return { Authorization: `Bearer ${b.gdriveToken ?? ''}` }
}

function gdriveQuery(b: Body, name: string): string {
  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    'trashed = false',
    b.gdriveFolderId ? `'${b.gdriveFolderId}' in parents` : '',
  ]
    .filter(Boolean)
    .join(' and ')
  return q
}

async function gdriveFindId(b: Body, name: string): Promise<string | null> {
  const res = await fetch(
    `${GDRIVE_API}/files?q=${encodeURIComponent(gdriveQuery(b, name))}&fields=files(id,name)&pageSize=5&spaces=drive`,
    { headers: gdriveHeaders(b), signal: AbortSignal.timeout(55_000) }
  )
  if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as {
    files?: { id: string }[]
  } | null
  return data?.files?.[0]?.id ?? null
}

async function gdriveAction(
  b: Body,
  action: Action
): Promise<NextResponse> {
  if (!b.gdriveToken) {
    return NextResponse.json({
      ok: false,
      error: 'Google Drive access token missing',
    })
  }
  const target = b.target ?? b.filename ?? ''
  try {
    if (action === 'test') {
      const res = await fetch(`${GDRIVE_API}/about?fields=user`, {
        headers: gdriveHeaders(b),
        signal: AbortSignal.timeout(55_000),
      })
      return NextResponse.json({ ok: res.ok, status: res.status })
    }
    if (action === 'delete') {
      const id = await gdriveFindId(b, target)
      if (!id) return NextResponse.json({ ok: true, status: 204 })
      const res = await fetch(`${GDRIVE_API}/files/${id}`, {
        method: 'DELETE',
        headers: gdriveHeaders(b),
        signal: AbortSignal.timeout(55_000),
      })
      return NextResponse.json({ ok: res.ok || res.status === 204, status: res.status })
    }
    if (action === 'list') {
      const dot = target.lastIndexOf('.')
      const base = dot > 0 ? target.slice(0, dot) : target
      const q = [
        `name contains '${base.replace(/'/g, "\\'")}'`,
        'trashed = false',
        b.gdriveFolderId ? `'${b.gdriveFolderId}' in parents` : '',
      ]
        .filter(Boolean)
        .join(' and ')
      const res = await fetch(
        `${GDRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(name)&pageSize=100&spaces=drive`,
        { headers: gdriveHeaders(b), signal: AbortSignal.timeout(55_000) }
      )
      const data = (await res.json().catch(() => null)) as {
        files?: { name: string }[]
      } | null
      return NextResponse.json({
        ok: res.ok,
        status: res.status,
        names: res.ok ? (data?.files ?? []).map((f) => f.name) : undefined,
      })
    }
    if (action === 'push') {
      const id = await gdriveFindId(b, target)
      if (id) {
        const res = await fetch(
          `${GDRIVE_UPLOAD}/files/${id}?uploadType=media`,
          {
            method: 'PATCH',
            headers: {
              ...gdriveHeaders(b),
              'Content-Type': 'application/json',
            },
            body: b.payload,
            signal: AbortSignal.timeout(55_000),
          }
        )
        return NextResponse.json({ ok: res.ok, status: res.status })
      }
      const meta: Record<string, unknown> = { name: target }
      if (b.gdriveFolderId) meta.parents = [b.gdriveFolderId]
      const form = new FormData()
      form.append(
        'metadata',
        new Blob([JSON.stringify(meta)], { type: 'application/json' })
      )
      form.append('file', new Blob([b.payload ?? ''], { type: 'application/json' }))
      const res = await fetch(`${GDRIVE_UPLOAD}/files?uploadType=multipart`, {
        method: 'POST',
        headers: gdriveHeaders(b),
        body: form,
        signal: AbortSignal.timeout(55_000),
      })
      return NextResponse.json({ ok: res.ok, status: res.status })
    }
    // pull
    const id = await gdriveFindId(b, target)
    if (!id) {
      return NextResponse.json({
        ok: false,
        status: 404,
        error: 'File not found in Drive',
      })
    }
    const res = await fetch(`${GDRIVE_API}/files/${id}?alt=media`, {
      headers: gdriveHeaders(b),
      signal: AbortSignal.timeout(55_000),
    })
    const text = await res.text().catch(() => '')
    return NextResponse.json({ ok: res.ok, status: res.status, text })
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error:
        err instanceof Error
          ? `Drive request failed: ${err.message}`
          : 'Drive request failed',
    })
  }
}

// ---- entry -----------------------------------------------------------------

export async function POST(req: NextRequest) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON' },
      { status: 400 }
    )
  }

  const action = body.action
  if (
    action !== 'test' &&
    action !== 'push' &&
    action !== 'pull' &&
    action !== 'list' &&
    action !== 'delete'
  ) {
    return NextResponse.json(
      { ok: false, error: 'action must be test | push | pull | list | delete' },
      { status: 400 }
    )
  }
  if (action === 'push' && typeof body.payload !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'payload is required for push' },
      { status: 400 }
    )
  }

  const provider = body.provider === 'gdrive' || body.provider === 's3' ? body.provider : 'webdav'

  if (provider === 's3') return s3Action(body, action as Action)
  if (provider === 'gdrive') return gdriveAction(body, action as Action)

  // ---- WebDAV (default) ----
  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'username and password are required' },
      { status: 400 }
    )
  }
  const url = davUrl(body, action as Action)
  if (!url) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Invalid WebDAV URL — must be an external http(s) endpoint',
      },
      { status: 400 }
    )
  }
  const isList = action === 'list'
  try {
    const res = await fetch(url, {
      method: davMethod(action as Action),
      headers: davHeaders(body, action as Action),
      body: action === 'push' ? body.payload : undefined,
      signal: AbortSignal.timeout(85_000),
      redirect: 'follow',
    })
    const text =
      action === 'pull' || isList ? await res.text().catch(() => '') : ''
    if (isList) {
      const base = url.toString().replace(/\/+$/, '')
      const names = parseDavListServer(text, base)
      return NextResponse.json({ ok: res.ok, status: res.status, names })
    }
    return NextResponse.json({ ok: res.ok, status: res.status, text })
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error:
        err instanceof Error
          ? `WebDAV request failed: ${err.message}`
          : 'WebDAV request failed',
    })
  }
}

/** Extract file names from a WebDAV PROPFIND (Depth 1) XML response. */
function parseDavListServer(xml: string, base: string): string[] {
  try {
    const out: string[] = []
    const re = /<(?:[a-zA-Z0-9]+:)?href>([^<]+)<\/(?:[a-zA-Z0-9]+:)?href>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(xml)) !== null) {
      let href = m[1]
      try {
        href = decodeURIComponent(href)
      } catch {
        /* keep raw */
      }
      if (/^https?:\/\//i.test(href)) {
        try {
          href = new URL(href).pathname
        } catch {
          /* keep raw */
        }
      }
      const basePath = (() => {
        try {
          return new URL(base).pathname
        } catch {
          return base
        }
      })()
      const rel = href.replace(basePath, '').replace(/^\/+/, '')
      if (rel && !rel.endsWith('/')) out.push(rel)
    }
    return out
  } catch {
    return []
  }
}
