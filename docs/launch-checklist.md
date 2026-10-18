# Launch checklist — app stores & distribution

Status as of **v1.2.0** (`WhatsApp-Viewer-v1.2.0-release.apk`, 23.1 MB,
versionCode 3). Run through this file top-to-bottom when you're ready to
submit; re-run it after every release.

---

## 1. IzzyOnDroid — ✅ READY, submit when you like

IzzyOnDroid is the biggest curated third-party F-Droid repo. It pulls APKs
straight from your GitHub releases, so there is **nothing to build** — they
just index your release.

### Scan results (v1.2.0 release APK, checked by hand)

| Criterion | Status |
|---|---|
| Source code public | ✅ github.com/Avithegod2010/WA-archiver |
| OSI license | ✅ MIT (`LICENSE`) |
| APKs signed (own key, not debug) | ✅ APK Signing v2 block present; tags build `assembleRelease` with `KEYSTORE_BASE64` |
| No tracking / analytics / ads | ✅ dex scan: 0 hits for Firebase, Facebook, AppsFlyer, Adjust, Amplitude, Mixpanel, Sentry, Braze, Segment |
| No Google Play Services dep | ✅ the one `com.google.android.gms` string is the AndroidX Photo Picker intent constant, not a dependency; `google-services.json` absent so the plugin is never applied |
| Proprietary blobs | ✅ none — androidx + Capacitor (Apache-2.0) + SQLCipher + Kotlin only |
| Target SDK | ✅ 36 (max) |
| Min SDK | ✅ 24 (Android 7) |
| Unique applicationId | ✅ `com.whatsappviewer.app` |
| APK size | ✅ 23 MB (fine) |
| Releases with changelogs | ✅ GitHub Releases + `CHANGELOG.md` + `fastlane/metadata/android/` (Izzy reads fastlane changelogs automatically) |

### How to submit

1. Open <https://gitlab.com/IzzyOnDroid/repo> → *Issues* → new issue with the
   **"App inclusion request"** template (or use the submit form on
   <https://apt.izzysoft.de/fdroid/index/info>).
2. Fill in: repo URL, issue tracker (= this repo's Issues), license (MIT),
   description, and the direct link to a release APK
   (`.../releases/download/v1.2.0/WhatsApp-Viewer-v1.2.0-release.apk`).
3. Izzy reviews (usually days, not weeks). Once included, every new GitHub
   release with a higher `versionCode` is picked up automatically.
4. ~~Screenshots~~ ✅ done — 5 phone shots are already checked in at
   `fastlane/metadata/android/com.whatsappviewer.app/en-US/images/phoneScreenshots/`
   (plus icon.png), so the listing is visual from day one.

**One rule to keep:** never bump `versionCode` backwards, never replace an
already-published APK file — publish a new release instead.

## 2. F-Droid main repo — ⚠️ possible, ~1-2 weeks of setup, do it after Izzy

F-Droid **builds everything from source** on their own infrastructure; they
don't take prebuilt APKs. That means someone must write a build recipe
(metadata YAML) describing the exact toolchain.

What's already fine:

- ✅ MIT license, no non-free dependencies, no anti-features
- ✅ Node/Gradle builds are supported on F-Droid's buildserver
- ✅ The whole web bundle is built from source (`scripts/build-capacitor.mjs`
  → `bunx cap sync android` → Gradle) — no vendored binaries except the
  third-party WASM runtimes that the repo vendors anyway (sql-wasm is MIT,
  transformers.js Apache-2.0 — declare them in the recipe if asked)

Gaps to close before a successful `fdroiddata` merge request:

1. **Reproducible-ish build recipe.** Draft `metadata/com.whatsappviewer.app.yml`:

   ```yaml
   Categories:
     - Internet
   License: MIT
   AuthorName: Avithegod2010
   WebSite: https://avithegod2010.github.io/WA-archiver/
   SourceCode: https://github.com/Avithegod2010/WA-archiver
   IssueTracker: https://github.com/Avithegod2010/WA-archiver/issues
   Name: WhatsApp Viewer
   Summary: Read your exported WhatsApp chats offline, privately
   Description: |-
       Import WhatsApp chat exports (.zip/.txt) and read them in a familiar
       WhatsApp-style interface. Local-first: chats, media and settings live
       in an on-device SQLite database. Optional AI toolbox uses your own
       Gemini key. No account, no cloud, no tracking.
   RepoType: git
   Repo: https://github.com/Avithegod2010/WA-archiver.git
   Builds:
     - versionName: 1.2.0
       versionCode: 3
       commit: v1.2.0
       subdir: android
       sudo:
         - apt-get update
         - apt-get install -y nodejs npm
       init:
         - cd .. && npm install && npm run build:capacitor
       gradle:
         - yes
   ```

   (Recipe shape will need adjusting with an fdroid lint run — the point is:
   it's writable today.)
2. **npm fallback for `bun install`.** The buildserver doesn't ship Bun;
   verify `npm install && npm run build:capacitor` works (or add a
   `package-lock.json` via `bun x --bun npm i --package-lock-only`) so their
   CI can pin dependencies. F-Droid accepts pinned npm ci builds.
3. **Reproducibility.** JS/Gradle toolchains make bit-for-bit reproducible
   builds hard; F-Droid accepts "non-reproducible, signed by us" builds but
   flags them. Expect your first builds to be signed by F-Droid's key.
4. Submit via merge request to <https://gitlab.com/fdroid/fdroiddata>
   (read their `README` first; reviews take weeks).

**Recommendation:** ship on IzzyOnDroid first (it's instant value, zero
maintenance), gather a few releases of stability, then invest in the
fdroiddata recipe.

## 3. Everything else worth doing for launch

- [x] **GitHub repo polish** — description, homepage URL and 14 topics are
      set (verified via API). Only the **social preview image** remains —
      it cannot be set via API: Settings → General → Social preview →
      upload `website/social-preview.png`
- [x] **Screenshots** — 5 real phone-resolution shots captured from the app
      (docs/screenshots/, embedded in README, shipped in fastlane metadata
      and on the landing page)
- [x] **Privacy policy** — PRIVACY.md, linked from README + landing footer
- [x] **Submission draft** — docs/izzy-submission-draft.md (paste-ready)
- [ ] **Post the launch**:
      - r/fossdroid + r/degoogle + r/privacy (Reddit FOSS communities)
      - Lemmy `!opensource@lemmy.ml`, `!fossandroid@lemmy.ml`
      - XDA forums thread (APK + APK-releases link)
      - "Show HN" on Hacker News (the local-first/static story is a hook)
      - Product Hunt (the landing page is launch-ready)
- [ ] **Translations** — the UI is English-only; add Weblate later
      (`TRANSLATORS` note in README)
- [ ] **Funding** — optional `FUNDING.yml` (GitHub Sponsors) if you ever want
      to offset the signing key/domain costs
- [ ] **Keep the release rhythm** — Izzy indexes releases; an active release
      history is itself discovery

## 4. Quick reference — what triggers what

| Action | Result |
|---|---|
| push to `main` | Pages site rebuilt (landing + app) · rolling `latest` debug APK · security gate |
| tag `v*` pushed | signed release APK on a versioned GitHub Release |
| PR to `beta`/`main`/`stable` | `pr-check.yml` (lint + tsc) |
| any push | `security.yml` secret/dep scan |
