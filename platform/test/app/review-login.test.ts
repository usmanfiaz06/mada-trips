import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ReviewLoginResponse } from "@mada/shared";
import { db } from "@/db";
import { appAudit, appUsers } from "@/db/app-schema";
import { REVIEW_FAILURES_PER_HOUR } from "@/lib/app/review-login";
import { POST as review } from "@/app/api/app/v1/auth/review/route";
import { call, freshIp, newPhone } from "./helpers";

/*
 * The App Review sign-in: off unless configured, never with mock Supabase, only the review contact with the exact
 * code, audited, paused after too many wrong codes, and a real Supabase token from the admin API (stubbed here).
 */

const REVIEW_EMAIL = `review.${Date.now()}@madatrips.sa`;
const REVIEW_PHONE = newPhone();
const CODE = "246810";
const ENV = ["APP_REVIEW_LOGIN", "APP_REVIEW_CODE", "SUPPLIER_MODE_SUPABASE", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

type Seen = { method: string; path: string; body: Record<string, unknown> | null; auth: string | null };
let seen: Seen[] = [];
let existing = false;

/** A stand-in for Supabase's GoTrue: create user (or 422 when it exists), list, set password, password grant. */
function fakeSupabase() {
  seen = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    const path = url.pathname.replace("/auth/v1", "") + url.search;
    seen.push({ method: init?.method ?? "GET", path, body, auth: new Headers(init?.headers).get("authorization") });
    const ok = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    if (path === "/admin/users" && init?.method === "POST") {
      if (existing) return new Response(JSON.stringify({ code: "email_exists" }), { status: 422 });
      return ok({ id: "sb-review-1", email: body?.email });
    }
    if (path.startsWith("/admin/users?page=")) return ok({ users: [{ id: "sb-other", email: "someone@example.com" }, { id: "sb-review-2", email: REVIEW_EMAIL, phone: REVIEW_PHONE.slice(1) }] });
    if (path.startsWith("/admin/users/") && init?.method === "PUT") return ok({ id: path.split("/").pop() });
    if (path === "/token?grant_type=password") return ok({ access_token: "eyJ.review-access-token.sig", token_type: "bearer" });
    return new Response("not found", { status: 404 });
  }));
}

function configure(over: Partial<Record<(typeof ENV)[number], string | undefined>> = {}) {
  const env = { APP_REVIEW_LOGIN: `${REVIEW_EMAIL},${REVIEW_PHONE}`, APP_REVIEW_CODE: CODE, SUPPLIER_MODE_SUPABASE: "live", SUPABASE_URL: "https://review-test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role-test-key", ...over };
  for (const k of ENV) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
}

const ask = (contact: { kind: "email" | "phone"; value: string }, code: string, ip = freshIp()) => call(review, { body: { contact, code }, ip });
const audits = (action: string) => db.select().from(appAudit).where(eq(appAudit.action, action));

beforeEach(() => { existing = false; fakeSupabase(); });
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  // app_audit is append-only; the test cluster is thrown away after the run.
});

describe("POST /auth/review", () => {
  it("doesn't exist unless both the contact and the code are set", async () => {
    for (const over of [{ APP_REVIEW_LOGIN: undefined }, { APP_REVIEW_CODE: undefined }, { APP_REVIEW_CODE: "12ab56" }]) {
      configure(over);
      const r = await ask({ kind: "email", value: REVIEW_EMAIL }, CODE);
      expect(r.status).toBe(404);
    }
    expect(seen).toHaveLength(0);
  });

  it("is never a way into a mock build", async () => {
    configure({ SUPPLIER_MODE_SUPABASE: "mock" });
    const r = await ask({ kind: "email", value: REVIEW_EMAIL }, CODE);
    expect(r.status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it("signs in the review email with the fixed code: a real Supabase token, audited without the address", async () => {
    configure();
    const r = await ask({ kind: "email", value: REVIEW_EMAIL.toUpperCase() }, CODE);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(ReviewLoginResponse.parse(r.json)).toEqual({ accessToken: "eyJ.review-access-token.sig" });
    // Created once with both contacts confirmed, a fresh password, then a password grant for the email.
    const create = seen.find((s) => s.method === "POST" && s.path === "/admin/users")!;
    expect(create.body).toMatchObject({ email: REVIEW_EMAIL, email_confirm: true, phone: REVIEW_PHONE.slice(1), phone_confirm: true });
    expect(create.auth).toBe("Bearer service-role-test-key");
    const put = seen.find((s) => s.method === "PUT")!;
    expect(put.path).toBe("/admin/users/sb-review-1");
    expect(String(put.body?.password)).toMatch(/^[A-Za-z0-9_-]{32}aA1!$/);
    const grant = seen.find((s) => s.path === "/token?grant_type=password")!;
    expect(grant.body).toEqual({ email: REVIEW_EMAIL, password: put.body?.password });
    const [a] = await audits("auth.review_login");
    expect(a!.summary).not.toContain(REVIEW_EMAIL);
    expect(JSON.stringify(a)).not.toContain(String(put.body?.password));
  });

  it("signs in the review phone, reusing the Supabase user already linked to our account", async () => {
    configure();
    await db.insert(appUsers).values({ name: "Review", phone: REVIEW_PHONE, phoneVerified: true, supabaseUserId: "sb-linked-9" });
    const loose = `0${REVIEW_PHONE.slice(4)}`;
    const r = await ask({ kind: "phone", value: loose }, CODE);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(seen.some((s) => s.method === "POST" && s.path === "/admin/users")).toBe(false);
    expect(seen.find((s) => s.method === "PUT")!.path).toBe("/admin/users/sb-linked-9");
    expect(seen.find((s) => s.path === "/token?grant_type=password")!.body).toMatchObject({ phone: REVIEW_PHONE.slice(1) });
    await db.delete(appUsers).where(eq(appUsers.supabaseUserId, "sb-linked-9"));
  });

  it("finds the Supabase user when it already exists there but not here", async () => {
    configure({ APP_REVIEW_LOGIN: REVIEW_EMAIL });
    existing = true;
    const r = await ask({ kind: "email", value: REVIEW_EMAIL }, CODE);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(seen.find((s) => s.method === "PUT")!.path).toBe("/admin/users/sb-review-2");
  });

  it("answers anyone else exactly like a wrong code, and stores nothing about them", async () => {
    configure();
    const before = (await audits("auth.review_login_failed")).length;
    const stranger = await ask({ kind: "email", value: "sara@example.com" }, CODE);
    const badPhone = await ask({ kind: "phone", value: "123456" }, CODE);
    expect(stranger.status).toBe(401);
    expect(stranger.json.error.code).toBe("OTP_WRONG");
    expect(badPhone.json.error.code).toBe("OTP_WRONG");
    expect((await audits("auth.review_login_failed")).length).toBe(before);
    expect(seen).toHaveLength(0);
  });

  it("refuses a wrong code for the review contact and audits it", async () => {
    configure();
    const r = await ask({ kind: "email", value: REVIEW_EMAIL }, "135791");
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("OTP_WRONG");
    expect(seen).toHaveLength(0);
    const rows = await audits("auth.review_login_failed");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => !x.summary.includes(REVIEW_EMAIL))).toBe(true);
  });

  it("validates the body", async () => {
    configure();
    const r = await call(review, { body: { contact: { kind: "email", value: "not-an-email" }, code: "12" }, ip: freshIp() });
    expect(r.status).toBe(400);
  });

  it("says not configured when Supabase's admin key is missing", async () => {
    configure({ SUPABASE_SERVICE_ROLE_KEY: undefined });
    const r = await ask({ kind: "email", value: REVIEW_EMAIL }, CODE);
    expect(r.status).toBe(501);
  });

  it(`pauses after ${REVIEW_FAILURES_PER_HOUR} wrong codes in an hour, even the right one`, async () => {
    configure();
    const have = (await audits("auth.review_login_failed")).length;
    for (let i = have; i < REVIEW_FAILURES_PER_HOUR; i++) {
      await db.insert(appAudit).values({ actorKind: "system", actorId: null, action: "auth.review_login_failed", entityType: "review_login", summary: "Wrong review code" });
    }
    const r = await ask({ kind: "email", value: REVIEW_EMAIL }, CODE);
    expect(r.status).toBe(429);
    expect(seen).toHaveLength(0);
  });
});
