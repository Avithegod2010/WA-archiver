/**
 * Trustworthy request identity — used by the app-lock PIN throttle and the
 * lock-reset recovery gate (security fix for the unauthenticated reset
 * bypass).
 *
 * Threat being handled: `X-Forwarded-For` is a request header any HTTP
 * client can freely set or omit. Using it for security decisions lets a
 * remote attacker (a) claim to be loopback and unlock the local-recovery
 * path, or (b) rotate throttle keys and brute-force the PIN. Instead:
 *
 *  - `x-wa-socket-remote-addr` is set by src/instrumentation.ts from the
 *    TCP socket itself (unspoofable). It is only trusted when the
 *    instrumentation hook has run in this process (`globalThis` flag) —
 *    a client-sent copy of the header is ignored otherwise.
 *  - Behind a reverse proxy the socket address is the proxy's, so set
 *    `WA_TRUST_PROXY=1` to key throttles on the rightmost XFF entry
 *    (the address your immediate proxy appended — trustworthy if that
 *    proxy is yours). When unset, XFF is ignored for throttling.
 */

export interface RequestIdentity {
  /** Best-effort per-client key for rate limiting / lockout buckets. */
  throttleKey: string
  /** True when the TCP socket address is known and unspoofable. */
  socketKnown: boolean
  /** True when the connection is from the loopback interface. */
  loopback: boolean
  /** True when the request arrived with any X-Forwarded-For header. */
  viaProxy: boolean
  /**
   * True when every X-Forwarded-For hop is loopback (or there is none) —
   * used by the local-recovery gate together with `loopback`.
   */
  proxyChainLoopback: boolean
  /** True when the connection is (or was terminated as) HTTPS. */
  secureTransport: boolean
}

const SOCKET_HEADER = 'x-wa-socket-remote-addr'

/** The instrumentation hook sets this flag when its patch is active. */
export function socketAddrHookActive(): boolean {
  return (globalThis as Record<string, unknown>).__WA_SOCK_ADDR_HOOK__ === true
}

/** Loopback check for Node socket addresses (IPv4 / IPv6 / IPv4-mapped). */
export function isLoopbackIp(ip: string): boolean {
  return (
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === '127.0.0.1' ||
    ip.startsWith('127.')
  )
}

function rightmostXff(req: Request): string | null {
  const raw = req.headers.get('x-forwarded-for')
  if (!raw) return null
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean)
  return parts.length ? (parts[parts.length - 1] as string) : null
}

function isHttps(req: Request): boolean {
  try {
    if (new URL(req.url).protocol === 'https:') return true
  } catch {
    /* fall through to the proxy header */
  }
  const proto = req.headers.get('x-forwarded-proto')
  return !!proto && proto.split(',')[0]?.trim().toLowerCase() === 'https'
}

/**
 * Derive the client identity for a request. See the module comment for the
 * trust rules; the summary is:
 *
 *   socket known (direct)  → throttle key = socket address
 *   WA_TRUST_PROXY + XFF   → throttle key = rightmost XFF entry
 *   otherwise              → shared "unknown" bucket (conservative)
 */
export function requestIdentity(req: Request): RequestIdentity {
  const socketKnown = socketAddrHookActive()
  const socketAddr = socketKnown ? req.headers.get(SOCKET_HEADER) : null
  const loopback = socketKnown && !!socketAddr && isLoopbackIp(socketAddr)
  const viaProxy = !!req.headers.get('x-forwarded-for')

  // Local-recovery signal: the socket is loopback AND the entire forwarded
  // chain (if any) is loopback. An honest appending proxy (including the
  // Next dev server's internal hop) always appends the address it saw, so
  // a remote client can never make the whole chain loopback; a client that
  // prepends fake loopback entries still exposes its real address in the
  // appended tail. Only a proxy that strips or hardcodes XFF can blur
  // this — a documented residual caveat (docs/SECURITY.md).
  const xffParts = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const proxyChainLoopback = xffParts.every((p) => isLoopbackIp(p))

  let throttleKey: string
  const trustProxy = process.env.WA_TRUST_PROXY === '1'
  const xffIp = rightmostXff(req)
  if (trustProxy && xffIp) {
    throttleKey = `xff:${xffIp}`
  } else if (socketAddr && socketKnown) {
    throttleKey = `sock:${socketAddr}`
  } else {
    throttleKey = 'unknown'
  }

  return {
    throttleKey,
    socketKnown,
    loopback,
    viaProxy,
    proxyChainLoopback,
    secureTransport: isHttps(req),
  }
}

/**
 * The local-recovery signal for PIN-less lock reset: the request provably
 * originates on this machine (loopback socket, and no non-loopback hop
 * reported by any proxy in between).
 */
export function isDirectLocalRequest(identity: RequestIdentity): boolean {
  return identity.socketKnown && identity.loopback && identity.proxyChainLoopback
}
