# Security Audit & Hardening Guide — WA Archiver

> Audit performed at v1.0 (pre-diverge), covering the hosted/server build
> (`next dev` / `next build` + `/api/*`) and the static APK export.
> Method: self-interrogation of the attack surface + live adversarial
> testing against the running app (curl + browser).
> Re-audited after the v1.9.1 app-lock bypass fix: reset gate, PIN
> throttling, fail-closed lock state, cookie flags (see the threat-model
> rows and `bun run test:security`).

## Threat model (who can attack what?)

| Actor | Vector | Verdict |
|---|---|---|
| Malicious chat export (zip/txt) | Import path — hostile filenames, zip bombs, XSS in message text, scriptable media (SVG/HTML) | **Hardened** |
| Malicious web page | CSRF / cross-origin calls against a hosted instance | **Mitigated** (proxy origin check + SameSite cookie) |
| Malicious URLs inside chats | Server-side link-preview scraper → SSRF | **Hardened** |
| Network observer | Cookie theft / sniffing | Hardened (HttpOnly, SameSite, `Secure` on HTTPS transports) |
| Curious visitor | Open instance with no lock → reads/deletes chats | **Documented risk** — enable the PIN lock (below) |
| Network attacker (lock enabled) | `POST /api/auth/lock {"action":"reset"}` to disable the lock, then read the archive | **Hardened** — reset now needs the current PIN, direct local access, or the operator's `WA_LOCK_RESET_TOKEN` |
| PIN guesser | Brute-force the 4–8 digit lock PIN over the network | **Throttled** — 5 wrong PINs / 15 min per client → 15-minute lockout (429) |
| DB outage mid-request | Lock gate fails open during a transient error | **Fail closed** — unknown lock state denies with 503 |
| Local device thief | APK data at rest | OPFS/SQLite under app sandbox + optional PIN screen |

## Self-interrogation → answers (audit Q&A)

1. **Can a zip export write files outside the media folder (zip-slip)?**
   No — tested with `../`, `..\\`, and absolute-path entries. Filenames are
   reduced to a sanitized basename, chat ids must match `^[a-z0-9]{1,64}$/i`,
   and the resolved path must stay inside `db/media/<chatId>` (belt-and-braces
   `path.resolve` + prefix check). Attack entries landed *inside* the chat
   folder under sanitized names; nothing escaped.

2. **Can a zip bomb exhaust memory?**
   No — tested with a 300 MB-declared entry (306 KB compressed): the
   decompressed size is read from archive metadata *before* inflation and
   rejected against per-entry (80 MB) and cumulative (600 MB) budgets. Import
   finished in 0.03 s. Oversized transcripts (25 MB txt) return HTTP 413.

3. **Can message text execute script (stored XSS)?**
   No — all message bodies render through React text nodes (no
   `dangerouslySetInnerHTML` on user content anywhere). Payloads
   (`<img onerror>`, `<script>`, `javascript:` URLs, 200 KB single lines)
   imported and rendered inert; the HTML/Text exporters escape before
   linkifying, and only `http(s)` URLs become `<a href>`.

4. **What about scriptable media served back to the browser (SVG/HTML/GIF/PDF)?**
   Those MIME types are served with `Content-Security-Policy: sandbox` and
   `X-Content-Type-Options: nosniff` — verified live on a hostile SVG
   (`onload` exfil script): script cannot run even when the file is opened
   directly on the origin.

5. **Can `/api/media/...` read arbitrary server files (path traversal)?**
   No — `..%2f`, `%5c`, and over-long encodings all return 404 (tested), and
   the DB file itself is unreachable through the media route.

6. **Can the link-preview scraper be used for SSRF?**
   Blocked for loopback/private/link-local/metadata targets, including
   decimal/hex/octal integer hosts, IPv6 loopback, `*.local/.internal`, and
   every redirect hop (max 5, re-validated). Tested: `127.0.0.1`,
   `169.254.169.254`, `0x7f000001`, `2130706433`, `[::1]` → all refused;
   `https://example.com` works. Response bodies are capped at 1 MB with a 4 s
   timeout; images resolved from `og:image` are now restricted to http(s).

7. **Is there authentication? What happens if I host this publicly?**
   The app is a **single-user local tool by design**. Every data route is
   guarded by `assertAppUnlocked` — a no-op until you enable the PIN lock.
   **If you host it, enable Settings → Privacy → App lock first** (scrypt-hashed
   PIN, HMAC-signed HttpOnly `SameSite=Lax` unlock cookie — `Secure` when the
   request arrives over HTTPS — 12 h TTL).

   Lock hardening (audited after the v1.9.1 reset-bypass fix):
   - **Reset is owner-only.** `POST /api/auth/lock {"action":"reset"}` used
     to wipe the lock without any credential — a network client could
     disable the lock and read the archive. Reset now succeeds only with
     (a) the current PIN, (b) a *provably local connection* — loopback
     socket AND every `X-Forwarded-For` hop loopback (the owner at the
     server console / SSH tunnel, including through honest appending
     proxies), or (c) the operator-set `WA_LOCK_RESET_TOKEN` header. A
     remote caller with none of those gets 403 and the lock stays armed.
   - **Loopback cannot be spoofed.** Locality is decided from the TCP socket
     address captured at the Node http layer (`src/instrumentation.ts`),
     not from `X-Forwarded-For`; a client-sent `x-wa-socket-remote-addr`
     header is ignored unless the hook provably overwrote it. Local recovery
     additionally requires every `X-Forwarded-For` hop to be loopback — an
     honest appending proxy always appends the real client address, so a
     remote client can never forge an all-loopback chain (fake loopback
     entries it prepends are exposed by the appended tail).
   - **PIN guessing is throttled** — 5 wrong PINs within 15 minutes lock
     that client out for 15 minutes (`429`, `Retry-After`, correct PIN
     included, shared across verify/change/disable/reset).
   - **The gate fails closed.** If the lock state cannot be read (DB error),
     data routes deny with 503 instead of silently treating the app as
     unlocked.
   - Forgotten-PIN recovery for the machine owner: see
     [Forgotten PIN recovery](#forgotten-pin-recovery-server-instances).

   Full flow tested live: enable → 401 everywhere → wrong PIN 401 (then
   429 after 5 tries) → unauthenticated reset 403 → correct PIN unlocks →
   media/cookies verified → disable restores access. Automated regression
   tests: `bun run test:security` (`src/lib/lock-security.test.ts`).

8. **Can another website make calls into my running instance (CSRF)?**
   Mutating (`non-GET`) `/api/*` requests carrying a mismatched `Origin`
   header are now rejected by `src/middleware.ts` (403). Non-browser clients
   (curl, server-to-server) send no Origin and are unaffected. The unlock
   cookie is additionally `SameSite=Lax`, so cross-site form posts cannot ride
   an authenticated session.

9. **Are server-side secrets exposed to the client?**
   No — the client bundle was scanned (`AIza…`/`sk-…`/provider key names:
   zero hits). Built-in AI runs server-side via the SDK; the BYO Gemini key
   path passes through an `x-gemini-key` request header and is never persisted.
   On the device transport the key lives only in the user's own browser/APK
   storage (by design, it is their key).

10. **Can the AI/ASR endpoints be abused for cost/DoS? Can the PIN be brute-forced?**
    AI/ASR are rate-limited: `/api/ai` 20 req/min, `/api/transcribe`
    10 req/min per client, with lazy bucket pruning (shared helper
    `src/lib/rate-limit.ts`). Raw provider errors are never returned to
    clients; ffmpeg runs through `execFile` (no shell) with timeouts.
    The app-lock PIN uses a separate, stricter limiter
    (`src/lib/pin-throttle.ts`): 5 failed attempts per client within 15
    minutes trigger a 15-minute lockout, keys are derived from the
    unspoofable socket address (or the trusted rightmost `X-Forwarded-For`
    entry when `WA_TRUST_PROXY=1`), and a wrong-PIN response always pays a
    250 ms delay on top of the scrypt cost.

11. **SQL injection?** Prisma parameterizes everything; the one raw query
    (`/api/memories`) uses a tagged template with bound parameters — safe.

12. **Command injection?** All child processes (`ffmpeg` poster generation,
    audio transcode) use `execFile` with fixed argument arrays and timeouts —
    no shell interpolation of user input.

## Fixes applied in this audit (v1.0.1)

1. `next.config.ts` — baseline security headers on every response:
   `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
   `Referrer-Policy: strict-origin-when-cross-origin`,
   `Permissions-Policy: camera=(), geolocation=(), microphone=(self)`.
2. `src/middleware.ts` — cross-origin mutating API calls rejected (CSRF).
3. `src/app/api/ai/route.ts` — 20 req/min rate limit (new shared helper
   `src/lib/rate-limit.ts`; `/api/transcribe` refactored onto it).
4. `src/app/api/link-preview/route.ts` — `og:image` results restricted to
   http(s) schemes.
5. `src/app/api/wallpaper/[name]/route.ts` — added `nosniff`.
6. Removed the leftover unguarded `/api` hello-world scaffold route.

## Forgotten PIN recovery (server instances)

The lock never permanently locks the owner out, but a PIN-less reset is
now owner-only. On a server install, if you forget the PIN, pick **one** of
these — all require access only the machine's operator has:

1. **At the server console / SSH** (the request provably originates on
   the machine — loopback socket, loopback-only forwarded chain):
   ```bash
   curl -X POST http://localhost:3000/api/auth/lock \
        -H 'Content-Type: application/json' -d '{"action":"reset"}'
   ```
   A loopback socket with a loopback-only forwarded chain is honored as local recovery.
2. **Recovery token** (works from any client): set a one-time token in the
   server environment, use it once, then remove it:
   ```bash
   export WA_LOCK_RESET_TOKEN="$(openssl rand -hex 32)"   # then restart the app
   curl -X POST https://your-host/api/auth/lock \
        -H 'Content-Type: application/json' \
        -H "x-wa-recovery: $WA_LOCK_RESET_TOKEN" \
        -d '{"action":"reset"}'
   unset WA_LOCK_RESET_TOKEN                                # and restart again
   ```
3. **Directly in the database** (no running-app cooperation needed):
   ```bash
   sqlite3 db/custom.db "DELETE FROM AppSetting WHERE key IN
     ('lock:enabled','lock:pin:hash','lock:pin:salt')"
   ```

The device transport (APK / offline mode) is unaffected: its lock lives
entirely in the browser/WebView, so the in-app "Forgot PIN?" reset keeps
working without a PIN there.

## Residual risks & recommendations (accepted / future work)

- **No-auth mode is still intentional** for local use; always enable the PIN
  lock before exposing the app beyond localhost. (A formal `APP_PIN` env gate
  for headless deployments is a beta candidate.)
- **Setting a lock is not itself authenticated.** On an unlocked, hosted
  instance a network client can still *enable* a lock with its own PIN
  (annoyance/DoS, no confidentiality impact — the same client could read
  everything anyway while no lock is set). The proxy origin check blocks
  browser-based cross-site attempts.
- In-memory rate limits (AI/ASR and the PIN lockout) reset on restart and are
  per-process — fine for a single-user tool; use a real limiter only if
  multi-tenant ever happens.
- **Local-recovery caveat:** loopback reset trust requires the whole
  forwarded chain to be loopback. If you run a reverse proxy on the same
  machine that strips `X-Forwarded-For` (or hardcodes it to a loopback
  value), proxied remote requests become indistinguishable from console
  access — use the `WA_LOCK_RESET_TOKEN` path in such setups instead.
  Behind a proxy that does set `X-Forwarded-For`, also set `WA_TRUST_PROXY=1`
  so PIN throttling keys on the real client rather than the proxy's address
  (proxied clients otherwise share the proxy's throttle bucket).
- No strict CSP on HTML documents (Next.js inline bootstrap scripts make a
  nonce-based CSP a non-trivial change; candidate for beta).
- Dependency scanning (CVE watch) is manual — consider `bun audit` in CI.
- The APK export ships no server; its attack surface is the WebView + OPFS
  data, sandboxed by the Android app sandbox.

## Verification summary (all live-tested)

| Test | Result |
|---|---|
| zip-slip (`../`, `..\\`, absolute, media-referenced) | contained ✅ |
| zip bomb (300 MB declared / 306 KB real) | rejected pre-inflation ✅ |
| 25 MB transcript inside zip | HTTP 413 ✅ |
| media path traversal (3 encodings) | 404 ✅ |
| hostile SVG stored XSS | `CSP: sandbox` + `nosniff` ✅ |
| XSS payloads in messages (browser) | inert (React text) ✅ |
| SSRF (6 probe forms) | refused ✅ |
| PIN lock full flow | 401/200 transitions correct ✅ |
| unauthenticated lock reset (remote) | 403, lock stays armed ✅ (`test:security`) |
| lock reset with current PIN / loopback / token | 200 ✅ (`test:security`) |
| PIN brute-force (5 wrong → lockout) | 429 + Retry-After ✅ (`test:security`) |
| lock gate during DB error | 503 fail-closed ✅ (`test:security`) |
| spoofed socket header / XFF-present loopback | ignored / rejected ✅ (`test:security`) |
| unlock-cookie flags (HttpOnly, SameSite, Secure@https) | verified ✅ (`test:security`) |
| client bundle secret scan | clean ✅ |
| security headers on responses | present ✅ |
