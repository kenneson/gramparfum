import type { NextConfig } from "next";

// ponytail: cacheComponents off — every screen is per-user/per-store data; add back if public pages appear
const nextConfig: NextConfig = {
  // Hostinger tem glibc antiga e não roda o compilador do Next: o build é feito no GitHub Actions
  // (.github/workflows/hostinger.yml) e o servidor autônomo roda lá só com Node.
  output: "standalone",
  // sem sharp (binário nativo que também não roda lá); as imagens são PNGs pequenos e locais
  images: { unoptimized: true },
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
