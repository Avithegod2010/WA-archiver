# Changelog

All notable changes to WA Archiver are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.8.0] — 2026-10-24

### Added
- **Encrypted backups** — optional passphrase on JSON backups. Downloads are
  sealed with AES-GCM-256 (PBKDF2-SHA256, 310k iterations, random salt+IV)
  entirely in the browser via WebCrypto; the passphrase never leaves the
  device. Restoring an encrypted file asks for the passphrase and rejects
  wrong ones without touching the database.
- **Smart collections** — three auto-computed, read-only chat folders:
  🖼️ Media (chats with media), ⏱️ Active this week, 📊 Biggest (top 5 by
  volume). No setup; they update live with the chat list.
- **Per-chat themes** — pick any of the 17 themes for a single chat from the
  Customize (wallpaper) popover. While that chat is open the whole look
  recolors; switching away snaps back to the app theme. Reset any time.

### Changed
- `mediaCount` now counts every media-typed message, even when the file
  wasn't included in the export ("not in export" tiles) — the Media smart
  collection and chat badges reflect what the chat actually contains.
- Chat tools → "Media gallery" opens the global Media Hub (shared albums +
  date-range filter) pre-filtered to the current chat.

### Fixed
- `/api/media-index` skipped media-typed messages without a stored file, so
  demo/synthetic media never appeared in the global Media Hub.

## [1.7.0] — 2026-10-23

### Added
- **Play Store App Bundle (.aab)** — tag releases now also build a signed
  `bundleRelease` artifact (`WA-Archiver-<tag>-release.aab`), ready to
  upload to Google Play. Play does the per-device splitting (ABI, density,
  language) itself, so Play installs download only what they need.
- **Auto-update checker** — the app reads the GitHub Releases API (at most
  once a day, localStorage-throttled) and shows a one-time
  "new version available" toast with a link to the release page whenever a
  strictly newer version is published. Silent on every failure path —
  offline APKs never nag.
- **Device-mode CSV & JSON chat export** — the per-chat `.csv` /
  `.json` exports now also work fully offline in the APK: in device
  transport the file is built client-side from the on-device database with
  the exact same spreadsheet schema as the server route
  (`idx, timestamp_iso, timestamp_local, sender, type, body, media_name,
  starred, edited, forwarded, pinned, reactions_summary`).
- **Starred-messages CSV export** — third button in the starred dialog,
  same columns as the chat CSV so starred rows and full-chat exports can
  live in one spreadsheet.

### Changed
- **On-demand voice transcription (~19 MB off the APK)** — the two ONNX
  Runtime WASM binaries are no longer bundled; `public/whisper/` now ships
  only the transformers.js bootstrap (~0.9 MB) plus a manifest, and the
  runtime fetches the matching binaries from jsDelivr on first use
  (cached by the browser Cache API, so transcription still works offline
  after the first run). Set `WHISPER_LOCAL_WASM=1` to restore the
  fully-bundled offline-out-of-the-box build. The ASR *model* (~45 MB)
  was already on-demand and is unchanged.
- **Media Hub: date-range filter** — from/to date pickers in the toolbar
  narrow the index to a period; a one-tap clear button resets it.

### Added (Media Hub)
- **Shared albums view** — new view toggle (layers icon) re-groups the
  filtered media into "albums": bursts of media shared in one conversation
  split on 45-minute gaps, with cover thumbnail, chat name, date range and
  item count; opening an album shows the same tile grid with multi-select,
  ZIP export and the lightbox.

## [1.6.0] — 2026-10-23

### Added
- **Year-in-review share cards** — the per-chat rewind dialog now exports a
  story-sized 1080×1350 PNG card: message count hero, busiest day, top
  month, longest streak, loudest voice, signature emoji and words typed —
  rendered fully on-device with the same teal-gradient look as the dialog.
- **Starred-messages export** — the starred dialog gains one-tap
  `.txt` and `.json` exports (timestamped, sender-attributed,
  filename slugged to the chat).
- **Three new languages — उर्दू (Urdu), मराठी (Marathi), தமிழ் (Tamil)** —
  the i18n layer now covers 5 languages × 277 strings with compile-time
  key parity. Urdu flips the whole interface RTL automatically.
- **Per-ABI APK builds** — releases now ship slim `arm64-v8a`,
  `armeabi-v7a` and `x86_64` APKs alongside the universal one;
  pick the arm64 APK on any modern phone.

### Changed
- **APK size audit** — removed the two never-used threaded ONNX Runtime
  WASM variants (the app is not cross-origin isolated and pins
  `numThreads=1`): whisper assets shrink 38 MB → 20 MB before
  compression, cutting the universal APK download.
  `WHISPER_ALL_VARIANTS=1` restores them for special builds.
- Version drift fix: the in-app version now tracks package.json/gradle
  (1.6.0) — the About dialog no longer lags a release behind.

## [1.5.1] — 2026-10-23

### Fixed
- **Server & device JSON backups keep reply relationships** — backup export
  now includes `replyToId` and restore writes it back (both the server
  SQLite transport and the on-device OPFS transport; backup format version
  bumped to 2, v1 files still restore). Reported with a full reproduction
  in issue #4 — thank you, @aichance!
- **PDF / HTML exports render Devanagari everywhere** — chats containing
  Hindi/Marathi/Nepali text embed a 45 KB subset of Noto Sans Devanagari
  (OFL 1.1) directly in the exported file, so print-to-PDF no longer shows
  tofu boxes on machines without Hindi fonts. Latin-only exports are
  unchanged and stay lightweight.

### Added
- **Word cloud PNG export** — one tap in the word-cloud dialog re-renders
  the ranked cloud to a 2160px canvas (title, word-count subtitle, footer)
  and downloads it — fully on-device.
- **Android launcher shortcuts** — long-press the app icon for Import
  chats, Search messages and Insights (localized labels in English and
  हिन्दी; Android 7.1+, older versions simply don't show them).
- **EXIF capture dates in the photo viewer** — when a photo's embedded
  DateTimeOriginal differs from the send time, the Lightbox shows a
  "Captured" pill (e.g. an old photo re-shared years later). Reads only
  the first 128 KB of the file; never network-heavy, never blocking.
- **हिन्दी copy pass** — smoother, more natural phrasing across chat rows,
  import progress and display settings; the word-cloud dialog is now fully
  translated (it previously had hardcoded English).
- versionCode 7.

## [1.5.0] — 2026-10-22

### Added — The power pack (18 upgrades)
- **Bulk chat actions** — multi-select chats from the sidebar (menu, hover action or long-press): delete, favorite, pin, move to folder and combined .txt export with per-chat headers.
- **Import merge & dedup** — re-importing an updated export offers "Merge into existing chat": title/source-file matching, per-message fingerprint dedup, and an honest "N new, M duplicates skipped" report (device and server transports).
- **Web Worker parser** — export parsing + zip text extraction moved off the main thread; large imports no longer freeze the UI. Automatic main-thread fallback.
- **Real voice waveforms** — voice notes decode actual audio peaks (48 buckets, LRU-cached) with the classic pseudo bars as fallback; seek/keyboard behavior unchanged.
- **PWA offline fallback** — branded offline page + service-worker navigation fallback (network-first; cache bumped to v3).
- **Android open/share intents** — the APK registers for .txt/.zip VIEW, SEND and SEND_MULTIPLE; files route into the import flow via a new JS bridge.
- **Theme studio** — visual preview cards for all 17 themes, "save current look" custom presets (theme + accent + bubble + density + wallpaper) with apply/delete, synced through personal-data transfer.
- **i18n groundwork** — locale framework with English + हिन्दी (61 keys), language picker in Settings, lang attribute sync; more surfaces migrate incrementally.
- **Fastest repliers** — new Insights panel: median reply time per person (6h window, ≥3 samples) plus your own median.
- **Landing page** — "Export from WhatsApp in 60 seconds" guide + 7-question FAQ.
- **Full reactions grid** — the long-press popup offers all 12 reactions in a 4×3 grid with a proper focus trap.
- **Videos tab** in the per-chat media gallery, with duration badges.
- **New shortcuts** — `m` opens the media hub, `Ctrl/⌘+Shift+F` searches across all chats; shortcut dialog updated.
- **Release automation** — tag builds extract the matching CHANGELOG section into the GitHub release body.
- **Accessibility** — long-press sheet focus trap, real version labels, checkbox roles in select mode, spoken-form aria labels on new panels.
- versionCode 6.

## [1.4.0] — 2026-10-19

### Changed — Name restored to WA Archiver
- **Renamed back to WA Archiver** to match the repository
  (`Avithegod2010/WA-archiver`) after the brief v1.3.0 detour as
  "Chat Archiver". Name-safety check: names are not copyrightable (no
  copyright issue), the "WA" abbreviation keeps the WhatsApp trademark out
  of the app name, and the original neon-bubble icon stays — it contains no
  WhatsApp logo elements (the usual F-Droid takedown trigger).
- **New application ID:** `io.github.avithegod2010.waarchiver`
  (was `io.github.avithegod2010.chatarchiver`). ⚠️ Side-loads as a new
  app — uninstall "Chat Archiver" first. PWA installs are unaffected
  (same origin; the name updates in place).
- GitHub release v1.3.0 re-titled "WA Archiver v1.3.0" and its APK asset
  renamed for consistency; v1.3.0 notes above kept as history.
- versionCode 5.

## [1.3.0] — 2026-10-19

### Changed — Rebrand
- **Renamed to Chat Archiver** (formerly WhatsApp Viewer). The "WhatsApp"
  trademark stays out of the app name and package ID ahead of store
  submissions (IzzyOnDroid / F-Droid); descriptions keep descriptive
  "exported WhatsApp chats" wording.
- **New application ID:** `io.github.avithegod2010.chatarchiver`
  (was `com.whatsappviewer.app`). ⚠️ Updating installs side-loads as a
  new app — uninstall the old one first.
- **New app icon** — dark carbon tile with neon chat bubble; new adaptive
  launcher icons, round icons and splash screens; refreshed PWA icons and
  favicon.
- versionCode 4.

## [1.2.0] — 2026-10-17

### Added — Data portability
- **Personal data export/import** — Settings ▸ Personal data: one file
  carries your themes, accent, bubble style, density, clock, text size,
  font, wallpapers (including per-chat photos), bookmarks, folders,
  favorites and read-state to another device. Chats ride with the full
  backup; app-lock PIN and AI keys never leave the device.
- Inline confirmation with export stats before anything is applied.

### Added — First-run & PWA
- Fresh installs get a welcome with **Try demo chats** and **Import a
  file** CTAs plus trust chips; returning users keep the quiet hint.
- Browser/PWA chrome color now **follows the active theme and accent**
  (dynamic theme-color, incl. system-scheme flips in Auto mode).
- Custom accent no longer flashes on reload (pre-paint boot script).
- User guide: docs/user-guide.md (export steps, migration, troubleshooting).

### Fixed
- Removed a stale unreferenced manifest.json that could confuse PWA audits.

## [1.1.0] — 2026-10-17

### Added — Personalization
- **17 app themes** (WhatsApp, Telegram, Sunset, Violet, Rose, Ocean, Graphite,
  Midnight, Espresso, Terracotta, Wine, Forest, Amber, Citrus, Lavender,
  Cyber, Mono) — each with matched light & dark palettes that recolor the
  header, bubbles, buttons and charts.
- **Bubble styles** — Classic / Round / Sharp corner shapes, live-previewed,
  with tails still squaring their corner at any radius.
- **Bubble density** — Cozy / Compact spacing for more or less breathing room.
- **Clock format** — Auto (follow device) / 12-hour / 24-hour, unified across
  bubbles, chat list, galleries, search and reading mode.
- **Extra-large reading text size** alongside the existing scale.
- **Wallpaper studio** — solid colors, 12 color-agnostic patterns, designed
  gradient presets, photo upload with dim / blur / contrast / brightness /
  saturation tuning; per-chat overrides over an app-wide default.

### Added — Exploration & memory
- **Year in Review rewind** — a wrapped-style per-chat recap: busiest day,
  most active month, longest streak, signature emoji, top words, and the
  loudest voice in group chats, per year or all time.
- **Date-range explorer** — pick a single day or a range on the heat-dot
  activity calendar and filter the conversation to exactly those days, with a
  live message count.
- **Bookmarks** — name any message as a clickable shortcut (per chat,
  device-local) from the context menu, hover actions or long-press sheet.
- **Heat-dot activity calendar** — every day cell in jump-to-date shows
  message volume at a glance, with a Today shortcut.

### Improved
- Header and sidebars decluttered — every secondary action lives in grouped
  menus (Modes / Browse / Tools / Customize) with a command palette
  (`Ctrl+K`).
- Timestamps, media badges and search results share one clock format.
- Onboarding guide rewritten as an interactive, animated tour with live
  buttons.

## [1.0.1] — 2026-10

### Fixed
- Signed release APK pipeline hardening and rolling `latest` pre-release
  rebuilds on every push to `main`.

## [1.0.0] — 2026-10

### Added
- Local-first chat viewer: import WhatsApp `.zip` / `.txt` exports (multiple
  at once) into an on-device SQLite database — nothing leaves your machine.
- Authentic reading experience — bubbles, replies, reactions, starred
  messages, unread divider, day separators, timeline scrubber.
- Media — photos, videos, documents, locations, contact cards; lightbox,
  gallery grid and media ZIP export; voice notes with waveform player,
  floating mini-player and offline on-device transcription (Whisper).
- Finding — global search (`Ctrl+K`), per-chat filters (date / starred /
  regex), jump-to-date, word cloud.
- Understanding — cross-chat insights dashboard, per-chat stats, storage
  breakdown, "On this day" memories.
- Messaging extras — send messages, photos, audio, docs & polls, scheduled
  messages, simulated replies in demo chats.
- AI toolbox (optional, your own Gemini key) — translate, explain slang,
  ask-the-chat, TL;DR, AI wallpapers; plus on-device text-to-speech.
- Privacy — server-verified PIN app lock; PWA install; dark & light mode;
  text size and font settings; export to `.txt` / `.zip` / standalone
  offline `.html`; full JSON backup & restore.
- Android APK (offline, standalone) built by GitHub Actions; signed APKs on
  `v*` tags.

[1.2.0]: https://github.com/Avithegod2010/WA-archiver/releases/tag/v1.2.0
[1.1.0]: https://github.com/Avithegod2010/WA-archiver/releases/tag/v1.1.0
[1.0.1]: https://github.com/Avithegod2010/WA-archiver/releases/tag/v1.0.1
[1.0.0]: https://github.com/Avithegod2010/WA-archiver/releases/tag/v1.0
