/**
 * Copy the sql.js runtime (UMD glue + WebAssembly binary) from node_modules
 * into public/ so the on-device SQLite engine (src/lib/data/local/engine.ts)
 * can load it as a plain static asset — no bundler involvement, works in
 * dev, production builds and the Capacitor APK shell alike.
 *
 * Wired as `predev` and `prebuild` so fresh clones get the files after a
 * plain `npm install` + `npm run dev` (also the F-Droid reproducible-build
 * path). Safe to run any time — it simply overwrites the two files.
 */
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const dist = path.join(root, 'node_modules', 'sql.js', 'dist')
const pub = path.join(root, 'public')

await mkdir(pub, { recursive: true })
await copyFile(path.join(dist, 'sql-wasm.js'), path.join(pub, 'sql-wasm.js'))
await copyFile(path.join(dist, 'sql-wasm.wasm'), path.join(pub, 'sql-wasm.wasm'))
console.log('[copy-sql-wasm] public/sql-wasm.js + public/sql-wasm.wasm are up to date')
