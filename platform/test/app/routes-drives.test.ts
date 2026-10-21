import { afterEach, describe, expect, it, vi } from "vitest";
import { keyedMode, keyedModes } from "@/lib/app/config";
import { clearDriveCache, dailyDrives, driveLeg, estimateDrive, routesSupplier } from "@/lib/app/suppliers/routes";
import { parseRoutes, routesBody, ROUTES_FIELD_MASK } from "@/lib/app/suppliers/routes/google";
import { resetBreakers } from "@/lib/app/resilience/breaker";

/* Google Routes (daily drives): the keyed switch, the mock fixtures, the border flag, the estimate, the 24-hour cache. */

const RIYADH = { lat: 24.7136, lng: 46.6753, countryCode: "SA" };
const ALULA = { lat: 26.6084, lng: 37.9232 };
const DAMMAM = { lat: 26.4207, lng: 50.0888, countryCode: "SA" };
const MANAMA = { lat: 26.2285, lng: 50.586, countryCode: "BH" };

afterEach(() => {
  for (const k of ["SUPPLIER_MODE_ROUTES", "GOOGLE_ROUTES_API_KEY", "VERCEL_ENV", "APP_ALLOW_MOCKS"]) delete process.env[k];
  vi.unstubAllGlobals();
  clearDriveCache();
  resetBreakers();
});

describe("the keyed switch", () => {
  it("is mock in development, live with the key, off on production without it", () => {
    expect(keyedMode("routes")).toBe("mock");
    process.env.GOOGLE_ROUTES_API_KEY = "k";
    expect(keyedMode("routes")).toBe("live");
    expect(routesSupplier()?.name).toBe("google");
    delete process.env.GOOGLE_ROUTES_API_KEY;
    process.env.VERCEL_ENV = "production";
    expect(keyedMode("routes")).toBe("off");
    expect(keyedModes().routes).toBeUndefined();
    process.env.APP_ALLOW_MOCKS = "yes";
    expect(keyedMode("routes")).toBe("mock");
    process.env.SUPPLIER_MODE_ROUTES = "off";
    expect(keyedMode("routes")).toBe("off");
    process.env.SUPPLIER_MODE_ROUTES = "google";
    expect(keyedMode("routes")).toBe("live");
  });
});

describe("mock drives", () => {
  it("answers a fixture leg either way round", async () => {
    const leg = await driveLeg({ from: RIYADH, to: ALULA, day: "2027-02-10" });
    expect(leg).toMatchObject({ distanceKm: 1076, durationMin: 620, crossesBorder: false, source: "mock" });
    expect(leg!.to.countryCode).toBe("SA");
    const back = await driveLeg({ from: ALULA, to: RIYADH, day: "2027-02-14" });
    expect(back).toMatchObject({ distanceKm: 1076, source: "mock" });
  });
  it("flags the causeway to Bahrain as a border crossing", async () => {
    const leg = await driveLeg({ from: DAMMAM, to: MANAMA, day: "2027-02-11" });
    expect(leg).toMatchObject({ crossesBorder: true, border: "SA→BH" });
    expect(leg!.warnings.join(" ")).toMatch(/toll/);
  });
  it("estimates anything not in the fixtures, and has no road to 0,0", async () => {
    const leg = await driveLeg({ from: RIYADH, to: { lat: 24.0, lng: 45.0 }, day: "2027-02-11" });
    expect(leg!.source).toBe("estimate");
    expect(leg!.distanceKm).toBeGreaterThan(150);
    expect(await driveLeg({ from: RIYADH, to: { lat: 0, lng: 0 }, day: "2027-02-11" })).toBeNull();
  });
  it("draws a plan's daily drives, skipping nights in the same place", async () => {
    const legs = await dailyDrives([
      { point: RIYADH, day: "2027-02-10" }, { point: ALULA, day: "2027-02-11" }, { point: ALULA, day: "2027-02-12" }, { point: RIYADH, day: "2027-02-14" },
    ]);
    expect(legs.map((l) => l?.day)).toEqual(["2027-02-11", "2027-02-14"]);
  });
});

describe("Google computeRoutes", () => {
  it("asks for a no-traffic drive with the Essentials field mask", () => {
    const b = routesBody({ from: RIYADH, to: ALULA, day: "2027-02-10", avoidTolls: true });
    expect(b).toMatchObject({ travelMode: "DRIVE", routingPreference: "TRAFFIC_UNAWARE", routeModifiers: { avoidTolls: true, avoidFerries: false } });
    expect(b.origin.location.latLng).toEqual({ latitude: 24.7136, longitude: 46.6753 });
    expect(ROUTES_FIELD_MASK).not.toMatch(/tollInfo|travelAdvisory/);
  });
  it("reads metres and seconds, and Google's border warning", () => {
    const q = { from: { lat: 25.2, lng: 55.27 }, to: { lat: 23.58, lng: 58.38 }, day: "2027-03-01" };
    const leg = parseRoutes({ routes: [{ distanceMeters: 447321, duration: "18200s", staticDuration: "18000s", warnings: ["This route crosses country borders."], polyline: { encodedPolyline: "abc" } }] }, q);
    expect(leg).toMatchObject({ distanceKm: 447.3, durationMin: 300, crossesBorder: true, border: null, polyline: "abc", source: "google" });
    expect(parseRoutes({}, q)).toBeNull();
    expect(parseRoutes({ routes: [{ distanceMeters: 1 }] }, q)).toBeNull();
  });
  it("calls Google once per origin, destination and day; falls back to the estimate when it's down", async () => {
    process.env.GOOGLE_ROUTES_API_KEY = "test-key";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("test-key");
      return new Response(JSON.stringify({ routes: [{ distanceMeters: 1076000, staticDuration: "37200s" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const q = { from: RIYADH, to: ALULA, day: "2027-02-10" };
    expect(await driveLeg(q)).toMatchObject({ distanceKm: 1076, durationMin: 620, source: "google" });
    await driveLeg(q);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await driveLeg({ ...q, day: "2027-02-11" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 503 })));
    expect((await driveLeg({ ...q, day: "2027-02-12" }))!.source).toBe("estimate");
  });
  it("live without a key estimates instead of failing the plan", async () => {
    process.env.SUPPLIER_MODE_ROUTES = "live";
    expect(estimateDrive({ from: RIYADH, to: ALULA, day: "d" }).source).toBe("estimate");
    expect((await driveLeg({ from: RIYADH, to: ALULA, day: "2027-02-10" }))!.source).toBe("estimate");
  });
});
