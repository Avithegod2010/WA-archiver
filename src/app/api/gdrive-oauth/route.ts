import { NextRequest, NextResponse } from 'next/server'
import { assertAppUnlocked } from '@/lib/server-lock'

export const runtime = 'nodejs'

/**
 * POST /api/gdrive-oauth — Google Drive OAuth code exchange / token refresh.
 *
 * The browser performs the consent redirect itself; this route only proxies
 * the token exchange to Google's token endpoint (same-origin ⇒ no CORS
 * friction in the web build). The client id / secret come from the request
 * body — they are the USER'S OWN OAuth client (device-local, single-user
 * local-first app), never a server-side secret.
 *
 * Body: { action: 'token', params: Record<string,string> } — params are the
 * urlencoded token-request fields (code / refresh_token / client_id / …).
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const ALLOWED_KEYS = new Set([
  'code',
  'client_id',
  'client_secret',
  'redirect_uri',
  'grant_type',
  'refresh_token',
  'code_verifier',
])

export async function POST(req: NextRequest) {
  const denied = await assertAppUnlocked(req)
  if (denied) return denied

  let body: { action?: string; params?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (body.action !== 'token' || !body.params) {
    return NextResponse.json(
      { error: 'action must be "token" with params' },
      { status: 400 }
    )
  }

  const form = new URLSearchParams()
  for (const [k, v] of Object.entries(body.params)) {
    if (!ALLOWED_KEYS.has(k)) continue // hard allow-list — no param smuggling
    if (typeof v === 'string' && v.length <= 2048) form.set(k, v)
  }
  const grant = form.get('grant_type')
  if (grant !== 'authorization_code' && grant !== 'refresh_token') {
    return NextResponse.json(
      { error: 'grant_type must be authorization_code or refresh_token' },
      { status: 400 }
    )
  }
  if (!form.get('client_id') || !form.get('client_secret')) {
    return NextResponse.json(
      { error: 'client_id and client_secret are required' },
      { status: 400 }
    )
  }

  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text().catch(() => '')
    let data: unknown = null
    try {
      data = JSON.parse(text)
    } catch {
      /* non-JSON → surface the status */
    }
    return NextResponse.json(data ?? { error: `token_endpoint_${res.status}` }, {
      status: res.ok ? 200 : 502,
    })
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Token request failed: ${err.message}`
            : 'Token request failed',
      },
      { status: 502 }
    )
  }
}
