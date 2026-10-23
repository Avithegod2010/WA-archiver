/**
 * Google Drive refresh-token OAuth flow (v1.9) — a real authorization-code
 * exchange instead of paste-a-token.
 *
 * Flow (web build):
 *   1. The user pastes their Google Cloud OAuth client id + secret once
 *      (stored device-local) and their registered redirect URI (prefilled
 *      with the current page URL).
 *   2. "Connect Google Drive" opens the consent screen (drive.file scope,
 *      access_type=offline → a refresh token is issued).
 *   3. Google redirects back to the app URL with ?code=…&state=wa-archiver;
 *      the app detects it, exchanges the code (server route on web, direct
 *      token-endpoint fetch on device) and stores the refresh token.
 *   4. Every provider call afterwards auto-refreshes the access token when
 *      it is (about to be) expired — no more re-pasting every hour.
 *
 * The token endpoint is CORS-enabled; the /api/gdrive-oauth route exists
 * only as a same-origin convenience (and SSRF-free by construction — it
 * always talks to accounts.google.com/oauth2.googleapis.com).
 */

import type { CloudSyncConfig } from './cloud-sync'

export const GDRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const GDRIVE_STATE = 'wa-archiver-gdrive'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

export interface TokenExchangeResult {
  accessToken: string
  expiresIn: number
  refreshToken: string | null
}

export function buildConsentUrl(opts: {
  clientId: string
  redirectUri: string
}): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'code',
    scope: GDRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: GDRIVE_STATE,
  })
  return `${AUTH_ENDPOINT}?${q.toString()}`
}

/** True when the current URL is a Google redirect carrying our code. */
export function readOAuthRedirectCode(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('state') !== GDRIVE_STATE) return null
    if (url.searchParams.get('error')) return null
    const code = url.searchParams.get('code')
    if (!code) return null
    // Clean the address bar so refreshes don't re-exchange.
    url.searchParams.delete('code')
    url.searchParams.delete('scope')
    url.searchParams.delete('state')
    url.searchParams.delete('prompt')
    url.searchParams.delete('authuser')
    window.history.replaceState(null, '', url.toString())
    return code
  } catch {
    return null
  }
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

async function tokenFetch(
  params: Record<string, string>
): Promise<TokenExchangeResult> {
  // Same-origin route first (web build); direct endpoint as device fallback.
  const tryOrder: (() => Promise<Response>)[] = [
    () =>
      fetch('/api/gdrive-oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'token', params }),
        signal: AbortSignal.timeout(30_000),
      }),
    () =>
      fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(30_000),
      }),
  ]
  let lastError = 'Token exchange failed'
  for (const attempt of tryOrder) {
    try {
      const res = await attempt()
      if (res.headers.get('content-type')?.includes('application/json')) {
        const data = (await res.json()) as TokenResponse & { error?: string }
        if (data.access_token) {
          return {
            accessToken: data.access_token,
            expiresIn: data.expires_in ?? 3600,
            refreshToken: data.refresh_token ?? null,
          }
        }
        lastError =
          data.error_description ?? data.error ?? `Token endpoint ${res.status}`
        if (!res.ok && data.error) break // Google error — retrying direct won't help
      } else {
        lastError = `Token endpoint ${res.status}`
      }
    } catch {
      /* route unreachable — fall through to the direct attempt */
    }
  }
  throw new Error(lastError)
}

/** Exchange an authorization code for refresh + access tokens. */
export async function exchangeAuthCode(opts: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<TokenExchangeResult> {
  return tokenFetch({
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
    grant_type: 'authorization_code',
  })
}

/** Rotate an access token from the stored refresh token. */
export async function refreshAccessToken(opts: {
  clientId: string
  clientSecret: string
  refreshToken: string
}): Promise<TokenExchangeResult> {
  return tokenFetch({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
    grant_type: 'refresh_token',
  })
}

/**
 * Make sure `cfg.gdriveToken` is fresh: when a refresh token + client
 * credentials exist and the cached access token is missing/expired (within
 * a 2-minute margin), rotate it. Mutates + returns a NEW config object —
 * callers must persist it.
 */
export async function ensureFreshGdriveToken(
  cfg: CloudSyncConfig
): Promise<CloudSyncConfig> {
  const expiresAt = cfg.gdriveTokenExpiresAt ?? 0
  const fresh = expiresAt - Date.now() > 120_000
  if (cfg.gdriveToken && fresh) return cfg
  if (!cfg.gdriveRefreshToken || !cfg.gdriveClientId || !cfg.gdriveClientSecret) {
    return cfg // manual-token mode — nothing to rotate
  }
  try {
    const out = await refreshAccessToken({
      clientId: cfg.gdriveClientId,
      clientSecret: cfg.gdriveClientSecret,
      refreshToken: cfg.gdriveRefreshToken,
    })
    return {
      ...cfg,
      gdriveToken: out.accessToken,
      gdriveTokenExpiresAt: Date.now() + out.expiresIn * 1000,
    }
  } catch {
    return cfg // keep the old token — requests will 401 and surface it
  }
}

/** Default redirect URI candidates for the settings field. */
export function defaultRedirectUri(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${window.location.pathname}`
}
