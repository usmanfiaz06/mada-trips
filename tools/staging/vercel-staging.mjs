#!/usr/bin/env node
/*
 * Staging on Vercel: two projects, created and configured from the environment, in one command.
 *
 *   mada-staging       platform/ (Mada Ops + the Core API), production target = the staging branch, so it has a stable
 *                      https://mada-staging.vercel.app URL, crons, and migrations on every deploy (vercel-build runs
 *                      db:deploy against DATABASE_URL = STAGING_DATABASE_URL). APP_ENV=staging keeps it a staging copy:
 *                      mocks allowed, Hotelbeds test keys book, stays live on the test environment.
 *   mada-app-staging   the mobile app's web export (apps/mobile, expo export --platform web), live mode, same origin
 *                      API through the rewrite in apps/mobile/vercel.json (→ mada-staging.vercel.app).
 *
 *   node tools/staging/vercel-staging.mjs                       create or update both projects, set env, deploy
 *   node tools/staging/vercel-staging.mjs --branch <name>       the git branch both projects build (default: this one)
 *   node tools/staging/vercel-staging.mjs --no-deploy           configure only
 *   node tools/staging/vercel-staging.mjs --dry-run             print what would change, write nothing
 *
 * Reads from the environment (never from a file, never printed):
 *   VERCEL_TOKEN           a token for a team Owner or Member (a token that can only see one project is refused on
 *                          project creation: "You don't have permission to create the project").
 *   VERCEL_TEAM            the team's slug or dashboard URL (https://vercel.com/<slug>).
 *   STAGING_DATABASE_URL   the staging Postgres (becomes DATABASE_URL on mada-staging; the production database is never
 *                          read). DIRECT_URL is copied too when STAGING_DIRECT_URL is set (pooler-safe migrations).
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY
 *   HOTELBEDS_{HOTEL,TRANSFERS,ACTIVITIES}_{API_KEY,SECRET}      the test keys (HOTELBEDS_ENV is forced to "test")
 *   AERODATABOX_API_KEY, AERODATABOX_MARKET, AVIATIONSTACK_API_KEY
 *   ADSB_CONTACT, PLACES_CONTACT                                 monitored addresses for the open-data user agents
 *   CRON_SECRET, APP_JWT_SECRET, APP_DATA_KEY, APP_OTP_PEPPER    generated here when missing (printed once, as a reminder
 *                                                                to keep them in the environment for the next run)
 *   OVERPASS_URL                                                 optional Overpass mirror for Things to do
 *
 * Idempotent: re-running updates settings and upserts env values. It never touches any other project.
 */
import { randomBytes } from "node:crypto";

const BRANCH_DEFAULT = "claude/nice-pasteur-qmk758";
const API = "https://api.vercel.com";
const REPO = "usmanfiaz06/mada-trips";
const PLATFORM = "mada-staging";
const APP = "mada-app-staging";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const dryRun = flag("dry-run");
const branch = value("branch") ?? process.env.STAGING_BRANCH ?? BRANCH_DEFAULT;

const token = process.env.VERCEL_TOKEN;
if (!token) fail("VERCEL_TOKEN is not set.");
const teamSlug = (process.env.VERCEL_TEAM ?? "").replace(/\/+$/, "").split("/").pop();
if (!teamSlug) fail("VERCEL_TEAM is not set (the team slug or https://vercel.com/<slug>).");

/* ───────────── Vercel API ───────────── */

async function api(method, path, body) {
  const url = `${API}${path}${path.includes("?") ? "&" : "?"}slug=${encodeURIComponent(teamSlug)}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const e = new Error(`${method} ${path} → ${res.status} ${json?.error?.code ?? ""}: ${json?.error?.message ?? text.slice(0, 200)}`);
    e.status = res.status; e.code = json?.error?.code; throw e;
  }
  return json;
}

async function getProject(name) {
  try { return await api("GET", `/v9/projects/${encodeURIComponent(name)}`); }
  catch (e) { if (e.status === 404) return null; throw e; }
}

async function ensureProject(name, settings) {
  let p = await getProject(name);
  if (!p) {
    log(`+ create project ${name} (root ${settings.rootDirectory}, linked to ${REPO})`);
    if (dryRun) return { id: `dry_${name}`, name, link: { productionBranch: "main" } };
    p = await api("POST", "/v11/projects", {
      name, framework: settings.framework, rootDirectory: settings.rootDirectory,
      gitRepository: { type: "github", repo: REPO },
    });
  } else {
    log(`= project ${name} exists (${p.id})`);
  }
  const patch = {
    framework: settings.framework, rootDirectory: settings.rootDirectory,
    buildCommand: settings.buildCommand ?? null, installCommand: settings.installCommand ?? null, outputDirectory: settings.outputDirectory ?? null,
    // Builds happen for the staging branch only (exit 0 = skip; exit 1 = build).
    commandForIgnoringBuildStep: `if [ "$VERCEL_GIT_COMMIT_REF" = "${branch}" ]; then exit 1; else exit 0; fi`,
    // Vercel Authentication on preview URLs only, so the stable *.vercel.app production URL is open for testers.
    ssoProtection: { deploymentType: "preview" },
  };
  log(`  settings: ${JSON.stringify({ ...patch, commandForIgnoringBuildStep: "<branch guard>" })}`);
  if (!dryRun) p = await api("PATCH", `/v9/projects/${p.id}`, patch);
  if (!p.link) {
    log(`  linking to ${REPO}`);
    if (!dryRun) p = await api("POST", `/v9/projects/${p.id}/link`, { type: "github", repo: REPO });
  }
  if ((p.link?.productionBranch ?? "main") !== branch) {
    log(`  production branch → ${branch}`);
    if (!dryRun) {
      try { await api("PATCH", `/v9/projects/${p.id}/branch`, { branch }); }
      catch (e) {
        warn(`could not set the production branch through the API (${e.message}). Set it by hand: Vercel → ${name} → Settings → Git → Production Branch → ${branch}`);
      }
    }
  }
  return p;
}

async function upsertEnv(project, vars, target = ["production", "preview"]) {
  const entries = Object.entries(vars).filter(([, v]) => v !== undefined && v !== null && v !== "");
  const missing = Object.entries(vars).filter(([, v]) => v === undefined || v === null || v === "").map(([k]) => k);
  log(`  env (${entries.length} values, target ${target.join("+")}): ${entries.map(([k]) => k).join(", ")}`);
  if (missing.length) warn(`not set on ${project.name} (missing here): ${missing.join(", ")}`);
  if (dryRun) return;
  const body = entries.map(([key, v]) => ({ key, value: String(v), type: /SECRET|KEY|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL/.test(key) && !key.startsWith("EXPO_PUBLIC_") ? "sensitive" : "encrypted", target }));
  const res = await api("POST", `/v10/projects/${project.id}/env?upsert=true`, body);
  for (const f of res.failed ?? []) warn(`env ${f.error?.key ?? "?"}: ${f.error?.message}`);
}

async function deploy(project) {
  const link = project.link ?? (await getProject(project.name))?.link;
  if (!link?.repoId) { warn(`${project.name}: no git link, cannot deploy from here`); return null; }
  log(`→ deploy ${project.name} from ${branch}`);
  if (dryRun) return null;
  const d = await api("POST", "/v13/deployments?forceNew=1", {
    name: project.name, project: project.id, target: "production",
    gitSource: { type: "github", repoId: link.repoId, ref: branch },
  });
  return d;
}

async function waitReady(d, label) {
  if (!d) return null;
  const started = Date.now();
  for (;;) {
    const cur = await api("GET", `/v13/deployments/${d.id}`);
    if (cur.readyState === "READY" || cur.status === "READY") return cur;
    if (["ERROR", "CANCELED"].includes(cur.readyState ?? cur.status)) {
      const events = await api("GET", `/v3/deployments/${d.id}/events?limit=200`).catch(() => []);
      const text = (Array.isArray(events) ? events : []).map((e) => e.text ?? e.payload?.text ?? "").filter(Boolean).join("\n");
      fail(`${label}: build ${cur.readyState ?? cur.status}\n${text.slice(-3000)}`);
    }
    if (Date.now() - started > 20 * 60_000) fail(`${label}: still building after 20 minutes (${cur.readyState})`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

/* ───────────── what goes where ───────────── */

const generated = {};
const gen = (name, make) => { if (process.env[name]) return process.env[name]; generated[name] = make(); return generated[name]; };
const env = process.env;

const platformEnv = {
  APP_ENV: "staging",
  APP_STAYS_MODE: "live",
  APP_ALLOW_MOCKS: "yes",
  SUPPLIER_MODE_HOTELS: "hotelbeds",
  SUPPLIER_MODE_TRANSFERS: "hotelbeds",
  SUPPLIER_MODE_SUPABASE: "live",
  HOTELBEDS_ENV: "test",
  HOTELBEDS_MAX_RESULTS: "200",
  HOTELBEDS_HOTEL_API_KEY: env.HOTELBEDS_HOTEL_API_KEY, HOTELBEDS_HOTEL_SECRET: env.HOTELBEDS_HOTEL_SECRET,
  HOTELBEDS_TRANSFERS_API_KEY: env.HOTELBEDS_TRANSFERS_API_KEY, HOTELBEDS_TRANSFERS_SECRET: env.HOTELBEDS_TRANSFERS_SECRET,
  HOTELBEDS_ACTIVITIES_API_KEY: env.HOTELBEDS_ACTIVITIES_API_KEY, HOTELBEDS_ACTIVITIES_SECRET: env.HOTELBEDS_ACTIVITIES_SECRET,
  DATABASE_URL: env.STAGING_DATABASE_URL,
  DIRECT_URL: env.STAGING_DIRECT_URL,
  SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  AERODATABOX_API_KEY: env.AERODATABOX_API_KEY, AERODATABOX_MARKET: env.AERODATABOX_MARKET ?? "rapidapi",
  AVIATIONSTACK_API_KEY: env.AVIATIONSTACK_API_KEY,
  SUPPLIER_MODE_FLIGHT_STATUS: "aerodatabox",
  ADSB_CONTACT: env.ADSB_CONTACT, PLACES_CONTACT: env.PLACES_CONTACT,
  OVERPASS_URL: env.OVERPASS_URL,
  CRON_SECRET: gen("CRON_SECRET", () => randomBytes(32).toString("hex")),
  APP_JWT_SECRET: gen("APP_JWT_SECRET", () => randomBytes(48).toString("base64")),
  APP_DATA_KEY: gen("APP_DATA_KEY", () => randomBytes(32).toString("base64")),
  APP_OTP_PEPPER: gen("APP_OTP_PEPPER", () => randomBytes(24).toString("hex")),
  SEED_PASSWORD: gen("STAGING_SEED_PASSWORD", () => randomBytes(9).toString("base64url")),
  APP_PUBLIC_URL: `https://${PLATFORM}.vercel.app`,
};

const appEnv = {
  EXPO_PUBLIC_API_MODE: "live", // no EXPO_PUBLIC_API_URL: same origin, apps/mobile/vercel.json rewrites /api/* to mada-staging
  EXPO_PUBLIC_SUPABASE_URL: env.EXPO_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_DEMO_HINTS: "yes",
};

/* ───────────── run ───────────── */

async function main() {
  log(`Team ${teamSlug} · branch ${branch}${dryRun ? " · DRY RUN" : ""}`);
  if (!env.STAGING_DATABASE_URL) warn("STAGING_DATABASE_URL is not set: mada-staging gets no DATABASE_URL, its build skips migrations with a warning, and app routes answer 503 until it is added.");

  const platform = await ensureProject(PLATFORM, { framework: "nextjs", rootDirectory: "platform" });
  await upsertEnv(platform, platformEnv);

  const app = await ensureProject(APP, {
    framework: null, rootDirectory: "apps/mobile",
    installCommand: "cd ../.. && npm install --no-audit --no-fund",
    buildCommand: "npm run export:web",
    outputDirectory: "dist",
  });
  await upsertEnv(app, appEnv);

  if (Object.keys(generated).length) {
    warn(`generated now (keep them in the environment so the next run reuses them): ${Object.keys(generated).join(", ")}`);
    for (const [k, v] of Object.entries(generated)) console.log(`  ${k}=${v}`);
  }

  if (flag("no-deploy")) return;
  const d1 = await deploy(platform);
  const d2 = await deploy(app);
  const r1 = await waitReady(d1, PLATFORM);
  const r2 = await waitReady(d2, APP);
  const urlOf = (r, name) => (r?.alias ?? []).find((a) => a === `${name}.vercel.app`) ?? r?.alias?.[0] ?? r?.url;
  console.log(`\nPlatform (Mada Ops + Core API): https://${urlOf(r1, PLATFORM) ?? `${PLATFORM}.vercel.app`}`);
  console.log(`App (web export):               https://${urlOf(r2, APP) ?? `${APP}.vercel.app`}`);
  console.log(`\nNext: curl https://${PLATFORM}.vercel.app/api/app/v1/health ; then load Things to do (docs/app/STAGING.md).`);
}

function log(s) { console.log(s); }
function warn(s) { console.warn(`! ${s}`); }
function fail(s) { console.error(`✗ ${s}`); process.exit(1); }

main().catch((e) => fail(e.message));
