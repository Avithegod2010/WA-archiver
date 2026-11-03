/**
 * Node-runtime socket-address capture (security fix, app-lock) — loaded only
 * from src/instrumentation.ts when NEXT_RUNTIME === 'nodejs'. The Edge build
 * eliminates that import branch entirely (see src/instrumentation.ts), so
 * this file is only ever bundled for the Node server runtime.
 *
 * App Router route handlers receive a Web `Request` that does NOT expose the
 * TCP peer address, which forces IP-based logic (throttle keys, loopback
 * recovery checks) to trust the spoofable `X-Forwarded-For` header. This
 * module patches the Node http server at the earliest possible point —
 * before any Next.js code runs — and overwrites a reserved header with the
 * socket's `remoteAddress`.
 *
 * The value is therefore unspoofable: a client may send its own
 * `x-wa-socket-remote-addr` header, but the patch overwrites it with the
 * address the TCP connection actually came from, every time. Consumers
 * check `socketAddrHookActive()` (src/lib/request-identity.ts) — the
 * header is only trusted when this hook has run (globalThis flag) — so a
 * client-supplied header is ignored on runtimes where the hook did not
 * execute.
 */

import type { IncomingMessage, Server } from 'node:http'
import http from 'node:http'

export const SOCKET_ADDR_HEADER = 'x-wa-socket-remote-addr'

export function activateSocketAddrHook(): void {
  const g = globalThis as Record<string, unknown>
  if (g.__WA_SOCK_ADDR_HOOK__ === true) return // already installed (dev HMR)

  try {
    const originalEmit = http.Server.prototype.emit
    http.Server.prototype.emit = function patchedEmit(
      this: Server,
      event: string | symbol,
      ...args: unknown[]
    ): boolean {
      if (event === 'request') {
        const req = args[0] as IncomingMessage | undefined
        const addr = req?.socket?.remoteAddress
        if (req && typeof addr === 'string') {
          // Overwrite unconditionally — this is what makes the value
          // trustworthy regardless of what the client sent.
          req.headers[SOCKET_ADDR_HEADER] = addr
        }
      }
      return originalEmit.call(this, event, ...args)
    }
    g.__WA_SOCK_ADDR_HOOK__ = true
  } catch {
    // Never let the hook break the server: without the flag, consumers
    // fall back to conservative behavior (no loopback trust, shared
    // throttle bucket) rather than trusting a client-supplied header.
  }
}
