# Task 14-i — AI-generated chat wallpapers

Agent: full-stack-developer (I-wallpaper)

## Files touched (STRICT ownership respected)
- `src/app/api/wallpaper/generate/route.ts` (NEW — subfolder `generate`, does not clash with `[name]`)
- `src/components/whatsapp/WallpaperPicker.tsx` (additive only)
- `worklog.md` (entry appended)

NOT touched: SettingsDialog.tsx, ChatView.tsx, WhatsAppApp.tsx, globals.css, wallpaper.ts, any existing route. Dev server not restarted; no db:push.

## Storage contract (discovered + reused, NOT reinvented)
- Custom wallpapers are **loose files** in `db/wallpapers/<name>` — **no manifest/registry**. `POST /api/wallpaper` writes `<uuid>.<ext>` and returns `{ url: '/api/wallpaper/<name>' }`; `GET /api/wallpaper/[name]` serves them (immutable cache, name regex `^[a-zA-Z0-9._-]+$`).
- The generate route saves **exactly** there: `ai-<Date.now()>.<ext>` (ext sniffed from base64 magic bytes: iVBORw0KGgo→png, /9j/→jpg, UklGR→webp — live SDK run returned a **JPEG**, so sniffing matters).
- Picker has a single custom-photo slot: success calls `writeWallpaper(chatId, { k:'custom', photo: url })` — same as `upload()` — which auto-selects and refreshes the picker via the wallpaper store (useSyncExternalStore). Upload flow auto-selects ⇒ generate auto-selects.

## API — POST /api/wallpaper/generate
1. `assertAppUnlocked(req)` first (standard 401 while locked).
2. Body `{ prompt }`: defensive JSON parse (bad body → same 400), trim, 3..300 chars else `400 {error:'Describe the wallpaper in 3–300 characters'}` (validation does NOT burn rate-limit quota).
3. Rate limit before the expensive call: in-memory `Map<string, number[]>`, sliding 60 s window, max 6 per client (x-forwarded-for → x-real-ip → 'local'), prune when map > 256 keys; `429 {error:'Too many generations — try again in a minute'}`.
4. Prompt + fixed `STYLE_SUFFIX = ', soft muted colors, subtle seamless doodle pattern, minimal, clean, phone wallpaper background'` → `zai.images.generations.create({ prompt, size: '1024x1024' })` → `data[0].base64`.
5. Save to db/wallpapers; respond `200 { ok: true, name, url }` (`url` matches upload convention).
6. Any failure → `502 {error:'Could not generate the wallpaper. Please try again.'}`; raw SDK errors never leak; `writtenPath` tracked and unlinked on post-write failure.
- `runtime = 'nodejs'`, `maxDuration = 300` (live generation measured ~61 s; /api/ai's 60 would be tighter than observed runtime).

## Component — WallpaperPicker additive block
- Placed ABOVE the "Custom photo — prominent row" in the left column, matching its visual language (rounded-xl dashed `border-(--wa-line)`, `bg-black/[0.03] dark:bg-white/[0.04]`, p-2). Emerald/teal `--wa-*` chrome only (accent-tinted pill), no indigo/blue.
- Real `<form onSubmit>` (Enter submits), Sparkles header, `aria-live` status ("Painting your wallpaper…" while pending), h-8 shadcn Input (placeholder "Describe a wallpaper… e.g. tropical leaves on cream", maxLength 300, disabled while pending, aria-label), Generate Button: Sparkles → Loader2 spin + "Painting…" while pending; disabled while generating or prompt < 3 chars.
- Success: apply via writeWallpaper + `toast.success('Wallpaper generated')` + clear input. Error: `toast.error(err.message || fallback)`, input kept. English-only.

## QA (all artifacts cleaned; db/wallpapers restored to exact 4-file baseline)
- Service sanity via skill CLI (`z-ai image` → /tmp, 83 KB) ✓.
- `POST …/generate {"prompt":"tropical leaves on cream"}` → **200 in 61.3 s** `{"ok":true,"name":"ai-1791815744288.jpg","url":"/api/wallpaper/ai-1791815744288.jpg"}`; file on disk verified (83,966 B, JPEG 1024×1024); `GET /api/wallpaper/ai-1791815744288.jpg` → **200 image/jpeg 83966B**.
- Validation: `"ab"` → 400 contract error; `""` → 400; missing body → 400. (429 path not live-fired — would burn 6 real generations; logic hand-reviewed.)
- Cleanup: deleted `ai-1791815744288.jpg` + /tmp png; `ls db/wallpapers` back to exactly the 4 pre-existing UUID files.
- `bunx eslint` both files → **0 problems**; `bunx tsc --noEmit` → **0 errors in my files** (only pre-existing examples/ + skills/ errors documented by earlier agents); `tail dev.log` → route 200s + clean "✓ Compiled", no compile errors.
