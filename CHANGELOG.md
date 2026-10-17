# Changelog

All notable changes to WhatsApp Viewer are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

[1.1.0]: https://github.com/Avithegod2010/WA-archiver/releases/tag/v1.1.0
[1.0.1]: https://github.com/Avithegod2010/WA-archiver/releases/tag/v1.0.1
[1.0.0]: https://github.com/Avithegod2010/WA-archiver/releases/tag/v1.0
