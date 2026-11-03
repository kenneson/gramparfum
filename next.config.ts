import type { NextConfig } from "next";

// ponytail: cacheComponents off — every screen is per-user/per-store data; add back if public pages appear
const nextConfig: NextConfig = {
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
