# User Guide — Chat Archiver

Everything you need to go from "a chat on my phone" to "a beautiful, private
archive I can actually read". Start to finish takes about two minutes.

---

## 1 · Export your chat from WhatsApp

WhatsApp builds the export; Chat Archiver just reads it. You can export any
chat (individual or group), with or without media.

### Android

1. Open the chat in WhatsApp.
2. Tap the **⋮ menu** (top right) → **More** → **Export chat**.
3. Choose **with media** (photos/voice notes included → bigger `.zip`) or
   **without media** (text only → small `.txt`).
4. Save the file somewhere you can find it — Downloads is fine.

### iPhone

1. Open the chat in WhatsApp.
2. Tap the **contact's name** (top) → scroll down → **Export Chat**.
3. Pick **with media** or **without media**.
4. Choose **Save to Files** (or share it straight to the viewer if you have
   the PWA installed).

> 💡 **Big chats?** "Without media" exports are much faster and still give
> you the full text history. You can always add media later with a second
> export — Chat Archiver merges imports into the same chat.

---

## 2 · Import into Chat Archiver

1. Open the app (web, PWA or the Android APK).
2. Drag the `.zip` / `.txt` anywhere onto the window, or use
   **Import** in the sidebar.
3. Check the preview — chat name, message count, media found — and confirm.

Multiple exports at once work fine; each becomes its own chat (or merges into
an existing one with the same name).

### No export handy?

Click **Try demo chats** on the welcome screen. Six fully-populated demo
chats (individuals + groups) load in one second so you can explore every
feature before touching your own data.

---

## 3 · Make it yours

- **Themes** — Display settings (`Aa` in the header) → *App theme*: 17 themes
  with matched light & dark palettes.
- **Accent color** — same panel → *Accent color*: any color you like, on top
  of any theme.
- **Appearance** — Auto (follows device) / Light / Dark.
- **Bubbles** — Classic / Round / Sharp corners, Cozy / Compact density.
- **Wallpapers** — per-chat or app-wide: solid colors, patterns, gradient
  presets, or your own photo with dim / blur / contrast tuning.

## 4 · Find things fast

| Want to… | Do this |
|---|---|
| Search everything | `Ctrl+K` (global search) |
| Find a message in one chat | 🔍 in the chat header |
| Jump to a day | Calendar icon → pick a day (heat dots show activity) |
| Explore a date range | Calendar → *Date range* → pick two days |
| Revisit the highlights | More menu → **Bookmarks**; bookmark any message via right-click / long-press |
| See the year at a glance | More menu → **Year in review** |
| Star a message | Hover → ⭐ (syncs into the full backup) |

## 5 · Move to a new device (data portability)

Two files give you a complete migration:

1. **Full backup** — Settings → *Backup & restore* → **Download backup**:
   every chat, message and starred flag.
2. **Personal data** — Settings → *Personal data* → **Export settings**:
   themes, bookmarks, wallpapers and preferences.

Copy both to the new device → import the backup first, then the personal
data. App-lock PIN and AI keys are intentionally **not** portable — set those
up fresh on the new device.

---

## Troubleshooting

**The import fails or shows 0 messages**
- Make sure it's a WhatsApp **export** (the `.zip`/`.txt` WhatsApp itself
  produces) — a forwarded "WhatsApp Chat.txt" someone sent you works too, but
  a screenshot or a photo of the chat will not.
- If the `.zip` was renamed or re-compressed, keep the internal `_chat.txt`
  file intact.

**Media is missing**
- "Without media" exports have no media by design — re-export *with media*
  and import again; it merges.

**Voice notes won't play / won't transcribe**
- Transcription (Whisper) is on-device and needs a first-time model download;
  it works offline afterwards. Check Settings → Speech.

**The app locked me out**
- App Lock is verified locally. Use your PIN; the lock can be disabled in
  Settings → Privacy while unlocked.

**The Android APK won't install**
- "Unknown sources" must be allowed for your browser/file manager
  (Android → Settings → Apps → Special access → Install unknown apps).
- The APK needs Android 8+.

**Notifications / install banner quirks**
- The PWA needs to be *installed* (browser → Install app) for notifications
  and the share sheet to work fully.

---

## Privacy model (the short version)

- Imports are parsed **on your device** and stored in a local database.
- No account, no analytics, no telemetry — nothing phones home.
- The only optional network calls: AI features (your own Gemini key →
  Google), link previews, and model download for on-device transcription.
- See [SECURITY.md](SECURITY.md) for the full audit and threat model.
