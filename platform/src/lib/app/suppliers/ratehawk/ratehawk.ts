import { HotelSearch as HotelSearchSchema } from "@mada/shared";
import { AppError } from "../../http";
import { requireEnv } from "../live/not-configured";
import { checkOut, cheapestRate, decodeRh, offerOf, type RhHotel, type RhInfo, type RhQuery } from "./parse";
import type { RateHawkBooking, RateHawkHotels } from "./types";

/*
 * RateHawk / Emerging Travel Group B2B API v3 (docs.emergingtravel.com), Basic auth RATEHAWK_KEY_ID:RATEHAWK_API_KEY.
 * Every answer is { status: "ok" | "error", error, data }.
 *   POST /api/b2b/v3/search/multicomplete/            city → region id (kept a day)
 *   POST /api/b2b/v3/search/serp/region/              prices for every hotel in the region
 *   POST /api/b2b/v3/hotel/info/                      name, address, coordinates, stars, photos (kept a day)
 *   POST /api/b2b/v3/search/hp/                       one hotel's rates (book_hash), for price()
 *   POST /api/b2b/v3/hotel/prebook                    the final price of one rate
 *   POST /api/b2b/v3/hotel/order/booking/form/ + /finish/ + /finish/status/   book (paid from Mada's deposit)
 *   POST /api/b2b/v3/hotel/order/cancel/
 * RATEHAWK_BASE_URL overrides the host (ETG gives sandbox keys on the same host; test hotel id "test_hotel").
 * Residency is SA (prices for Saudi residents). RATEHAWK_MAX_HOTELS (default 30): how many of the cheapest hotels
 * we look up and offer per search.
 */

const host = () => process.env.RATEHAWK_BASE_URL || "https://api.worldota.net";
const max = () => { const n = Number(process.env.RATEHAWK_MAX_HOTELS ?? 30); return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : 30; };

async function call<T>(path: string, body: unknown, timeoutMs = 18_000): Promise<T> {
  const c = requireEnv("hotels (RateHawk)", ["RATEHAWK_KEY_ID", "RATEHAWK_API_KEY"]);
  const res = await fetch(`${host()}/api/b2b/v3${path}`, {
    method: "POST", signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Basic ${Buffer.from(`${c.RATEHAWK_KEY_ID}:${c.RATEHAWK_API_KEY}`).toString("base64")}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status >= 500) throw new Error(`ratehawk answered ${res.status}`);
  const j = (() => { try { return JSON.parse(text) as { status?: string; error?: string | null; data?: T }; } catch { return null; } })();
  if (!res.ok || !j || j.status !== "ok") {
    const err = j?.error ?? `HTTP ${res.status}`;
    if (/not_found|no_available_rates|rate_not_found|sold_out|book_hash_not_found/i.test(err)) throw new AppError("NOT_FOUND", { details: { reason: "sold_out" } });
    throw new AppError("VALIDATION", { message: `RateHawk refused: ${err}` });
  }
  return j.data as T;
}

const DAY = 24 * 3_600_000;
const g = globalThis as unknown as { __madaRh?: { regions: Map<string, { at: number; id: number | null }>; info: Map<string, { at: number; v: RhInfo | null }> } };
const memo: NonNullable<typeof g.__madaRh> = (g.__madaRh ??= { regions: new Map(), info: new Map() });
export const clearRateHawkCache = () => { memo.regions.clear(); memo.info.clear(); };

async function regionOf(city: string, language: string): Promise<number | null> {
  const k = city.toLowerCase();
  const hit = memo.regions.get(k);
  if (hit && Date.now() - hit.at < DAY) return hit.id;
  const d = await call<{ regions?: { id?: number; type?: string }[] }>("/search/multicomplete/", { query: city, language });
  const id = d.regions?.find((r) => r.type === "City")?.id ?? d.regions?.[0]?.id ?? null;
  memo.regions.set(k, { at: Date.now(), id });
  return id;
}

async function infoOf(id: string, language: string): Promise<RhInfo | null> {
  const hit = memo.info.get(id);
  if (hit && Date.now() - hit.at < DAY) return hit.v;
  const v = await call<RhInfo>("/hotel/info/", { id, language }).catch(() => null);
  memo.info.set(id, { at: Date.now(), v });
  return v;
}

const guestsOf = (q: Pick<RhQuery, "adults" | "childAges" | "rooms">) => {
  // One room per two adults or so, children with the first rooms, as ETG wants one guests entry per room.
  const rooms = Math.max(1, Math.min(q.rooms, q.adults));
  return Array.from({ length: rooms }, (_, i) => ({
    adults: Math.floor(q.adults / rooms) + (i < q.adults % rooms ? 1 : 0),
    children: q.childAges.filter((_, j) => j % rooms === i),
  }));
};
export const serpBody = (q: RhQuery, language: string) => ({ checkin: q.checkIn, checkout: checkOut(q.checkIn, q.nights), residency: "sa", language, guests: guestsOf(q), region_id: q.regionId, currency: "SAR" });

async function offersFor(hotels: RhHotel[], q: RhQuery, language: string) {
  const cheap = hotels.map((h) => ({ h, best: cheapestRate(h) })).filter((x) => x.best).sort((a, b) => Number(a.best!.pay.amount) - Number(b.best!.pay.amount)).slice(0, max());
  const infos: (RhInfo | null)[] = [];
  for (let i = 0; i < cheap.length; i += 10) infos.push(...(await Promise.all(cheap.slice(i, i + 10).map((x) => infoOf(x.h.id!, language)))));
  return cheap.map((x, i) => offerOf(x.h, x.best!.rate, x.best!.pay, infos[i] ?? null, q)).filter((o) => !!o);
}

export const rateHawk: RateHawkHotels = {
  name: "ratehawk",
  async search(input) {
    const s = HotelSearchSchema.parse(input);
    const childAges = ((input as { childAges?: number[] }).childAges ?? []).slice(0, 4);
    const regionId = await regionOf(s.city, "en");
    if (!regionId) return [];
    const q: RhQuery = { regionId, city: s.city, checkIn: s.checkIn, nights: s.nights, adults: Math.max(1, s.adults - childAges.length), childAges, rooms: s.rooms };
    const d = await call<{ hotels?: RhHotel[] }>("/search/serp/region/", serpBody(q, "en"), 25_000);
    return offersFor(d.hotels ?? [], q, "en");
  },
  async price(id) {
    const dec = decodeRh(id);
    if (!dec) throw new AppError("NOT_FOUND");
    const { key } = dec;
    // The party may have changed since the search (the order sheet re-prices with the ".n" suffix).
    const kids = key.q.childAges.slice(0, dec.party);
    const q: RhQuery = { ...key.q, adults: Math.max(1, dec.party - kids.length), childAges: kids };
    const { region_id: _region, ...stay } = serpBody(q, "en");
    const d = await call<{ hotels?: RhHotel[] }>("/search/hp/", { ...stay, id: key.h });
    const h = d.hotels?.[0];
    const rates = (h?.rates ?? []).filter((r) => (key.m && r.match_hash === key.m) || (r.room_name === key.room && r.meal === key.meal));
    const pick = cheapestRate({ ...h, rates: rates.length ? rates : h?.rates ?? [] });
    if (!h || !pick?.rate.book_hash) throw new AppError("NOT_FOUND", { details: { reason: "sold_out" } });
    const pre = await call<{ hotels?: RhHotel[] }>("/hotel/prebook", { hash: pick.rate.book_hash, price_increase_percent: 0 });
    const final = pre.hotels?.[0]?.rates?.[0];
    const pay = final ? cheapestRate({ rates: [final] }) : null;
    const o = offerOf({ ...h, id: key.h }, final ?? pick.rate, pay?.pay ?? pick.pay, await infoOf(key.h, "en"), q);
    if (!o) throw new AppError("NOT_FOUND", { details: { reason: "sold_out" } });
    // The book hash for book(): kept in the id, so the order carries it.
    return { ...o, id: o.id.replace(/\.(\d+)$/, `~${Buffer.from(final?.book_hash ?? pick.rate.book_hash).toString("base64url")}.$1`) };
  },
  async book({ offerId, reference, guests, email, phone, ip }) {
    const known = await this.status(reference).catch(() => null);
    if (known && known.status !== "failed") return known;
    const hash = /~([\w-]+)\.\d+$/.exec(offerId)?.[1];
    if (!hash) throw new AppError("VALIDATION", { message: "Price the room again before booking." });
    const form = await call<{ order_id?: number; payment_types?: { type?: string; amount?: string; currency_code?: string }[] }>("/hotel/order/booking/form/", {
      partner_order_id: reference, book_hash: Buffer.from(hash, "base64url").toString("utf8"), language: "en", user_ip: ip ?? "127.0.0.1",
    });
    const pay = form.payment_types?.find((p) => p.type === "deposit");
    if (!pay) throw new AppError("VALIDATION", { message: "RateHawk didn't offer deposit payment for this rate." });
    await call("/hotel/order/booking/finish/", {
      user: { email, phone }, partner: { partner_order_id: reference }, language: "en",
      rooms: guests.map((room) => ({ guests: room.map((p) => ({ first_name: p.firstName, last_name: p.lastName })) })),
      payment_type: { type: "deposit", amount: pay.amount, currency_code: pay.currency_code },
    });
    return { reference, orderId: form.order_id ?? null, status: "processing", offer: null };
  },
  async status(reference) {
    const d = await call<{ status?: string; order_id?: number }>("/hotel/order/booking/finish/status/", { partner_order_id: reference });
    const s = (d.status ?? "").toLowerCase();
    return { reference, orderId: d.order_id ?? null, status: s === "ok" ? "confirmed" : /process|3ds/.test(s) ? "processing" : s === "cancelled" ? "cancelled" : "failed", offer: null } satisfies RateHawkBooking;
  },
  async cancel(reference) {
    await call("/hotel/order/cancel/", { partner_order_id: reference });
    return { cancelled: true };
  },
};
