import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql as rawSql } from "drizzle-orm";
import { ApiErrorBody, ConfigResponse, HealthResponse, PeopleResponse, SignInResponse, StatusResponse } from "@mada/shared";
import { db } from "@/db";
import { appIdempotencyKeys, appSupplierHealth } from "@/db/app-schema-resilience";
import { AppError, json, route } from "@/lib/app/http";
import { BREAKER, callSupplier, guarded, resetBreakers } from "@/lib/app/resilience/breaker";
import { clearRuntimeCache, setRuntimeConfig } from "@/lib/app/resilience/runtime";
import { GET as configGet } from "@/app/api/app/v1/config/route";
import { GET as statusGet } from "@/app/api/app/v1/status/route";
import { GET as health } from "@/app/api/app/v1/health/route";
import { POST as otpStart } from "@/app/api/app/v1/auth/otp/start/route";
import { POST as otpVerify } from "@/app/api/app/v1/auth/otp/verify/route";
import { GET as peopleGet, POST as peoplePost } from "@/app/api/app/v1/people/route";
import { call, freshIp, newPhone } from "./helpers";

type H = (req: Request) => Promise<Response>;

/** Like helpers.call, with any headers. */
async function send(handler: H, opts: { method?: string; path?: string; body?: unknown; headers?: Record<string, string>; token?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": "10.9.9.9", "user-agent": "vitest", ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const req = new Request(`http://localhost${opts.path ?? "/api/app/v1/test"}`, { method: opts.method ?? "POST", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const res = await handler(req);
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, headers: res.headers, json: (text ? JSON.parse(text) : null) as any };
}

async function token() {
  const phone = newPhone();
  const ip = freshIp();
  await call(otpStart, { body: { phone }, ip });
  return SignInResponse.parse((await call(otpVerify, { body: { phone, code: "123456" }, ip })).json).tokens.accessToken;
}

const key = () => `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;

afterEach(async () => {
  await setRuntimeConfig(null);
  clearRuntimeCache();
  resetBreakers();
  vi.restoreAllMocks();
});

describe("the error envelope and request ids", () => {
  it("wraps an expected failure with its code, copy, extra fields and the request id", async () => {
    const h = route(async () => { throw new AppError("RATE_LIMITED", { vars: { seconds: 30 }, retryAfter: 30, details: { scope: "otp" } }); });
    const r = await send(h, { method: "GET" });
    expect(r.status).toBe(429);
    const body = ApiErrorBody.parse(r.json);
    expect(body.error).toMatchObject({ code: "RATE_LIMITED", retryAfter: 30, details: { scope: "otp" } });
    expect(body.error.message).toBe("Too many tries. Wait 30 seconds, then try again.");
    expect(r.headers.get("retry-after")).toBe("30");
    expect(body.error.requestId).toBe(r.headers.get("x-request-id"));
    expect(r.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number(r.headers.get("x-server-time"))).toBeGreaterThan(Date.now() - 5000);
  });

  it("turns anything unexpected into INTERNAL with calm words and no internals", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = route(async () => { throw new Error("connection to db-7.internal refused"); });
    const r = await send(h, { method: "GET", headers: { "x-request-id": "app-1234567890" } });
    expect(r.status).toBe(500);
    expect(r.json.error.code).toBe("INTERNAL");
    expect(r.json.error.message).toBe("That didn’t work, and it’s on us. Try once more, or talk to Mada.");
    expect(JSON.stringify(r.json)).not.toContain("db-7");
    // The app's own request id is kept when it's sane, so its logs and ours line up.
    expect(r.headers.get("x-request-id")).toBe("app-1234567890");
    expect(r.json.error.requestId).toBe("app-1234567890");
    expect(spy.mock.calls.flat().join(" ")).toContain("app-1234567890");
  });

  it("replaces a request id that isn't sane", async () => {
    const r = await send(route(async () => json({ ok: true })), { method: "GET", headers: { "x-request-id": "<script>" } });
    expect(r.headers.get("x-request-id")).not.toBe("<script>");
  });

  it("every catalogue code parses on the app side, including the new ones", () => {
    for (const code of ["SUPPLIER_DOWN", "MAINTENANCE", "UPGRADE_REQUIRED", "IDEMPOTENCY_CONFLICT", "IN_PROGRESS", "TIMEOUT"] as const) {
      const e = new AppError(code);
      expect(ApiErrorBody.safeParse({ error: { code, message: e.message } }).success, code).toBe(true);
      expect(e.message).not.toMatch(/⟦/);
    }
  });
});

describe("GET /config", () => {
  it("answers without sign-in, with defaults, the server's clock and a short public cache", async () => {
    const r = await send(configGet as H, { method: "GET", path: "/api/app/v1/config" });
    expect(r.status).toBe(200);
    const c = ConfigResponse.parse(r.json);
    expect(c).toMatchObject({ minVersion: "0.0.0", maintenance: { on: false, message: null, until: null } });
    expect(c.features.offlineOutbox).toBe(true);
    expect(Math.abs(Date.parse(c.serverTime) - Date.now())).toBeLessThan(5000);
    expect(r.headers.get("cache-control")).toContain("public");
  });

  it("takes overrides from Ops without a deploy", async () => {
    await setRuntimeConfig({ minVersion: "0.2.0", latestVersion: "0.3.0", features: { circlesDiscover: false }, maintenance: { on: true, message: "Back by 03:00 Riyadh time.", until: new Date(Date.now() + 600_000).toISOString() } });
    const c = ConfigResponse.parse((await send(configGet as H, { method: "GET", path: "/api/app/v1/config" })).json);
    expect(c).toMatchObject({ minVersion: "0.2.0", latestVersion: "0.3.0", maintenance: { on: true, message: "Back by 03:00 Riyadh time." } });
    expect(c.features).toMatchObject({ circlesDiscover: false, offlineOutbox: true });
  });

  it("ends maintenance by itself once its end time has passed", async () => {
    await setRuntimeConfig({ maintenance: { on: true, until: new Date(Date.now() - 1000).toISOString() } });
    const c = ConfigResponse.parse((await send(configGet as H, { method: "GET", path: "/api/app/v1/config" })).json);
    expect(c.maintenance.on).toBe(false);
  });

  it("is answered even for an app that must update, and during maintenance", async () => {
    await setRuntimeConfig({ minVersion: "9.0.0", maintenance: { on: true } });
    const r = await send(configGet as H, { method: "GET", path: "/api/app/v1/config", headers: { "x-app-version": "0.1.0" } });
    expect(r.status).toBe(200);
  });
});

describe("version and maintenance gates", () => {
  const echo = route(async () => json({ ok: true }));

  it("asks an old app to update (426) and lets current and unknown versions through", async () => {
    await setRuntimeConfig({ minVersion: "0.2.0" });
    const old = await send(echo, { method: "GET", headers: { "x-app-version": "0.1.9" } });
    expect(old.status).toBe(426);
    expect(old.json.error).toMatchObject({ code: "UPGRADE_REQUIRED", details: { minVersion: "0.2.0" } });
    expect((await send(echo, { method: "GET", headers: { "x-app-version": "0.2.0" } })).status).toBe(200);
    expect((await send(echo, { method: "GET", headers: { "x-app-version": "1.10.0" } })).status).toBe(200);
    expect((await send(echo, { method: "GET" })).status).toBe(200);
  });

  it("pauses changes during maintenance with Retry-After, but reads and sign-in keep working", async () => {
    const until = new Date(Date.now() + 120_000).toISOString();
    await setRuntimeConfig({ maintenance: { on: true, until } });
    const w = await send(echo, { method: "POST", body: {} });
    expect(w.status).toBe(503);
    expect(w.json.error).toMatchObject({ code: "MAINTENANCE", details: { until } });
    expect(Number(w.headers.get("retry-after"))).toBeGreaterThan(60);
    expect((await send(echo, { method: "GET" })).status).toBe(200);
    expect((await send(echo, { method: "POST", path: "/api/app/v1/auth/refresh", body: {} })).status).toBe(200);
  });
});

describe("idempotency", () => {
  it("runs a keyed mutation once and replays the first answer", async () => {
    let runs = 0;
    const h = route(async (req) => { runs += 1; const b = await req.json(); return json({ n: runs, got: b }, 201); });
    const k = key();
    const a = await send(h, { body: { amount: 100 }, headers: { "idempotency-key": k } });
    const b = await send(h, { body: { amount: 100 }, headers: { "idempotency-key": k } });
    expect(runs).toBe(1);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.json).toEqual(a.json);
    expect(b.headers.get("idempotency-replayed")).toBe("true");
    expect(a.headers.get("idempotency-replayed")).toBeNull();
  });

  it("refuses the same key with a different request", async () => {
    const h = route(async () => json({ ok: true }));
    const k = key();
    await send(h, { body: { amount: 100 }, headers: { "idempotency-key": k } });
    const r = await send(h, { body: { amount: 999 }, headers: { "idempotency-key": k } });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("answers IN_PROGRESS to a double tap while the first is still running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let runs = 0;
    const h = route(async () => { runs += 1; await gate; return json({ paid: true }, 201); });
    const k = key();
    const first = send(h, { body: { pay: 1 }, headers: { "idempotency-key": k } });
    await new Promise((r) => setTimeout(r, 150));
    const second = await send(h, { body: { pay: 1 }, headers: { "idempotency-key": k } });
    expect(second.status).toBe(409);
    expect(second.json.error).toMatchObject({ code: "IN_PROGRESS", retryAfter: 2 });
    release();
    expect((await first).status).toBe(201);
    expect(runs).toBe(1);
    // Once it's done, the third try gets the kept answer.
    const third = await send(h, { body: { pay: 1 }, headers: { "idempotency-key": k } });
    expect(third.status).toBe(201);
    expect(runs).toBe(1);
  });

  it("doesn't keep answers that may change: a 5xx or a thrown problem lets the retry run for real", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let runs = 0;
    const h = route(async () => { runs += 1; if (runs === 1) throw new Error("boom"); return json({ ok: true }); });
    const k = key();
    expect((await send(h, { body: {}, headers: { "idempotency-key": k } })).status).toBe(500);
    expect((await send(h, { body: {}, headers: { "idempotency-key": k } })).status).toBe(200);
    expect(runs).toBe(2);
  });

  it("takes over a claim whose function died", async () => {
    const k = key();
    let runs = 0;
    const hang = route(async () => { runs += 1; return new Promise<Response>(() => {}); });
    void send(hang, { body: { a: 1 }, headers: { "idempotency-key": k } });
    await new Promise((r) => setTimeout(r, 150));
    // The function was killed two minutes ago, mid-way: its claim is still "running".
    await db.update(appIdempotencyKeys).set({ lockedAt: new Date(Date.now() - 120_000) }).where(eq(appIdempotencyKeys.key, k));
    const h = route(async () => { runs += 1; return json({ ok: true }); });
    const r = await send(h, { body: { a: 1 }, headers: { "idempotency-key": k } });
    expect(r.status).toBe(200);
    expect(runs).toBe(2);
    const [row] = await db.select().from(appIdempotencyKeys).where(eq(appIdempotencyKeys.key, k));
    expect(row!.state).toBe("done");
  });

  it("rejects a malformed key", async () => {
    const r = await send(route(async () => json({ ok: true })), { body: {}, headers: { "idempotency-key": "short" } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("VALIDATION");
  });

  it("guards a real route: a retried POST /people adds one person, per user", async () => {
    const t = await token();
    const k = key();
    const person = { givenNames: "Sara", surname: "Alharbi", relation: "child" };
    const a = await send(peoplePost as H, { token: t, body: person, headers: { "idempotency-key": k }, path: "/api/app/v1/people" });
    const b = await send(peoplePost as H, { token: t, body: person, headers: { "idempotency-key": k }, path: "/api/app/v1/people" });
    expect(a.status).toBe(201);
    expect(b.json.person.id).toBe(a.json.person.id);
    const list = PeopleResponse.parse((await send(peopleGet as H, { method: "GET", token: t })).json).people;
    expect(list.filter((p) => p.firstName === "Sara")).toHaveLength(1);
    // Keys belong to their user: someone else's identical key is their own.
    const other = await token();
    const c = await send(peoplePost as H, { token: other, body: person, headers: { "idempotency-key": k }, path: "/api/app/v1/people" });
    expect(c.status).toBe(201);
    expect(c.json.person.id).not.toBe(a.json.person.id);
  });
});

describe("circuit breakers", () => {
  beforeEach(() => resetBreakers());
  const down = () => Promise.reject(new TypeError("fetch failed"));

  it("opens after repeated failures and then fails fast without calling the supplier", async () => {
    for (let i = 0; i < BREAKER.FAILURES; i++) await expect(callSupplier("flights", down)).rejects.toThrow("fetch failed");
    const fn = vi.fn(async () => "never");
    const t0 = Date.now();
    const e = await callSupplier("flights", fn).catch((x: unknown) => x);
    expect(Date.now() - t0).toBeLessThan(50);
    expect(fn).not.toHaveBeenCalled();
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe("SUPPLIER_DOWN");
    expect((e as AppError).extra.details).toMatchObject({ supplier: "flights", label: "The airline", reason: "open" });
    expect((e as AppError).extra.retryAfter).toBeGreaterThan(0);
  });

  it("turns a supplier that hangs into a quick SUPPLIER_DOWN", async () => {
    const e = await callSupplier("sms", () => new Promise(() => {}), { timeoutMs: 80 }).catch((x: unknown) => x);
    expect((e as AppError).code).toBe("SUPPLIER_DOWN");
    expect((e as AppError).extra.details).toMatchObject({ reason: "timeout" });
  });

  it("lets one trial through after the cooldown, and closes on success", async () => {
    for (let i = 0; i < BREAKER.FAILURES; i++) await callSupplier("hotels", down).catch(() => {});
    const real = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(real + BREAKER.COOLDOWN_MS + 10);
    expect(await callSupplier("hotels", async () => "ok")).toBe("ok");
    expect(await callSupplier("hotels", async () => "again")).toBe("again");
  });

  it("doesn't count business answers, and rethrows them unchanged", async () => {
    class Declined extends Error {}
    for (let i = 0; i < BREAKER.FAILURES + 2; i++) await expect(callSupplier("payments", () => Promise.reject(new Declined("card declined")))).rejects.toBeInstanceOf(Declined);
    for (let i = 0; i < BREAKER.FAILURES + 2; i++) await expect(callSupplier("payments", () => Promise.reject(new AppError("NOT_CONFIGURED")))).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(await callSupplier("payments", async () => 1)).toBe(1);
  });

  it("wraps an adapter: methods go through the breaker, other properties stay as they were", async () => {
    let calls = 0;
    const adapter = { name: "live-sms", async send(to: string) { calls += 1; if (to === "bad") throw new TypeError("fetch failed"); return { id: to }; } };
    const g = guarded("whatsapp", adapter);
    expect(g.name).toBe("live-sms");
    expect(await g.send("ok")).toEqual({ id: "ok" });
    for (let i = 0; i < BREAKER.FAILURES; i++) await g.send("bad").catch(() => {});
    await expect(g.send("ok")).rejects.toMatchObject({ code: "SUPPLIER_DOWN" });
    expect(calls).toBe(1 + BREAKER.FAILURES);
  });
});

describe("GET /status and health", () => {
  beforeEach(async () => {
    resetBreakers();
    await new Promise((r) => setTimeout(r, 50)); // let earlier tests' background health writes land
    await db.delete(appSupplierHealth);
  });

  it("is all clear when every supplier answers", async () => {
    await db.delete(appSupplierHealth);
    const r = await send(statusGet as H, { method: "GET", path: "/api/app/v1/status" });
    expect(r.status).toBe(200);
    expect(StatusResponse.parse(r.json)).toMatchObject({ status: "ok", degraded: [] });
    expect(r.headers.get("cache-control")).toContain("max-age=15");
  });

  it("lists a supplier whose breaker is open, across instances, and health shows it", async () => {
    for (let i = 0; i < BREAKER.FAILURES; i++) await callSupplier("flights", () => Promise.reject(new TypeError("fetch failed"))).catch(() => {});
    await new Promise((r) => setTimeout(r, 100)); // the health row is written in the background
    const s = StatusResponse.parse((await send(statusGet as H, { method: "GET", path: "/api/app/v1/status" })).json);
    expect(s.status).toBe("down");
    expect(s.degraded).toEqual([expect.objectContaining({ name: "flights", label: "The airline", state: "down" })]);
    const [row] = await db.select().from(appSupplierHealth).where(eq(appSupplierHealth.name, "flights"));
    expect(row).toMatchObject({ state: "down", lastProblem: "TypeError" });
    // Another instance (fresh breakers) still sees it from the table.
    resetBreakers();
    const again = StatusResponse.parse((await send(statusGet as H, { method: "GET", path: "/api/app/v1/status" })).json);
    expect(again.degraded.map((d) => d.name)).toContain("flights");
    // Health on this instance: open breakers by name.
    for (let i = 0; i < BREAKER.FAILURES; i++) await callSupplier("flights", () => Promise.reject(new TypeError("fetch failed"))).catch(() => {});
    const h = HealthResponse.parse((await send(health as H, { method: "GET", path: "/api/app/v1/health" })).json);
    expect(h.breakers).toMatchObject({ flights: "down" });
    expect(h.maintenance).toBe(false);
    expect(typeof h.dbMs).toBe("number");
    await db.execute(rawSql`DELETE FROM app_supplier_health`);
  });

  it("says down during maintenance", async () => {
    await db.delete(appSupplierHealth);
    await setRuntimeConfig({ maintenance: { on: true } });
    const s = StatusResponse.parse((await send(statusGet as H, { method: "GET", path: "/api/app/v1/status" })).json);
    expect(s).toMatchObject({ status: "down", maintenance: { on: true } });
  });
});
