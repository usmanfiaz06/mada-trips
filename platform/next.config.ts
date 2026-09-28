import type { NextConfig } from "next";

// One Vercel project serves both the public website and Mada Ops:
//   /            the website: its files are copied into public/ at build time by scripts/copy-site.mjs
//   /adminwork   Mada Ops (routes in src/app/adminwork)

// Server actions only accept requests from these hosts (the deployment's own host is always allowed).
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "madatrips.sa,www.madatrips.sa,mada-trips.vercel.app")
  .split(",").map((s) => s.trim()).filter(Boolean);

const config: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "8mb", allowedOrigins } },
  poweredByHeader: false,
  devIndicators: false,
  async redirects() {
    // The website's clean URLs (/about, not /about.html), as Vercel's cleanUrls did before.
    return [
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/:page((?!adminwork)[^/.]+)\\.html", destination: "/:page", permanent: true },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/index.html" }],
      // After real files and app routes: /about → about.html. Anything else falls through to the 404 page.
      fallback: [{ source: "/:page((?!adminwork)[^/.]+)", destination: "/:page.html" }],
    };
  },
  async headers() {
    return [
      { source: "/assets/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }] },
      {
        source: "/:path((?!adminwork(?:/|$)).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        source: "/adminwork/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      { source: "/adminwork", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "X-Frame-Options", value: "DENY" }] },
    ];
  },
};
export default config;
