# Offline architecture — decision record

**Goal:** WhatsApp Viewer should work with **no internet at all** — as an
installed PWA *and* as a real Android APK — while keeping the entire v1.0 UI.

## Why the current app can't go fully offline

Today the data lives in a **server-side** SQLite database + on-disk media.
The browser/PWA only *caches* what it has seen (recent chats in localStorage,
media in the service worker). Offline today = read-only snapshot; any write
(send, react, import, lock) needs the server. An APK pointed at a hosted URL
has the same dependency.

Phones also cannot run the Next.js server itself (Node + Prisma + file system).

## The chosen path: local-first refactor (keeps 100% of the UI)

Move the **data layer onto the device**; the React UI stays as-is.

| Concern | Browser (PWA) | Android (APK) |
|---|---|---|
| Database | SQLite compiled to WASM, persisted via OPFS | Native SQLite (`@capacitor-community/sqlite`) — same schema |
| Media | Blobs in OPFS / DB | Files in app storage |
| App lock | PIN verified with WebCrypto, fully on-device | Same |
| AI (translate/ask/…) | Direct Gemini calls with the user's free key — **online-only, optional** | Same |
| Speak (TTS) | ✅ already offline (browser speech synthesis) | ✅ device voices |
| Import | Client-side `.zip` parsing → insert locally | Same |

**Rejected alternative:** rewriting the whole frontend in React Native "to get
offline". RN shares no UI code with this project (no DOM/CSS/shadcn), so it
means rebuilding all 50+ components, dialogs and effects — months of work and
a second app to maintain — to reach the same offline result the local-first
refactor achieves on the existing codebase. The pure-TypeScript logic
(WA export parser, export generators, persona engine, AI prompts) is portable
either way, so nothing is lost by *not* choosing RN now.

## Phases

- **Phase 1 — storage seam ✅ DONE:** `src/lib/data/types.ts` defines the
  DataClient interface; `src/lib/data/local/` implements it fully on-device —
  sql.js (SQLite WASM, loaded from /sql-wasm.* assets, copied by
  scripts/copy-sql-wasm.mjs), the Prisma schema ported to plain DDL
  (schema.ts), the database file persisted to OPFS with an IndexedDB
  fallback (debounced autosave + flush on pagehide), media blobs in an
  IndexedDB store, and a complete client-side zip importer
  (local/import.ts) that reuses the server's parser and guards. UI entry:
  "On this device" card in Data & storage (import → status → per-chat
  delete → wipe). Verified in-browser: import 16 messages + 4 media →
  counts exact → survives full page reload via OPFS.
- **Phase 2 — feature swap ✅ DONE:** every chat/message/media/scheduled/
  search/starred/media-gallery/forward/memories/import/demo/backup/lock flow
  runs through the DataClient seam with a user-facing storage-mode switch
  (Settings → Data & storage: Server ☁ / This device 📱).
- **Phase 3 — offline APK ✅ DONE:** the Capacitor shell no longer points at
  a hosted URL — it **bundles the whole built frontend** and runs the device
  transport exclusively:
  - `bun run build:capacitor` (scripts/build-capacitor.mjs) static-exports
    the app (`CAP_EXPORT=1` branch in next.config.ts, `src/app/api` moved
    aside for the build) into `capacitor-web/`; GitHub Actions builds the
    export before `cap sync` on every push.
  - Inside the shell the native bridge injects `window.Capacitor` — detected
    by `isNativeApp()` (storage-mode.ts) so the DEFAULT storage mode is
    'device' and Settings shows a static "on-device storage" card instead of
    the mode switch.
  - AI runs **directly against Google Gemini** with the user's free key
    (src/lib/device-ai.ts + the shared ai-prompts.ts — the same prompt
    assembly the server route uses). No /api/ai in the loop.
  - Stats + word cloud compute **on-device** (isomorphic stats-compute.ts /
    wordcloud.ts — the API routes share the exact same code).
  - Custom wallpaper photos embed as self-contained JPEG data: URLs on the
    device path (progressively downscaled to fit localStorage); AI wallpaper
    generation is server-only and shows a friendly note instead.
  - Boot-order fix: DataProvider exposes `modeResolved`; mount effects
    (chat list, scheduled poller) wait for it so a device-mode app never
    fires one doomed server request at startup.
  - **Native SQLite not needed for v1:** the SQLite-WASM + OPFS engine runs
    as-is in the Android System WebView (async OPFS + IndexedDB fallback);
    `@capacitor-community/sqlite` stays a Phase-4 hardening option for
    older WebViews.
- **Phase 4 — polish ✅ DONE (with two options deliberately deferred):**
  - **Offline-aware AI states:** every AI surface (Translate/Explain in
    AIToolsDialog, Ask, TL;DR summarize, persona reply suggestions, the
    Settings key test, and the device transport itself) pre-checks
    `navigator.onLine` (src/lib/online.ts) and fails fast with
    "You're offline — AI needs internet. Everything else keeps working on
    this device." instead of a raw network error. The global offline banner
    (Task 7-e) already covers general offline awareness.
  - **On-device voice transcription (Whisper-WASM):** the Transcribe button
    now works on the device transport — previously it was server-only and
    hidden. `src/lib/whisper-asr.ts` runs Whisper tiny (quantized,
    multilingual) fully in the browser via transformers.js + ONNX Runtime
    WASM: voice-note blob → WebAudio decode → 16 kHz mono → WASM inference.
    - Runtime vendored to `public/whisper/` by scripts/copy-whisper.mjs
      (same bundler-free script-tag pattern as sql.js); served offline via
      the service worker's stale-while-revalidate list.
    - Model (~45 MB, one time) downloads from the HF CDN on first use with a
      byte-accurate progress UI (in the bubble and in Settings → AI), then
      lives in the browser Cache API; transcripts are cached in localStorage
      per message id (instant repeats, capped store).
    - Settings → AI gains a "Voice transcription (offline)" model manager:
      status pill, Download / Remove (removes model + cached transcripts).
    - Verified end-to-end in the browser: import zip with a real voice note →
      transcribe online (91% → 100% download → transcript) → **transcribe
      again with the network fully off — full inference, zero requests**.
  - *Deferred by design (kept as options):* `@capacitor-community/sqlite`
    native driver (the WASM+OPFS engine works in the Android WebView; the
    native driver remains a hardening path for very old WebViews) and a
    sync server (only relevant if multi-device is ever wanted).

## What offline still can't do

AI features (translate/explain/ask/summarize/wallpapers) call a model — those
stay online-only by nature (voice-note transcription is the exception: since
Phase 4 it runs on-device with Whisper, after a one-time model download).
Everything else — reading, sending, reactions, notes, lock, export, import,
transcription — becomes fully device-local.

## Hosting impact

No Turso/Vercel-DB migration is needed on this path: the hosted site becomes a
thin, free entry point (PWA install + optional AI), while the data never leaves
the device. Hosting cost stays $0.

## App stores & distribution (F-Droid / IzzyOnDroid / iOS)

**F-Droid & IzzyOnDroid compliance after this refactor:**

- ✅ License: MIT (permissive, accepted by both).
- ✅ Self-contained FOSS app: bundles real functionality (local DB, import,
  export) — **not** a mere website wrapper, which F-Droid would reject.
- ✅ No proprietary SDK bundled: the sandbox AI SDK is removed on this path;
  Gemini is a user-key network API (declare the `NonFreeNet` anti-feature).
- ⚠️ Build must be reproducible from source with standard npm/node (keep an
  npm fallback for the bun-specific scripts) — F-Droid builds apps itself.
- ⚠️ Trademark: "WhatsApp Viewer" may draw a Meta complaint; a
  "… for WhatsApp"-style distinct name is safer for store listings.
- ✅ IzzyOnDroid accepts MIT apps built from source; faster inclusion than
  main F-Droid.

**iOS later:** same codebase via the Capacitor iOS platform — no rewrite.
Costs are Apple-side: a Mac (or CI macOS runner) to build, $99/yr for App
Store/TestFlight (or free 7-day sideloading). Local-first suits iOS well
because Safari/PWA storage is eviction-prone — the native shell protects data.

**Distribution without any hosting:** APKs can ship via GitHub Releases
(free) + F-Droid/IzzyOnDroid; the hosted site becomes optional (a thin
install page / demo), not infrastructure.
