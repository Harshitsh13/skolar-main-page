import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      // Public Vercel Blob store (destination + article images uploaded from the admin)
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      // Firebase Storage (SKOLAR Studio article images)
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
    ],
  },
  // Published Insights are Markdown files read at request time (ISR) — ship them with every route.
  outputFileTracingIncludes: {
    "/*": ["./content/insights/**/*", "./content/countries/**/*"],
    // Studio image rendering needs the brand fonts, logos and licensed photos at runtime.
    "/api/studio/**": ["./assets/fonts/**/*", "./public/brand/**/*", "./public/images/**/*"],
  },
  // The Studio worker modules are server-only; keep sharp/firebase-admin external.
  serverExternalPackages: ["sharp", "firebase-admin", "@resvg/resvg-js", "opentype.js"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
