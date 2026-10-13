/**
 * Vendor the on-device speech-to-text runtime (Phase 4).
 *
 * Copies the prebuilt transformers.js browser bundle (ES module) and the
 * ONNX Runtime WebAssembly binaries from node_modules into public/whisper/
 * so src/lib/whisper-asr.ts can load them as plain static assets — the same
 * bundler-free pattern as sql.js (scripts/copy-sql-wasm.mjs).
 *
 * Nothing here is loaded until the user actually transcribes a voice note or
 * downloads the ASR model in Settings — the script tag is injected lazily.
 *
 * Wired as part of `dev`, `build` and `build:capacitor` so fresh clones and
 * the F-Droid reproducible-build path both produce the assets. Safe to run
 * repeatedly (plain overwrites).
 */
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const tfDist = path.join(root, 'node_modules', '@xenova', 'transformers', 'dist')
const ortDist = path.join(root, 'node_modules', 'onnxruntime-web', 'dist')
const pub = path.join(root, 'public', 'whisper')

await mkdir(pub, { recursive: true })

await copyFile(
  path.join(tfDist, 'transformers.min.js'),
  path.join(pub, 'transformers.min.js')
)

// Every ORT 1.14 wasm backend variant — numThreads=1 uses the plain/simd
// binaries, but shipping all four keeps the engine working in any WebView.
const WASM_FILES = [
  'ort-wasm.wasm',
  'ort-wasm-simd.wasm',
  'ort-wasm-threaded.wasm',
  'ort-wasm-simd-threaded.wasm',
]
await Promise.all(
  WASM_FILES.map((f) => copyFile(path.join(ortDist, f), path.join(pub, f)))
)

console.log('[copy-whisper] public/whisper/ is up to date (transformers + ort wasm)')
