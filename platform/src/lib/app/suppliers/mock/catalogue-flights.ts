import {
  CARRIERS, CATALOGUE_FLIGHTS, DESTINATIONS, FlightSearch as FlightSearchSchema, addDays, destinationByCode, fareSar, sarToHalalas, times, zonedToInstant,
  type CatalogueFlight, type Cabin,
} from "@mada/shared";
import type { BookingFlightOffer, BookingFlightSupplier } from "../booking-types";
import { AIRPORT_TZ } from "./data";
import { SupplierDown } from "./flights";

/*
 * The catalogue flight supplier: the GDS stand-in for booking (M2). Every route the prototype sells (Istanbul with
 * Saudia SV263, flynas XY125 to SAW and Turkish TK141; Dubai, Cairo, London, Baku, Jeddah, AlUla, Abha) from any of
 * RUH/JED/DMM, priced by cabin and one way. Offer ids carry the whole search, so price() re-derives the fare.
 * Magic inputs (as the M0 mock): to "XXX" → no flights, to "ERR" → not answering.
 */

const OFFER_TTL_MIN = 20;

function localPlus(day: string, hhmm: string, addMin: number): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const total = h * 60 + m + addMin;
  const d = addDays(day, Math.floor(total / 1440));
  const t = ((total % 1440) + 1440) % 1440;
  return `${d}T${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function arrivalLocal(depLocal: string, from: string, to: string, durationMin: number): string {
  const instant = zonedToInstant(depLocal, AIRPORT_TZ[from] ?? "Asia/Riyadh").getTime() + durationMin * 60_000;
  const tz = AIRPORT_TZ[to] ?? "Asia/Riyadh";
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(instant)).reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

type Decoded = { dest: string; key: string; from: string; depart: string; ret: string | null; cabin: Cabin; adults: number; infants: number };
const encode = (d: Decoded) => `cat.${d.dest}.${d.key}.${d.from}.${d.depart}.${d.ret ?? "ow"}.${d.cabin}.${d.adults}.${d.infants}`;
function decode(id: string): Decoded | null {
  const m = /^cat\.([a-z]+)\.([a-z0-9]+)\.([A-Z]{3})\.(\d{4}-\d{2}-\d{2})\.(\d{4}-\d{2}-\d{2}|ow)\.(economy|premium|business|first)\.(\d)\.(\d)$/.exec(id);
  if (!m) return null;
  return { dest: m[1]!, key: m[2]!, from: m[3]!, depart: m[4]!, ret: m[5] === "ow" ? null : m[5]!, cabin: m[6] as Cabin, adults: Number(m[7]), infants: Number(m[8]) };
}

function offerOf(f: CatalogueFlight, d: Decoded, mainCode: string, now = new Date()): BookingFlightOffer {
  const to = f.to ?? mainCode;
  const carrier = CARRIERS[f.carrier]!;
  const leg = (back: boolean, day: string) => {
    const a = back ? to : d.from; const b = back ? d.from : to;
    const dep = localPlus(day, back ? "15:10" : f.dep, 0);
    return {
      carrier: f.carrier, carrierName: carrier.name, flightNumber: back ? f.backNumber : f.number, from: a, to: b,
      departLocal: dep, departTz: AIRPORT_TZ[a] ?? "Asia/Riyadh", arriveLocal: back ? arrivalLocal(dep, a, b, f.durationMin) : `${day}T${f.arr}`, arriveTz: AIRPORT_TZ[b] ?? "Asia/Riyadh",
      durationMin: f.durationMin,
    };
  };
  const pp = sarToHalalas(fareSar(f.ppSar, d.cabin, !d.ret));
  return {
    id: encode(d), supplier: "catalogue", label: f.label === "bags" ? "other" : f.label, reason: f.reason,
    out: [leg(false, d.depart)], back: d.ret ? [leg(true, d.ret)] : [], cabin: d.cabin,
    pricePerPerson: { amount: pp, currency: "SAR" }, total: { amount: times(pp, d.adults), currency: "SAR" },
    baggage: f.bags, changeRule: f.change, refundRule: f.refund, seatsLeft: null,
    expiresAt: new Date(now.getTime() + OFFER_TTL_MIN * 60_000).toISOString(),
    meta: { label: f.label === "quiet" || f.label === "water" ? "best" : f.label, stop: f.stop ?? null, refundable: f.refund !== "Not refundable" },
  };
}

export const catalogueFlights: BookingFlightSupplier = {
  name: "catalogue-flights",
  async search(input) {
    const q = FlightSearchSchema.parse(input);
    if (q.to === "ERR") throw new SupplierDown("catalogue-flights");
    if (q.to === "XXX") return [];
    const dest = destinationByCode(q.to);
    const list = dest ? CATALOGUE_FLIGHTS[dest.key] ?? [] : [];
    return list.map((f) => offerOf(f, { dest: dest!.key, key: f.key, from: q.from, depart: q.depart, ret: q.return, cabin: q.cabin, adults: q.adults + q.children, infants: q.infants }, dest!.code));
  },
  async price(offerId, travellers) {
    const d = decode(offerId);
    const f = d && CATALOGUE_FLIGHTS[d.dest]?.find((x) => x.key === d.key);
    if (!d || !f) throw new Error(`Unknown catalogue offer ${offerId}`);
    return offerOf(f, { ...d, adults: travellers }, DESTINATIONS[d.dest]!.code);
  },
  async hold(offerId, travellers) {
    const offer = await this.price(offerId, travellers.length);
    const pnr = offerId.includes(".sv263.") ? "X7K2QD" : offerId.split(".").slice(1, 5).join("").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(-6);
    return { pnr, expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString(), offer };
  },
};
