/*
 * npm run auth:check: the live email sign-in check from docs/app/AUTH.md §8 (Pass 1), end to end, against the real
 * Supabase project and a throwaway Postgres for the Core API.
 *
 *   1. the project's auth settings (email on, codes not auto-confirmed)
 *   2. a code is sent to the address (POST /auth/v1/otp)                 → the "Confirm signup" template for a new
 *      address, "Magic link" for an address Supabase already knows (--existing creates it first, service role)
 *   3. the email arrives: how long it took, who signed it (SPF, DKIM, DMARC from the receiving server's
 *      Authentication-Results), and whether it carries a 6-digit code or still Supabase's default link
 *   4. six wrong codes are refused (what the app shows as "wrong code"), and whether a sixth is slowed down
 *   5. the right code signs in (POST /auth/v1/verify)
 *   6. the Core API's /auth/session creates the account once (isNew), and after onboarding finds the same one on a
 *      second exchange (not new); /me shows the verified email
 *   7. the test user is removed from Supabase (service role) unless --keep
 *
 * The inbox: with MAILTM_TOKEN set (a mail.tm account's bearer token, https://api.mail.tm), the script reads the
 * code itself; otherwise it prints the address and waits for you to type the code from the inbox.
 *
 *   npm run auth:check -- --email someone@example.com                a brand-new address
 *   npm run auth:check -- --email someone@example.com --existing     an address Supabase already knows
 *   npm run auth:check -- --email … --keep                           leave the Supabase user in place
 *
 * Needs SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) and, for --existing and the clean-up,
 * SUPABASE_SERVICE_ROLE_KEY. Nothing from the environment is printed. Exit code 0 when every step passed.
 */
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { startCluster } from "../test/app/pg";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : null; };

const email = opt("email")?.trim().toLowerCase();
const existing = flag("existing");
const keep = flag("keep");
const url = (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const mailtm = process.env.MAILTM_TOKEN ?? "";

if (!email || !url || !anon) {
  console.error("Usage: npm run auth:check -- --email <address> [--existing] [--keep]\nNeeds SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in the environment.");
  process.exit(2);
}

/* ───────────── the report ───────────── */

type Step = { step: string; ok: boolean | "warn"; ms: number; note: string };
const steps: Step[] = [];
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
function record(step: string, ok: boolean | "warn", ms: number, note: string) {
  steps.push({ step, ok, ms, note });
  console.log(`${ok === true ? "✓" : ok === "warn" ? "!" : "✗"} ${pad(step, 10)} ${pad(ms ? `${ms} ms` : "", 9)} ${note}`);
}
class StepFailed extends Error {}
async function step<T>(name: string, run: () => Promise<T>, note: (r: T) => string | { warn: string }): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await run();
    const n = note(r);
    if (typeof n === "string") record(name, true, Date.now() - t0, n); else record(name, "warn", Date.now() - t0, n.warn);
    return r;
  } catch (e) {
    record(name, false, Date.now() - t0, e instanceof Error ? e.message : String(e));
    throw new StepFailed(name);
  }
}

/* ───────────── Supabase Auth over HTTP (what the app's client does) ───────────── */

type AuthAnswer = { status: number; json: Record<string, unknown> | null; headers: Headers };
async function auth(path: string, init: { method?: string; body?: unknown; key?: string; bearer?: string } = {}): Promise<AuthAnswer> {
  const key = init.key ?? anon;
  const res = await fetch(`${url}/auth/v1${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { apikey: key, Authorization: `Bearer ${init.bearer ?? key}`, "Content-Type": "application/json", "X-Client-Info": "mada-auth-check" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, headers: res.headers };
}
const errCode = (a: AuthAnswer) => String(a.json?.error_code ?? a.json?.code ?? a.json?.error ?? "") || `${a.status}`;
const errMsg = (a: AuthAnswer) => String(a.json?.msg ?? a.json?.message ?? a.json?.error_description ?? "");

/* ───────────── the inbox ───────────── */

type Mail = { id: string; subject: string; from: string; receivedAt: number; text: string; html: string; source: string };

async function mailtmGet(path: string): Promise<unknown> {
  const res = await fetch(`https://api.mail.tm${path}`, { headers: { Authorization: `Bearer ${mailtm}`, Accept: "application/json" } });
  if (res.status === 401) throw new Error("MAILTM_TOKEN was refused: make a fresh token (POST https://api.mail.tm/token)");
  if (!res.ok) throw new Error(`mail.tm answered ${res.status} for ${path}`);
  return res.json();
}

/** Wait for a message that arrived after `since`, up to `waitMs`. */
async function waitForMail(since: number, waitMs: number): Promise<Mail> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    // With Accept: application/json the API answers a plain array; with ld+json a Hydra collection. Take either.
    type Row = { id: string; subject?: string; from?: { address?: string }; createdAt: string };
    const list = (await mailtmGet("/messages")) as Row[] | { "hydra:member"?: Row[] };
    const rows = Array.isArray(list) ? list : list["hydra:member"] ?? [];
    const m = rows.find((x) => Date.parse(x.createdAt) >= since - 60_000);
    if (m) {
      const full = (await mailtmGet(`/messages/${m.id}`)) as { text?: string; html?: string[] | string; subject?: string; from?: { address?: string }; createdAt: string };
      let source = "";
      try { source = String(((await mailtmGet(`/sources/${m.id}`)) as { data?: string }).data ?? ""); } catch { /* no raw source: no header checks */ }
      return { id: m.id, subject: full.subject ?? m.subject ?? "", from: full.from?.address ?? m.from?.address ?? "", receivedAt: Date.parse(full.createdAt), text: full.text ?? "", html: Array.isArray(full.html) ? full.html.join("") : full.html ?? "", source };
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`nothing arrived in ${Math.round(waitMs / 1000)} s`);
}

/**
 * SPF, DKIM and DMARC as the receiving server recorded them (Authentication-Results), or failing that as a relay on
 * the way recorded them (ARC-Authentication-Results); plus who signed and where bounces go.
 */
function authResults(source: string) {
  const headers = source.split(/\r?\n\r?\n/)[0] ?? "";
  const unfolded = headers.replace(/\r?\n[ \t]+/g, " ");
  const lines = unfolded.split(/\r?\n/);
  const direct = lines.filter((l) => /^Authentication-Results:/i.test(l)).join(" ");
  const arc = lines.filter((l) => /^ARC-Authentication-Results:/i.test(l)).join(" ");
  const ar = direct || arc;
  const pick = (k: string) => new RegExp(`(?:^|[\\s;])${k}=(\\w+)`, "i").exec(ar)?.[1]?.toLowerCase() ?? null;
  const sig = /^DKIM-Signature:(.*)$/im.exec(unfolded)?.[1] ?? "";
  const dkimDomain = /\bd=([^;\s]+)/.exec(sig)?.[1] ?? null;
  const dkimSelector = /\bs=([^;\s]+)/.exec(sig)?.[1] ?? null;
  const returnPath = /^Return-Path:\s*<?([^>\s]+)>?/im.exec(unfolded)?.[1] ?? null;
  const from = /^From:.*?<?([^<>\s]+@[^<>\s]+)>?\s*$/im.exec(unfolded)?.[1] ?? null;
  return { spf: pick("spf"), dkim: pick("dkim"), dmarc: pick("dmarc"), by: direct ? "the inbox" : arc ? "a relay on the way (ARC)" : null, dkimDomain, dkimSelector, returnPath, from };
}

/** The DNS records behind those checks (AUTH.md §8 step 3), over DNS-over-HTTPS so it works from any network. */
async function dnsTxt(name: string): Promise<string[]> {
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=TXT`, { headers: { Accept: "application/dns-json" } });
    const j = (await res.json()) as { Answer?: { data?: string }[] };
    return (j.Answer ?? []).map((a) => String(a.data ?? "").replace(/^"|"$/g, "").replace(/"\s*"/g, ""));
  } catch { return []; }
}
async function dnsReport(r: ReturnType<typeof authResults>): Promise<string> {
  const fromDomain = r.from?.split("@")[1] ?? null;
  const bounceDomain = r.returnPath?.split("@")[1] ?? null;
  const out: string[] = [];
  if (bounceDomain) out.push(`SPF ${bounceDomain}: ${(await dnsTxt(bounceDomain)).find((t) => t.startsWith("v=spf1")) ?? "MISSING"}`);
  if (r.dkimDomain && r.dkimSelector) out.push(`DKIM ${r.dkimSelector}._domainkey.${r.dkimDomain}: ${(await dnsTxt(`${r.dkimSelector}._domainkey.${r.dkimDomain}`)).some((t) => /\bp=[A-Za-z0-9+/]+/.test(t)) ? "key published" : "MISSING"}`);
  if (fromDomain) out.push(`DMARC ${fromDomain}: ${(await dnsTxt(`_dmarc.${fromDomain}`)).find((t) => t.startsWith("v=DMARC1")) ?? "MISSING"}`);
  return out.join(" · ");
}

/** The 6-digit code in the email, ignoring links (a verify link's hex token ends in digits often enough to fool a regex). */
function codeIn(m: Mail): string | null {
  const text = `${m.subject}\n${m.text}\n${m.html.replace(/<[^>]+>/g, " ")}`.replace(/https?:\/\/[^\s"'<>)\]]+/g, " ");
  return /(?<![\d\w])(\d{6})(?![\d\w])/.exec(text)?.[1] ?? null;
}
const linksIn = (m: Mail) => [...new Set([...`${m.text}\n${m.html}`.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((x) => x[0]))];

async function askCode(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = (await rl.question(`Type the 6-digit code that reached ${email}: `)).trim();
  rl.close();
  return code;
}

/* ───────────── the run ───────────── */

let supabaseUserId: string | null = null;
let stopCluster: (() => void) | null = null;
let closeDb: (() => Promise<void>) | null = null;

async function main() {
  console.log(`Supabase email sign-in check · ${url} · ${email} (${existing ? "address already known" : "brand-new address"}) · inbox ${mailtm ? "read by the script (mail.tm)" : "typed by you"}\n`);

  // 1. Settings.
  await step("settings", async () => {
    const a = await auth("/settings");
    if (a.status !== 200) throw new Error(`/settings answered ${a.status}`);
    const s = a.json as { external?: { email?: boolean; phone?: boolean }; mailer_autoconfirm?: boolean; disable_signup?: boolean };
    if (!s.external?.email) throw new Error("the email provider is off");
    if (s.mailer_autoconfirm) throw new Error("mailer_autoconfirm is on: addresses would sign in without a code");
    if (s.disable_signup) throw new Error("sign-ups are disabled: a new traveller could not sign in");
    return s;
  }, (s) => `email on · phone ${s.external?.phone ? "on" : "off"} · confirm email on`);

  // 2. Make the address known first (--existing), with the service role, as an account that signed in before would be.
  if (existing) {
    if (!service) throw new Error("--existing needs SUPABASE_SERVICE_ROLE_KEY");
    await step("precreate", async () => {
      const a = await auth("/admin/users", { body: { email, email_confirm: true }, key: service });
      if (a.status === 200 || a.status === 201) { supabaseUserId = String((a.json as { id?: string }).id ?? ""); return "created"; }
      if (a.status === 422 && /exists|registered/i.test(errMsg(a) + errCode(a))) return "already there";
      throw new Error(`${a.status} ${errCode(a)}: ${errMsg(a)}`);
    }, (r) => `${r} (confirmed email, no password)`);
  }

  // 3. Send the code.
  const sentAt = Date.now();
  await step("send", async () => {
    const a = await auth("/otp", { body: { email, create_user: true } });
    if (a.status !== 200) throw new Error(`${a.status} ${errCode(a)}: ${errMsg(a)}`);
    return a;
  }, () => `POST /otp accepted (${existing ? "Magic link" : "Confirm signup"} template)`);

  // 4. The email.
  let code: string | null = null;
  if (mailtm) {
    const mail = await step("inbox", () => waitForMail(sentAt, 90_000), (m) => `arrived ${Math.max(0, Math.round((m.receivedAt - sentAt) / 1000))} s after sending · from ${m.from} · "${m.subject}"`);
    const r = authResults(mail.source);
    const auths = `SPF ${r.spf ?? "?"} · DKIM ${r.dkim ?? "?"}${r.dkimDomain ? ` (d=${r.dkimDomain})` : ""} · DMARC ${r.dmarc ?? "?"}${r.by ? `, as recorded by ${r.by}` : ", nothing recorded them"}`;
    record("headers", r.spf === "pass" && r.dkim === "pass" && r.dmarc === "pass" ? true : "warn", 0, mail.source ? auths : "no raw source from the inbox: SPF/DKIM/DMARC not checked");
    if (mail.source) {
      const dns = await dnsReport(r);
      record("dns", dns && !dns.includes("MISSING") ? true : "warn", 0, dns || "no sender domains in the headers");
    }
    code = codeIn(mail);
    const links = linksIn(mail).filter((l) => !/mail\.tm|unsubscribe/i.test(l));
    if (code) record("template", true, 0, `carries a 6-digit code${links.some((l) => /\/verify|token=/.test(l)) ? " (and still a link: trim the template)" : ""}`);
    else record("template", false, 0, `no 6-digit code in the email${links.length ? `; it carries a link: ${links[0]}${/localhost/.test(links[0]!) ? " (Site URL is still the default)" : ""}` : ""}. Fix the template (AUTH.md §2.3, §8 step 4).`);
  } else {
    console.log(`  → a code was sent to ${email}.`);
    code = await askCode();
    record("inbox", true, 0, "code typed by hand (delivery time and headers not checked)");
  }

  // 5. Wrong codes: six in a row, as a traveller mistyping would.
  await step("wrong", async () => {
    const out: { status: number; code: string; ms: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const t0 = Date.now();
      const a = await auth("/verify", { body: { type: "email", email, token: String(100000 + ((i * 7919 + 13) % 900000)) } });
      out.push({ status: a.status, code: errCode(a), ms: Date.now() - t0 });
      if (a.status === 200) throw new Error("a wrong code signed in");
    }
    return out;
  }, (out) => {
    const friendly = out.every((o) => o.status === 403 && /otp_expired|invalid|expired/i.test(o.code));
    const slowed = out.some((o) => o.status === 429);
    const text = `${out.map((o) => `${o.status} ${o.code}`).filter((v, i, a) => a.indexOf(v) === i).join(", ")} · ${out.map((o) => o.ms).join("/")} ms${slowed ? " · a later try was rate-limited" : " · none slowed down by Supabase (the app's own counter does that, otp.ts)"}`;
    return friendly || slowed ? text : { warn: `unexpected answers: ${text}` };
  });

  if (!code) throw new StepFailed("template");

  // 6. The right code.
  const session = await step("verify", async () => {
    const a = await auth("/verify", { body: { type: "email", email, token: code } });
    if (a.status !== 200) throw new Error(`${a.status} ${errCode(a)}: ${errMsg(a)}`);
    const s = a.json as { access_token?: string; user?: { id?: string; email?: string; email_confirmed_at?: string; app_metadata?: { providers?: string[] } } };
    if (!s.access_token || !s.user?.id) throw new Error("no session in the answer");
    supabaseUserId = s.user.id;
    return s as { access_token: string; user: { id: string; email?: string; email_confirmed_at?: string; app_metadata?: { providers?: string[] } } };
  }, (s) => `signed in · user ${s.user.id.slice(0, 8)}… · providers ${(s.user.app_metadata?.providers ?? []).join(",") || "-"} · email ${s.user.email_confirmed_at ? "confirmed" : "NOT confirmed"}`);

  // 7. The Core API, on a throwaway Postgres built by the real migrations.
  await step("core api", async () => {
    const cluster = await startCluster();
    stopCluster = cluster.stop;
    const sql = postgres(cluster.url, { max: 1, onnotice: () => {} });
    await migrate(drizzle(sql), { migrationsFolder: join(here, "../drizzle") });
    await sql.end();
    process.env.DATABASE_URL = cluster.url;
    process.env.APP_JWT_SECRET ??= "auth-check-secret-for-the-mada-core-api-0123456789";
    process.env.APP_DATA_KEY ??= Buffer.alloc(32, 9).toString("base64");
    process.env.SUPPLIER_MODE ??= "mock";
    process.env.SUPPLIER_MODE_SUPABASE = "live";
    process.env.SUPABASE_URL = url;
    const { POST: sessionRoute } = await import("../src/app/api/app/v1/auth/session/route");
    const { GET: meRoute, PATCH: mePatch } = await import("../src/app/api/app/v1/me/route");
    const db = await import("../src/db");
    closeDb = () => db.sql.end({ timeout: 5 });
    const call = async (handler: (req: Request, ctx?: unknown) => Promise<Response>, init: { method?: string; body?: unknown; token?: string }) => {
      const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "10.9.9.9", "user-agent": "auth-check" };
      if (init.token) headers.authorization = `Bearer ${init.token}`;
      const res = await handler(new Request("http://localhost/api/app/v1/x", { method: init.method ?? "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }), { params: Promise.resolve({}) });
      const text = await res.text();
      return { status: res.status, json: (text ? JSON.parse(text) : null) as Record<string, unknown> | null };
    };
    type SignIn = { tokens: { accessToken: string }; user: { id: string; email: string | null; emailVerified?: boolean; methods: Record<string, boolean | undefined> }; isNew: boolean };
    const first = await call(sessionRoute, { body: { accessToken: session.access_token, device: { platform: "ios" } } });
    if (first.status !== 200) throw new Error(`/auth/session answered ${first.status}: ${JSON.stringify(first.json)}`);
    const a = first.json as unknown as SignIn;
    // The app finishes onboarding (a name) before the traveller ever signs in again; isNew stays true until then.
    const onboarded = await call(mePatch, { method: "PATCH", token: a.tokens.accessToken, body: { name: "Check", onboarded: true } });
    if (onboarded.status !== 200) throw new Error(`PATCH /me answered ${onboarded.status}: ${JSON.stringify(onboarded.json)}`);
    const second = await call(sessionRoute, { body: { accessToken: session.access_token, device: { platform: "ios" } } });
    if (second.status !== 200) throw new Error(`second /auth/session answered ${second.status}: ${JSON.stringify(second.json)}`);
    const b = second.json as unknown as SignIn;
    const me = await call(meRoute, { method: "GET", token: b.tokens.accessToken });
    if (me.status !== 200) throw new Error(`/me answered ${me.status}: ${JSON.stringify(me.json)}`);
    const u = (me.json as unknown as { user: SignIn["user"] }).user;
    const problems = [
      !a.isNew && "first exchange did not create the account", a.user.id !== b.user.id && "the second exchange found a different account", b.isNew && "the second exchange still says isNew after onboarding",
      u.email !== email && `the account's email is ${u.email ?? "empty"}`, u.emailVerified !== true && "the email is not marked verified", !u.methods.email && "the email method is not on",
    ].filter(Boolean) as string[];
    if (problems.length) throw new Error(problems.join("; "));
    return { id: a.user.id };
  }, (r) => `created once (isNew), onboarded, found again (not new), /me shows the verified email · account ${r.id.slice(0, 8)}…`);
}

async function cleanup() {
  try { await closeDb?.(); } catch { /* already closed */ }
  try { stopCluster?.(); } catch { /* already gone */ }
  // A brand-new address that never signed in was still created by /otp: find it by email so no test user is left behind.
  if (!supabaseUserId && service && !keep) {
    const a = await auth("/admin/users?page=1&per_page=200", { key: service });
    const users = ((a.json as { users?: { id: string; email?: string }[] } | null)?.users ?? []);
    supabaseUserId = users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
  }
  if (!supabaseUserId) return;
  if (keep) { console.log(`\n--keep: Supabase user ${supabaseUserId} left in place.`); return; }
  if (!service) { console.log(`\nNo SUPABASE_SERVICE_ROLE_KEY: Supabase user ${supabaseUserId} (${email}) is still there; delete it in the dashboard.`); return; }
  const t0 = Date.now();
  const a = await auth(`/admin/users/${supabaseUserId}`, { method: "DELETE", key: service });
  record("cleanup", a.status === 200, Date.now() - t0, a.status === 200 ? `Supabase user removed (${email})` : `delete answered ${a.status} ${errCode(a)}: remove ${supabaseUserId} in the dashboard`);
}

main()
  .then(() => cleanup())
  .catch(async (e) => { if (!(e instanceof StepFailed)) console.error(`\n✗ ${e instanceof Error ? e.message : String(e)}`); await cleanup().catch(() => {}); })
  .finally(() => {
    const failed = steps.filter((s) => s.ok === false).length;
    const warned = steps.filter((s) => s.ok === "warn").length;
    console.log(`\n${steps.length - failed}/${steps.length} steps passed${warned ? ` (${warned} to look at)` : ""}.`);
    process.exit(failed ? 1 : 0);
  });
