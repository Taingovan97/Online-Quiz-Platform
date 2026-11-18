import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page is per-user and authorization-gated, so static prerendering brings
  // no benefit; classic request-time rendering keeps the code simple.
  // See docs/architecture.md §2 (ADR: Cache Components disabled).
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
