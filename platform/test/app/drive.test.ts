import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LivingPlanResponse, SignInResponse } from "@mada/shared";
import { db } from "@/db";
import { appDriveBudget, appDriveCache } from "@/db/app-schema-plans";
import { POST as otpStart } from "@/app/api/app/v1/auth/otp/start/route";
import { POST as otpVerify } from "@/app/api/app/v1/auth/otp/verify/route";
import { POST as createPost } from "@/app/api/app/v1/trips/plan/route";
import { GET as planGet } from "@/app/api/app/v1/trips/[id]/plan/route";
import { bordersOf, countryAt, decodePolyline } from "@/lib/app/drive/borders";
import { departureBucket, driveKey, driveLine, getDrive, toPlanDrive, type DriveQuery } from "@/lib/app/drive/drive";
import { osrmPath, parseOsrm } from "@/lib/app/drive/osrm";
import { pointOf } from "@/lib/app/drive/places";
import { resolvePlace } from "@/lib/app/plans/places";
import { clearDriveCache } from "@/lib/app/suppliers/routes";
import { resetBreakers } from "@/lib/app/resilience/breaker";
import { call, freshIp, newPhone, type Handler } from "./helpers";
import { scanJson } from "../../../tools/leak-scan/denylist.mjs";

/*
 * Drives (ASK-INTEGRATED §4, U4): km and time from the routes fixtures and recorded router answers (fetch is stubbed:
 * no real Google or OSRM call), the cache, the daily budget, borders, the unknown states, and plan legs carrying them.
 */

const RIYADH = pointOf(resolvePlace({ name: "Riyadh" }))!;
const ALULA = pointOf(resolvePlace({ name: "AlUla" }))!;
const SINGAPORE = pointOf(resolvePlace({ name: "Singapore" }))!;
const MELAKA = pointOf(resolvePlace({ name: "Melaka" }))!;
const DAMMAM = pointOf(resolvePlace({ name: "Dammam" }))!;
const MANAMA = pointOf(resolvePlace({ name: "Manama" }))!;
const WOODLANDS: [number, number] = [1.4517, 103.7686];
const JOHOR: [number, number] = [1.4927, 103.7414];

/** Encoded polyline (precision 5), to build router answers. */
function encode(points: [number, number][]): string {
  let out = "", pLat = 0, pLng = 0;
  const one = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) { out += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    out += String.fromCharCode(n + 63);
  };
  for (const [la, ln] of points) {
    const a = Math.round(la * 1e5), b = Math.round(ln * 1e5);
    one(a - pLat); one(b - pLng);
    pLat = a; pLng = b;
  }
  return out;
}

const SG_MELAKA_LINE: [number, number][] = [[SINGAPORE.lat, SINGAPORE.lng], [1.38, 103.8], WOODLANDS, JOHOR, [1.9, 103.0], [MELAKA.lat, MELAKA.lng]];
const osrmOk = (km: number, sec: number, line: [number, number][], steps: unknown[] = []) =>
  ({ code: "Ok", routes: [{ distance: km * 1000, duration: sec, geometry: encode(line), legs: [{ steps }] }] });
const googleOk = (meters: number, sec: number, warnings: string[] = []) => ({ routes: [{ distanceMeters: meters, staticDuration: `${sec}s`, duration: `${sec}s`, warnings }] });

function stubFetch(answer: (url: string) => { status?: number; body: unknown }) {
  const f = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const a = answer(url);
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

const q = (from: DriveQuery["from"], to: DriveQuery["to"], date = "2027-11-18"): DriveQuery => ({ from, to, date });

beforeEach(async () => {
  await db.delete(appDriveCache);
  await db.delete(appDriveBudget);
});

afterEach(() => {
  for (const k of ["SUPPLIER_MODE_ROUTES", "GOOGLE_ROUTES_API_KEY", "DRIVE_OSRM_URL", "DRIVE_PROVIDER", "DRIVE_DAILY_CALLS"]) delete process.env[k];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearDriveCache();
  resetBreakers();
});

describe("places and keys", () => {
  it("knows the plan's cities, Melaka included, and nothing it can't place", () => {
    expect(MELAKA).toMatchObject({ country: "MY" });
    expect(pointOf({ name: "RUH", kind: "airport", code: "RUH", city: "Riyadh", country: "SA" })).toMatchObject({ lat: 24.7136, country: "SA" });
    expect(pointOf({ name: "Somewhere nobody mapped", kind: "place" })).toBeNull();
    expect(pointOf({ name: "Hotel", kind: "place", lat: 1, lng: 2 })).toMatchObject({ lat: 1, lng: 2 });
  });

  it("keys on both ends to ~100 m, the avoid flags and the departure bucket (Fri–Sat weekend in the Gulf)", () => {
    expect(driveKey(q(RIYADH, ALULA))).toBe("drive|24.714,46.675|26.608,37.923|-|weekday-day");
    expect(driveKey({ ...q({ ...RIYADH, lat: RIYADH.lat + 0.0002 }, ALULA) })).toBe(driveKey(q(RIYADH, ALULA)));
    expect(departureBucket({ from: RIYADH, date: "2027-11-19" })).toBe("weekend-day"); // a Friday
    expect(departureBucket({ from: SINGAPORE, date: "2027-11-19" })).toBe("weekday-day");
    expect(departureBucket({ from: SINGAPORE, date: "2027-11-21", at: "22:15" })).toBe("weekend-night"); // a Sunday
  });
});

describe("Riyadh → AlUla", () => {
  it("returns km and time from the routes fixture (mock mode), from the map", async () => {
    const r = await getDrive(q(RIYADH, ALULA));
    expect(r).toMatchObject({ km: 1076, minutes: 620, source: "map", noRoute: false, crossings: [] });
    expect(driveLine(r)).toBe("1,076 km · about 10 h 20 min");
  });

  it("returns km and time from a recorded Google answer, through the existing routes supplier", async () => {
    process.env.GOOGLE_ROUTES_API_KEY = "test-key";
    const f = stubFetch(() => ({ body: googleOk(1_076_400, 37_200) }));
    const r = await getDrive(q(RIYADH, ALULA));
    expect(r).toMatchObject({ km: 1076.4, minutes: 620, source: "map" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0]![0])).toContain("computeRoutes");
  });
});

describe("the cache", () => {
  it("a hit makes no call", async () => {
    process.env.GOOGLE_ROUTES_API_KEY = "test-key";
    const f = stubFetch(() => ({ body: googleOk(1_076_400, 37_200) }));
    const a = await getDrive(q(RIYADH, ALULA));
    const b = await getDrive(q(RIYADH, ALULA, "2027-11-25")); // another weekday: the same bucket
    expect(f).toHaveBeenCalledTimes(1);
    expect(b).toMatchObject({ km: a.km, minutes: a.minutes, source: "map" });
    const [row] = await db.select().from(appDriveCache);
    expect(row!.provider).toBe("google");
    expect(row!.expiresAt.getTime() - row!.fetchedAt.getTime()).toBe(30 * 86_400_000);
    // Numbers only: no route line, no provider text.
    expect(JSON.stringify(row!.result)).not.toMatch(/polyline|warning/i);
  });

  it("an expired row is asked again", async () => {
    process.env.GOOGLE_ROUTES_API_KEY = "test-key";
    const f = stubFetch(() => ({ body: googleOk(1_076_400, 37_200) }));
    await getDrive(q(RIYADH, ALULA), new Date("2027-01-01T00:00:00Z"));
    await getDrive(q(RIYADH, ALULA), new Date("2027-02-15T00:00:00Z"));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("a provider that's down falls back and isn't cached", async () => {
    process.env.GOOGLE_ROUTES_API_KEY = "test-key";
    stubFetch(() => ({ status: 503, body: {} }));
    const r = await getDrive(q(RIYADH, ALULA));
    expect(r).toMatchObject({ source: "estimate", minutes: null });
    expect(await db.select().from(appDriveCache)).toHaveLength(0);
  });

  it("OSRM answers when the map provider is down", async () => {
    process.env.GOOGLE_ROUTES_API_KEY = "test-key";
    process.env.DRIVE_OSRM_URL = "http://osrm.test:5000/";
    const f = stubFetch((url) => (url.includes("googleapis") ? { status: 503, body: {} } : { body: osrmOk(1081.2, 37_800, [[RIYADH.lat, RIYADH.lng], [ALULA.lat, ALULA.lng]]) }));
    const r = await getDrive(q(RIYADH, ALULA));
    expect(r).toMatchObject({ km: 1081.2, minutes: 630, source: "map" });
    expect(f.mock.calls.map((c) => String(c[0]))[1]).toMatch(/^http:\/\/osrm\.test:5000\/route\/v1\/driving\/46\.67530,24\.71360;37\.92320,26\.60840\?/);
    const [row] = await db.select().from(appDriveCache);
    expect(row!.provider).toBe("osrm");
    expect(row!.expiresAt.getTime() - row!.fetchedAt.getTime()).toBe(90 * 86_400_000);
  });
});

describe("the daily budget", () => {
  it("when it's hit: the estimate label, no time, no call", async () => {
    process.env.GOOGLE_ROUTES_API_KEY = "test-key";
    process.env.DRIVE_DAILY_CALLS = "1";
    const f = stubFetch(() => ({ body: googleOk(1_076_400, 37_200) }));
    await getDrive(q(RIYADH, ALULA));
    const r = await getDrive(q(DAMMAM, MANAMA));
    expect(f).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ source: "estimate", minutes: null, expiresAt: null });
    expect(r.km).toBeGreaterThan(40);
    expect(driveLine(r)).toMatch(/^About \d+ km · estimate, straight-line/);
    expect(toPlanDrive(r)).toMatchObject({ estimate: true, minutes: null, source: "estimate" });
    // Riyadh → AlUla is cached: still the map's figure.
    expect(await getDrive(q(RIYADH, ALULA))).toMatchObject({ source: "map", minutes: 620 });
  });

  it("zero means no calls at all; the estimate is great circle × 1.25", async () => {
    process.env.DRIVE_DAILY_CALLS = "0";
    const r = await getDrive(q(RIYADH, ALULA));
    expect(r).toMatchObject({ km: 1100, minutes: null, source: "estimate" });
    expect(driveLine(r)).toBe("About 1,100 km · estimate, straight-line");
  });
});

describe("borders", () => {
  it("Singapore → Melaka lists the border, named from the route line (OSRM)", async () => {
    process.env.SUPPLIER_MODE_ROUTES = "off";
    process.env.DRIVE_OSRM_URL = "http://osrm.test:5000";
    stubFetch(() => ({ body: osrmOk(238.5, 9_900, SG_MELAKA_LINE, [{ mode: "driving", intersections: [{ classes: ["toll"] }] }]) }));
    const r = await getDrive(q(SINGAPORE, MELAKA));
    expect(r).toMatchObject({ km: 238.5, minutes: 165, tolls: true, ferries: null, source: "map" });
    expect(r.crossings).toEqual([{ from: "SG", to: "MY", name: "Woodlands Causeway" }]);
    expect(toPlanDrive(r).borders).toEqual(["SG→MY"]);
    expect(driveLine(r)).toBe("239 km · about 2 h 45 min · tolls · Crosses into Malaysia via Woodlands Causeway");
  });

  it("Singapore → Melaka without a route line: the border from the two countries, unnamed (two crossings exist)", async () => {
    const r = await getDrive(q(SINGAPORE, MELAKA)); // mock mode has no fixture for it: the estimate
    expect(r.source).toBe("estimate");
    expect(r.crossings).toEqual([{ from: "SG", to: "MY", name: null }]);
    expect(driveLine(r)).toContain("Crosses into Malaysia");
  });

  it("Dammam → Manama: King Fahd Causeway (the only crossing), and the fixture's toll", async () => {
    const r = await getDrive(q(DAMMAM, MANAMA));
    expect(r).toMatchObject({ km: 61, minutes: 55, tolls: true, source: "map" });
    expect(r.crossings).toEqual([{ from: "SA", to: "BH", name: "King Fahd Causeway" }]);
  });

  it("the line decides the order and direction; the boxes place an end with no country", () => {
    const back = [...SG_MELAKA_LINE].reverse();
    expect(bordersOf({ ...MELAKA, country: null }, { ...SINGAPORE, country: null }, back)).toEqual([{ from: "MY", to: "SG", name: "Woodlands Causeway" }]);
    expect(countryAt({ lat: JOHOR[0], lng: JOHOR[1] })).toBe("MY");
    expect(countryAt({ lat: SINGAPORE.lat, lng: SINGAPORE.lng })).toBe("SG");
    expect(bordersOf(RIYADH, ALULA, null)).toEqual([]);
    expect(decodePolyline(encode(SG_MELAKA_LINE))[2]).toEqual(WOODLANDS);
  });
});

describe("when we don't know", () => {
  it("no road: said so, kept (an answer), no km or time", async () => {
    process.env.SUPPLIER_MODE_ROUTES = "off";
    process.env.DRIVE_OSRM_URL = "http://osrm.test:5000";
    const f = stubFetch(() => ({ status: 400, body: { code: "NoRoute", message: "Impossible route between points" } }));
    const r = await getDrive(q(RIYADH, { lat: 27.0, lng: 35.5, country: "SA" }));
    expect(r).toMatchObject({ noRoute: true, km: null, minutes: null, source: "map" });
    expect(driveLine(r)).toBe("No road route found. A flight or ferry instead?");
    await getDrive(q(RIYADH, { lat: 27.0, lng: 35.5, country: "SA" }));
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("OSRM's answers parse: ferries from the steps, a garbled answer throws", () => {
    expect(parseOsrm(osrmOk(10, 600, [[0, 0], [0.1, 0.1]], [{ mode: "ferry" }]))).toMatchObject({ km: 10, minutes: 10, ferries: true, tolls: null });
    expect(() => parseOsrm({ code: "InvalidQuery" })).toThrow();
    expect(osrmPath({ from: RIYADH, to: ALULA, avoidTolls: true, avoidFerries: true })).toContain("&exclude=toll,ferry");
  });
});

/* ───────────── plan legs ───────────── */

async function signIn() {
  const phone = newPhone();
  const ip = freshIp();
  await call(otpStart, { body: { phone }, ip });
  return SignInResponse.parse((await call(otpVerify, { body: { phone, code: "123456" }, ip })).json).tokens.accessToken;
}

describe("plan legs carry the drive", () => {
  it("a Riyadh → AlUla road trip: both drive legs have km and time from the fixture; the read shows them; no supplier names", async () => {
    const token = await signIn();
    const created = LivingPlanResponse.parse((await call(createPost, { token, body: { origin: { name: "Riyadh" }, stops: [{ place: { name: "AlUla" }, nights: 2 }], start: "2027-11-18", travelMode: "drive" } })).json).plan;
    const drives = created.items.filter((i) => i.kind === "leg" && i.mode === "drive");
    expect(drives.length).toBe(2);
    for (const l of drives) expect(l.drive).toMatchObject({ km: 1076, minutes: 620, source: "map", line: "1,076 km · about 10 h 20 min" });

    const h: Handler = (req) => planGet(req, { params: Promise.resolve({ id: created.tripId }) });
    const res = await call(h, { token });
    const read = LivingPlanResponse.parse(res.json).plan;
    expect(read.items.find((i) => i.mode === "drive")?.drive).toMatchObject({ km: 1076, minutes: 620 });
    expect(scanJson(res.json)).toEqual([]);
    expect(JSON.stringify(res.json)).not.toMatch(/google|osrm/i);
  });

  it("Singapore → Melaka on a mixed road trip: the border on the leg, an estimate with no time (no fixture)", async () => {
    const token = await signIn();
    const plan = LivingPlanResponse.parse((await call(createPost, { token, body: {
      origin: { name: "Riyadh" }, stops: [{ place: { name: "Singapore" }, nights: 2 }, { place: { name: "Melaka" }, nights: 1 }], start: "2027-11-18", travelMode: "mixed",
    } })).json).plan;
    const leg = plan.items.find((i) => i.mode === "drive" && i.title === "Singapore → Melaka")!;
    expect(leg.drive).toMatchObject({ minutes: null, estimate: true, borders: ["SG→MY"] });
    expect(leg.drive!.line).toContain("Crosses into Malaysia");
  });
});
