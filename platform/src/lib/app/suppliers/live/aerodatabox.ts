import type { FlightStatus } from "@mada/shared";
import type { FlightStatusInfo, FlightStatusSupplier } from "../types";
import { BudgetSpent, reserve } from "../../flight-status/usage";
import { requireEnv } from "./not-configured";

/*
 * AeroDataBox flight status (the beta's flight-status source). Docs: https://doc.aerodatabox.com/ (OpenAPI v1.15.4.0,
 * read 2026-10-11 from doc.aerodatabox.com/docs/openapi-{rapidapi,apimarket,direct}-v1.json).
 *
 * CONFIRMED from the OpenAPI specs:
 *   RapidAPI   https://aerodatabox.p.rapidapi.com            headers X-RapidAPI-Key, X-RapidAPI-Host: aerodatabox.p.rapidapi.com
 *   API.Market https://prod.api.market/api/v1/aedbx/aerodatabox  header x-api-market-key
 *   Direct     https://api.aerodatabox.com                   header X-Api-Key
 *   GET /flights/{searchBy}/{searchParam}/{dateLocal}  "Flight Status (single day)", TIER 2. searchBy is one of
 *     Number | Reg | CallSign | Icao24; query dateLocalRole=Arrival|Departure|Both, withAircraftImage, withLocation.
 *     200 → FlightContract[]; 204 → nothing found; also 400/401/451/500/503.
 *   FlightContract: number, callSign, status, codeshareStatus (Unknown|IsOperator|IsCodeshared), lastUpdatedUtc,
 *     airline {name, iata, icao}, aircraft {reg, modeS (ICAO 24-bit hex), model}, departure/arrival
 *     {airport {iata, icao, name, timeZone, location {lat, lon}}, scheduledTime/revisedTime/predictedTime/runwayTime
 *     {utc, local}, terminal, gate, checkInDesk, baggageBelt (arrivals), runway, quality: [Basic|Live|Approximate]}.
 *   FlightStatus: Unknown, Expected, EnRoute, CheckIn, Boarding, GateClosed, Departed, Delayed, Approaching, Arrived,
 *     Canceled, Diverted, CanceledUncertain.
 *   FIDS (airport departures/arrivals): GET /flights/airports/{codeType}/{code}/{fromLocal}/{toLocal}, also TIER 2.
 *     Not used: one flight per call is cheaper for us than a 12-hour board per airport.
 * CONFIRMED from https://aerodatabox.com/pricing (2026-10-11): a TIER 2 call costs 2 API units. RapidAPI Basic is free
 *   with 400 units/month at 1 req/s (Pro $8: 5,000; Ultra $40: 50,000; Mega $200: 500,000). API.Market Basic is a
 *   7-day free trial with 400 units (Pro $7.50: 5,000; Pro 2 $15: 15,000; Ultra $37.50: 50,000). Direct: Starter
 *   $19 for 40,000. So the free tier is about 200 flight lookups a month.
 * ASSUMED (not in the spec; check against the first live answer):
 *   - the path segment is written lower case ("/flights/number/SV263/2026-10-11"), as in AeroDataBox's own examples;
 *   - times look like "2026-10-11 06:40Z" (utc) and "2026-10-11 09:40+03:00" (local), parsed leniently either way;
 *   - API.Market used to call its header x-magicapi-key; we send it too, it's ignored where unknown.
 *
 * Env: AERODATABOX_API_KEY, AERODATABOX_MARKET=rapidapi (default) | apimarket | direct,
 *      AERODATABOX_PLAN=basic (default) | pro | ultra | mega, AERODATABOX_MONTHLY_UNITS (defaults from the plan).
 */

export type AdbMarket = "rapidapi" | "apimarket" | "direct";
const MARKETS: Record<AdbMarket, { base: string; headers: (key: string) => Record<string, string> }> = {
  rapidapi: { base: "https://aerodatabox.p.rapidapi.com", headers: (k) => ({ "X-RapidAPI-Key": k, "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com" }) },
  apimarket: { base: "https://prod.api.market/api/v1/aedbx/aerodatabox", headers: (k) => ({ "x-api-market-key": k, "x-magicapi-key": k }) },
  direct: { base: "https://api.aerodatabox.com", headers: (k) => ({ "X-Api-Key": k }) },
};

export const adbMarket = (): AdbMarket => {
  const m = (process.env.AERODATABOX_MARKET ?? "rapidapi").toLowerCase().replace(/[^a-z]/g, "");
  return m === "apimarket" ? "apimarket" : m === "direct" ? "direct" : "rapidapi";
};

const PLAN_UNITS: Record<string, number> = { basic: 400, pro: 5_000, pro2: 15_000, ultra: 50_000, ultra2: 150_000, mega: 500_000, starter: 40_000, growth: 400_000 };
export const adbPlan = () => (process.env.AERODATABOX_PLAN ?? "basic").toLowerCase().replace(/[^a-z0-9]/g, "");
export const adbBudget = () => Number(process.env.AERODATABOX_MONTHLY_UNITS) || PLAN_UNITS[adbPlan()] || 400;
/** Units one flight-status call costs (TIER 2). */
export const ADB_UNITS_PER_CALL = 2;

type When = { utc?: string; local?: string } | null | undefined;
type Movement = {
  airport?: { iata?: string; icao?: string; name?: string; timeZone?: string; location?: { lat?: number; lon?: number } };
  scheduledTime?: When; revisedTime?: When; predictedTime?: When; runwayTime?: When;
  terminal?: string | null; gate?: string | null; baggageBelt?: string | null; quality?: string[];
};
export type AdbFlight = {
  number?: string; callSign?: string; status?: string; codeshareStatus?: string; lastUpdatedUtc?: string; isCargo?: boolean;
  airline?: { name?: string; iata?: string; icao?: string } | null;
  aircraft?: { reg?: string; modeS?: string; model?: string } | null;
  departure?: Movement; arrival?: Movement;
};

/** "2026-10-11 06:40Z" or "2026-10-11T06:40:00Z" → ISO; null when absent or unreadable. */
function iso(v: string | undefined | null): string | null {
  if (!v) return null;
  const t = Date.parse(v.trim().replace(" ", "T"));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
/** "2026-10-11 09:40+03:00" → "2026-10-11T09:40" (the airport's wall clock). */
const wall = (v: string | undefined | null) => (v && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v) ? v.slice(0, 16).replace(" ", "T") : null);
const minutes = (a: string | null, b: string | null) => (a && b ? Math.round((Date.parse(a) - Date.parse(b)) / 60_000) : null);
const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

function statusOf(f: AdbFlight, delay: number | null, live: boolean): FlightStatus {
  switch (f.status) {
    case "Canceled": return "cancelled";
    case "Diverted": return "diverted";
    case "Arrived": return "landed";
    case "EnRoute": case "Approaching": return "in_air";
    case "Departed": return f.departure?.runwayTime?.utc ? "in_air" : "departed";
    case "Boarding": case "GateClosed": return "boarding";
    case "Delayed": return "delayed";
    // "CanceledUncertain" is AeroDataBox guessing: never tell a traveller their flight is cancelled on a guess.
    default: return (delay ?? 0) >= 15 ? "delayed" : live ? "on_time" : "scheduled";
  }
}

/** Picks the flight that departs on `date` (local), preferring the operating carrier over codeshares. */
export function pickFlight(list: AdbFlight[], date: string): AdbFlight | null {
  const onDay = list.filter((f) => (wall(f.departure?.scheduledTime?.local) ?? "").startsWith(date));
  const pool = onDay.length ? onDay : list;
  const sorted = [...pool].sort((a, b) => (a.codeshareStatus === "IsCodeshared" ? 1 : 0) - (b.codeshareStatus === "IsCodeshared" ? 1 : 0)
    || (iso(a.departure?.scheduledTime?.utc) ?? "").localeCompare(iso(b.departure?.scheduledTime?.utc) ?? ""));
  return sorted[0] ?? null;
}

export function mapAdb(flightNumber: string, date: string, f: AdbFlight): FlightStatusInfo {
  const d = f.departure ?? {};
  const a = f.arrival ?? {};
  const schedDep = iso(d.scheduledTime?.utc);
  const revDep = iso(d.revisedTime?.utc);
  const takeoff = iso(d.runwayTime?.utc);
  const depart = takeoff ?? revDep ?? schedDep;
  const arrive = iso(a.runwayTime?.utc) ?? iso(a.revisedTime?.utc) ?? iso(a.predictedTime?.utc) ?? iso(a.scheduledTime?.utc);
  const delay = minutes(revDep ?? takeoff, schedDep);
  const live = [...(d.quality ?? []), ...(a.quality ?? [])].includes("Live");
  return {
    flightNumber, carrierName: f.airline?.name ?? null, date,
    from: d.airport?.iata ?? null, to: a.airport?.iata ?? null,
    departLocal: wall(d.revisedTime?.local) ?? wall(d.scheduledTime?.local),
    arriveLocal: wall(a.revisedTime?.local) ?? wall(a.predictedTime?.local) ?? wall(a.scheduledTime?.local),
    status: statusOf(f, delay, live),
    gate: clean(d.gate), terminal: clean(d.terminal) ? (/^\d+$/.test(clean(d.terminal)!) ? `Terminal ${clean(d.terminal)}` : clean(d.terminal)) : null,
    source: live ? "Live" : "Schedule", // never the vendor's name: the app shows it
    departUtc: depart, arriveUtc: arrive, scheduledDepartUtc: schedDep, scheduledArriveUtc: iso(a.scheduledTime?.utc),
    actualDepartUtc: takeoff ?? (f.status === "Departed" || f.status === "EnRoute" || f.status === "Approaching" || f.status === "Arrived" ? revDep : null),
    delayMin: delay !== null ? Math.max(0, delay) : null,
    arrivalTerminal: clean(a.terminal), arrivalGate: clean(a.gate), baggageBelt: clean(a.baggageBelt),
    aircraft: f.aircraft ? { reg: clean(f.aircraft.reg), hex: clean(f.aircraft.modeS)?.toLowerCase() ?? null, model: clean(f.aircraft.model) } : null,
    updatedUtc: iso(f.lastUpdatedUtc),
  };
}

export const aeroDataBox: FlightStatusSupplier = {
  name: "aerodatabox",
  async lookup(raw, date): Promise<FlightStatusInfo | null> {
    const env = requireEnv("aerodatabox", ["AERODATABOX_API_KEY"]);
    const flightNumber = raw.replace(/\s+/g, "").toUpperCase();
    const budget = adbBudget();
    if (!(await reserve("aerodatabox", ADB_UNITS_PER_CALL, budget))) throw new BudgetSpent("aerodatabox", budget);
    const m = MARKETS[adbMarket()];
    const url = `${m.base}/flights/number/${encodeURIComponent(flightNumber)}/${date}?dateLocalRole=Departure&withAircraftImage=false&withLocation=false`;
    const res = await fetch(url, { headers: { Accept: "application/json", ...m.headers(env.AERODATABOX_API_KEY!) }, signal: AbortSignal.timeout(8_000) });
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) throw new Error(`AeroDataBox answered ${res.status}`);
    const text = await res.text();
    if (!text.trim()) return null;
    const list = JSON.parse(text) as AdbFlight[] | AdbFlight;
    const f = pickFlight(Array.isArray(list) ? list : [list], date);
    return f ? mapAdb(flightNumber, date, f) : null;
  },
  // AeroDataBox has paid webhooks ("flight alerts", billed in credits); for the beta we poll from /api/cron/flights.
  async watch(flightNumber, date) { return { alertId: `poll:aerodatabox:${flightNumber}:${date}` }; },
};

/** A call to the AeroDataBox account's own endpoints (alert subscriptions, balance: FREE TIER, no units). */
export async function adbFetch(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const env = requireEnv("aerodatabox", ["AERODATABOX_API_KEY"]);
  const m = MARKETS[adbMarket()];
  return fetch(`${m.base}${path}`, {
    method: init.method ?? "GET",
    headers: { Accept: "application/json", ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...m.headers(env.AERODATABOX_API_KEY!) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(8_000),
  });
}
