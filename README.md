# WhatsApp Viewer 🟢

**Read, explore and enrich your exported WhatsApp chats — private & local.**

WhatsApp Viewer is a local-first web app (installable as a PWA) that turns your
WhatsApp chat exports (`.zip` with media or `.txt`) into a beautiful, familiar
chat experience — with AI superpowers, voice notes, reactions, privacy lock and
more. Everything stays on your device: no account, no cloud, no tracking.

**Version: v1.0** 🎉

---

## ✨ Features

**Reading & exploring**
- Import one or many exports (`.zip` with media, or `.txt`) — with preview before import
- Authentic chat UI: bubbles, day separators, replies, reactions, starred messages
- Rich media: photos, videos, documents, **location & contact cards**, call cards
- Voice notes: play with waveform + speed control, **transcribe to text** (on-device Whisper offline, or AI on the server)
- Unread badge, unread divider with "jump to first unread", jump to date, timeline scrubber
- Global search, per-chat search, word cloud, cross-chat Insights dashboard
- "On this day" memories — see what happened on today's date in past years
- Telegram-style floating mini-player that keeps audio playing across chats

**Messaging (demo & imported chats)**
- Send messages, photos, videos, audio, documents & polls
- One-second hover quick-actions: reply, react, forward, star, copy
- Scheduled messages — compose now, deliver later
- Simulated replies in demo chats (AI or offline personas)
- Long-press a message → **Speak** (text-to-speech), translate, explain

**AI toolbox** (bring your own Gemini key, or built-in provider where available)
- Translate any message · Explain context & slang · Ask AI about the chat
- "Summarize this chat" TL;DR · AI-generated chat wallpapers

**Privacy & data**
- Server-verified **App Lock (PIN)** — 4–8 digits, verified server-side
- Everything stored in a local SQLite database — nothing leaves your device
- Export chats back out: `.txt`, `.zip` (with media), standalone `.html` (offline voice notes), or print
- Download a full JSON backup; optional backup reminders
- Data & storage dashboard — see exactly what each chat uses

**App-like experience**
- Installable PWA — works offline for recently opened chats
- Dark mode, light mode, chat wallpapers, text size & font settings

---

## 🚀 Quick start

**Prerequisites:** [Node.js 20+](https://nodejs.org) and [Bun](https://bun.sh)
(or use npm/pnpm — scripts work with any runner).

```bash
# 1. Install dependencies
bun install

# 2. Create your env file
cp .env.example .env

# 3. Create the database
bun run db:push

# 4. Start the app
bun run dev
```

Open http://localhost:3000 and click **Try demo chats** to explore instantly —
no import needed. To use your own chats: in WhatsApp, open a chat →
**⋮ → More → Export chat → with media**, then drop the `.zip` into the app.

---

## 🧱 Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| UI | Tailwind CSS 4 + shadcn/ui (New York) + Lucide icons |
| Database | Prisma ORM + SQLite (local file) |
| AI | Gemini (user key) / built-in provider — translate, explain, ask, summarize, TTS, ASR, image generation |
| Realtime-ish | Scheduled-message dispatcher, simulated replies, PWA service worker |

---

## 🔒 Privacy model

- Chats, media and settings live in `db/` on your machine.
- The only network calls are the AI features you trigger — and if you set a
  Gemini key, requests go to Google's API directly.
- App Lock is verified on the server that runs the app (your machine), with an
  httpOnly cookie session.

---

## 📱 Android APK (fully offline, standalone)

The repo ships with a ready Capacitor Android shell **plus a GitHub Actions
workflow that builds a STANDALONE, installable APK on every push** — no
Android Studio needed on your machine, and **no hosted URL either**: the
entire app (UI + on-device SQLite) is bundled inside the APK.

1. Push to GitHub → open the **Actions** tab → latest run → download
   **whatsapp-viewer-apk** → install on any Android phone
   (allow "install unknown apps" when prompted).

The APK works with **no internet at all**: chats live in an on-device SQLite
database (OPFS-persisted), importing, searching, stats, lock and backups all
happen on the phone. The only online-optional features are the AI tools —
add your own free
[Gemini API key](https://aistudio.google.com/apikey) in Settings → AI and
they call Google directly (optional). **Voice notes transcribe on the phone
itself** (on-device Whisper, Settings → AI → one-time ~45 MB model download) —
no server, no API key, works in airplane mode.

Build it yourself with `bun run build:capacitor` (static-exports the app into
`capacitor-web/`) followed by `bunx cap sync android` and a Gradle debug
build.

---

## ☁️ Deploying

The app ships as a standalone Next.js build (`bun run build` → `bun run start`).
Because it stores data in a local SQLite file and on-disk media, a classic
serverless host (Vercel's free tier) needs small adaptations for persistence
(e.g. Turso/libSQL + object storage). A tiny always-free VM (e.g. Oracle Cloud
Always Free) runs it as-is. See the roadmap for the planned cloud-ready mode.

---

## 🗺️ Roadmap (v1.1 candidates)

- Message editing / unsend with "edited" tags
- Export/import round-trip for location & contact cards, scheduled messages
- Cloud-ready persistence mode (one-click deploy to free hosts)
- Custom offline page + update toast for the PWA
- Multi-language UI (i18n)
- Media gallery grid + per-media favorites
- One-bundle multi-device transfer

---

## 📄 License

MIT — see [LICENSE](LICENSE).
