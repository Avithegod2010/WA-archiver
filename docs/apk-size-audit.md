# APK Size Audit — v1.6.0

**Baseline (v1.5.1):** universal release APK ≈ 24 MB
**After audit (v1.6.0):** universal ≈ 18–19 MB expected · per-ABI APKs a few MB slimmer still

## Where the bytes go

| Asset | Raw size | Notes |
| --- | --- | --- |
| `public/whisper/` | **38 MB → 20 MB** | ONNX Runtime WASM + transformers.js. By far the biggest asset. |
| `public/sql-wasm.wasm` + `.js` | ≈ 0.7 MB | SQLite-WASM for the device transport. Required. |
| App JS/CSS (static export) | ≈ 2–3 MB | Next.js static bundle. Required. |
| Native libs (all ABIs) | ≈ 1–2 MB × 4 ABIs | Capacitor + WebView glue; duplicated in the universal APK. |
| Icons, demo assets | ≈ 0.4 MB | Fine. |

## What changed in v1.6.0

### 1. Dropped the unused threaded WASM variants (−18 MB raw)

`src/lib/whisper-asr.ts` pins `numThreads = 1` because the app is **not
cross-origin isolated** (no COOP/COEP headers — and the Capacitor WebView
serves from `file://`/`https://appassets` where SharedArrayBuffer is
unavailable anyway). That means `ort-wasm-threaded.wasm` and
`ort-wasm-simd-threaded.wasm` could **never** be loaded — they were pure
dead weight in every APK since Phase 4.

- `scripts/copy-whisper.mjs` now copies only `ort-wasm-simd.wasm`
  (every WebView since Android 7 / Chrome 91) and `ort-wasm.wasm`
  (no-SIMD fallback for ancient devices).
- Escape hatch: `WHISPER_ALL_VARIANTS=1 bun run build:capacitor` restores
  all four variants for special builds.

### 2. Per-ABI APK splits (`android/app/build.gradle`)

```gradle
splits {
    abi {
        enable true
        reset()
        include 'armeabi-v7a', 'arm64-v8a', 'x86_64'
        universalApk true
    }
}
```

- CI (`android-apk.yml`) attaches **all** outputs to versioned releases:
  `WA-Archiver-v1.6.0-universal-release.apk`, `…-arm64-v8a-release.apk`,
  `…-armeabi-v7a-release.apk`, `…-x86_64-release.apk`.
- Users on arm64 (virtually every modern phone) should pick the arm64 APK.
- The rolling "latest" pre-release still ships only the universal debug
  APK to keep the asset list tidy.
- `versionCode` is not yet split per ABI (all four share code 8). If we
  ever publish to a store that requires unique codes per split, add
  `versionCodeOverride`/`output.versionCodeOverride` arithmetic.

## Further options (not done — tradeoffs)

1. **On-demand whisper download** (~−19 MB APK): ship the app without the
   ASR runtime and fetch it on first use. ~~Rejected for now~~ → **DONE in
   v1.7.0** with an escape hatch: the ORT WASM binaries are no longer
   bundled; `public/whisper/` carries only the transformers.js bootstrap
   (~0.9 MB) + `manifest.json`, and `whisper-asr.ts` fetches the
   matching binaries from jsDelivr on first use (browser Cache API keeps
   them for offline reuse — same one-online-moment contract as the ~45 MB
   ASR model, which was always on-demand). Builds that must work offline
   out of the box set `WHISPER_LOCAL_WASM=1` to re-bundle the binaries.
2. **Single WASM variant** (~−9 MB): drop `ort-wasm.wasm` and require
   SIMD support. Every Android WebView since 2017 has SIMD; risk is low
   but nonzero for very old devices. Revisit if size pressure grows.
3. **Brotli/zip-compressed assets served from the APK** — Capacitor
   compresses `assets/` in the APK already (deflate); no further win.
4. **App Bundle (.aab)** — ~~90% of the way there~~ → **DONE in v1.7.0**:
   CI tag builds run `assembleRelease bundleRelease` and attach
   `WA-Archiver-<tag>-release.aab` to the release. Upload it to Play
   Console and Google generates the per-device APKs server-side.

## Verification checklist after a release build

- [ ] `ls android/app/build/outputs/apk/release/` shows 4 APKs
- [ ] Universal APK installs and boots on arm64 device
- [ ] Voice-note transcription still works (uses `ort-wasm-simd.wasm`)
- [ ] Release page shows all four APK assets

## v1.7.0 update (2026-10-23)

- `public/whisper/` weight: 19.6 MB → 0.9 MB (wasm now on-demand from
  jsDelivr `@xenova/transformers@2.17.2/dist/`, version-locked to the
  vendored bundle via `manifest.json`).
- Releases attach a signed .aab alongside the four APKs.
- `WHISPER_LOCAL_WASM=1` restores the fully-offline bundled build;
  `WHISPER_ALL_VARIANTS=1` still forces all four wasm variants.
