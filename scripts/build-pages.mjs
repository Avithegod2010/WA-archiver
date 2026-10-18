#!/usr/bin/env node
/**
 * Build the GitHub Pages site: landing page + the full web app.
 *
 * Produces `pages-site/` — the exact directory actions/deploy-pages uploads:
 *
 *   pages-site/
 *   ├── index.html          ← landing page (copied from website/)
 *   ├── social-preview.png  ← og:image for the landing page
 *   ├── .nojekyll           ← stop Jekyll from eating _next/
 *   └── app/                ← the full app, statically exported under
 *                            the /WA-archiver/app basePath (device
 *                            transport only — no server exists on Pages)
 *
 * Pipeline (mirrors scripts/build-capacitor.mjs):
 *   1. copy the SQLite WASM + Whisper assets into public/
 *   2. temporarily move `src/app/api` → `src/app/_api_stash` (route
 *      handlers cannot participate in `output: 'export'`) — ALWAYS restored
 *   3. `PAGES_EXPORT=1 next build` → emits `pages-export/` with basePath
 *      /WA-archiver/app baked into every asset URL
 *   4. assemble `pages-site/` (landing at the root, app under app/)
 *
 * Run via `bun run build:pages`. The PAGES_BASE_PATH env var overrides the
 * sub-path (default /WA-archiver/app) when hosting somewhere else.
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
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API_DIR = path.join(root, 'src', 'app', 'api')
const STASH_DIR = path.join(root, 'src', 'app', '_api_stash')
const EXPORT_DIR = path.join(root, 'pages-export')
const SITE_DIR = path.join(root, 'pages-site')
const LANDING_DIR = path.join(root, 'website')
const COPY_WASM = path.join(root, 'scripts', 'copy-sql-wasm.mjs')
const COPY_WHISPER = path.join(root, 'scripts', 'copy-whisper.mjs')

const basePath = process.env.PAGES_BASE_PATH || '/WA-archiver/app'

function log(msg) {
  console.log(`[build-pages] ${msg}`)
}

function fail(msg) {
  console.error(`[build-pages] ERROR: ${msg}`)
  process.exit(1)
}

/** Resolve the local Next.js CLI without depending on bun vs npm. */
function nextBin() {
  const local = path.join(root, 'node_modules', '.bin', 'next')
  if (existsSync(local)) return { cmd: local, args: [] }
  return { cmd: 'npx', args: ['next'] }
}

function dirSize(p) {
  let total = 0
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, entry.name)
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size
  }
  return total
}

// ---- 1. static runtime assets ----------------------------------------------
log('copying sql-wasm assets into public/ …')
const wasm = spawnSync(process.execPath, [COPY_WASM], { stdio: 'inherit' })
if (wasm.status !== 0) fail('copy-sql-wasm.mjs failed')

log('copying whisper assets into public/ …')
const whisper = spawnSync(process.execPath, [COPY_WHISPER], { stdio: 'inherit' })
if (whisper.status !== 0) fail('copy-whisper.mjs failed')

// ---- 2. stash the API routes ------------------------------------------------
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
  // ---- 3. static export with basePath --------------------------------------
  const { cmd, args } = nextBin()
  log(`running next build (PAGES_EXPORT=1, basePath ${basePath}) via ${path.basename(cmd)} …`)
  const build = spawnSync(cmd, [...args, 'build'], {
    stdio: 'inherit',
    cwd: root,
    env: {
      ...process.env,
      PAGES_EXPORT: '1',
      PAGES_BASE_PATH: basePath,
      NEXT_TELEMETRY_DISABLED: '1',
    },
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

// ---- 4. assemble the deployable site ---------------------------------------
log('assembling pages-site/ (landing + app) …')
rmSync(SITE_DIR, { recursive: true, force: true })
mkdirSync(path.join(SITE_DIR, 'app'), { recursive: true })

if (existsSync(LANDING_DIR)) {
  cpSync(LANDING_DIR, SITE_DIR, { recursive: true })
} else {
  fail('website/ landing page not found')
}
cpSync(EXPORT_DIR, path.join(SITE_DIR, 'app'), { recursive: true })
writeFileSync(path.join(SITE_DIR, '.nojekyll'), '')

log(
  `done — pages-site/ is ${(dirSize(SITE_DIR) / (1024 * 1024)).toFixed(1)} MB. ` +
    `Deploy target: ${basePath.replace(/\/app\/?$/, '')}/ (landing) + ${basePath}/ (app).`
)
