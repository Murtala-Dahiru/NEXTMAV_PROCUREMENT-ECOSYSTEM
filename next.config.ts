import type { NextConfig } from "next";

/**
 * `output: "standalone"` is required by the self-hosted path in `.zscripts/`,
 * which packages `.next/standalone` behind Caddy. It must NOT be set on Vercel:
 * Vercel does its own packaging and its post-build step reads the file-trace
 * manifests (`.next/*.nft.json`) that standalone mode relocates, which fails the
 * build with:
 *
 *   ENOENT: no such file or directory, open '.next/next-server.js.nft.json'
 *
 * Vercel sets `VERCEL=1` in the build environment, so the two paths are
 * distinguished automatically. For a self-host build elsewhere, set
 * `BUILD_STANDALONE=1` (see `npm run build:standalone`).
 */
const wantsStandalone =
  process.env.BUILD_STANDALONE === "1" || (!process.env.VERCEL && process.env.BUILD_STANDALONE !== "0");

const nextConfig: NextConfig = {
  ...(wantsStandalone ? { output: "standalone" as const } : {}),

  typescript: {
    // Inherited from the original scaffold. `npm run typecheck` is clean, so this
    // is now hiding nothing — but it also means a future type error would ship
    // silently rather than failing the build. Worth turning off once you are
    // confident in the deploy pipeline.
    ignoreBuildErrors: true,
  },

  reactStrictMode: false,

  // Prisma must not be bundled into the serverless function; it needs its
  // generated engine binary at runtime.
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default nextConfig;
