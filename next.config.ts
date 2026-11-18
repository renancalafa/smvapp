import type { NextConfig } from "next";

/**
 * Comprovantes: app valida ≤ 10 MB (RECEIPT_MAX_BYTES).
 * Server Actions default = 1 MB — insuficiente para anexos.
 * 11 MB cobre 10 MB de arquivo + overhead multipart (limites/campos).
 * @see https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions
 */
const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "11mb",
    },
  },
  async redirects() {
    return [{ source: "/rankings", destination: "/stats", permanent: true }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // O navegador sempre confere se há versão nova do service worker.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      {
        source: "/offline.html",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
      {
        // Ao Vivo autenticado: nunca cachear no CDN/browser.
        source: "/api/live",
        headers: [{ key: "Cache-Control", value: "private, no-store, no-cache, must-revalidate" }],
      },
      {
        source: "/live",
        headers: [{ key: "Cache-Control", value: "private, no-store, no-cache, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
