import path from "node:path";
import type { NextConfig } from "next";

// Same default as API_BASE in src/lib/api.ts. Read at build time, like every NEXT_PUBLIC_ value.
const apiUrl = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Same-origin proxy: /api/v1/* on the terminal's own origin (next dev, next start, Vercel)
  // reaches the FastAPI backend without a CORS round trip.
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: `${apiUrl}/api/v1/:path*` },
    ];
  },
  turbopack: {
    // Pins the root to frontend/, so a lockfile in a parent directory is never picked instead.
    root: path.join(__dirname),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
