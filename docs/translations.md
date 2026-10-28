# Translations & Weblate

WA Archiver ships in **5 languages**: English (en), हिन्दी (hi), اردو (ur,
RTL), मराठी (mr) and தமிழ் (ta) — 516 strings each, kept in perfect key
parity by the TypeScript compiler.

Community translations are managed on **Weblate**, the open-source
translation platform. Translators never touch code; maintainers never
touch translation strings by hand.

---

## Architecture (why JSON + TS?)

| Layer | Location | Who edits it |
|---|---|---|
| TypeScript sources | `src/lib/locales/*.ts` | Maintainers (en) / generated |
| Weblate bridge | `locales/*.json` | Weblate translators |
| Export bridge | `scripts/i18n-export.ts` | — (`bun run i18n:export`) |
| Import bridge | `scripts/i18n-import.ts` | — (`bun run i18n:import`) |

- `en.ts` is the **source of truth**. Every other locale is typed as
  `Record<TranslationKey, string>`, so a missing or extra key fails
  `tsc` — parity is compile-enforced.
- `bun run i18n:export` regenerates the JSON files from the TS sources
  (validates parity, sorts keys, refuses to run on mismatch).
- `bun run i18n:import` regenerates the four non-English TS files from
  the JSON Weblate edited (validates parity, escapes values, all-or-
  nothing per locale).

The round-trip is lossless: TS → JSON → TS produces identical values.

---

## For translators

1. Open the project on hosted Weblate:
   `https://hosted.weblate.org/engage/wa-archiver/` (free hosting for
   free software).
2. Pick your language (हिन्दी, اردو, मराठी, தமிழ் — or request a new
   one; adding a 6th locale = one new TS + JSON pair, see below).
3. Translate in the Weblate editor. Keep the `{name}`-style
   placeholders intact — Weblate highlights and validates them
   automatically. The app name "WA Archiver" stays untranslated.
4. Save. Weblate opens a pull request against the repo automatically.

## For maintainers

### One-time Weblate setup

1. Register at [hosted.weblate.org](https://hosted.weblate.org) (FOSS
   projects are hosted free; the project slug should be `wa-archiver`
   to match the README badge).
2. **Add component**:
   - Repository: `https://github.com/Avithegod2010/WA-archiver.git`
     (branch `main`)
   - File format: **JSON (monolingual)**
   - Source file: `locales/en.json`
   - File mask: `locales/*.json`
   - Translation languages: Weblate auto-detects hi/ur/mr/ta from the
     existing files.
3. **Push configuration**: set the pull/push branch to `main`, enable
   "Open pull request instead of direct push" (Weblate needs a GitHub
   OAuth token for this).
4. Optional: add a GitHub webhook
   (`https://hosted.weblate.org/hooks/github/`) so Weblate syncs the
   moment you push.

### Folding a Weblate PR back into the code

```bash
git fetch origin && git checkout main && git pull
git merge weblate/wa-archiver   # or merge the PR on GitHub first
bun run i18n:import             # JSON → TS regeneration
bunx tsc --noEmit               # key parity re-checked by the compiler
bun run lint
git add -A && git commit -m "i18n: fold Weblate translations into TS locales"
git push origin main beta stable
```

### Adding a new key (maintainers)

1. Add the key to `src/lib/locales/en.ts` **and** temporary English
   values in the other four TS files (tsc enforces this).
2. `bun run i18n:export && git add -A && git commit`
3. Push — Weblate picks up the new key on its next sync and marks it
   "Needs editing" in the other languages.

### Adding a new language

1. Create `src/lib/locales/xx.ts` mirroring the shape of `hi.ts`
   (`Record<TranslationKey, string>`), with English values as
   placeholders.
2. Register it in `src/lib/i18n.ts` (strings map + locale metadata)
   and in `scripts/i18n-export.ts` / `scripts/i18n-import.ts` targets.
3. `bun run i18n:export` → commit → create the language in Weblate.
