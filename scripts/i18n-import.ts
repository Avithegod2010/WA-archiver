/**
 * i18n:import — apply Weblate-translated JSON files (locales/{hi,ur,mr,ta}.json)
 * back into the TypeScript locale sources (src/lib/locales/*.ts).
 *
 * Flow after merging a Weblate pull request:
 *   1. bun run i18n:import
 *   2. bunx tsc --noEmit        (key parity is compile-enforced)
 *   3. bun run lint
 *   4. commit src/lib/locales/*.ts (and the JSON, if Weblate didn't)
 *
 * Only the four translation files are regenerated — en.ts is the source
 * of truth and stays hand-edited. Values are JSON-escaped, so Devanagari,
 * Nastaliq (RTL), Tamil and quotes survive round-trips safely.
 *
 * Usage: bun scripts/i18n-import.ts [locale ...]   (default: hi ur mr ta)
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { strings as en } from '../src/lib/locales/en'

const TARGETS = ['hi', 'ur', 'mr', 'ta']
const args = process.argv.slice(2)
const codes = args.length ? args : TARGETS
const ROOT = process.cwd()

const enKeys = Object.keys(en).sort()

// Header comment per locale (kept in sync with the hand-written files).
const HEADERS: Record<string, string> = {
  hi: 'हिन्दी strings — mirrors en.ts 1:1 (Record<TranslationKey, string>,\n * so a missing/extra key fails typecheck). Kept short and natural;\n * the app name stays "WA Archiver".\n *\n * ⚙ MAINTAINED VIA WEBLATE — edit at hosted.weblate.org, then run\n * `bun run i18n:import`. Do not hand-edit; regenerate instead.',
  ur: 'اردو strings — mirrors en.ts 1:1 (Record<TranslationKey, string>,\n * so a missing/extra key fails typecheck). ur is rendered RTL.\n *\n * ⚙ MAINTAINED VIA WEBLATE — edit at hosted.weblate.org, then run\n * `bun run i18n:import`. Do not hand-edit; regenerate instead.',
  mr: 'मराठी strings — mirrors en.ts 1:1 (Record<TranslationKey, string>,\n * so a missing/extra key fails typecheck). Kept short and natural;\n * the app name stays "WA Archiver".\n *\n * ⚙ MAINTAINED VIA WEBLATE — edit at hosted.weblate.org, then run\n * `bun run i18n:import`. Do not hand-edit; regenerate instead.',
  ta: 'தமிழ் strings — mirrors en.ts 1:1 (Record<TranslationKey, string>,\n * so a missing/extra key fails typecheck). Kept short and natural;\n * the app name stays "WA Archiver".\n *\n * ⚙ MAINTAINED VIA WEBLATE — edit at hosted.weblate.org, then run\n * `bun run i18n:import`. Do not hand-edit; regenerate instead.',
}

let failed = false

for (const code of codes) {
  if (!TARGETS.includes(code)) {
    console.error(`✗ unknown locale "${code}" (expected one of ${TARGETS.join(', ')})`)
    failed = true
    continue
  }

  const jsonPath = join(ROOT, 'locales', `${code}.json`)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(readFileSync(jsonPath, 'utf8'))
  } catch (e) {
    console.error(`✗ ${code}: cannot read ${jsonPath} (${(e as Error).message})`)
    failed = true
    continue
  }

  const missing = enKeys.filter((k) => !(k in parsed))
  const extra = Object.keys(parsed).filter((k) => !enKeys.includes(k))

  if (missing.length || extra.length) {
    failed = true
    console.error(`✗ ${code}: key mismatch with en (${missing.length} missing, ${extra.length} extra)`)
    for (const k of missing.slice(0, 10)) console.error(`  missing: ${k}`)
    for (const k of extra.slice(0, 10)) console.error(`  extra:   ${k}`)
    if (missing.length > 10) console.error(`  … and ${missing.length - 10} more`)
    continue
  }

  const lines: string[] = []
  for (const k of enKeys) {
    const value = String(parsed[k])
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
    lines.push(`  '${k}': '${value}',`)
  }

  // Group markers every ~15 keys would fight the sorted order; instead a
  // single flat block keeps diffs clean and regeneration deterministic.
  const out = `/**
 * ${HEADERS[code]}
 */

import type { TranslationKey } from './en'

export const strings: Record<TranslationKey, string> = {
${lines.join('\n')}
}
`

  const tsPath = join(ROOT, 'src', 'lib', 'locales', `${code}.ts`)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(tsPath, out)
  console.log(`✓ ${tsPath} regenerated (${enKeys.length} keys from ${jsonPath})`)
}

if (failed) {
  console.error('\ni18n:import failed — nothing half-applied; fix the JSON and re-run.')
  process.exit(1)
}

console.log('\nNext: bunx tsc --noEmit && bun run lint, then commit.')
