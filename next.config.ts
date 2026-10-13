import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // NOTE: keep this file minimal — editing it makes `next dev` self-restart
  // and re-resolve freshly generated Prisma clients.
};

export default nextConfig;
