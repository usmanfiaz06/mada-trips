import type { NextConfig } from "next";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// One Vercel project serves both the public website and Mada Ops:
//   /            the website: its files are copied into public/ at build time by scripts/copy-site.mjs
//   /adminwork   Mada Ops (routes in src/app/adminwork)

// Server actions only accept requests from these hosts (the deployment's own host is always allowed).
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "madatrips.sa,www.madatrips.sa,mada-trips.vercel.app")
  .split(",").map((s) => s.trim()).filter(Boolean);

// The Mada Trips app's Core API (src/app/api/app/v1) imports TypeScript straight from packages/shared, outside this
// folder. externalDir lets Next compile it; tsconfig paths map "@mada/shared". Its one dependency, zod, always resolves
// to this package's copy, so the Vercel build (which installs only platform/) needs nothing from the repo root.
const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const zodDir = dirname(require.resolve("zod/package.json"));

const config: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "8mb", allowedOrigins }, externalDir: true },
  // The repo root also has a lockfile (the app workspace); trace from there so files in packages/shared are included.
  outputFileTracingRoot: resolve(here, ".."),
  webpack(cfg) {
    cfg.resolve ??= {};
    cfg.resolve.alias = { ...(cfg.resolve.alias as Record<string, string>), zod$: zodDir, "@mada/shared$": resolve(here, "../packages/shared/src/index.ts") };
    cfg.resolve.modules = [...(cfg.resolve.modules ?? ["node_modules"]), resolve(here, "node_modules")];
    return cfg;
  },
  poweredByHeader: false,
  devIndicators: false,
  async redirects() {
    // The website's clean URLs (/about, not /about.html), as Vercel's cleanUrls did before.
    return [
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/site-home", destination: "/", permanent: true },
      { source: "/:page((?!adminwork|index|site-home)[^/.]+)\\.html", destination: "/:page", permanent: true },
      // Arabic site under /ar
      { source: "/ar/index.html", destination: "/ar", permanent: true },
      { source: "/ar/site-home", destination: "/ar", permanent: true },
      { source: "/ar/:page((?!index|site-home)[^/.]+)\\.html", destination: "/ar/:page", permanent: true },
    ];
  },
  async rewrites() {
    return {
      // After real files and app routes. "/" is served from site-home.html, a copy of index.html:
      // Vercel won't rewrite to a file named index.html. /about → about.html, and so on.
      fallback: [
        { source: "/", destination: "/site-home.html" },
        { source: "/ar", destination: "/ar/site-home.html" },
        { source: "/ar/:page((?!site-home)[^/.]+)", destination: "/ar/:page.html" },
        { source: "/:page((?!adminwork|site-home)[^/.]+)", destination: "/:page.html" },
      ],
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
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      { source: "/adminwork", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "X-Frame-Options", value: "DENY" }] },
    ];
  },
};
export default config;
