import { describe, expect, it, beforeAll } from "vitest";
import { SignJWT } from "jose";
import { sql as rawSql } from "drizzle-orm";
import { ApiErrorBody, HealthResponse, MeResponse, OtpStartResponse, SignInResponse, RefreshResponse } from "@mada/shared";
import { db } from "@/db";
import { outbox } from "@/lib/app/suppliers";
import { GET as health } from "@/app/api/app/v1/health/route";
import { POST as otpStart } from "@/app/api/app/v1/auth/otp/start/route";
import { POST as otpVerify } from "@/app/api/app/v1/auth/otp/verify/route";
import { POST as refresh } from "@/app/api/app/v1/auth/refresh/route";
import { POST as logout } from "@/app/api/app/v1/auth/logout/route";
import { POST as apple } from "@/app/api/app/v1/auth/apple/route";
import { GET as meGet, PATCH as mePatch } from "@/app/api/app/v1/me/route";
import { call, freshIp, newPhone } from "./helpers";

/** Push this number's codes 31 seconds into the past, so the resend wait is over. */
const skipCooldown = (phone: string) => db.execute(rawSql`UPDATE app_otp SET created_at = created_at - interval '31 seconds' WHERE phone = ${phone}`);

async function signUp(phone = newPhone()) {
  const ip = freshIp();
  const s = await call(otpStart, { body: { phone }, ip });
  expect(s.status).toBe(200);
  const v = await call(otpVerify, { body: { phone, code: "123456", device: { platform: "ios", name: "Test iPhone" } }, ip });
  expect(v.status, JSON.stringify(v.json)).toBe(200);
  return { phone, ip, ...SignInResponse.parse(v.json) };
}

const expectError = (r: { status: number; json: unknown }, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.json)).toBe(status);
  const e = ApiErrorBody.parse(r.json);
  expect(e.error.code).toBe(code);
  expect(e.error.message.length).toBeGreaterThan(3);
  return e.error;
};

describe("health", () => {
  it("reports the database, mocked suppliers and the data key", async () => {
    const r = await call(health as never, { method: "GET" });
    expect(r.status).toBe(200);
    const h = HealthResponse.parse(r.json);
    expect(h).toMatchObject({ ok: true, db: "ok", dataKey: "ok", apiVersion: "v1" });
    expect(h.suppliers.sms).toBe("mock");
    expect(Object.keys(h.suppliers)).toEqual(expect.arrayContaining(["flights", "hotels", "payments", "sms", "whatsapp", "flightStatus", "ai", "email"]));
  });
});

describe("phone sign-in", () => {
  it("refuses numbers that aren't Saudi mobiles, with the reason", async () => {
    const r = await call(otpStart, { body: { phone: "4000041" }, ip: freshIp() });
    const e = expectError(r, 400, "PHONE_INVALID");
    expect(e.fields).toEqual({ phone: "prefix" });
    expectError(await call(otpStart, { body: {}, ip: freshIp() }), 400, "VALIDATION");
    expectError(await call(otpStart, { raw: "{not json", ip: freshIp() }), 400, "VALIDATION");
  });

  it("sends a code (logged by the mock SMS) and normalises the number", async () => {
    const r = await call(otpStart, { body: { phone: "050 000 4127" }, ip: freshIp() });
    expect(r.status).toBe(200);
    expect(OtpStartResponse.parse(r.json)).toEqual({ phone: "+966500004127", resendAfter: 30, expiresIn: 600, length: 6 });
    expect(outbox[0]).toMatchObject({ channel: "sms", to: "+966500004127" });
    expect(outbox[0]!.body).toContain("123456");
    const [row] = await db.execute<{ code_hash: string }>(rawSql`SELECT code_hash FROM app_otp WHERE phone = '+966500004127'`);
    expect(row!.code_hash).not.toContain("123456");
  });

  it("makes you wait 30 seconds before another code", async () => {
    const phone = newPhone();
    await call(otpStart, { body: { phone }, ip: freshIp() });
    const e = expectError(await call(otpStart, { body: { phone }, ip: freshIp() }), 429, "OTP_COOLDOWN");
    expect(e.retryAfter).toBeGreaterThan(25);
    expect(e.retryAfter).toBeLessThanOrEqual(30);
  });

  it("counts down 3 tries, then locks the code until a new one is sent", async () => {
    const phone = newPhone();
    const ip = freshIp();
    await call(otpStart, { body: { phone }, ip });
    expect(expectError(await call(otpVerify, { body: { phone, code: "000000" }, ip }), 401, "OTP_WRONG")).toMatchObject({ triesLeft: 2, message: "That code doesn't match. 2 tries left." });
    expect(expectError(await call(otpVerify, { body: { phone, code: "111111" }, ip }), 401, "OTP_WRONG")).toMatchObject({ triesLeft: 1, message: "That code doesn't match. 1 try left." });
    expectError(await call(otpVerify, { body: { phone, code: "222222" }, ip }), 423, "OTP_LOCKED");
    // Even the right code is refused now.
    expectError(await call(otpVerify, { body: { phone, code: "123456" }, ip }), 423, "OTP_LOCKED");
    // A new code clears it.
    await skipCooldown(phone);
    expect((await call(otpStart, { body: { phone }, ip })).status).toBe(200);
    expect((await call(otpVerify, { body: { phone, code: "123456" }, ip })).status).toBe(200);
  });

  it("uses each code once, and refuses a code that was never sent", async () => {
    const { phone, ip } = await signUp();
    expectError(await call(otpVerify, { body: { phone, code: "123456" }, ip }), 410, "OTP_EXPIRED");
    expectError(await call(otpVerify, { body: { phone: newPhone(), code: "123456" }, ip }), 410, "OTP_EXPIRED");
  });

  it("expires codes after 10 minutes", async () => {
    const phone = newPhone();
    await call(otpStart, { body: { phone }, ip: freshIp() });
    await db.execute(rawSql`UPDATE app_otp SET expires_at = now() - interval '1 second' WHERE phone = ${phone}`);
    expectError(await call(otpVerify, { body: { phone, code: "123456" } }), 410, "OTP_EXPIRED");
  });

  it("allows 5 codes per number per hour", async () => {
    const phone = newPhone();
    for (let i = 0; i < 5; i += 1) {
      expect((await call(otpStart, { body: { phone }, ip: freshIp() })).status).toBe(200);
      await skipCooldown(phone);
    }
    const e = expectError(await call(otpStart, { body: { phone }, ip: freshIp() }), 429, "OTP_RATE_LIMITED");
    expect(e.retryAfter).toBeGreaterThan(60);
  });

  it("allows 20 codes per network per hour", async () => {
    const ip = freshIp();
    for (let i = 0; i < 20; i += 1) expect((await call(otpStart, { body: { phone: newPhone() }, ip })).status).toBe(200);
    expectError(await call(otpStart, { body: { phone: newPhone() }, ip }), 429, "RATE_LIMITED");
  });

  it("creates the account on first sign-in, with the holder in the household", async () => {
    const { user, isNew, tokens } = await signUp();
    expect(isNew).toBe(true);
    expect(user).toMatchObject({ name: "", alerts: "quiet", notifications: "unknown", methods: { apple: false, google: false, phone: true }, onboardedAt: null });
    expect(tokens.refreshToken).toMatch(/^mrt_/);
    const [s] = await db.execute<{ refresh_hash: string; platform: string }>(rawSql`SELECT refresh_hash, platform FROM app_sessions WHERE user_id = ${user.id}`);
    expect(s!.refresh_hash).not.toBe(tokens.refreshToken);
    expect(s!.platform).toBe("ios");
    const [p] = await db.execute<{ n: number }>(rawSql`SELECT count(*)::int AS n FROM app_people WHERE owner_id = ${user.id} AND is_self`);
    expect(p!.n).toBe(1);
  });

  it("welcomes back an account that finished onboarding", async () => {
    const first = await signUp();
    await call(mePatch, { method: "PATCH", token: first.tokens.accessToken, body: { name: "Omar", onboarded: true } });
    await skipCooldown(first.phone);
    const again = await signUp(first.phone);
    expect(again.isNew).toBe(false);
    expect(again.user.id).toBe(first.user.id);
    expect(again.user.name).toBe("Omar");
  });
});

describe("sessions", () => {
  it("rotates refresh tokens and kills the session when an old one is replayed", async () => {
    const { tokens } = await signUp();
    const r1 = await call(refresh, { body: { refreshToken: tokens.refreshToken } });
    expect(r1.status).toBe(200);
    const t2 = RefreshResponse.parse(r1.json).tokens;
    expect(t2.refreshToken).not.toBe(tokens.refreshToken);
    expect((await call(meGet, { method: "GET", token: t2.accessToken })).status).toBe(200);

    // The first token again: someone copied it. The whole session ends.
    expectError(await call(refresh, { body: { refreshToken: tokens.refreshToken } }), 401, "SESSION_REVOKED");
    expectError(await call(refresh, { body: { refreshToken: t2.refreshToken } }), 401, "UNAUTHORIZED");
    expectError(await call(meGet, { method: "GET", token: t2.accessToken }), 401, "SESSION_REVOKED");
  });

  it("refuses unknown refresh tokens", async () => {
    expectError(await call(refresh, { body: { refreshToken: "mrt_" + "x".repeat(43) } }), 401, "UNAUTHORIZED");
  });

  it("signs out this device", async () => {
    const { tokens } = await signUp();
    expect((await call(logout, { token: tokens.accessToken, body: { refreshToken: tokens.refreshToken } })).status).toBe(200);
    expectError(await call(meGet, { method: "GET", token: tokens.accessToken }), 401, "SESSION_REVOKED");
    expectError(await call(refresh, { body: { refreshToken: tokens.refreshToken } }), 401, "UNAUTHORIZED");
    expectError(await call(logout, { body: {} }), 401, "UNAUTHORIZED");
  });

  it("tells an expired access token from a bad one", async () => {
    const { tokens, user } = await signUp();
    const [s] = await db.execute<{ id: string }>(rawSql`SELECT id FROM app_sessions WHERE user_id = ${user.id}`);
    const expired = await new SignJWT({ sid: s!.id }).setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuer("mada-core").setAudience("mada-app")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600).setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.APP_JWT_SECRET));
    expectError(await call(meGet, { method: "GET", token: expired }), 401, "TOKEN_EXPIRED");
    const forged = await new SignJWT({ sid: s!.id }).setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuer("mada-core").setAudience("mada-app")
      .setExpirationTime("10m").sign(new TextEncoder().encode("another-secret-that-is-long-enough-000000"));
    expectError(await call(meGet, { method: "GET", token: forged }), 401, "UNAUTHORIZED");
    expectError(await call(meGet, { method: "GET", token: tokens.accessToken.slice(0, -2) + "xx" }), 401, "UNAUTHORIZED");
    expectError(await call(meGet, { method: "GET" }), 401, "UNAUTHORIZED");
  });
});

describe("/me", () => {
  let token: string;
  beforeAll(async () => { token = (await signUp()).tokens.accessToken; });

  it("reads and updates the profile", async () => {
    const r = await call(meGet, { method: "GET", token });
    expect(MeResponse.parse(r.json).user.phone).toMatch(/^\+9665/);
    const p = await call(mePatch, { method: "PATCH", token, body: { name: "  Sara ", alerts: "everything", notifications: "allowed", onboarded: true } });
    expect(p.status).toBe(200);
    const u = MeResponse.parse(p.json).user;
    expect(u).toMatchObject({ name: "Sara", alerts: "everything", notifications: "allowed" });
    expect(u.onboardedAt).not.toBeNull();
  });

  it("validates the patch", async () => {
    expectError(await call(mePatch, { method: "PATCH", token, body: {} }), 400, "VALIDATION");
    const e = expectError(await call(mePatch, { method: "PATCH", token, body: { alerts: "loud" } }), 400, "VALIDATION");
    expect(Object.keys(e.fields ?? {})).toEqual(["alerts"]);
    expectError(await call(mePatch, { method: "PATCH", token, body: { name: "x".repeat(31) } }), 400, "VALIDATION");
  });
});

describe("Sign in with Apple (mock) then a mobile number", () => {
  it("creates the account, hides the email, then attaches the verified phone", async () => {
    const a = await call(apple, { body: { idToken: "mock:apple-user-1:k7x2m9q4pz@privaterelay.appleid.com", givenName: "Omar" } });
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    const s = SignInResponse.parse(a.json);
    expect(s.isNew).toBe(true);
    expect(s.user).toMatchObject({ name: "Omar", emailRelay: true, phone: null, methods: { apple: true, phone: false } });

    const phone = newPhone();
    await call(otpStart, { body: { phone }, ip: freshIp() });
    const v = await call(otpVerify, { token: s.tokens.accessToken, body: { phone, code: "123456" } });
    expect(v.status).toBe(200);
    const after = SignInResponse.parse(v.json);
    expect(after.user.id).toBe(s.user.id);
    expect(after.user.methods).toMatchObject({ apple: true, google: false, phone: true });

    // Same Apple account again: same user.
    const again = SignInResponse.parse((await call(apple, { body: { idToken: "mock:apple-user-1:k7x2m9q4pz@privaterelay.appleid.com" } })).json);
    expect(again.user.id).toBe(s.user.id);
  });

  it("won't attach a number that belongs to someone else", async () => {
    const other = await signUp();
    const s = SignInResponse.parse((await call(apple, { body: { idToken: "mock:apple-user-2" } })).json);
    await skipCooldown(other.phone);
    await call(otpStart, { body: { phone: other.phone }, ip: freshIp() });
    expectError(await call(otpVerify, { token: s.tokens.accessToken, body: { phone: other.phone, code: "123456" } }), 409, "PHONE_TAKEN");
  });

  it("refuses tokens it can't verify", async () => {
    expectError(await call(apple, { body: { idToken: "eyJhbGciOi.not.real" } }), 401, "UNAUTHORIZED");
  });
});

describe("audit trail", () => {
  it("records sign-ins and can't be edited", async () => {
    const { user } = await signUp();
    const rows = await db.execute<{ action: string }>(rawSql`SELECT action FROM app_audit WHERE actor_id = ${user.id} ORDER BY created_at`);
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["account.created", "auth.signed_in"]));
    const why = (p: Promise<unknown>) => p.then(() => "no error", (e: { cause?: { message?: string } }) => String(e.cause?.message ?? e));
    expect(await why(db.execute(rawSql`UPDATE app_audit SET summary = 'x' WHERE actor_id = ${user.id}`))).toMatch(/app_audit is append-only/);
    expect(await why(db.execute(rawSql`DELETE FROM app_audit WHERE actor_id = ${user.id}`))).toMatch(/app_audit is append-only/);
    // No code or full number ever lands in the log.
    const leaks = await db.execute<{ n: number }>(rawSql`SELECT count(*)::int AS n FROM app_audit WHERE summary LIKE '%123456%' OR entity_id LIKE '+9665%'`);
    expect(leaks[0]!.n).toBe(0);
  });
});
