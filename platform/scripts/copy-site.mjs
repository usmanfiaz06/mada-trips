// The public website (repo root) and Mada Ops deploy as one Vercel project.
// Before each build, copy the website into public/ so Next.js serves it at "/". public/adminwork is the app's own.
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const out = resolve(import.meta.dirname, "../public");
const SKIP = new Set(["platform", "docs", ".git", ".github", ".vercel", "node_modules", "README.md", "vercel.json", ".gitignore"]);

// Clear the previous copy but keep the app's own assets.
for (const name of readdirSync(out)) if (name !== "adminwork") rmSync(join(out, name), { recursive: true, force: true });
let n = 0;
for (const name of readdirSync(root)) {
  if (SKIP.has(name) || name.startsWith(".") || name === "adminwork") continue;
  cpSync(join(root, name), join(out, name), { recursive: true });
  n++;
}
if (!existsSync(join(out, "index.html"))) throw new Error("Website index.html not found at repo root");
console.log(`Copied ${n} website entries into public/`);
