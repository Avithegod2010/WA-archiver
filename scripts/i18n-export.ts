/**
 * i18n:export — generate Weblate-friendly JSON files from the TypeScript
 * locale sources (src/lib/locales/*.ts).
 *
 * The TS files stay the source of truth for the app; the JSON files in
 * locales/ are what Weblate edits. Run this after every change to en.ts
 * (or any other locale) and commit the result, then Weblate picks the
 * new keys up on its next repo pull.
 *
 * Usage: bun scripts/i18n-export.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { strings as en } from '../src/lib/locales/en'
import { strings as hi } from '../src/lib/locales/hi'
import { strings as ur } from '../src/lib/locales/ur'
import { strings as mr } from '../src/lib/locales/mr'
import { strings as ta } from '../src/lib/locales/ta'

const LOCALES: Record<string, Record<string, string>> = { en, hi, ur, mr, ta }
const OUT_DIR = join(process.cwd(), 'locales')

const enKeys = Object.keys(en).sort()

mkdirSync(OUT_DIR, { recursive: true })

let failed = false

for (const [code, strings] of Object.entries(LOCALES)) {
  const keys = Object.keys(strings).sort()
  const missing = enKeys.filter((k) => !keys.includes(k))
  const extra = keys.filter((k) => !enKeys.includes(k))

  if (missing.length || extra.length) {
    failed = true
    console.error(`✗ ${code}: key mismatch with en`)
    for (const k of missing) console.error(`  missing: ${k}`)
    for (const k of extra) console.error(`  extra:   ${k}`)
    continue
  }

  const sorted: Record<string, string> = {}
  for (const k of enKeys) sorted[k] = strings[k]

  const file = join(OUT_DIR, `${code}.json`)
  writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`✓ ${file} (${enKeys.length} keys)`)
}

if (failed) {
  console.error('\ni18n:export failed — fix key parity in src/lib/locales first.')
  process.exit(1)
}

console.log(`\nAll ${Object.keys(LOCALES).length} locales exported with ${enKeys.length} keys each.`)
