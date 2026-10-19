# Hosting WA Archiver

The app ships in three deployable shapes. Pick one — or all three; they are
the same codebase and the same local-first behavior everywhere.

| Target | URL | Cost | What runs |
|---|---|---|---|
| **GitHub Pages** (default, already configured) | `https://avithegod2010.github.io/WA-archiver/` | Free | Landing page + **full app** (device transport) |
| **Vercel** | any `*.vercel.app` | Free (Hobby) | Full app **with** server storage + server AI relay |
| **Any static host** (Netlify / Cloudflare Pages / nginx) | wherever you point it | Free tier | Same as Pages (`bun run build:pages` → upload `pages-site/`) |

---

## 1. GitHub Pages (already set up — zero work)

Every push to `main` runs `.github/workflows/pages.yml`, which:

1. installs dependencies with Bun,
2. runs `bun run build:pages` →
   - statically exports the app with `basePath: /WA-archiver/app`
     (`PAGES_EXPORT=1` branch of `next.config.ts`),
   - copies the landing page (`website/`) to the site root,
   - writes `.nojekyll`,
3. uploads `pages-site/` and deploys it via `actions/deploy-pages`.

Result:

- Landing page: `https://avithegod2010.github.io/WA-archiver/`
- The app itself: `https://avithegod2010.github.io/WA-archiver/app/`

**What "device transport" means on Pages.** The hosted app has no backend —
exactly like the APK. Chats, media, settings and bookmarks live in the
visitor's browser (SQLite-WASM persisted to OPFS/IndexedDB). Clearing site
data deletes the archive; the app's built-in export/backup covers migrations.

**Why `/app/` under the repo path?** GitHub Pages serves project sites from
`/<repo>/`, so the export needs a matching `basePath`. `sw.js` derives its
scope from its own URL and every runtime asset (sql-wasm, whisper runtime,
icons, manifest) is basePath-aware, so nothing 404s.

**Custom sub-path** (e.g. hosting under a different repo name):

```bash
PAGES_BASE_PATH=/myrepo/app bun run build:pages
```

## 2. Vercel (free Hobby plan — with server features)

Vercel is only worth it if you want the **server transport**: chats stored in
the server's SQLite (`/api/*`) instead of the browser — handy for using the
same archive from several devices on one machine you control.

1. Push the repo (or fork it).
2. <https://vercel.com/new> → import `Avithegod2010/WA-archiver`.
3. Framework preset: **Next.js** (auto-detected). Build command/paths:
   leave untouched — the default `next build` produces the standalone server.
4. Deploy. Done.

Caveats (be honest with yourself about them):

- **SQLite on serverless is ephemeral.** Vercel functions get a read-only-ish,
  per-instance filesystem — server-stored chats can vanish between
  deployments/instances. For real server storage, host the standalone build
  on a long-lived box (VPS, Railway, Fly.io) instead:

  ```bash
  bun run build && bun run start   # serves .next/standalone/server.js
  ```

- The **local-first mode still works** on Vercel: switch *Settings ▸ Storage
  ▸ This device* and the app behaves exactly like the Pages build.

## 3. Any other static host

`bun run build:pages` → upload the `pages-site/` folder. For Netlify/
Cloudflare Pages set build command `bun run build:pages` and publish
directory `pages-site`. All paths are relative/basePath-aware already.

## Data-safety summary

| Mode | Where chats live | Leaves the device? |
|---|---|---|
| Pages / APK / "This device" setting | Browser OPFS (or on-device SQLite in the APK) | Never |
| Vercel / VPS with server storage | Server SQLite file | Only if you point it at a public box |

No telemetry exists in any mode; the only outbound calls are the ones you
trigger (Gemini API with your own key, Hugging Face CDN for the one-time
Whisper model download).
