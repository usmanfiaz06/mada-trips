import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, count, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { checkSaudiMobile, type ReviewLoginRequest, type ReviewLoginResponse } from "@mada/shared";
import { db } from "@/db";
import { appAudit, appUsers } from "@/db/app-schema";
import { appAuditLog } from "./audit";
import { supplierMode } from "./config";
import { AppError } from "./http";
import { maskContact, normaliseContact, type Contact } from "./recovery";

/*
 * The App Review sign-in (docs/app/store/REVIEW.md). Store reviewers can't receive our codes, so one contact can sign
 * in with a fixed code:
 *
 *   APP_REVIEW_LOGIN   the review contact: an email (recommended, e.g. review@madatrips.sa) or a Saudi mobile, or both
 *                      separated by a comma (one account holding both).
 *   APP_REVIEW_CODE    six digits the reviewer types on the code screen.
 *
 * Rules:
 *   - Off unless BOTH are set: the route answers 404 as if it didn't exist.
 *   - Only with live Supabase (SUPPLIER_MODE_SUPABASE=live): mock sign-in already takes any account, and this path
 *     must never be one more way into a mock build.
 *   - Only the named contact, only the exact code (constant-time compare). Anyone else gets the same "wrong code".
 *   - Every success and every wrong code for the review contact is audited (auth.review_login, …_failed), masked.
 *     More than REVIEW_FAILURES_PER_HOUR wrong codes for it in an hour pause it (429), whoever sends them.
 *   - The answer is a real Supabase access token for the review user (admin API: create once, set a fresh random
 *     password, sign in with it), so /auth/session and everything after it is the ordinary path.
 * Turn it off after review by removing APP_REVIEW_CODE.
 */

export const REVIEW_FAILURES_PER_HOUR = 20;

type ReviewConfig = { contacts: Contact[]; code: string };

/** The review login, or null when it is off (either variable missing or malformed). */
export function reviewConfig(): ReviewConfig | null {
  const login = process.env.APP_REVIEW_LOGIN?.trim();
  const code = process.env.APP_REVIEW_CODE?.trim();
  if (!login || !code || !/^\d{6}$/.test(code)) return null;
  const contacts: Contact[] = [];
  for (const raw of login.split(",").map((s) => s.trim()).filter(Boolean)) {
    if (raw.includes("@")) contacts.push({ kind: "email", value: raw.toLowerCase() });
    else {
      const p = checkSaudiMobile(raw);
      if (p.ok) contacts.push({ kind: "phone", value: p.e164 });
    }
  }
  return contacts.length ? { contacts, code } : null;
}

const digest = (s: string) => createHash("sha256").update(s).digest();
const sameCode = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/* ───────── Supabase (GoTrue) admin and token endpoints, with the service-role key ───────── */

function supabaseEnv() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("[app-api] review login is set but SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing");
    throw new AppError("NOT_CONFIGURED");
  }
  return { url, key };
}

async function gotrue(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<unknown> {
  const { url, key } = supabaseEnv();
  const res = await fetch(`${url}/auth/v1${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  // Never echo Supabase's body: it can carry the address or number.
  if (!res.ok) throw Object.assign(new Error(`Supabase ${method} ${path.split("?")[0]} answered ${res.status}`), { status: res.status });
  return text ? (JSON.parse(text) as unknown) : null;
}

type SbUser = { id: string; email?: string | null; phone?: string | null };
const bare = (phone: string) => phone.replace(/^\+/, "");
const matches = (u: SbUser, c: Contact) => (c.kind === "email" ? u.email?.toLowerCase() === c.value : u.phone === bare(c.value));

/** The Supabase user behind the review contacts: the one our account is linked to, else found or created. */
async function reviewUserId(cfg: ReviewConfig): Promise<string> {
  const byContact = cfg.contacts.map((c) => (c.kind === "phone" ? eq(appUsers.phone, c.value) : sql`lower(${appUsers.email}) = ${c.value}`));
  const [linked] = await db.select({ sub: appUsers.supabaseUserId }).from(appUsers)
    .where(and(or(...byContact), isNotNull(appUsers.supabaseUserId), isNull(appUsers.deletedAt))).limit(1);
  if (linked?.sub) return linked.sub;

  const fields: Record<string, unknown> = { user_metadata: { review_account: true } };
  for (const c of cfg.contacts) {
    if (c.kind === "email") Object.assign(fields, { email: c.value, email_confirm: true });
    else Object.assign(fields, { phone: bare(c.value), phone_confirm: true });
  }
  try {
    const created = (await gotrue("POST", "/admin/users", fields)) as SbUser | null;
    if (created?.id) return created.id;
  } catch (e) {
    if ((e as { status?: number }).status !== 422) throw e;
  }
  // Already in Supabase (an earlier review, or the account was deleted on our side only): look it up.
  for (let page = 1; page <= 20; page++) {
    const r = (await gotrue("GET", `/admin/users?page=${page}&per_page=500`)) as { users?: SbUser[] } | null;
    const users = r?.users ?? [];
    const found = users.find((u) => cfg.contacts.some((c) => matches(u, c)));
    if (found) return found.id;
    if (users.length < 500) break;
  }
  throw new Error("Supabase has no user for the review contact and would not create one");
}

/** A fresh random password (meets the project's rules: lower, upper, digit, symbol), then a password sign-in. */
async function reviewAccessToken(cfg: ReviewConfig, contact: Contact): Promise<{ accessToken: string; sub: string }> {
  const sub = await reviewUserId(cfg);
  const password = `${randomBytes(24).toString("base64url")}aA1!`;
  await gotrue("PUT", `/admin/users/${encodeURIComponent(sub)}`, { password });
  const login = contact.kind === "email" ? { email: contact.value, password } : { phone: bare(contact.value), password };
  const r = (await gotrue("POST", "/token?grant_type=password", login)) as { access_token?: string } | null;
  if (!r?.access_token) throw new Error("Supabase returned no access token for the review login");
  return { accessToken: r.access_token, sub };
}

export async function reviewSignIn(input: ReviewLoginRequest, ctx: { ipHash: string | null }, now = new Date()): Promise<ReviewLoginResponse> {
  const cfg = reviewConfig();
  if (!cfg || supplierMode("supabase") !== "live") throw new AppError("NOT_FOUND");

  let contact: Contact;
  try { contact = normaliseContact(input.contact, "contact.value"); } catch { throw new AppError("OTP_WRONG"); }
  const isReview = cfg.contacts.some((c) => c.kind === contact.kind && c.value === contact.value);
  // Anyone else: the same answer as a wrong code, and nothing stored about them.
  if (!isReview) throw new AppError("OTP_WRONG");

  const hourAgo = new Date(now.getTime() - 3_600_000);
  const [{ n }] = (await db.select({ n: count() }).from(appAudit)
    .where(and(eq(appAudit.action, "auth.review_login_failed"), gt(appAudit.createdAt, hourAgo)))) as [{ n: number }];
  if (n >= REVIEW_FAILURES_PER_HOUR) throw new AppError("RATE_LIMITED", { retryAfter: 3600 });

  if (!sameCode(input.code, cfg.code)) {
    await appAuditLog(db, { actorKind: "system", actorId: null, action: "auth.review_login_failed", entityType: "review_login", summary: `Wrong review code for ${maskContact(contact)}`, ipHash: ctx.ipHash });
    throw new AppError("OTP_WRONG");
  }

  const { accessToken, sub } = await reviewAccessToken(cfg, contact);
  await appAuditLog(db, { actorKind: "system", actorId: null, action: "auth.review_login", entityType: "review_login", entityId: null, summary: `App Review sign-in for ${maskContact(contact)}`, data: { kind: contact.kind, supabaseUser: sub }, ipHash: ctx.ipHash });
  return { accessToken };
}
