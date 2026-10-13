import type { NextConfig } from "next";

/**
 * Two build modes (Phase 3 of the local-first refactor):
 *
 *   • default — `next build`: full standalone server (web hosting, /api/*).
 *   • CAP_EXPORT=1 — static export: a purely client-side bundle of the same
 *     UI, emitted to `capacitor-export/` and copied into `capacitor-web/` by
 *     scripts/build-capacitor.mjs. This is what the Capacitor APK shell
 *     bundles; it runs the device transport exclusively (no server exists
 *     inside the app), which is why scripts/build-capacitor.mjs temporarily
 *     moves `src/app/api` out of the route tree for the duration of the
 *     build — route handlers are not exportable.
 */
const isApkExport = process.env.CAP_EXPORT === "1";

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
  : {
      output: "standalone",
      typescript: {
        ignoreBuildErrors: true,
      },
      reactStrictMode: false,
    };

// NOTE: keep this file minimal — editing it makes `next dev` self-restart
// and re-resolve freshly generated Prisma clients.

export default nextConfig;
