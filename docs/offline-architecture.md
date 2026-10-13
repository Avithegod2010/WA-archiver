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

- **Phase 1 — storage seam:** introduce a data-client interface; implement the
  on-device SQLite (WASM/OPFS) adapter; port the Prisma schema; rewrite import
  as client-side zip parsing.
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
