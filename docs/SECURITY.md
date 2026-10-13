# Security Audit & Hardening Guide — WhatsApp Viewer

> Audit performed at v1.0 (pre-diverge), covering the hosted/server build
> (`next dev` / `next build` + `/api/*`) and the static APK export.
> Method: self-interrogation of the attack surface + live adversarial
> testing against the running app (curl + browser).

## Threat model (who can attack what?)

| Actor | Vector | Verdict |
|---|---|---|
| Malicious chat export (zip/txt) | Import path — hostile filenames, zip bombs, XSS in message text, scriptable media (SVG/HTML) | **Hardened** |
| Malicious web page | CSRF / cross-origin calls against a hosted instance | **Mitigated** (middleware + SameSite cookie) |
| Malicious URLs inside chats | Server-side link-preview scraper → SSRF | **Hardened** |
| Network observer | Cookie theft / sniffing | Hardened (HttpOnly, SameSite; use HTTPS when hosting) |
| Curious visitor | Open instance with no lock → reads/deletes chats | **Documented risk** — enable the PIN lock (below) |
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
   PIN, HMAC-signed HttpOnly `SameSite=Lax` unlock cookie, 12 h TTL). Full
   flow tested live: enable → 401 everywhere → wrong PIN 401 → correct PIN
   unlocks → media/cookies verified → disable restores access.

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

10. **Can the AI/ASR endpoints be abused for cost/DoS?**
    Both are rate-limited now: `/api/ai` 20 req/min, `/api/transcribe`
    10 req/min per client, with lazy bucket pruning (shared helper
    `src/lib/rate-limit.ts`). Raw provider errors are never returned to
    clients; ffmpeg runs through `execFile` (no shell) with timeouts.

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

## Residual risks & recommendations (accepted / future work)

- **No-auth mode is intentional** for local use; always enable the PIN lock
  before exposing the app beyond localhost. (A formal `APP_PIN` env gate for
  headless deployments is a beta candidate.)
- In-memory rate limits reset on restart and are per-process — fine for a
  single-user tool; use a real limiter only if multi-tenant ever happens.
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
| client bundle secret scan | clean ✅ |
| security headers on responses | present ✅ |
