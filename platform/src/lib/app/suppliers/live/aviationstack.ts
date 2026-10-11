import { zonedToInstant, type FlightStatus } from "@mada/shared";
import type { FlightStatusInfo, FlightStatusSupplier } from "../types";
import { BudgetSpent, markSpent, reserve } from "../../flight-status/usage";
import { requireEnv } from "./not-configured";

/*
 * aviationstack (APILayer) real-time flights. For development: the Free plan is 100 requests a month and
 * NON-COMMERCIAL. Production needs a paid aviationstack plan (Basic $49.99/month, 10,000 requests) or AeroDataBox.
 *
 * CONFIRMED (OpenAPI at https://api.swaggerhub.com/apis/apilayer-863/AviationstackAPI/1.0.0/swagger.json, the pricing
 * page https://aviationstack.com/pricing, and a live call with a bad key, 2026-10-11):
 *   GET https://api.aviationstack.com/v1/flights?access_key=…  (HTTPS works on Free; the key is a query parameter)
 *   filters: flight_iata, flight_icao, flight_number, flight_status, dep_iata, arr_iata, flight_date, limit, offset…
 *   flight_date is "historical flights data", Basic plan and above: on Free we ask for the flight number alone and
 *   pick the right day from the answer.
 *   { pagination, data: [{ flight_date, flight_status (scheduled|active|landed|cancelled|incident|diverted),
 *     departure/arrival { airport, timezone, iata, icao, terminal, gate, baggage, delay, scheduled, estimated, actual,
 *     estimated_runway, actual_runway }, airline { name, iata, icao }, flight { number, iata, icao, codeshared },
 *     aircraft { registration, iata, icao, icao24 } | null, live { updated, latitude, longitude, altitude, direction,
 *     speed_horizontal, speed_vertical, is_ground } | null }] }
 *   errors: { error: { code, message } }, e.g. invalid_access_key (401), usage_limit_reached, function_access_restricted.
 * ASSUMED: times come as "2026-10-11T09:40:00+00:00" but are the airport's local wall clock despite the +00:00 (a
 *   long-standing, widely reported quirk), so we read the wall clock and convert with the airport's `timezone`.
 *
 * Env: AVIATIONSTACK_API_KEY, AVIATIONSTACK_MONTHLY_BUDGET (default 100), AVIATIONSTACK_PLAN=free (default) | paid.
 */

type Side = {
  airport?: string; timezone?: string; iata?: string; icao?: string; terminal?: string | null; gate?: string | null; baggage?: string | null;
  delay?: number | null; scheduled?: string | null; estimated?: string | null; actual?: string | null; estimated_runway?: string | null; actual_runway?: string | null;
};
export type AvsFlight = {
  flight_date?: string; flight_status?: string; departure?: Side; arrival?: Side;
  airline?: { name?: string; iata?: string; icao?: string } | null;
  flight?: { number?: string; iata?: string; icao?: string; codeshared?: unknown } | null;
  aircraft?: { registration?: string; iata?: string; icao?: string; icao24?: string } | null;
  live?: { updated?: string; latitude?: number; longitude?: number; altitude?: number; is_ground?: boolean } | null;
};

export const avsBudget = () => Number(process.env.AVIATIONSTACK_MONTHLY_BUDGET) || 100;
export const avsPaid = () => (process.env.AVIATIONSTACK_PLAN ?? "free").toLowerCase() !== "free";

const wall = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(0, 16) : null);
const utc = (v: string | null | undefined, tz: string | undefined) => {
  const w = wall(v);
  if (!w) return null;
  try { return tz ? zonedToInstant(w, tz).toISOString() : new Date(`${w}:00Z`).toISOString(); } catch { return null; }
};
const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

function statusOf(f: AvsFlight, delay: number): FlightStatus {
  const d = f.departure ?? {};
  switch (f.flight_status) {
    case "cancelled": return "cancelled";
    case "diverted": return "diverted";
    case "landed": return "landed";
    case "active": return d.actual_runway || (f.live && f.live.is_ground === false) ? "in_air" : "departed";
    // "incident" is too vague to tell a traveller anything: we keep to what the times say.
    default: return delay >= 15 ? "delayed" : d.estimated ? "on_time" : "scheduled";
  }
}

export function mapAvs(flightNumber: string, date: string, f: AvsFlight): FlightStatusInfo {
  const d = f.departure ?? {};
  const a = f.arrival ?? {};
  const delay = Math.max(0, d.delay ?? 0);
  const best = (s: Side) => s.actual_runway ?? s.actual ?? s.estimated_runway ?? s.estimated ?? s.scheduled;
  const terminal = clean(d.terminal);
  return {
    flightNumber, carrierName: f.airline?.name ?? null, date, from: d.iata ?? null, to: a.iata ?? null,
    departLocal: wall(d.actual ?? d.estimated ?? d.scheduled), arriveLocal: wall(a.actual ?? a.estimated ?? a.scheduled),
    status: statusOf(f, delay), gate: clean(d.gate), terminal: terminal ? (/^\d+$/.test(terminal) ? `Terminal ${terminal}` : terminal) : null,
    source: "Live · aviationstack",
    departUtc: utc(best(d), d.timezone), arriveUtc: utc(best(a), a.timezone),
    scheduledDepartUtc: utc(d.scheduled, d.timezone), scheduledArriveUtc: utc(a.scheduled, a.timezone),
    actualDepartUtc: utc(d.actual_runway ?? d.actual, d.timezone),
    delayMin: d.delay ?? null, arrivalTerminal: clean(a.terminal), arrivalGate: clean(a.gate), baggageBelt: clean(a.baggage),
    aircraft: f.aircraft ? { reg: clean(f.aircraft.registration), hex: clean(f.aircraft.icao24)?.toLowerCase() ?? null, model: clean(f.aircraft.iata ?? f.aircraft.icao) } : null,
    updatedUtc: f.live?.updated ? new Date(f.live.updated).toISOString() : null,
  };
}

export const aviationstack: FlightStatusSupplier = {
  name: "aviationstack",
  async lookup(raw, date): Promise<FlightStatusInfo | null> {
    const env = requireEnv("aviationstack", ["AVIATIONSTACK_API_KEY"]);
    const flightNumber = raw.replace(/\s+/g, "").toUpperCase();
    const budget = avsBudget();
    if (!(await reserve("aviationstack", 1, budget))) throw new BudgetSpent("aviationstack", budget);
    const q = new URLSearchParams({ access_key: env.AVIATIONSTACK_API_KEY!, flight_iata: flightNumber, limit: "10" });
    if (avsPaid()) q.set("flight_date", date);
    const res = await fetch(`https://api.aviationstack.com/v1/flights?${q}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    const body = (await res.json().catch(() => null)) as { data?: AvsFlight[]; error?: { code?: string } } | null;
    const code = body?.error?.code;
    if (code === "usage_limit_reached") { await markSpent("aviationstack", budget); throw new BudgetSpent("aviationstack", budget); }
    // The key goes in the URL, so the URL never goes in a log or an error.
    if (code || !res.ok) throw new Error(`aviationstack answered ${res.status}${code ? ` (${code})` : ""}`);
    const list = (body?.data ?? []).filter((f) => f.flight_date === date);
    const f = list.find((x) => !x.flight?.codeshared) ?? list[0];
    return f ? mapAvs(flightNumber, date, f) : null;
  },
  async watch(flightNumber, date) { return { alertId: `poll:aviationstack:${flightNumber}:${date}` }; },
};
