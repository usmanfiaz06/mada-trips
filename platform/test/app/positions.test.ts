import { describe, expect, it } from "vitest";
import { FlightPositionResponse, SignInResponse } from "@mada/shared";
import { POST as otpStart } from "@/app/api/app/v1/auth/otp/start/route";
import { POST as otpVerify } from "@/app/api/app/v1/auth/otp/verify/route";
import { GET as position } from "@/app/api/app/v1/flights/[flightNo]/position/route";
import { supplierMode } from "@/lib/app/config";
import { __parse } from "@/lib/app/suppliers/live/flight-positions";
import { call, freshIp, newPhone } from "./helpers";

async function token() {
  const phone = newPhone();
  const ip = freshIp();
  await call(otpStart, { body: { phone }, ip });
  return SignInResponse.parse((await call(otpVerify, { body: { phone, code: "123456" }, ip })).json).tokens.accessToken;
}
const get = (flightNo: string, tok?: string) =>
  call((req) => position(req, { params: Promise.resolve({ flightNo }) }), { method: "GET", path: `/api/app/v1/flights/${flightNo}/position`, token: tok });

describe("GET /flights/{flightNo}/position", () => {
  it("returns SV263's position (mock adapter) with attribution", async () => {
    const r = await get("SV263", await token());
    expect(r.status).toBe(200);
    const body = FlightPositionResponse.parse(r.json);
    expect(body).toMatchObject({ flightNumber: "SV263", callsign: "SVA263", position: { altitudeFt: 37000, onGround: false, source: "mock" } });
    expect(body.attribution).toContain("adsb.lol");
  });
  it("returns null for a flight that isn't airborne, and for airlines without a callsign mapping", async () => {
    const t = await token();
    expect(FlightPositionResponse.parse((await get("XY125", t)).json).position).toBeNull();
    expect(FlightPositionResponse.parse((await get("ZZ12", t)).json)).toMatchObject({ callsign: null, position: null });
  });
  it("needs a signed-in caller and a real flight number", async () => {
    expect((await get("SV263")).status).toBe(401);
    expect((await get("not-a-flight", await token())).status).toBe(400);
  });
});

describe("open ADS-B adapter", () => {
  it("is live by default, and SUPPLIER_MODE alone doesn't switch it", () => {
    const prev = process.env.SUPPLIER_MODE_FLIGHT_POSITIONS;
    delete process.env.SUPPLIER_MODE_FLIGHT_POSITIONS;
    try { expect(supplierMode("flightPositions")).toBe("live"); } finally { process.env.SUPPLIER_MODE_FLIGHT_POSITIONS = prev; }
  });
  it("normalises adsb.lol and OpenSky payloads", () => {
    const now = Date.parse("2026-10-10T09:00:00Z");
    const a = __parse.fromAdsb({ ac: [{ hex: "717c96", flight: "KNE126  ", alt_baro: 8900, gs: 280.4, track: 150.05, lat: 24.9, lon: 46.59, seen_pos: 2 }] }, now);
    expect(a).toEqual({ lat: 24.9, lon: 46.59, altitudeFt: 8900, groundSpeedKt: 280.4, track: 150.05, onGround: false, seenAt: "2026-10-10T08:59:58.000Z", source: "adsb.lol" });
    expect(__parse.fromAdsb({ ac: [{ alt_baro: "ground", lat: 1, lon: 2 }] }, now)?.onGround).toBe(true);
    expect(__parse.fromAdsb({ ac: [] }, now)).toBeNull();
    const o = __parse.fromOpenSky({ states: [["710020", "FAD28   ", "Saudi Arabia", 1791623400, 1791623401, 46.7, 24.7, 2423.2, false, 129.7, 150.3, -5, null, 2580, "6306", false, 0]] }, (s) => (s[1] ?? "").trim() === "FAD28");
    expect(o).toMatchObject({ lat: 24.7, lon: 46.7, altitudeFt: 7950, groundSpeedKt: 252.1, onGround: false, source: "opensky" });
  });
});
