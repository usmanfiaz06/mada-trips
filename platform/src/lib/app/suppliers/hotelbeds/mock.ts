import { addDays } from "@mada/shared";
import availability from "./fixtures/hotels-availability.json";
import bookingTpl from "./fixtures/hotels-booking.json";
import content from "./fixtures/hotels-content.json";
import transfersTpl from "./fixtures/transfers-availability.json";
import { HotelbedsClient, type FetchLike } from "./client";
import { HotelbedsHotels, type FactsLookup, type HbBookingResponse } from "./hotels";
import { HotelbedsTransfers } from "./transfers";

/*
 * Hotelbeds without the network: a fetch that answers from the fixtures (shaped on the API reference's examples), with
 * the dates, occupancy and prices filled from the request. Used by the tests, by SUPPLIER_MODE_TRANSFERS=mock, by
 * SUPPLIER_MODE_HOTELS=hotelbeds-mock (a staging demo of real-looking Hotelbeds rooms), and by the desk's "Book on
 * Hotelbeds" while the supplier is in mock mode. Istanbul has rooms; anywhere else answers no hotels.
 *
 * Bookings live in memory per server instance (enough for a demo and for tests).
 */

type Vars = Record<string, string>;

const fmt = (n: number) => n.toFixed(2);

function fill(tpl: unknown, vars: Vars, scale: { n: number; np: number }, baseDay: string): unknown {
  const text = JSON.stringify(tpl).replace(/\{\{(\w+)(?::([\d.]+))?\}\}/g, (m, name: string, arg?: string) => {
    if (name === "n") return fmt(Number(arg) * scale.n);
    if (name === "np") return fmt(Number(arg) * scale.np);
    if (name === "deadline") return addDays(baseDay, -Number(arg));
    return vars[name] ?? m;
  });
  const out = JSON.parse(text) as Record<string, unknown>;
  delete out._note;
  return out;
}

const day8 = (d: string) => d.replace(/-/g, "");
const ISTANBUL = { lat: 41.0256, lng: 28.9744 };

export type MockHotelbedsState = {
  bookings: Map<string, { body: Record<string, unknown>; status: string; net: number; fee: number; product: "hotels" | "transfers"; at: number }>;
  calls: { method: string; path: string }[];
  seq: number;
};
const g = globalThis as unknown as { __madaHbMock?: MockHotelbedsState };
export const mockHotelbedsState = (): MockHotelbedsState => (g.__madaHbMock ??= { bookings: new Map(), calls: [], seq: 3_982_400 });
export const resetMockHotelbeds = () => { g.__madaHbMock = { bookings: new Map(), calls: [], seq: 3_982_400 }; };

const reply = (status: number, body: unknown) => ({ status, headers: { get: () => null }, text: async () => (body === null ? "" : JSON.stringify(body)) });

function hotelsAvailability(body: Record<string, unknown>) {
  const stay = body.stay as { checkIn: string; checkOut: string };
  const occ = (body.occupancies as { rooms: number; adults: number; children: number }[])[0]!;
  const geo = body.geolocation as { latitude: number; longitude: number } | undefined;
  const dest = (body.destination as { code?: string } | undefined)?.code;
  const codes = (body.hotels as { hotel?: number[] } | undefined)?.hotel;
  const inIstanbul = codes ? codes.some((c) => c >= 99701 && c <= 99704) : dest ? dest === "IST" : geo ? Math.abs(geo.latitude - ISTANBUL.lat) < 0.5 && Math.abs(geo.longitude - ISTANBUL.lng) < 0.5 : false;
  if (!inIstanbul) return { auditData: { token: "MOCKEMPTY" }, hotels: { total: 0, checkIn: stay.checkIn, checkOut: stay.checkOut } };
  const nights = Math.max(1, Math.round((Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / 86_400_000));
  const rooms = (body.occupancies as { rooms: number }[]).reduce((a, o) => a + o.rooms, 0);
  const adults = (body.occupancies as { rooms: number; adults: number }[]).reduce((a, o) => a + o.adults * o.rooms, 0);
  const children = (body.occupancies as { rooms: number; children: number }[]).reduce((a, o) => a + o.children * o.rooms, 0);
  const res = fill(availability, {
    ci8: day8(stay.checkIn), co8: day8(stay.checkOut), checkIn: stay.checkIn, checkOut: stay.checkOut, occ: `${rooms}~${adults}~${children}`, now: new Date().toISOString(),
  }, { n: (nights / 6) * rooms, np: 1 }, stay.checkIn) as { hotels: { hotels: { code: number; rooms: { rates: Record<string, unknown>[] }[] }[]; total: number } };
  for (const h of res.hotels.hotels) for (const r of h.rooms) for (const rate of r.rates) Object.assign(rate, { rooms, adults: occ.adults, children: occ.children });
  if (codes) res.hotels.hotels = res.hotels.hotels.filter((h) => codes.includes(h.code));
  // A cap from the filter, in the contract currency, as Hotelbeds applies it.
  const maxRate = (body.filter as { maxRate?: number } | undefined)?.maxRate;
  if (maxRate) for (const h of res.hotels.hotels) for (const r of h.rooms) r.rates = r.rates.filter((x) => Number(x.net) <= maxRate);
  res.hotels.total = res.hotels.hotels.length;
  return res;
}

function findRate(rateKey: string) {
  const parts = rateKey.split("|");
  const ci = `${parts[0]!.slice(0, 4)}-${parts[0]!.slice(4, 6)}-${parts[0]!.slice(6, 8)}`;
  const co = `${parts[1]!.slice(0, 4)}-${parts[1]!.slice(4, 6)}-${parts[1]!.slice(6, 8)}`;
  const [rooms, adults, children] = (parts[9] ?? "1~2~0").split("~").map(Number);
  const res = hotelsAvailability({ stay: { checkIn: ci, checkOut: co }, occupancies: [{ rooms: rooms!, adults: Math.max(1, Math.round(adults! / rooms!)), children: Math.round(children! / rooms!) }], hotels: { hotel: [Number(parts[4])] } }) as {
    hotels: { hotels?: { code: number; name: string; rooms: { code: string; name: string; rates: { rateKey: string; net: string; cancellationPolicies?: { amount: string }[] }[] }[]; currency: string }[] };
  };
  const h = res.hotels.hotels?.[0];
  const room = h?.rooms.find((r) => r.rates.some((x) => x.rateKey === rateKey));
  const rate = room?.rates.find((x) => x.rateKey === rateKey);
  return h && room && rate ? { h, room, rate, ci, co } : null;
}

function transfersAvailability(path: string) {
  // /transfer-api/1.0/availability/{lang}/from/{type}/{code}/to/{type}/{code}/{outbound}/{adults}/{children}/{infants}
  const p = path.split("/").map(decodeURIComponent);
  const i = p.indexOf("from");
  const fromCode = p[i + 2]!, toType = p[i + 4]!, toCode = p[i + 5]!, outbound = p[i + 6]!, adults = Number(p[i + 7]);
  if (!/^(IST|SAW)$/.test(fromCode)) return null;
  const [date, time] = [outbound.slice(0, 10), outbound.slice(11, 16)];
  return fill(transfersTpl, { date, time, fromCode, toType, toCode, toDescription: toType === "ATLAS" ? "Hotel in Istanbul" : "Istanbul address", adults: String(adults) }, { n: 1, np: adults }, date);
}

/** A fetch that answers like Hotelbeds from the fixtures. `fail` lets a test break one path. */
export function fixtureFetch(opts: { fail?: (method: string, path: string) => { status: number; body?: unknown } | "hang" | null } = {}): FetchLike {
  return async (url, init) => {
    const u = new URL(url);
    const path = u.pathname;
    const st = mockHotelbedsState();
    st.calls.push({ method: init.method, path });
    const f = opts.fail?.(init.method, path);
    if (f === "hang") return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    if (f) return reply(f.status, f.body ?? { error: { code: "SYSTEM_ERROR", message: "Mock failure" } });
    if (!init.headers["Api-key"] || !/^[0-9a-f]{64}$/.test(init.headers["X-Signature"] ?? "")) return reply(401, { error: { code: "AUTHENTICATION", message: "Invalid signature" } });
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};

    if (init.method === "POST" && path === "/hotel-api/1.0/hotels") return reply(200, hotelsAvailability(body));
    if (init.method === "POST" && path === "/hotel-api/1.0/checkrates") {
      const key = (body.rooms as { rateKey: string }[])[0]!.rateKey;
      const f2 = findRate(key);
      if (!f2) return reply(400, { error: { code: "INSUFFICIENT_ALLOTMENT", message: "Insufficient allotment" } });
      const rate = { ...f2.rate, rateType: "BOOKABLE", rateComments: "Check-in hour 14:00 - 00:00. Identification card at arrival." };
      return reply(200, { auditData: { token: "MOCKCR" }, hotel: { ...f2.h, checkIn: f2.ci, checkOut: f2.co, rooms: [{ ...f2.room, rates: [rate] }], totalNet: f2.rate.net } });
    }
    if (init.method === "POST" && path === "/hotel-api/1.0/bookings") {
      const key = (body.rooms as { rateKey: string }[])[0]!.rateKey;
      const f2 = findRate(key);
      if (!f2) return reply(400, { error: { code: "INSUFFICIENT_ALLOTMENT", message: "Insufficient allotment" } });
      const ref = `1-${++st.seq}`;
      const holder = body.holder as { name: string; surname: string };
      const net = Number(f2.rate.net);
      const fee = Number(f2.rate.cancellationPolicies?.[0]?.amount ?? 0);
      st.bookings.set(ref, { body, status: "CONFIRMED", net, fee, product: "hotels", at: Date.now() });
      return reply(200, fill(bookingTpl, {
        reference: ref, clientReference: String(body.clientReference ?? ""), today: new Date().toISOString().slice(0, 10), holderName: holder.name, holderSurname: holder.surname,
        checkIn: f2.ci, checkOut: f2.co, hotelCode: String(f2.h.code), hotelName: f2.h.name, net: fmt(net), netNumber: fmt(net), fee: fmt(fee), remark: String(body.remark ?? ""), now: new Date().toISOString(),
      }, { n: 1, np: 1 }, f2.ci));
    }
    const hb = /^\/hotel-api\/1\.0\/bookings\/(.+)$/.exec(path);
    if (hb) {
      const ref = decodeURIComponent(hb[1]!);
      const b = st.bookings.get(ref);
      if (!b || b.product !== "hotels") return reply(404, { error: { code: "INVALID_DATA", message: "Booking not found" } });
      const base = { reference: ref, clientReference: b.body.clientReference, status: b.status, totalNet: b.net, currency: "EUR", holder: b.body.holder } as HbBookingResponse["booking"];
      if (init.method === "GET") return reply(200, { booking: base });
      if (init.method === "DELETE") {
        const sim = u.searchParams.get("cancellationFlag") === "SIMULATION";
        if (b.status === "CANCELLED") return reply(400, { error: { code: "INVALID_DATA", message: "Booking already cancelled" } });
        if (!sim) b.status = "CANCELLED";
        return reply(200, { booking: { ...base, status: sim ? "CONFIRMED" : "CANCELLED", cancellationReference: sim ? undefined : `C-${ref}`, hotel: { cancellationAmount: b.fee, currency: "EUR" } } });
      }
    }
    if (init.method === "GET" && path === "/hotel-content-api/1.0/hotels") {
      const codes = u.searchParams.get("codes")?.split(",").map(Number);
      const hotels = content.hotels.filter((h) => !codes || codes.includes(h.code));
      return reply(200, { ...content, _note: undefined, hotels, total: hotels.length });
    }

    if (init.method === "GET" && path.startsWith("/transfer-api/1.0/availability/")) {
      const r = transfersAvailability(path);
      return r ? reply(200, r) : reply(204, null);
    }
    if (init.method === "POST" && path === "/transfer-api/1.0/bookings") {
      const t = (body.transfers as { rateKey: string }[])[0]!;
      const parts = t.rateKey.split("|");
      const net = Number(parts[parts.length - 3]);
      const ref = `102-${++st.seq}`;
      st.bookings.set(ref, { body, status: "CONFIRMED", net, fee: net, product: "transfers", at: Date.now() });
      return reply(200, { bookings: [{ reference: ref, status: "CONFIRMED", clientReference: body.clientReference, totalAmount: net, currency: parts[parts.length - 2], holder: body.holder, transfers: [{ id: 1, rateKey: t.rateKey, status: "CONFIRMED", transferType: parts[13] === "SHRD" ? "SHARED" : "PRIVATE", vehicle: { code: parts[14], name: parts[14] === "MNV" ? "Minivan" : parts[14] === "SH" ? "Shuttle" : "Car" } }] }] });
    }
    const tb = /^\/transfer-api\/1\.0\/bookings\/(\w+)\/reference\/(.+)$/.exec(path);
    if (tb) {
      const ref = decodeURIComponent(tb[2]!);
      const b = st.bookings.get(ref);
      if (!b || b.product !== "transfers") return reply(404, { message: "Booking not found" });
      if (init.method === "GET") return reply(200, { bookings: [{ reference: ref, status: b.status, totalAmount: b.net, currency: "EUR" }] });
      if (init.method === "DELETE") {
        const sim = u.searchParams.get("simulation") === "true";
        // Free until the day before: the mock charges nothing.
        if (!sim) b.status = "CANCELLED";
        return reply(200, { bookings: [{ reference: ref, status: sim ? "CONFIRMED" : "CANCELLED", totalAmount: 0, currency: "EUR" }] });
      }
    }
    return reply(404, { error: { code: "NOT_FOUND", message: `No fixture for ${init.method} ${path}` } });
  };
}

const MOCK_CREDS = { apiKey: "mock-key", secret: "mock-secret" };

/** The fixture-backed adapters (no network). */
export function mockHotelbedsHotels(facts?: FactsLookup, fetchImpl: FetchLike = fixtureFetch()) {
  return new HotelbedsHotels(new HotelbedsClient({ product: "hotels", credentials: MOCK_CREDS, env: "test", fetch: fetchImpl, retries: 0, log: () => {} }), facts);
}
export function mockHotelbedsTransfers(fetchImpl: FetchLike = fixtureFetch()) {
  return new HotelbedsTransfers(new HotelbedsClient({ product: "transfers", credentials: MOCK_CREDS, env: "test", fetch: fetchImpl, retries: 0, log: () => {} }));
}
