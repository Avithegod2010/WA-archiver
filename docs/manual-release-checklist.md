# Manual release checklist — your side of the desk

Things only **you** (the account owner) can do. Everything code-side is
already automated by GitHub Actions (`.github/workflows/android-apk.yml`).

---

## 1. Play Console — upload the .aab (≈ 30 min first time)

The bundle is attached to every GitHub Release since **v1.7.0** as
`WA-Archiver-vX.Y.Z-release.aab`. Latest: <https://github.com/Avithegod2010/WA-archiver/releases/latest>

1. Create the app: <https://play.google.com/console> → **Create app**
   - Name: **WA Archiver** · Default language: English (US)
   - App or game: **App** · Free/paid: **Free**
2. **App signing**: keep Google-managed signing key (recommended).
3. **Play App Signing + upload key**: the CI signs the .aab with your
   release keystore — that becomes your *upload key*.
4. Store listing (reuse the copy in
   `fastlane/metadata/android/io.github.avithegod2010.waarchiver/en-US/`):
   - Short + full description, icon 512×512, **2+ phone screenshots**
     (see `docs/screenshots/`), feature graphic 1024×500.
5. **App content** forms (all standard for a local-only app):
   - Privacy policy URL: `https://github.com/Avithegod2010/WA-archiver/blob/main/PRIVACY.md`
   - Data safety: **No data collected, no data shared** (true — local-first)
   - Content rating questionnaire → Everyone
   - Target audience: 13+ · Ads: **No ads**
6. **Production → Create release**: upload
   `WA-Archiver-v1.8.0-release.aab` (versionCode 10), release notes =
   the v1.8.0 section of `CHANGELOG.md`.
7. Submit for review. First review typically 1–7 days.

> Tips: Data-safety "No data collected" matches PRIVACY.md exactly — reviewers
> check this. The AI toolbox uses *your own* Gemini key, so no API key is
> embedded in the APK (say so in the review notes if asked).

## 2. IzzyOnDroid submission (≈ 10 min)

Paste-ready text lives in **`docs/izzy-submission-draft.md`** (updated to
v1.8.0). Short version:

1. Free GitLab account → <https://gitlab.com>
2. New issue at <https://gitlab.com/IzzyOnDroid/repo/-/issues/new>
   → **App request** template → title `App request: WA Archiver`
3. Paste the draft → submit. Izzy then auto-indexes every future tag.

## 3. Real-device sanity test (≈ 15 min)

Per release, before uploading to Play:

- [ ] Install the arm64 APK from the latest release (or the .aab via bundletool)
- [ ] Import a real WhatsApp export zip (with media)
- [ ] Search, star, edit + unsend a message, export .txt round-trip (re-import it)
- [ ] Settings → Cloud sync (WebDAV): push + pull & restore
- [ ] Settings → Encrypted sync file: export + restore
- [ ] App lock on/off, dark mode, per-chat wallpaper/theme
- [ ] Voice note transcription (first run downloads the whisper model)
- [ ] Airplane mode: everything except model download + auto-update check works offline

## 4. After every release (automated — verify once)

- [ ] CI green on the tag: <https://github.com/Avithegod2010/WA-archiver/actions>
- [ ] Release assets present: 1 × .aab + 4 × APK
- [ ] Auto-update checker shows the new version inside the old app (it polls
      `releases/latest`)
