import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from "jose";
import { sql as rawSql } from "drizzle-orm";
import { ApiErrorBody, MeResponse, SignInResponse, encodeMockSupabaseToken, type MockSupabaseClaims } from "@mada/shared";
import { db } from "@/db";
import { outbox } from "@/lib/app/suppliers";
import { supplierMode } from "@/lib/app/config";
import { verifySupabaseToken } from "@/lib/app/suppliers/live/supabase";
import { signStandardWebhook, verifyStandardWebhook } from "@/lib/app/sms-hook";
import { POST as session } from "@/app/api/app/v1/auth/session/route";
import { POST as sync } from "@/app/api/app/v1/auth/session/sync/route";
import { POST as smsHook } from "@/app/api/app/v1/auth/sms-hook/route";
import { POST as otpStart } from "@/app/api/app/v1/auth/otp/start/route";
import { POST as otpVerify } from "@/app/api/app/v1/auth/otp/verify/route";
import { GET as meGet, PATCH as mePatch } from "@/app/api/app/v1/me/route";
import { POST as ordersPost } from "@/app/api/app/v1/orders/route";
import { call, freshIp, newPhone } from "./helpers";

const expectError = (r: { status: number; json: unknown }, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.json)).toBe(status);
  expect(ApiErrorBody.parse(r.json).error.code).toBe(code);
};

let seq = 0;
const sub = () => `sb-${Date.now().toString(36)}-${++seq}`;
const mock = (c: Partial<MockSupabaseClaims> & { sub: string }) =>
  encodeMockSupabaseToken({ providers: [], exp: Math.floor(Date.now() / 1000) + 3600, ...c });

async function exchange(token: string, extra: Record<string, unknown> = {}) {
  const r = await call(session, { body: { accessToken: token, device: { platform: "ios" }, ...extra }, ip: freshIp() });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return SignInResponse.parse(r.json);
}

/* ───────────── the live verifier, against a local key set ───────────── */

describe("Supabase access tokens (live verifier)", () => {
  const URL_ = "https://abcd.supabase.co";
  let priv: CryptoKey, jwk: JWK, keys: ReturnType<typeof createLocalJWKSet>;
  beforeAll(async () => {
    const kp = await generateKeyPair("ES256", { extractable: true });
    priv = kp.privateKey;
    jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "ES256" };
    keys = createLocalJWKSet({ keys: [jwk] });
  });

  const sign = (claims: Record<string, unknown>, o: { iss?: string; aud?: string; exp?: number; key?: CryptoKey } = {}) =>
    new SignJWT({ role: "authenticated", ...claims }).setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setSubject(String(claims.sub ?? "2f0c6f8e-1111-4222-8333-944444444444")).setIssuer(o.iss ?? `${URL_}/auth/v1`).setAudience(o.aud ?? "authenticated")
      .setIssuedAt().setExpirationTime(o.exp ?? Math.floor(Date.now() / 1000) + 3600).sign(o.key ?? priv);

  it("accepts a valid token and reads what Supabase proved", async () => {
    const t = await sign({ phone: "966500001111", email: "Sara@Example.com", app_metadata: { provider: "phone", providers: ["phone", "email"] }, user_metadata: { full_name: "Sara Ahmed" } });
    const id = await verifySupabaseToken(t, { url: URL_, keys });
    expect(id).toMatchObject({ phone: "+966500001111", phoneVerified: true, email: "sara@example.com", emailVerified: true, providers: ["phone", "email"], name: "Sara Ahmed" });
  });

  it("treats a Google email as verified only when Google said so", async () => {
    const yes = await verifySupabaseToken(await sign({ email: "a@gmail.com", app_metadata: { provider: "google", providers: ["google"] }, user_metadata: { email_verified: true } }), { url: URL_, keys });
    expect(yes.emailVerified).toBe(true);
    const no = await verifySupabaseToken(await sign({ email: "b@gmail.com", app_metadata: { provider: "google", providers: ["google"] } }), { url: URL_, keys });
    expect(no.emailVerified).toBe(false);
  });

  it("refuses an expired token as TOKEN_EXPIRED", async () => {
    const t = await sign({}, { exp: Math.floor(Date.now() / 1000) - 120 });
    await expect(verifySupabaseToken(t, { url: URL_, keys })).rejects.toMatchObject({ code: "TOKEN_EXPIRED" });
  });

  it("refuses a token from another project, audience, key or role", async () => {
    await expect(verifySupabaseToken(await sign({}, { iss: "https://evil.supabase.co/auth/v1" }), { url: URL_, keys })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(verifySupabaseToken(await sign({}, { aud: "anon" }), { url: URL_, keys })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const other = (await generateKeyPair("ES256")).privateKey;
    await expect(verifySupabaseToken(await sign({}, { key: other }), { url: URL_, keys })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(verifySupabaseToken(await sign({ role: "anon" }), { url: URL_, keys })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(verifySupabaseToken(await sign({ is_anonymous: true }), { url: URL_, keys })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(verifySupabaseToken("not.a.jwt", { url: URL_, keys })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("checks legacy HS256 tokens only when the project secret is set", async () => {
    const secret = "legacy-supabase-jwt-secret-0123456789abcdef";
    const t = await new SignJWT({ role: "authenticated", email: "x@example.com", app_metadata: { providers: ["email"] } }).setProtectedHeader({ alg: "HS256" })
      .setSubject("legacy-1").setIssuer(`${URL_}/auth/v1`).setAudience("authenticated").setExpirationTime("10m").sign(new TextEncoder().encode(secret));
    await expect(verifySupabaseToken(t, { url: URL_, keys })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await verifySupabaseToken(t, { url: URL_, keys, hsSecret: secret })).sub).toBe("legacy-1");
  });

  it("fetches the project's JWKS through /auth/session in live mode", async () => {
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(`${URL_}/auth/v1/.well-known/jwks.json`);
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("SUPPLIER_MODE_SUPABASE", "live");
    vi.stubEnv("SUPABASE_URL", URL_);
    try {
      const phone = newPhone();
      const s = await exchange(await sign({ sub: "6b1f0b0e-aaaa-4bbb-8ccc-0000000000a1", phone: phone.slice(1), app_metadata: { provider: "phone", providers: ["phone"] } }));
      expect(s.user.phone).toBe(phone);
      expect(fetchSpy).toHaveBeenCalled();
      expectError(await call(session, { body: { accessToken: await sign({}, { iss: "https://other.supabase.co/auth/v1" }) } }), 401, "UNAUTHORIZED");
      expectError(await call(session, { body: { accessToken: await sign({}, { exp: Math.floor(Date.now() / 1000) - 60 }) } }), 401, "TOKEN_EXPIRED");
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});

/* ───────────── the exchange (mock Supabase) ───────────── */

describe("POST /auth/session", () => {
  it("creates an account for a new phone sign-in, then finds it again by Supabase id", async () => {
    const s1 = sub(), phone = newPhone();
    const a = await exchange(mock({ sub: s1, phone, providers: ["phone"] }));
    expect(a.isNew).toBe(true);
    expect(a.user).toMatchObject({ phone, methods: { phone: true, apple: false, google: false, email: false } });
    expect(a.tokens.refreshToken).toMatch(/^mrt_/);
    expect((await call(meGet, { method: "GET", token: a.tokens.accessToken })).status).toBe(200);
    const [row] = await db.execute<{ supabase_user_id: string; phone_verified: boolean; auth_providers: string[] }>(rawSql`SELECT supabase_user_id, phone_verified, auth_providers FROM app_users WHERE id = ${a.user.id}`);
    expect(row).toMatchObject({ supabase_user_id: s1, phone_verified: true, auth_providers: ["phone"] });

    await call(mePatch, { method: "PATCH", token: a.tokens.accessToken, body: { name: "Omar", onboarded: true } });
    const b = await exchange(mock({ sub: s1, phone, providers: ["phone"] }));
    expect(b.user.id).toBe(a.user.id);
    expect(b.isNew).toBe(false);
  });

  it("links a pre-Supabase phone account by its verified number", async () => {
    const phone = newPhone();
    const ip = freshIp();
    await call(otpStart, { body: { phone }, ip });
    const legacy = SignInResponse.parse((await call(otpVerify, { body: { phone, code: "123456" }, ip })).json);
    const s = await exchange(mock({ sub: sub(), phone, providers: ["phone"] }));
    expect(s.user.id).toBe(legacy.user.id);
    const audit = await db.execute<{ action: string }>(rawSql`SELECT action FROM app_audit WHERE actor_id = ${legacy.user.id}`);
    expect(audit.map((r) => r.action)).toContain("account.identity_linked");
  });

  it("links by verified email, and Apple's name fills an empty one", async () => {
    const email = `sara.${seq}${Date.now()}@example.com`;
    const first = await exchange(mock({ sub: sub(), email, providers: ["email"] }));
    expect(first.user).toMatchObject({ email, emailVerified: true, phone: null, methods: { email: true } });
    const viaApple = await exchange(mock({ sub: sub(), email: email.toUpperCase(), providers: ["apple"] }), { givenName: "Sara" });
    expect(viaApple.user.id).toBe(first.user.id);
    expect(viaApple.user.name).toBe("Sara");
  });

  it("keeps Apple's private relay address and marks it", async () => {
    const s = await exchange(mock({ sub: sub(), email: `k${Date.now()}@privaterelay.appleid.com`, providers: ["apple"], name: "Omar Al" }));
    expect(s.user).toMatchObject({ emailRelay: true, name: "Omar", methods: { apple: true, google: false } });
  });

  it("refuses tokens it can't trust", async () => {
    expectError(await call(session, { body: { accessToken: "mocksb.bm90LWpzb24" } }), 401, "UNAUTHORIZED");
    expectError(await call(session, { body: { accessToken: mock({ sub: sub(), exp: Math.floor(Date.now() / 1000) - 5 }) } }), 401, "TOKEN_EXPIRED");
    expectError(await call(session, { body: { accessToken: encodeMockSupabaseToken({ sub: "x", providers: [], exp: 4e9, iss: "someone-else" }) } }), 401, "UNAUTHORIZED");
    expectError(await call(session, { body: {} }), 400, "VALIDATION");
  });

  it("refuses the mock adapter on a production deployment unless mocks are allowed", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("SUPPLIER_MODE", "");
    vi.stubEnv("SUPPLIER_MODE_SUPABASE", "mock");
    try {
      expect(() => supplierMode("supabase")).toThrow(/mock mode on a production deployment/);
      vi.stubEnv("APP_ALLOW_MOCKS", "yes");
      expect(supplierMode("supabase")).toBe("mock");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("turns the pre-Supabase routes off in production", async () => {
    vi.stubEnv("APP_LEGACY_AUTH", "no");
    try {
      expectError(await call(otpStart, { body: { phone: newPhone() }, ip: freshIp() }), 404, "NOT_FOUND");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

/* ───────────── a phone before the first booking, and adding ways in ───────────── */

describe("Verify your phone and sign-in methods", () => {
  it("blocks the first booking until a phone is verified, then adds it through sync", async () => {
    const s1 = sub();
    const email = `g${Date.now()}@gmail.com`;
    const a = await exchange(mock({ sub: s1, email, providers: ["google"] }));
    expect(a.user.phone).toBeNull();
    const order = { draft: { kind: "esim", count: 1 }, payment: { method: "card", cardId: "00000000-0000-4000-8000-000000000001" }, plan: "full", expectedTotal: 100, idempotencyKey: `phone-gate-${s1}` };
    expectError(await call(ordersPost, { token: a.tokens.accessToken, body: order }), 403, "PHONE_REQUIRED");

    const phone = newPhone();
    const r = await call(sync, { token: a.tokens.accessToken, body: { accessToken: mock({ sub: s1, email, phone, providers: ["google", "phone"] }) } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(MeResponse.parse(r.json).user).toMatchObject({ phone, methods: { google: true, phone: true } });
    const again = await call(ordersPost, { token: a.tokens.accessToken, body: { ...order, idempotencyKey: `phone-gate-2-${s1}` } });
    expect(ApiErrorBody.safeParse(again.json).data?.error.code).not.toBe("PHONE_REQUIRED");
  });

  it("refuses a number that is on another account, and another person's Supabase user", async () => {
    const owner = await exchange(mock({ sub: sub(), phone: newPhone(), providers: ["phone"] }));
    const s1 = sub();
    const me = await exchange(mock({ sub: s1, email: `m${Date.now()}@example.com`, providers: ["email"] }));
    expectError(await call(sync, { token: me.tokens.accessToken, body: { accessToken: mock({ sub: s1, phone: owner.user.phone!, providers: ["email", "phone"] }) } }), 409, "PHONE_TAKEN");
    expectError(await call(sync, { token: me.tokens.accessToken, body: { accessToken: mock({ sub: sub(), phone: newPhone(), providers: ["phone"] }) } }), 409, "IDENTITY_TAKEN");
    expectError(await call(sync, { body: { accessToken: mock({ sub: s1, providers: ["email"] }) } }), 401, "UNAUTHORIZED");
  });

  it("at sign-in, skips a number someone else holds instead of locking the person out", async () => {
    const owner = await exchange(mock({ sub: sub(), phone: newPhone(), providers: ["phone"] }));
    const s1 = sub();
    await exchange(mock({ sub: s1, email: `n${Date.now()}@example.com`, providers: ["email"] }));
    const again = await exchange(mock({ sub: s1, email: `n-other@example.com`, phone: owner.user.phone!, providers: ["email", "phone"] }));
    expect(again.user.phone).toBeNull();
    expect(again.user.id).not.toBe(owner.user.id);
  });

  it("records providers as Supabase reports them (an unlinked Google goes away)", async () => {
    const s1 = sub(), phone = newPhone();
    const a = await exchange(mock({ sub: s1, phone, providers: ["phone"] }));
    const linked = await call(sync, { token: a.tokens.accessToken, body: { accessToken: mock({ sub: s1, phone, email: `l${Date.now()}@gmail.com`, providers: ["phone", "google"] }) } });
    expect(MeResponse.parse(linked.json).user.methods).toMatchObject({ google: true, phone: true });
    const unlinked = await call(sync, { token: a.tokens.accessToken, body: { accessToken: mock({ sub: s1, phone, providers: ["phone"] }) } });
    expect(MeResponse.parse(unlinked.json).user.methods).toMatchObject({ google: false, phone: true });
  });
});

/* ───────────── Supabase's Send SMS hook ───────────── */

describe("POST /auth/sms-hook", () => {
  const SECRET = `v1,whsec_${Buffer.from("a-32-byte-secret-for-the-sms-hook!").toString("base64")}`;
  afterEach(() => { vi.unstubAllEnvs(); });

  const hook = async (payload: unknown, o: { secret?: string; ts?: number; id?: string; sig?: string } = {}) => {
    const raw = JSON.stringify(payload);
    const ts = o.ts ?? Math.floor(Date.now() / 1000);
    const id = o.id ?? `msg_${Math.random().toString(36).slice(2)}`;
    const req = new Request("http://localhost/api/app/v1/auth/sms-hook", {
      method: "POST", body: raw,
      headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": o.sig ?? signStandardWebhook(o.secret ?? SECRET, id, ts, raw) },
    });
    const res = await smsHook(req);
    return { status: res.status, json: JSON.parse(await res.text()) as Record<string, unknown> };
  };

  it("checks signatures the Standard Webhooks way", () => {
    const h = new Headers({ "webhook-id": "msg_1", "webhook-timestamp": "1700000000", "webhook-signature": `v0,abc ${signStandardWebhook(SECRET, "msg_1", 1700000000, "{}")}` });
    expect(verifyStandardWebhook(SECRET, h, "{}", 1700000000_000)).toEqual({ ok: true });
    expect(verifyStandardWebhook(SECRET, h, "{ }", 1700000000_000)).toEqual({ ok: false, reason: "signature" });
    expect(verifyStandardWebhook(SECRET, h, "{}", (1700000000 + 301) * 1000)).toEqual({ ok: false, reason: "stale" });
    expect(verifyStandardWebhook(SECRET, new Headers(), "{}")).toEqual({ ok: false, reason: "missing" });
  });

  it("sends the code through the SMS adapter when the call is signed", async () => {
    vi.stubEnv("SUPABASE_SMS_HOOK_SECRET", SECRET);
    const phone = newPhone();
    const r = await hook({ user: { id: "u1", phone: phone.slice(1) }, sms: { otp: "482913" } });
    expect(r).toEqual({ status: 200, json: {} });
    const sent = outbox.find((m) => m.to === phone && m.body.includes("482913"));
    expect(sent?.channel).toBe("sms");
    const leaks = await db.execute<{ n: number }>(rawSql`SELECT count(*)::int AS n FROM app_audit WHERE summary LIKE '%482913%'`);
    expect(leaks[0]!.n).toBe(0);
  });

  it("sends a phone change's code to the new number, in Arabic when the person reads Arabic", async () => {
    vi.stubEnv("SUPABASE_SMS_HOOK_SECRET", SECRET);
    const oldPhone = newPhone(), next = newPhone();
    expect((await hook({ user: { phone: oldPhone, new_phone: next.slice(1), user_metadata: { locale: "ar" } }, sms: { otp: "551177" } })).status).toBe(200);
    expect(outbox.some((m) => m.to === next && m.body.includes("551177"))).toBe(true);
    expect(outbox.some((m) => m.to === oldPhone && m.body.includes("551177"))).toBe(false);
  });

  it("refuses unsigned, wrongly signed and replayed calls", async () => {
    vi.stubEnv("SUPABASE_SMS_HOOK_SECRET", SECRET);
    const p = { user: { phone: "966500000001" }, sms: { otp: "123123" } };
    expect((await hook(p, { secret: `v1,whsec_${Buffer.from("another-secret-entirely-000000000").toString("base64")}` })).status).toBe(401);
    expect((await hook(p, { sig: "v1,AAAA" })).status).toBe(401);
    const stale = await hook(p, { ts: Math.floor(Date.now() / 1000) - 600 });
    expect(stale).toMatchObject({ status: 401, json: { error: { http_code: 401 } } });
    expect((await hook({ user: {}, sms: {} })).status).toBe(400);
  });

  it("says so when the secret isn't set", async () => {
    vi.stubEnv("SUPABASE_SMS_HOOK_SECRET", "");
    expect((await hook({ user: { phone: "966500000001" }, sms: { otp: "123123" } })).status).toBe(501);
  });
});
