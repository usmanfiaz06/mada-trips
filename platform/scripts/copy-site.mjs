// The public website (repo root) and Mada Ops deploy as one Vercel project.
// Before each build, copy the website into public/ so Next.js serves it at "/". public/adminwork is the app's own.
import { copyFileSync, cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const root = resolve(here, "../..");
const out = resolve(here, "../public");
// Allow-list: only what a visitor's browser needs is published. Anything else at the repo root (notes, config,
// a stray .env or backup) is never copied into the public site.
const DIRS = new Set(["assets", "Assets", "css", "js"]);
const FILE = /\.(html|xml|txt|webmanifest|jpe?g|png|webp|svg|ico|gif|avif|woff2?)$/i;
const publicFile = (src) => { const base = src.split(/[\\/]/).pop(); return !base.startsWith(".") && !/\.(map|md|env|json|ya?ml|log|bak|sql|sh)$/i.test(base); };

// Clear the previous copy but keep the app's own assets.
for (const name of readdirSync(out)) if (name !== "adminwork") rmSync(join(out, name), { recursive: true, force: true });
let n = 0;
for (const name of readdirSync(root, { withFileTypes: true })) {
  const ok = name.isDirectory() ? DIRS.has(name.name) : name.isFile() && FILE.test(name.name) && !name.name.startsWith(".");
  if (!ok) continue;
  cpSync(join(root, name.name), join(out, name.name), { recursive: true, filter: publicFile });
  n++;
}
if (!existsSync(join(out, "index.html"))) throw new Error("Website index.html not found at repo root");
// Vercel treats a file named index.html specially, so "/" is served from a copy under another name.
copyFileSync(join(out, "index.html"), join(out, "site-home.html"));
console.log(`Copied ${n} website entries into public/`);
