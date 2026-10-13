# Idea Backlog — 24 Refinements & Features (v1.1+)

> Candidate pool for the `beta` branch, grouped by theme. Items marked
> ⚡ = offline-capable (device transport), 🛡 = security/privacy relevant.

## AI & Smart Features

1. **Smart reply chips** — three context-aware quick replies above each chat;
   on-device heuristic suggestions (recent vocabulary + sender history) when
   offline, Gemini-generated when online. ⚡
2. **Relationship insights dashboard** — who initiates conversations,
   response-time heatmap, "left on read" streaks, ghosting detector per
   contact. Pure local computation. ⚡
3. **Semantic search** — "find where we planned the trip": local embedding
   index (MiniLM via WASM, same loader pattern as Whisper) over all messages;
   blends with the existing keyword search. ⚡
4. **AI daily digest** — auto-generated weekly recap card per chat (top
   moments, new people, mood shift), cached on-device. Online-only (AI).
5. **Message rewriting for Saved Messages** — draft a note, rewrite
   formal/casual/shorter before copying it out to the real WhatsApp. Online-only.

## Media & Attachments

6. **Media triage view** — global grid of every photo/video by month with
   multi-select → export or delete, plus a "storage used / space saved" meter. ⚡
7. **Voice-note upgrade** — waveform scrubbing, 0.5–2× speed, and
   resume-where-you-left playback for long notes. ⚡
8. **Image quick-fixes** — rotate/flip/auto-enhance (canvas filters, no
   upload) on any imported photo; changes stored as new versions, original
   never touched. ⚡
9. **Document OCR** — tesseract.js WASM so scanned documents/images become
   searchable text; pairs with the existing Documents tab. ⚡
10. **Storyboard strip** — auto-pick keyframes from long videos into a
    horizontally scrollable storyboard for fast navigation. ⚡

## Data, Sync & Portability

11. 🛡 **Encrypted portable sync file** — opt-in: export an end-to-end
    encrypted blob (passphrase-derived WebCrypto key) of all data; import on
    another device/browser. No server ever sees plaintext. ⚡
12. **Multi-profile spaces** — separate "Personal" / "Work" data partitions
    with instant switching and per-profile PINs. ⚡
13. **Selective import preview** — parse first, then choose date ranges,
    senders, and media types before committing an import. ⚡
14. **Rolling auto-backups** — keep the last 5 on-device snapshots with
    one-click restore; runs after every import. ⚡
15. **Dedupe & orphan cleaner** — detect duplicate messages from re-imports
    and media blobs no message references; safe-delete with dry-run report. ⚡
16. **Import adapters** — Telegram/Signal/iMessage export parsers feeding the
    same viewer (parser is already modular).

## UX & Polish

17. **Command palette (Ctrl/⌘+K)** — jump to chat, run actions, toggle
    settings, search across everything from one overlay. ⚡
18. **Reading mode** — distraction-free full-bleed chat view with adjustable
    font/line-height and gentle auto-scroll for long exports. ⚡
19. **Theme builder** — pick two colors → generates wallpaper + accent
    palette; export/import themes as tiny JSON. ⚡
20. **Per-chat home-screen shortcuts** — PWA shortcuts / share-target
    registration so a chat opens directly from the OS.
21. 🛡 **Accessibility & hardening pass** — full screen-reader tour,
    high-contrast theme, reduced-motion respect, and a CI step that runs
    `bun audit` + secret-pattern scan on every build.

## Platform & Distribution

22. **Native SQLite driver for the APK** — the deliberately deferred Phase-4
    hardening (`@capacitor-community/sqlite`) for very large exports; WASM+OPFS
    remains the fallback.
23. 🛡 **Headless access gate** — optional `APP_PIN` env var that forces the
    lock screen for hosted/self-host deployments without touching the UI.
24. **Release engineering** — Playwright smoke-test suite in CI gating the
    beta → stable merge, plus signed release APK builds (v2 signature).

---
*Picked for beta next (suggested order): 17 → 6 → 1 → 11 → 22.*
