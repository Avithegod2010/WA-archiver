/**
 * Vendor the on-device speech-to-text runtime (Phase 4; on-demand in v1.7.0).
 *
 * Copies the prebuilt transformers.js browser bundle (ES module) into
 * public/whisper/ so src/lib/whisper-asr.ts can load it as a plain static
 * asset — the same bundler-free pattern as sql.js (copy-sql-wasm.mjs).
 *
 * v1.7.0 — ON-DEMAND WASM: the ORT WebAssembly binaries (~19 MB) are NO
 * LONGER bundled. Default behaviour writes a tiny manifest pointing at the
 * matching jsdelivr CDN directory; whisper-asr.ts resolves `wasmPaths` from
 * it at first use and the browser Cache API keeps the files for offline
 * reuse. This trims the APK/public tree by ~19 MB at the cost of needing
 * one online moment before the first transcription.
 *
 * Escape hatches:
 *   • WHISPER_LOCAL_WASM=1    bundle the wasm files again (full-offline
 *                             builds / F-Droid flavor) — manifest says local.
 *   • WHISPER_ALL_VARIANTS=1  also copy the threaded variants (debug only;
 *                             the app pins numThreads=1 so they are dead weight).
 *
 * Nothing here is loaded until the user actually transcribes a voice note or
 * downloads the ASR model in Settings — the script tag is injected lazily.
 * Safe to run repeatedly (plain overwrites).
 */
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const tfDist = path.join(root, 'node_modules', '@xenova', 'transformers', 'dist')
const ortDist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist')
const pub = path.join(root, 'public', 'whisper')

const tfVersion = JSON.parse(
  await readFile(path.join(root, 'node_modules', '@xenova', 'transformers', 'package.json'), 'utf8')
).version
const CDN_BASE = `https://cdn.jsdelivr.net/npm/@xenova/transformers@${tfVersion}/dist/`

await mkdir(pub, { recursive: true })

await copyFile(
  path.join(tfDist, 'transformers.min.js'),
  path.join(pub, 'transformers.min.js')
)

// ORT wasm backend variants. The app is NOT cross-origin isolated (no
// SharedArrayBuffer) and pins numThreads=1 (see src/lib/whisper-asr.ts),
// so the *threaded* variants can never be used — copying them only
// bloated the APK (~19 MB raw).
const ALL_WASM_FILES = [
  'ort-wasm.wasm',
  'ort-wasm-simd.wasm',
  'ort-wasm-threaded.wasm',
  'ort-wasm-simd-threaded.wasm',
]
const LOCAL_WASM_FILES =
  process.env.WHISPER_ALL_VARIANTS === '1'
    ? ALL_WASM_FILES
    : ['ort-wasm.wasm', 'ort-wasm-simd.wasm']

const localWasm = process.env.WHISPER_LOCAL_WASM === '1'

if (localWasm) {
  await Promise.all(
    LOCAL_WASM_FILES.map((f) => copyFile(path.join(ortDist, f), path.join(pub, f)))
  )
} else {
  // On-demand mode: drop any stale local wasm copies (they would defeat the
  // ~19 MB APK/public saving after an upgrade from v1.6.0).
  for (const f of await readdir(pub)) {
    if (f.startsWith('ort-wasm') && f.endsWith('.wasm')) {
      await rm(path.join(pub, f), { force: true })
    }
  }
}

await writeFile(
  path.join(pub, 'manifest.json'),
  JSON.stringify(
    localWasm
      ? { wasm: 'local' }
      : { wasm: 'cdn', base: CDN_BASE, version: tfVersion },
    null,
    2
  ) + '\n'
)

console.log(
  `[copy-whisper] public/whisper/ up to date (transformers + wasm: ${
    localWasm ? `${LOCAL_WASM_FILES.length} local variants` : `on-demand from ${CDN_BASE}`
  })`
)
