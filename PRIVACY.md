# Privacy Policy

**WA Archiver** — https://github.com/Avithegod2010/WA-archiver
**Effective date:** 2026-10-18 · **App version:** 1.2.0+

## The short version

Your chats never leave your device. There is no account, no server that
stores your data, no analytics, no ads, no trackers — by design, not by
policy. The app works fully offline.

## What the app stores, and where

| What | Where |
|---|---|
| Imported chats, media, bookmarks, settings | A SQLite database **on your device** — inside the app sandbox on Android; in your browser's OPFS/IndexedDB storage when running as a web app |
| App preferences (theme, accent, wallpaper) | Your device's local storage |
| Optional app-lock PIN hash | Your device only (hash, never the PIN) |

**Uninstalling the app / clearing site data deletes everything.** The app's
built-in export (txt / zip / HTML / JSON backup) is the only data that ever
leaves the device — and only when *you* trigger it and *you* choose the
destination.

## Network access — only when you ask

The app makes **no** network calls on its own. The only exceptions, all
explicitly user-triggered:

1. **AI toolbox (optional)** — if you enter your own Gemini API key, requests
   go **directly from your device to Google's API** (`generativelanguage.googleapis.com`).
   The relevant message text is sent to Google under *your* key and *your*
   account. No intermediary server exists.
2. **Voice-note transcription (optional)** — the Whisper model (~45 MB) is
   downloaded **once** from the Hugging Face CDN; after that, transcription
   runs fully offline.

## What we collect

**Nothing.** No telemetry, no crash reporting, no usage statistics, no
fingerprints, no advertising IDs. This is verifiable: the source code is
public (MIT) and the APK can be scanned — you'll find no analytics or
tracking libraries.

## Children

The app does not collect any data from anyone, including children under 13.

## Third-party services summary

| Service | When | Data sent |
|---|---|---|
| Google Gemini API | Only if you enable AI features with your own key | The message text you choose to process |
| Hugging Face CDN | First transcription use only | Nothing (plain file download) |
| GitHub Pages | Serving the web app itself | Standard web hosting logs (GitHub's policy) |

## Contact

Questions or concerns? Open an issue at
https://github.com/Avithegod2010/WA-archiver/issues
