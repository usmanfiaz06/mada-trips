import { AIRPORT_GEO, FLIGHT_POSITION_ATTRIBUTION, FlightNumber, estimatePosition, icaoCallsign, isIsoDay, zonedToInstant, type EstimatedPosition, type FlightPosition, type FlightPositionResponse } from "@mada/shared";
import { AppError, json, resilient } from "@/lib/app/http";
import { flightStatusNow } from "@/lib/app/flight-status/service";
import { suppliers, type FlightStatusInfo } from "@/lib/app/suppliers";
import { authenticate } from "@/lib/app/tokens";

// GET /api/app/v1/flights/{flightNo}/position[?date=YYYY-MM-DD] → { flightNumber, callsign, position | null, attribution,
// hex, match, estimate }. Open ADS-B data (adsb.lol, OpenSky fallback): position and altitude only. With a date, the
// flight-status supplier (cached, within its quota cadence) names the aircraft: we look it up by its ICAO hex first
// (more reliable than a callsign), then by callsign. With no receiver in range (most of Saudi airspace today), and
// the flight due in the air, `estimate` is where its times put it on the great circle: the app labels it "estimated".
export const dynamic = "force-dynamic";

const HEX = /^[0-9a-f]{6}$/;
const NOT_FLYING = new Set(["cancelled", "landed", "diverted"]);

function estimateFor(info: FlightStatusInfo, now: number): EstimatedPosition | null {
  if (!info.from || !info.to || NOT_FLYING.has(info.status)) return null;
  const at = (utc: string | null | undefined, local: string | null, airport: string) => {
    if (utc) return Date.parse(utc);
    const tz = AIRPORT_GEO[airport]?.[2];
    try { return local && tz ? zonedToInstant(local, tz).getTime() : NaN; } catch { return NaN; }
  };
  const dep = at(info.actualDepartUtc ?? info.departUtc, info.departLocal, info.from);
  const arr = at(info.arriveUtc, info.arriveLocal, info.to);
  if (!Number.isFinite(dep) || !Number.isFinite(arr)) return null;
  const basis = info.actualDepartUtc ? "actual" : info.departUtc && info.scheduledDepartUtc && info.departUtc !== info.scheduledDepartUtc ? "revised" : "schedule";
  return estimatePosition(info.from, info.to, dep, arr, now, basis);
}

export async function GET(req: Request, ctx: { params: Promise<{ flightNo: string }> }) {
  return resilient(req, async () => {
    await authenticate(req);
    const raw = decodeURIComponent((await ctx.params).flightNo).replace(/\s+/g, "").toUpperCase();
    if (!FlightNumber.safeParse(raw).success) throw new AppError("VALIDATION", { fields: { flightNo: "Expected a flight number like SV263" } });
    const date = new URL(req.url).searchParams.get("date");
    if (date !== null && !isIsoDay(date)) throw new AppError("VALIDATION", { fields: { date: "Expected a day as YYYY-MM-DD" } });
    const callsign = icaoCallsign(raw);
    const info = date ? (await flightStatusNow(raw, date).catch(() => null))?.info ?? null : null;
    const hex = info?.aircraft?.hex && HEX.test(info.aircraft.hex) ? info.aircraft.hex : null;
    const positions = suppliers.flightPositions();
    let position: FlightPosition | null = null;
    let match: "hex" | "callsign" | null = null;
    if (hex) { position = await positions.byHex(hex).catch(() => null); if (position) match = "hex"; }
    if (!position && callsign) { position = await positions.byCallsign(callsign).catch(() => null); if (position) match = "callsign"; }
    const estimate = !position && info ? estimateFor(info, Date.now()) : null;
    const body: FlightPositionResponse = { flightNumber: raw, callsign, position, attribution: FLIGHT_POSITION_ATTRIBUTION, hex, match, estimate };
    return json(body, 200, { "Cache-Control": "private, max-age=30" });
  });
}
