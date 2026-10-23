import { NextRequest, NextResponse } from 'next/server'
import { assertAppUnlocked } from '@/lib/server-lock'

export const runtime = 'nodejs'

/**
 * POST /api/cloud-sync — WebDAV proxy for cloud-ready persistence.
 *
 * The browser hands us a fully ENCRYPTED `.wasync` envelope (client-side
 * AES-GCM); this route is a dumb transport to any WebDAV endpoint and never
 * sees plaintext chat data. Avoids CORS friction in the web build — device
 * (Capacitor) builds talk WebDAV directly instead.
 *
 * Body: { action: 'test' | 'push' | 'pull', url, username, password, payload? }
 *   test → PROPFIND depth 0 (connection + auth check)
 *   push → PUT payload (the encrypted envelope)
 *   pull → GET the file, return its text
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

export async function POST(req: NextRequest) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  let body: {
    action?: unknown
    url?: unknown
    username?: unknown
    password?: unknown
    payload?: unknown
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON' },
      { status: 400 }
    )
  }

  const action = body.action
  if (action !== 'test' && action !== 'push' && action !== 'pull') {
    return NextResponse.json(
      { ok: false, error: 'action must be test | push | pull' },
      { status: 400 }
    )
  }
  const url = validateUrl(body.url)
  if (!url) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Invalid WebDAV URL — must be an external http(s) endpoint',
      },
      { status: 400 }
    )
  }
  if (typeof body.username !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'username and password are required' },
      { status: 400 }
    )
  }
  if (action === 'push' && typeof body.payload !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'payload is required for push' },
      { status: 400 }
    )
  }

  const payload: string | undefined =
    action === 'push' ? (body.payload as string) : undefined

  const headers: Record<string, string> = {
    Authorization:
      'Basic ' +
      Buffer.from(`${body.username}:${body.password}`).toString('base64'),
  }
  if (action === 'push') headers['Content-Type'] = 'application/json'
  if (action === 'test') headers['Depth'] = '0'

  const method =
    action === 'push' ? 'PUT' : action === 'pull' ? 'GET' : 'PROPFIND'
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: action === 'push' ? payload : undefined,
      signal: AbortSignal.timeout(55_000),
      redirect: 'follow',
    })
    const text =
      action === 'pull' || action === 'test'
        ? await res.text().catch(() => '')
        : ''
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
