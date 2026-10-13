import { NextRequest, NextResponse } from 'next/server'

/**
 * CSRF defense-in-depth for mutating API calls (security audit, v1.0.1).
 *
 * Browsers attach an `Origin` header to cross-origin POSTs (and to same-origin
 * POSTs issued by fetch). If an Origin is present and its host does not match
 * the request's Host, the call cannot have been made by this app's own UI —
 * reject it. Non-browser clients (curl, server-to-server) send no Origin and
 * are unaffected. Combined with the HttpOnly SameSite=Lax unlock cookie, this
 * closes the classic cross-site form/fetch attack surface.
 */
export function proxy(req: NextRequest) {
  const { method } = req
  if (
    method === 'GET' ||
    method === 'HEAD' ||
    method === 'OPTIONS' ||
    !req.nextUrl.pathname.startsWith('/api/')
  ) {
    return NextResponse.next()
  }

  const origin = req.headers.get('origin')
  if (origin) {
    try {
      const originHost = new URL(origin).host
      const host = req.headers.get('host')
      if (host && originHost !== host) {
        return NextResponse.json(
          { error: 'Cross-origin request blocked' },
          { status: 403 }
        )
      }
    } catch {
      // Malformed Origin — let the route's own validation handle the request.
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
