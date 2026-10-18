import type { NextConfig } from "next";

/**
 * Three build modes:
 *
 *   • default — `next build`: full standalone server (web hosting, /api/*).
 *   • CAP_EXPORT=1 — static export: a purely client-side bundle of the same
 *     UI, emitted to `capacitor-export/` and copied into `capacitor-web/` by
 *     scripts/build-capacitor.mjs. This is what the Capacitor APK shell
 *     bundles; it runs the device transport exclusively (no server exists
 *     inside the app), which is why scripts/build-capacitor.mjs temporarily
 *     moves `src/app/api` out of the route tree for the duration of the
 *     build — route handlers are not exportable.
 *   • PAGES_EXPORT=1 — static export for GitHub Pages (scripts/
 *     build-pages.mjs): the same client-side bundle, but mounted under a
 *     sub-path (/WA-archiver/app/) via `basePath`. NEXT_PUBLIC_BASE_PATH
 *     is inlined so runtime asset URLs (sql-wasm, whisper, sw.js) resolve;
 *     NEXT_PUBLIC_STATIC_HOST=1 makes the storage-mode default 'device'
 *     because /api/* does not exist at the origin.
 */
const isApkExport = process.env.CAP_EXPORT === "1";
const isPagesExport = process.env.PAGES_EXPORT === "1";
const pagesBase = process.env.PAGES_BASE_PATH || "/WA-archiver/app";

const nextConfig: NextConfig = isApkExport
  ? {
      output: "export",
      distDir: "capacitor-export",
      images: { unoptimized: true },
      typescript: {
        ignoreBuildErrors: true,
      },
      reactStrictMode: false,
    }
  : isPagesExport
    ? {
        output: "export",
        distDir: "pages-export",
        basePath: pagesBase,
        // GitHub Pages serves directory-style URLs only (no clean URLs),
        // so every route exports as dir/index.html.
        trailingSlash: true,
        images: { unoptimized: true },
        typescript: {
          ignoreBuildErrors: true,
        },
        reactStrictMode: false,
        env: {
          NEXT_PUBLIC_BASE_PATH: pagesBase,
          NEXT_PUBLIC_STATIC_HOST: "1",
        },
      }
    : {
      output: "standalone",
      typescript: {
        ignoreBuildErrors: true,
      },
      reactStrictMode: false,
      // Baseline security headers for every server-rendered response
      // (security audit, v1.0.1). Static/APK export has no server, so
      // headers only apply to the hosted/dev build.
      async headers() {
        return [
          {
            source: "/(.*)",
            headers: [
              { key: "X-Content-Type-Options", value: "nosniff" },
              { key: "X-Frame-Options", value: "DENY" },
              {
                key: "Referrer-Policy",
                value: "strict-origin-when-cross-origin",
              },
              {
                key: "Permissions-Policy",
                value: "camera=(), geolocation=(), microphone=(self)",
              },
            ],
          },
        ];
      },
    };

// NOTE: keep this file minimal — editing it makes `next dev` self-restart
// and re-resolve freshly generated Prisma clients.

export default nextConfig;
