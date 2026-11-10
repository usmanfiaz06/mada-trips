// Multi-leg flight itineraries: a ticket can have one or more legs (a stop/transit between them), each with
// its own airline, flight number and times. Pure helpers, safe on both client and server.
import { AIRPORT_CODES, AIRLINE_LABELS } from "./travel-data";

export type FlightLeg = { from: string; to: string; airline: string; flightNo?: string; dep?: string; arr?: string };
export type Itinerary = { outbound: FlightLeg[]; return?: FlightLeg[] };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isTime = (s: unknown): s is string => typeof s === "string" && TIME.test(s);

/** "RUH → DOH → LHR" for a set of legs. */
export function routeString(legs: FlightLeg[]): string {
  if (!legs.length) return "";
  return [legs[0].from, ...legs.map((l) => l.to)].join(" → ");
}

/** The whole trip as one label, e.g. "RUH → DOH → LHR · LHR → RUH" for a return. */
export function fullRoute(it: Itinerary): string {
  const out = routeString(it.outbound);
  return it.return?.length ? `${out} · ${routeString(it.return)}` : out;
}

/** Minutes between landing (arr) and the next departure (dep), same airport → no timezone issue. Null if unknown. */
export function layoverMinutes(arr?: string, dep?: string): number | null {
  if (!isTime(arr) || !isTime(dep)) return null;
  const [ah, am] = arr.split(":").map(Number);
  const [dh, dm] = dep.split(":").map(Number);
  let m = dh * 60 + dm - (ah * 60 + am);
  if (m < 0) m += 1440; // crosses midnight
  return m;
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

function cleanLegs(raw: unknown, label: string): { ok: true; legs: FlightLeg[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: `Add at least one ${label} flight leg` };
  if (raw.length > 6) return { ok: false, error: `A ${label} route can have at most 6 legs` };
  const legs: FlightLeg[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = (raw[i] ?? {}) as Record<string, unknown>;
    const from = String(r.from ?? "").toUpperCase();
    const to = String(r.to ?? "").toUpperCase();
    const airline = String(r.airline ?? "");
    const n = i + 1;
    if (!AIRPORT_CODES.has(from)) return { ok: false, error: `Pick the departure airport for ${label} leg ${n}` };
    if (!AIRPORT_CODES.has(to)) return { ok: false, error: `Pick the arrival airport for ${label} leg ${n}` };
    if (from === to) return { ok: false, error: `${label} leg ${n} can't start and end at the same airport` };
    if (!AIRLINE_LABELS.has(airline)) return { ok: false, error: `Pick the airline for ${label} leg ${n}` };
    if (i > 0 && legs[i - 1].to !== from) return { ok: false, error: `${label} leg ${n} must start where leg ${i} lands (${legs[i - 1].to})` };
    const leg: FlightLeg = { from, to, airline };
    const flightNo = String(r.flightNo ?? "").trim().toUpperCase().slice(0, 10);
    if (flightNo) leg.flightNo = flightNo;
    if (isTime(r.dep)) leg.dep = r.dep;
    if (isTime(r.arr)) leg.arr = r.arr;
    legs.push(leg);
  }
  return { ok: true, legs };
}

/** Validate a submitted itinerary. `hasReturn` requires a return route too. */
export function validateItinerary(raw: unknown, hasReturn: boolean): { ok: true; itinerary: Itinerary } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Add the flight route" };
  const o = cleanLegs((raw as { outbound?: unknown }).outbound, "outbound");
  if (!o.ok) return o;
  if (!hasReturn) return { ok: true, itinerary: { outbound: o.legs } };
  const r = cleanLegs((raw as { return?: unknown }).return, "return");
  if (!r.ok) return r;
  return { ok: true, itinerary: { outbound: o.legs, return: r.legs } };
}
