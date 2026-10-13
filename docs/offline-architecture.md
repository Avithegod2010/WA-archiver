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
- **Phase 2 — feature swap:** move chat list, messages, reactions, scheduled
  messages, settings, lock and export onto the local adapter, module by
  module (app stays working at every step).
- **Phase 3 — offline APK:** switch the Capacitor shell from `server.url`
  (remote) to **bundling the built frontend** + native SQLite. The APK becomes
  a truly standalone, no-internet app.
- **Phase 4 — polish:** offline-aware AI states, optional Whisper-WASM on-device
  transcription, optional sync server (only if multi-device is ever wanted).

## What offline still can't do

AI features (translate/explain/ask/summarize/transcribe/wallpapers) call a
model — those stay online-only by nature. Everything else — reading, sending,
reactions, notes, lock, export, import — becomes fully device-local.

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
