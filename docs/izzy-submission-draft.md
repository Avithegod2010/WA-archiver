# IzzyOnDroid submission — paste-ready draft

**Everything below is filled in and fact-checked against the v1.2.0 release.**
You only need a (free) GitLab account and ~10 minutes.

---

## How to submit (10 minutes)

1. Create/sign in to a GitLab account: <https://gitlab.com/users/sign_up>
2. Go to <https://gitlab.com/IzzyOnDroid/repo/-/issues/new> and pick the
   **"App request"** (app inclusion) template.
3. Paste the block below into the description (trim anything the template
   already covers), title it: `App request: Chat Archiver`.
4. Submit. Typical review time: a few days. Once accepted, Izzy indexes the
   **v1.2.0** release immediately and picks up every future release
   automatically (it watches your GitHub releases; versionCode must increase).

---

## Paste-ready issue text

```markdown
### App request: Chat Archiver

**App name:** Chat Archiver
**Package name:** io.github.avithegod2010.chatarchiver
**Source code:** https://github.com/Avithegod2010/WA-archiver
**Issue tracker:** https://github.com/Avithegod2010/WA-archiver/issues
**License:** MIT
**APKs:** signed release APKs attached to GitHub Releases
(latest: https://github.com/Avithegod2010/WA-archiver/releases/tag/v1.2.0 —
WhatsApp-Viewer-v1.2.0-release.apk, versionCode 3, APK Signature v2)
**Changelogs:** fastlane format, checked in at
fastlane/metadata/android/io.github.avithegod2010.chatarchiver/en-US/ (title, short and
full descriptions, changelogs for versionCodes 1–3, icon + 5 phone
screenshots)

**Summary:** Import standard WhatsApp chat exports (.zip/.txt, media
included) and read them in a familiar, polished WhatsApp-style interface.

**Full description:**

Chat Archiver turns your exported WhatsApp chats into a beautiful,
private reading experience — no account, no cloud, no tracking.

- Import in seconds: drop the export zip you already have; preview before
  import; multiple chats at once; media included
- Authentic chat UI: bubbles, replies, reactions, photos, voice notes with
  waveforms, documents, locations; 9 themes, custom accent colors,
  wallpapers, bubble styles
- Find anything: global search (Ctrl/⌘+K), per-chat filters (date ranges,
  starred, regex), jump-to-date calendar, activity heatmap
- Understand your chats: cross-chat Insights dashboard, per-chat stats,
  year-in-review rewind, storage breakdown, "On this day" memories
- Voice notes transcribed on-device (Whisper, fully offline after a
  one-time model download)
- Optional AI toolbox with your own Gemini key, talking straight to Google
- Private by architecture: everything in a local SQLite database; no
  analytics, no trackers, no accounts; PIN app lock verified locally;
  export back out to txt/zip/HTML/JSON anytime

Privacy policy: https://github.com/Avithegod2010/WA-archiver/blob/main/PRIVACY.md
Web app (same codebase, runs in the browser):
https://avithegod2010.github.io/WA-archiver/app/

**Categories:** Communication / Utilities
**Anti-features:** none — no tracking, no ads, no non-free dependencies,
no proprietary blobs (deps: AndroidX, Capacitor, SQLCipher, Kotlin)
**Target SDK:** 36 · **Min SDK:** 24
**Notes:** APKs are built reproducibly-ish by GitHub Actions from the
tagged commit (workflow: .github/workflows/android-apk.yml); signing key
is ours and stays constant. Source corresponds 1:1 to the released APK —
the bundled web assets are built from the same tree by
scripts/build-capacitor.mjs during the CI build.
```

---

## Checklist before you hit Submit on GitLab

- [x] Signed release APK on GitHub Releases (v1.2.0, versionCode 3)
- [x] LICENSE (MIT) in repo root
- [x] fastlane metadata: title / descriptions / changelogs / icon / screenshots
- [x] Privacy policy: PRIVACY.md (linked from README + landing page)
- [x] No trackers/analytics (dex-scanned v1.2.0 APK — zero hits)
- [x] Issue tracker open
- [ ] **(You)** GitLab account + submit the issue
- [ ] **(You)** After acceptance: keep tagging releases (`v1.2.1`, …) — Izzy auto-updates
