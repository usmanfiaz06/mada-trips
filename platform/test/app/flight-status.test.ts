import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { estimatePosition, FlightPositionResponse, greatCirclePoint, SignInResponse, StatusResponse } from "@mada/shared";
import { db } from "@/db";
import { appNotifications, appTrips } from "@/db/app-schema";
import { appFlightSubscriptions } from "@/db/app-schema-flight-status";
import { POST as otpStart } from "@/app/api/app/v1/auth/otp/start/route";
import { POST as otpVerify } from "@/app/api/app/v1/auth/otp/verify/route";
import { GET as position } from "@/app/api/app/v1/flights/[flightNo]/position/route";
import { POST as adbWebhook } from "@/app/api/app/v1/flights/alerts/aerodatabox/[token]/route";
import { GET as statusGet } from "@/app/api/app/v1/status/route";
import { supplierMode } from "@/lib/app/config";
import { isDue, planFor, refreshEvery } from "@/lib/app/flight-status/cadence";
import { flightsJob } from "@/lib/app/flight-status/poll";
import { flightStatusNow } from "@/lib/app/flight-status/service";
import { usageOf } from "@/lib/app/flight-status/usage";
import { resetBreakers } from "@/lib/app/resilience/breaker";
import { flightStatusVendor } from "@/lib/app/suppliers";
import { mapAdb, pickFlight, type AdbFlight } from "@/lib/app/suppliers/live/aerodatabox";
import { mapAvs, type AvsFlight } from "@/lib/app/suppliers/live/aviationstack";
import { __positionsCache } from "@/lib/app/suppliers/live/flight-positions";
import { delayStep, trackFlight } from "@/lib/app/trips/status";
import { seedDemoTrip } from "@/lib/app/trips/seed";
import { call, freshIp, newPhone } from "./helpers";

/*
 * Flight status from AeroDataBox and aviationstack, with recorded fixtures (test/app/fixtures/flight-status): mapping,
 * the shared cache and polling cadence, the monthly budget, the vendor auto-pick, the flights job and alert webhooks
 * (each change told once), and linking status to ADS-B by hex with an honest estimate. No live network.
 */

const fx = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", "flight-status", name), "utf8"));
const H = 3_600_000;
const ENV_KEYS = ["SUPPLIER_MODE_FLIGHT_STATUS", "AERODATABOX_API_KEY", "AERODATABOX_MARKET", "AERODATABOX_PLAN", "AERODATABOX_MONTHLY_UNITS", "AERODATABOX_WEBHOOK_SECRET",
  "AVIATIONSTACK_API_KEY", "AVIATIONSTACK_MONTHLY_BUDGET", "FLIGHTAWARE_API_KEY", "SUPPLIER_MODE_FLIGHT_POSITIONS", "APP_PUBLIC_URL"];
const saved: Record<string, string | undefined> = {};
const SECRET = "test-webhook-secret-0123456789abcdef";

type Reply = { status?: number; body?: unknown };
/** A fetch stub answering by URL; records every call. */
function stubFetch(route: (url: string, init: RequestInit) => Reply | undefined) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const r = route(url, init) ?? { status: 404, body: { message: "not stubbed" } };
    const status = r.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(r.body ?? null), { status, headers: { "content-type": "application/json" } });
  }));
  return calls;
}

async function signIn() {
  const phone = newPhone();
  const ip = freshIp();
  await call(otpStart, { body: { phone }, ip });
  const r = SignInResponse.parse((await call(otpVerify, { body: { phone, code: "123456" }, ip })).json);
  return { token: r.tokens.accessToken, userId: r.user.id };
}

const notes = (userId: string) => db.select({ kind: appNotifications.kind, title: appNotifications.title, body: appNotifications.body }).from(appNotifications).where(eq(appNotifications.userId, userId));

beforeAll(async () => {
  await db.execute(sql`DELETE FROM app_supplier_usage; DELETE FROM app_flight_status_cache; DELETE FROM app_flight_subscriptions`);
});
beforeEach(() => { for (const k of ENV_KEYS) saved[k] = process.env[k]; });
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetBreakers();
});

describe("mapping recorded answers", () => {
  it("maps an AeroDataBox flight, picking the operating carrier over a codeshare", () => {
    const list = fx("aerodatabox-sv263-delayed.json") as AdbFlight[];
    const f = pickFlight(list, "2027-05-10")!;
    expect(f.codeshareStatus).toBe("IsOperator");
    expect(mapAdb("SV263", "2027-05-10", f)).toMatchObject({
      flightNumber: "SV263", carrierName: "Saudia", from: "RUH", to: "IST", departLocal: "2027-05-10T10:25", arriveLocal: "2027-05-10T14:40",
      status: "delayed", gate: "C4", terminal: "Terminal 3", source: "Live", delayMin: 45,
      departUtc: "2027-05-10T07:25:00.000Z", scheduledDepartUtc: "2027-05-10T06:40:00.000Z", arriveUtc: "2027-05-10T11:40:00.000Z", actualDepartUtc: null,
      arrivalTerminal: "I", baggageBelt: "12", aircraft: { reg: "HZ-AK11", hex: "710101", model: "Boeing 777-300ER" },
    });
  });
  it("maps cancellations, but never a guessed one", () => {
    const [c] = fx("aerodatabox-sv263-cancelled.json") as AdbFlight[];
    expect(mapAdb("SV263", "2027-05-10", c!).status).toBe("cancelled");
    expect(mapAdb("SV263", "2027-05-10", { ...c!, status: "CanceledUncertain" }).status).toBe("on_time");
    expect(mapAdb("SV263", "2027-05-10", { ...c!, status: "Diverted" }).status).toBe("diverted");
    expect(mapAdb("SV263", "2027-05-10", { ...c!, status: "EnRoute" }).status).toBe("in_air");
    expect(mapAdb("SV263", "2027-05-10", { ...c!, status: "Arrived" }).status).toBe("landed");
  });
  it("maps aviationstack, reading its times as the airport's wall clock", () => {
    const { data } = fx("aviationstack-sv263.json") as { data: AvsFlight[] };
    const m = mapAvs("SV263", "2027-05-10", data[1]!);
    expect(m).toMatchObject({
      status: "in_air", gate: "C4", terminal: "Terminal 3", delayMin: 45, departLocal: "2027-05-10T10:27", arriveLocal: "2027-05-10T14:35",
      scheduledDepartUtc: "2027-05-10T06:40:00.000Z", actualDepartUtc: "2027-05-10T07:40:00.000Z", baggageBelt: "12", aircraft: { reg: "HZ-AK11", hex: "710101" },
    });
    expect(mapAvs("SV263", "2027-05-09", data[0]!).status).toBe("landed");
  });
});

describe("polling cadence", () => {
  const dep = Date.parse("2027-05-10T06:40:00Z");
  const arr = dep + 4 * H;
  const at = (hoursBefore: number) => dep - hoursBefore * H;
  it("asks more often close to departure and in the air, and never after landing", () => {
    expect(refreshEvery({ now: at(72), departAt: dep, arriveAt: arr, plan: "basic" })).toBe(24 * H);
    expect(refreshEvery({ now: at(24), departAt: dep, arriveAt: arr, plan: "basic" })).toBe(12 * H);
    expect(refreshEvery({ now: at(5), departAt: dep, arriveAt: arr, plan: "basic" })).toBe(90 * 60_000);
    expect(refreshEvery({ now: at(2), departAt: dep, arriveAt: arr, plan: "basic" })).toBe(30 * 60_000);
    expect(refreshEvery({ now: dep + H, departAt: dep, arriveAt: arr, status: "in_air", plan: "basic" })).toBe(30 * 60_000);
    expect(refreshEvery({ now: at(2), departAt: dep, arriveAt: arr, plan: "pro" })).toBe(10 * 60_000);
    expect(refreshEvery({ now: dep + H, departAt: dep, arriveAt: arr, status: "landed", plan: "pro" })).toBeNull();
    expect(refreshEvery({ now: arr + 3 * H, departAt: dep, arriveAt: arr, plan: "pro" })).toBeNull();
  });
  it("keeps aviationstack's free plan to the last 6 hours", () => {
    expect(refreshEvery({ now: at(24), departAt: dep, arriveAt: arr, plan: "tight" })).toBeNull();
    expect(isDue({ now: at(24), departAt: dep, arriveAt: arr, plan: "tight", fetchedAt: null })).toBe(false);
    expect(isDue({ now: at(5), departAt: dep, arriveAt: arr, plan: "tight", fetchedAt: null })).toBe(true);
    expect(isDue({ now: at(5), departAt: dep, arriveAt: arr, plan: "tight", fetchedAt: at(5) - 30 * 60_000 })).toBe(false);
    expect(isDue({ now: at(2), departAt: dep, arriveAt: arr, plan: "tight", fetchedAt: at(2) - 61 * 60_000 })).toBe(true);
    expect(planFor("aviationstack", {})).toBe("tight");
    expect(planFor("aerodatabox", {})).toBe("basic");
    expect(planFor("aerodatabox", { AERODATABOX_PLAN: "pro" })).toBe("pro");
  });
  it("tells delays at 15 minutes and each further half hour", () => {
    expect([10, 15, 44, 45, 74, 75, 130].map(delayStep)).toEqual([null, 15, 15, 45, 45, 75, 105]);
  });
});

describe("which vendor answers", () => {
  it("picks itself from the key that is set, and an explicit mode wins", () => {
    delete process.env.SUPPLIER_MODE_FLIGHT_STATUS;
    delete process.env.AERODATABOX_API_KEY; delete process.env.AVIATIONSTACK_API_KEY; delete process.env.FLIGHTAWARE_API_KEY;
    expect(flightStatusVendor()).toBe("mock");
    expect(supplierMode("flightStatus")).toBe("mock");
    process.env.FLIGHTAWARE_API_KEY = "fa";
    expect(flightStatusVendor()).toBe("flightaware");
    process.env.AVIATIONSTACK_API_KEY = "as";
    expect(flightStatusVendor()).toBe("aviationstack");
    process.env.AERODATABOX_API_KEY = "adb";
    expect(flightStatusVendor()).toBe("aerodatabox");
    expect(supplierMode("flightStatus")).toBe("live");
    process.env.SUPPLIER_MODE_FLIGHT_STATUS = "aviationstack";
    expect(flightStatusVendor()).toBe("aviationstack");
    process.env.SUPPLIER_MODE_FLIGHT_STATUS = "mock";
    expect(flightStatusVendor()).toBe("mock");
    expect(supplierMode("flightStatus")).toBe("mock");
  });
  it("says which in GET /status", async () => {
    process.env.AERODATABOX_API_KEY = "adb";
    delete process.env.SUPPLIER_MODE_FLIGHT_STATUS;
    const r = StatusResponse.parse((await call(statusGet, { method: "GET", path: "/api/app/v1/status" })).json);
    expect(r.flightStatusSource).toBe("live"); // the vendor stays on the server
  });
});

describe("AeroDataBox through the cache, within the budget", () => {
  const now = Date.parse("2027-05-10T03:00:00Z"); // 3 h 40 min before departure
  it("sends each marketplace's headers, caches, and only asks again when the cadence says", async () => {
    delete process.env.SUPPLIER_MODE_FLIGHT_STATUS;
    process.env.AERODATABOX_API_KEY = "adb-key";
    process.env.AERODATABOX_MONTHLY_UNITS = "400";
    const calls = stubFetch((u) => (u.includes("/flights/number/SV263/2027-05-10") ? { body: fx("aerodatabox-sv263-delayed.json") } : { status: 204 }));
    const a = await flightStatusNow("SV263", "2027-05-10", { now });
    expect(a).toMatchObject({ fresh: true, vendor: "aerodatabox", info: { status: "delayed", gate: "C4" } });
    expect(calls[0]!.url).toBe("https://aerodatabox.p.rapidapi.com/flights/number/SV263/2027-05-10?dateLocalRole=Departure&withAircraftImage=false&withLocation=false");
    expect(calls[0]!.init.headers).toMatchObject({ "X-RapidAPI-Key": "adb-key", "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" });
    // 3–6 h out on Basic: every 90 minutes. 30 minutes later is still the cached answer.
    const b = await flightStatusNow("SV263", "2027-05-10", { now: now + 30 * 60_000 });
    expect(b).toMatchObject({ fresh: false, info: { gate: "C4" } });
    expect(calls).toHaveLength(1);
    process.env.AERODATABOX_MARKET = "apimarket";
    const c = await flightStatusNow("SV263", "2027-05-10", { now: now + 91 * 60_000 });
    expect(c.fresh).toBe(true);
    expect(calls[1]!.url.startsWith("https://prod.api.market/api/v1/aedbx/aerodatabox/flights/number/SV263/")).toBe(true);
    expect(calls[1]!.init.headers).toMatchObject({ "x-api-market-key": "adb-key" });
    expect((await usageOf("aerodatabox", new Date())).used).toBeGreaterThanOrEqual(4);
  });
  it("stops at the monthly budget and keeps the last answer", async () => {
    process.env.AERODATABOX_API_KEY = "adb-key";
    const used = (await usageOf("aerodatabox")).used;
    process.env.AERODATABOX_MONTHLY_UNITS = String(used + 2); // one more call, then nothing
    const calls = stubFetch(() => ({ body: fx("aerodatabox-sv263-delayed.json") }));
    expect((await flightStatusNow("SV263", "2027-05-10", { now, force: true })).fresh).toBe(true);
    const spent = await flightStatusNow("SV263", "2027-05-10", { now, force: true });
    expect(spent).toMatchObject({ fresh: false, info: { gate: "C4" } });
    expect(calls).toHaveLength(1);
  });
  it("falls back to the last answer when AeroDataBox fails, and to nothing when there is none", async () => {
    process.env.AERODATABOX_API_KEY = "adb-key";
    process.env.AERODATABOX_MONTHLY_UNITS = "100000";
    stubFetch(() => ({ status: 503, body: { message: "down" } }));
    expect(await flightStatusNow("SV263", "2027-05-10", { now, force: true })).toMatchObject({ fresh: false, info: { gate: "C4" } });
    expect(await flightStatusNow("SV999", "2027-05-10", { now, force: true })).toMatchObject({ fresh: false, info: null });
  });
  it("aviationstack: free plan asks by number only, and a used-up quota stops calls for the month", async () => {
    delete process.env.AERODATABOX_API_KEY;
    process.env.AVIATIONSTACK_API_KEY = "as-key";
    const calls = stubFetch((u) => (u.includes("api.aviationstack.com") ? { body: fx("aviationstack-sv263.json") } : undefined));
    const r = await flightStatusNow("SV263", "2027-05-10", { now: Date.parse("2027-05-10T04:00:00Z"), departAt: Date.parse("2027-05-10T06:40:00Z") });
    expect(r).toMatchObject({ vendor: "aviationstack", fresh: true, info: { status: "in_air", aircraft: { hex: "710101" } } });
    expect(calls[0]!.url).toContain("flight_iata=SV263");
    expect(calls[0]!.url).not.toContain("flight_date");
    // Far from departure, nothing cached: the free plan doesn't spend a call.
    expect(await flightStatusNow("SV264", "2027-05-20", { now: Date.parse("2027-05-10T04:00:00Z") })).toMatchObject({ fresh: false, info: null });
    expect(calls).toHaveLength(1);
    stubFetch(() => ({ status: 200, body: { error: { code: "usage_limit_reached", message: "Your monthly usage limit has been reached." } } }));
    await flightStatusNow("SV263", "2027-05-10", { now: Date.parse("2027-05-10T04:00:00Z"), force: true });
    const after = stubFetch(() => ({ body: fx("aviationstack-sv263.json") }));
    expect((await flightStatusNow("SV263", "2027-05-10", { now: Date.parse("2027-05-10T04:00:00Z"), force: true })).fresh).toBe(false);
    expect(after).toHaveLength(0);
  });
});

describe("the flights job: status changes drive the disruption notices, once", () => {
  it("polls a booked flight near departure, tells the gate change and delay once, then the cancellation", async () => {
    await db.execute(sql`DELETE FROM app_flight_status_cache`);
    process.env.AERODATABOX_API_KEY = "adb-key";
    process.env.AERODATABOX_MONTHLY_UNITS = "100000";
    delete process.env.AERODATABOX_WEBHOOK_SECRET;
    const A = await signIn();
    await seedDemoTrip(A.userId, { outDay: "2027-05-10", backDay: "2027-05-25" });
    let answer = "aerodatabox-sv263-delayed.json";
    const calls = stubFetch((u) => (u.includes("/flights/number/SV263/2027-05-10") ? { body: fx(answer) } : { status: 204 }));
    const t0 = Date.parse("2027-05-10T05:00:00Z");
    const first = await flightsJob(t0);
    expect(first).toMatchObject({ polled: 1, told: 2 });
    expect((await notes(A.userId)).map((n) => n.kind).sort()).toEqual(["flight_delayed", "gate_change"]);
    expect((await notes(A.userId)).find((n) => n.kind === "flight_delayed")!.body).toContain("45");
    // The next run inside the cadence doesn't ask; one after it asks and finds nothing new to tell.
    expect(await flightsJob(t0 + 5 * 60_000)).toMatchObject({ polled: 0, told: 0 });
    expect(await flightsJob(t0 + 31 * 60_000)).toMatchObject({ polled: 1, told: 0 });
    expect(calls.filter((c) => c.url.includes("SV263/2027-05-10"))).toHaveLength(2);
    answer = "aerodatabox-sv263-cancelled.json";
    expect(await flightsJob(t0 + 62 * 60_000)).toMatchObject({ polled: 1, told: 1 });
    expect(await flightsJob(t0 + 93 * 60_000)).toMatchObject({ polled: 0 }); // cancelled is final: no more calls
    const kinds = (await notes(A.userId)).map((n) => n.kind).sort();
    expect(kinds).toEqual(["flight_cancelled", "flight_delayed", "gate_change"]);
  });
  it("tells someone tracking the flight in words that promise nothing we aren't holding", async () => {
    await db.execute(sql`DELETE FROM app_flight_status_cache`);
    process.env.AERODATABOX_API_KEY = "adb-key";
    process.env.AERODATABOX_MONTHLY_UNITS = "100000";
    const T = await signIn();
    stubFetch((u) => (u.includes("/flights/number/SV263/2027-05-11") ? { body: JSON.parse(JSON.stringify(fx("aerodatabox-sv263-delayed.json")).replaceAll("2027-05-10", "2027-05-11")) } : { status: 204 }));
    await trackFlight(T.userId, { flightNumber: "SV263", date: "2027-05-11", alerts: true }, null);
    await db.execute(sql`DELETE FROM app_flight_status_cache`);
    expect(await flightsJob(Date.parse("2027-05-11T05:00:00Z"))).toMatchObject({ polled: 1 });
    const n = await notes(T.userId);
    expect(n.find((x) => x.kind === "flight_delayed")).toMatchObject({ title: "SV263 is late", body: "About 45 minutes late, by the airline’s latest time." });
    expect(n.some((x) => x.body.includes("holding"))).toBe(false);
  });
  it("does nothing in mock mode", async () => {
    delete process.env.AERODATABOX_API_KEY; delete process.env.AVIATIONSTACK_API_KEY;
    expect(await flightsJob()).toEqual({ skipped: 1 });
  });
});

describe("AeroDataBox alerts by flight number", () => {
  it("subscribes flights in the window, acts on verified notifications once, and unsubscribes when the trip is off", async () => {
    await db.execute(sql`DELETE FROM app_flight_status_cache`);
    process.env.AERODATABOX_API_KEY = "adb-key";
    process.env.AERODATABOX_MONTHLY_UNITS = "100000";
    process.env.AERODATABOX_WEBHOOK_SECRET = SECRET;
    process.env.APP_PUBLIC_URL = "https://ops.example.test";
    const B = await signIn();
    const tripId = await seedDemoTrip(B.userId, { outDay: "2027-05-12", backDay: "2027-05-26" });
    const calls = stubFetch((u, init) => {
      if (u.endsWith("/subscriptions/balance")) return { body: { creditsRemaining: 40, lastRefilledUtc: "2027-05-01T00:00Z", lastDeductedUtc: null } };
      if (u.includes("/subscriptions/webhook/FlightByNumber/") && init.method === "POST") return { body: { id: "sub-sv263", isActive: true, billingType: "CreditBased", createdOnUtc: "2027-05-11T10:00Z", subject: { type: "FlightByNumber", id: "SV263" }, subscriber: { type: "WebHook", id: "x" } } };
      if (u.includes("/subscriptions/webhook/sub-sv263") && init.method === "DELETE") return { status: 204 };
      if (u.includes("/flights/number/")) return { status: 204 };
      return undefined;
    });
    const now = Date.parse("2027-05-12T03:00:00Z");
    const run = await flightsJob(now);
    expect(run).toMatchObject({ subscribed: 1, polled: 0, credits: 40 });
    const sub = calls.find((c) => c.url.includes("/subscriptions/webhook/FlightByNumber/"))!;
    expect(sub.url).toBe("https://aerodatabox.p.rapidapi.com/subscriptions/webhook/FlightByNumber/SV263");
    expect(JSON.parse(String(sub.init.body))).toEqual({ url: `https://ops.example.test/api/app/v1/flights/alerts/aerodatabox/${SECRET}`, maxDeliveryRetries: 1 });
    expect(calls.some((c) => c.url.includes("FlightByAirportIcao"))).toBe(false);
    // Subscribed flights aren't polled.
    expect(calls.some((c) => c.url.includes("/flights/number/SV263/2027-05-12"))).toBe(false);

    const hook = (token: string, body: unknown) => call((req) => adbWebhook(req, { params: Promise.resolve({ token }) }), { path: `/api/app/v1/flights/alerts/aerodatabox/${token}`, body });
    const payload = JSON.parse(JSON.stringify(fx("aerodatabox-notification.json")).replace("SUB-ID-PLACEHOLDER", "sub-sv263"));
    expect((await hook("wrong-token-wrong-token-wrong-123", payload)).status).toBe(401);
    expect((await hook(SECRET, { ...payload, subscription: { id: "someone-else" } })).json).toMatchObject({ ignored: true });
    const r1 = await hook(SECRET, payload);
    expect(r1.status, JSON.stringify(r1.json)).toBe(200);
    expect(r1.json).toMatchObject({ flights: 1, told: 2 });
    expect((await hook(SECRET, payload)).json).toMatchObject({ flights: 1, told: 0 }); // a retry tells nobody twice
    const n = await notes(B.userId);
    expect(n.map((x) => x.kind).sort()).toEqual(["flight_delayed", "gate_change"]);
    expect(n.find((x) => x.kind === "gate_change")!.title).toBe("Gate changed to D9");

    // The trip is cancelled: the next run removes the subscription.
    await db.update(appTrips).set({ status: "cancelled" }).where(eq(appTrips.id, tripId));
    expect(await flightsJob(now + 10 * 60_000)).toMatchObject({ removed: 1 });
    expect(calls.some((c) => c.url.endsWith("/subscriptions/webhook/sub-sv263") && c.init.method === "DELETE")).toBe(true);
    const [row] = await db.select().from(appFlightSubscriptions).where(and(eq(appFlightSubscriptions.vendor, "aerodatabox"), eq(appFlightSubscriptions.flightNumber, "SV263")));
    expect(row?.status).toBe("removed");
  });
  it("falls back to polling when the plan refuses alerts", async () => {
    await db.execute(sql`DELETE FROM app_flight_subscriptions; DELETE FROM app_flight_status_cache`);
    process.env.AERODATABOX_API_KEY = "adb-key";
    process.env.AERODATABOX_MONTHLY_UNITS = "100000";
    process.env.AERODATABOX_WEBHOOK_SECRET = SECRET;
    const C = await signIn();
    await seedDemoTrip(C.userId, { outDay: "2027-05-14", backDay: "2027-05-28" });
    const calls = stubFetch((u, init) => {
      if (u.endsWith("/subscriptions/balance")) return { body: { creditsRemaining: 10 } };
      if (u.includes("/subscriptions/webhook/FlightByNumber/") && init.method === "POST") return { status: 451, body: { message: "Not available on your plan" } };
      if (u.includes("/flights/number/SV263/2027-05-14")) return { body: JSON.parse(JSON.stringify(fx("aerodatabox-sv263-delayed.json")).replaceAll("2027-05-10", "2027-05-14")) };
      return { status: 204 };
    });
    const r = await flightsJob(Date.parse("2027-05-14T05:00:00Z"));
    expect(r).toMatchObject({ subscribed: 0, failed: 1, polled: 1, told: 2 });
    expect(calls.some((c) => c.url.includes("/flights/number/SV263/2027-05-14"))).toBe(true);
  });
  it("is closed without a secret", async () => {
    delete process.env.AERODATABOX_WEBHOOK_SECRET;
    process.env.AERODATABOX_API_KEY = "adb-key";
    const r = await call((req) => adbWebhook(req, { params: Promise.resolve({ token: "x" }) }), { body: {} });
    expect(r.status).toBe(501);
  });
});

describe("status linked to position", () => {
  it("interpolates along the great circle", () => {
    expect(greatCirclePoint([24.957, 46.698], [41.275, 28.752], 0)).toEqual([24.957, 46.698]);
    expect(greatCirclePoint([24.957, 46.698], [41.275, 28.752], 1)).toEqual([41.275, 28.752]);
    const mid = greatCirclePoint([24.957, 46.698], [41.275, 28.752], 0.5);
    expect(mid[0]).toBeGreaterThan(32); expect(mid[0]).toBeLessThan(34.5);
    const dep = Date.parse("2027-05-10T07:25:00Z");
    expect(estimatePosition("RUH", "IST", dep, dep + 4 * H, dep - 1, "schedule")).toBeNull();
    expect(estimatePosition("RUH", "XXX", dep, dep + 4 * H, dep + H, "schedule")).toBeNull();
    expect(estimatePosition("RUH", "IST", dep, dep + 4 * H, dep + H, "revised")).toMatchObject({ fraction: 0.25, basis: "revised" });
  });
  it("finds the aircraft by its hex when the status names it, else shows an estimate, labelled", async () => {
    await db.execute(sql`DELETE FROM app_flight_status_cache`);
    process.env.AERODATABOX_API_KEY = "adb-key";
    process.env.AERODATABOX_MONTHLY_UNITS = "100000";
    process.env.SUPPLIER_MODE_FLIGHT_POSITIONS = "live";
    __positionsCache.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-05-10T08:25:00Z")); // an hour after the revised take-off
    const tok = (await signIn()).token;
    let adsbSees = false;
    const calls = stubFetch((u) => {
      if (u.includes("/flights/number/SV263/2027-05-10")) return { body: fx("aerodatabox-sv263-delayed.json") };
      if (u.startsWith("https://api.adsb.lol/v2/hex/710101")) return { body: adsbSees ? fx("adsb-hex-710101.json") : { ac: [] } };
      if (u.startsWith("https://api.adsb.lol/")) return { body: { ac: [] } };
      return { status: 204 };
    });
    const get = () => call((req) => position(req, { params: Promise.resolve({ flightNo: "SV263" }) }), { method: "GET", path: "/api/app/v1/flights/SV263/position?date=2027-05-10", token: tok });
    const est = FlightPositionResponse.parse((await get()).json);
    expect(est).toMatchObject({ hex: "710101", position: null, match: null, estimate: { basis: "revised" } });
    expect(est.estimate!.fraction).toBeCloseTo(60 / 255, 2); // 1 h into a 4 h 15 min flight
    expect(calls.some((c) => c.url === "https://api.adsb.lol/v2/hex/710101")).toBe(true);
    adsbSees = true;
    __positionsCache.clear();
    const live = FlightPositionResponse.parse((await get()).json);
    expect(live).toMatchObject({ hex: "710101", match: "hex", estimate: null, position: { lat: 31.402, lon: 36.115, altitudeFt: 36000, source: "adsb.lol" } });
    const bad = await call((req) => position(req, { params: Promise.resolve({ flightNo: "SV263" }) }), { method: "GET", path: "/api/app/v1/flights/SV263/position?date=tomorrow", token: tok });
    expect(bad.status).toBe(400);
  });
});
