#!/usr/bin/env node
/**
 * Phase 3 — build the standalone Capacitor web bundle.
 *
 * Produces `capacitor-web/` = a fully static export of the app (device
 * transport only, no API routes) that the Android APK shell serves from its
 * WebView. This makes the APK truly standalone: no hosted URL, no server.
 *
 * Pipeline:
 *   1. copy the SQLite WASM assets into public/ (same as the dev/build flow)
 *   2. temporarily move `src/app/api` → `src/app/_api_stash` (route handlers
 *      cannot participate in `output: 'export'`; an underscore-prefixed
 *      folder is invisible to the App Router) — ALWAYS restored afterwards
 *   3. `CAP_EXPORT=1 next build` → emits `capacitor-export/` (static site,
 *      incl. the public/ assets: sql-wasm, icons, manifest)
 *   4. replace `capacitor-web/` with the export
 *
 * Run via `bun run build:capacitor` (or plain node). Then `bunx cap sync
 * android` picks the folder up into the native project.
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API_DIR = path.join(root, 'src', 'app', 'api')
const STASH_DIR = path.join(root, 'src', 'app', '_api_stash')
const EXPORT_DIR = path.join(root, 'capacitor-export')
const WEB_DIR = path.join(root, 'capacitor-web')
const COPY_WASM = path.join(root, 'scripts', 'copy-sql-wasm.mjs')

function log(msg) {
  console.log(`[build-capacitor] ${msg}`)
}

function fail(msg) {
  console.error(`[build-capacitor] ERROR: ${msg}`)
  process.exit(1)
}

/** Resolve the local Next.js CLI without depending on bun vs npm. */
function nextBin() {
  const local = path.join(root, 'node_modules', '.bin', 'next')
  if (existsSync(local)) return { cmd: local, args: [] }
  return { cmd: 'npx', args: ['next'] }
}

// ---- 1. SQLite WASM assets -------------------------------------------------
log('copying sql-wasm assets into public/ …')
const wasm = spawnSync(process.execPath, [COPY_WASM], { stdio: 'inherit' })
if (wasm.status !== 0) fail('copy-sql-wasm.mjs failed')

// ---- 2. stash the API routes ----------------------------------------------
if (existsSync(STASH_DIR)) {
  fail(
    `${path.relative(root, STASH_DIR)} already exists — a previous export build ` +
      'was interrupted. Restore src/app/api from it (move it back) and retry.'
  )
}
if (!existsSync(API_DIR)) fail('src/app/api not found — nothing to build')

log('temporarily moving src/app/api out of the route tree …')
renameSync(API_DIR, STASH_DIR)

try {
  // ---- 3. static export ----------------------------------------------------
  const { cmd, args } = nextBin()
  log(`running next build (CAP_EXPORT=1) via ${path.basename(cmd)} …`)
  const build = spawnSync(cmd, [...args, 'build'], {
    stdio: 'inherit',
    cwd: root,
    env: { ...process.env, CAP_EXPORT: '1', NEXT_TELEMETRY_DISABLED: '1' },
  })
  if (build.status !== 0) fail('next build failed — see output above')
} finally {
  // ---- restore, even when the build failed --------------------------------
  if (existsSync(STASH_DIR)) {
    renameSync(STASH_DIR, API_DIR)
    log('restored src/app/api')
  }
}

if (!existsSync(path.join(EXPORT_DIR, 'index.html'))) {
  fail(`static export did not produce ${path.relative(root, EXPORT_DIR)}/index.html`)
}

// ---- 4. publish into capacitor-web/ ----------------------------------------
log('publishing the export into capacitor-web/ …')
rmSync(WEB_DIR, { recursive: true, force: true })
mkdirSync(WEB_DIR, { recursive: true })
cpSync(EXPORT_DIR, WEB_DIR, { recursive: true })

function dirSize(p) {
  let total = 0
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, entry.name)
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size
  }
  return total
}
log(`done — capacitor-web/ is ${(dirSize(WEB_DIR) / (1024 * 1024)).toFixed(1)} MB total. ` +
    'Next: `bunx cap sync android` (the GitHub Actions workflow does this automatically).')
