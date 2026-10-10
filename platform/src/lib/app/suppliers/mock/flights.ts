import { addDays, sarToHalalas, times, zonedToInstant, type FlightOffer, type FlightSearch, FlightSearch as FlightSearchSchema } from "@mada/shared";
import type { FlightHold, FlightSupplier } from "../types";
import { AIRLINES, AIRPORT_TZ, ISTANBUL_FLIGHTS, stableCode, type MockFlight } from "./data";

/*
 * Mock flight search. RUH→IST returns the prototype's three options (Saudia SV263 best, flynas XY125 lowest via SAW,
 * Turkish TK141 earliest). Other routes get one plausible direct option per airline that flies it.
 * Magic inputs, to exercise the app's edge cases (FLOWS.md §2):
 *   - to "XXX"                     → no flights (the "nothing direct on those dates" path)
 *   - to "ERR"                     → supplier not answering (throws SUPPLIER_DOWN)
 *   - price() on an offer id ending "-up" → price rose SAR 140 per booking
 */

const OFFER_TTL_MIN = 15;

function localPlus(day: string, hhmm: string, addMin: number): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const total = h * 60 + m + addMin;
  const d = addDays(day, Math.floor(total / 1440));
  const t = ((total % 1440) + 1440) % 1440;
  return `${d}T${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function arrivalLocal(depDay: string, dep: string, from: string, to: string, durationMin: number): string {
  const depLocal = localPlus(depDay, dep, 0);
  const instant = zonedToInstant(depLocal, AIRPORT_TZ[from] ?? "Asia/Riyadh").getTime() + durationMin * 60_000;
  const tz = AIRPORT_TZ[to] ?? "Asia/Riyadh";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(instant)).reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function leg(f: MockFlight, day: string, back = false) {
  const from = back ? f.to : f.from;
  const to = back ? f.from : f.to;
  const dep = back ? "15:10" : f.dep;
  const number = back ? f.backNumber : f.number;
  return {
    carrier: f.carrier, carrierName: f.carrierName, flightNumber: number, from, to,
    departLocal: localPlus(day, dep, 0), departTz: AIRPORT_TZ[from] ?? "Asia/Riyadh",
    arriveLocal: arrivalLocal(day, dep, from, to, f.durationMin), arriveTz: AIRPORT_TZ[to] ?? "Asia/Riyadh",
    durationMin: f.durationMin,
  };
}

function toOffer(f: MockFlight, q: FlightSearch & { adults: number }, now = new Date()): FlightOffer {
  const n = q.adults + (q.children ?? 0);
  const pp = sarToHalalas(f.ppSar);
  return {
    id: `mock-${f.key}-${q.depart}${q.return ? `-${q.return}` : ""}-${n}`,
    supplier: "mock",
    label: f.label,
    reason: f.reason,
    out: [leg(f, q.depart)],
    back: q.return ? [leg(f, q.return, true)] : [],
    cabin: q.cabin ?? "economy",
    pricePerPerson: { amount: pp, currency: "SAR" },
    total: { amount: times(pp, Math.max(1, n)), currency: "SAR" },
    baggage: f.bags, changeRule: f.change, refundRule: f.refund,
    seatsLeft: null,
    expiresAt: new Date(now.getTime() + OFFER_TTL_MIN * 60_000).toISOString(),
  };
}

function genericFlights(from: string, to: string): MockFlight[] {
  const out: MockFlight[] = [];
  for (const [iata, al] of Object.entries(AIRLINES)) {
    const r = al.routes.find(([a, b]) => a === from && b === to);
    if (!r) continue;
    const num = 100 + (stableCode(iata + from + to, 3).charCodeAt(0) % 800);
    out.push({
      key: `${iata.toLowerCase()}${num}`, label: out.length === 0 ? "best" : "lowest", carrier: iata, carrierName: al.name,
      number: `${iata}${num}`, backNumber: `${iata}${num + 1}`, dep: `${String(6 + (num % 14)).padStart(2, "0")}:${num % 2 ? "10" : "45"}`, arr: "",
      from, to, durationMin: r[2], ppSar: Math.round(r[2] * 6.5 + (num % 9) * 40), reason: "Direct.", bags: "1 × 23 kg", change: "SAR 200 per person", refund: "Refund minus SAR 300 per person",
    });
  }
  return out.slice(0, 3);
}

export class SupplierDown extends Error {
  constructor(public supplier: string) { super(`${supplier} is not answering`); }
}

export const mockFlights: FlightSupplier = {
  name: "mock-flights",
  async search(input) {
    const q = FlightSearchSchema.parse(input);
    if (q.to === "ERR") throw new SupplierDown("mock-flights");
    if (q.to === "XXX") return [];
    const list = q.from === "RUH" && (q.to === "IST" || q.to === "SAW") ? ISTANBUL_FLIGHTS : genericFlights(q.from, q.to);
    return list.map((f) => toOffer(f, q));
  },
  async price(offerId, travellers) {
    const m = /^mock-([a-z0-9]+)-(\d{4}-\d{2}-\d{2})(?:-(\d{4}-\d{2}-\d{2}))?-(\d+)(-up)?$/.exec(offerId);
    const f = m && ISTANBUL_FLIGHTS.find((x) => x.key === m[1]);
    if (!m || !f) throw new Error(`Unknown mock offer ${offerId}`);
    const offer = toOffer(f, { from: f.from, to: f.to, depart: m[2]!, return: m[3] ?? null, adults: travellers, children: 0, infants: 0, cabin: "economy", flexibleDays: 0 });
    if (m[5]) offer.total = { amount: offer.total.amount + 14000, currency: "SAR" };
    return offer;
  },
  async hold(offerId, travellers): Promise<FlightHold> {
    const offer = await this.price(offerId, travellers.length);
    return { pnr: offerId.startsWith("mock-sv263") ? "X7K2QD" : stableCode(offerId), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), offer };
  },
};
