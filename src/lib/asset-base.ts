/**
 * Base path for root-absolute asset URLs (sql-wasm, whisper runtime,
 * service worker, manifest, icons).
 *
 * The app ships in three shapes:
 *   • dev / standalone server — assets live at the origin root (base = '')
 *   • APK (CAP_EXPORT) — the WebView serves from the package root (base = '')
 *   • GitHub Pages (PAGES_EXPORT) — the site lives under a sub-path
 *     (/WA-archiver/app/), so every root-absolute URL must be prefixed.
 *
 * NEXT_PUBLIC_BASE_PATH is inlined at build time via the `env` block in
 * next.config.ts (PAGES_EXPORT branch only); everywhere else it is ''.
 */
export const ASSET_BASE: string = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/** Prefix a root-absolute asset path with the configured base path. */
export function assetUrl(path: string): string {
  if (!path.startsWith('/')) return path
  return `${ASSET_BASE}${path}`
}
