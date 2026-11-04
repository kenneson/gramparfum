// .mjs (não .ts) e build com Webpack: o servidor da Hostinger tem glibc antiga, o SWC nativo não carrega e o
// Next cai no SWC em WASM, que não compila next.config.ts nem roda o Turbopack. Tailwind entra via postcss.config.mjs.
// ponytail: cacheComponents off — every screen is per-user/per-store data; add back if public pages appear

/** @type {import('next').NextConfig} */
const nextConfig = {
  // sem sharp (binário nativo que também não roda lá); as imagens são PNGs pequenos e locais
  images: { unoptimized: true },
};

export default nextConfig;
