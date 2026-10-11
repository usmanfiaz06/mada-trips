import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  CARRIERS, CATALOGUE_HOTELS, rankStays, tripShape, demoPassportTarget, CHECKED_FARES, DESTINATIONS, addDays, bundleFor, daysBetween, demoIqama, entryChecks, infantSar, money, roomsFor, roomsLabel, sarToHalalas,
  type DemoFlag, type EntryCheckRequest, type EntryCheckResponse, type FlightOption, type FlightSearchRequest, type FlightSearchResponse, type OfferResponse,
  type StayOption, type StaySearchRequest, type StaySearchResponse, EntryCheckRequest as EntrySchema, FlightSearchRequest as FlightSchema, StaySearchRequest as StaySchema,
} from "@mada/shared";
import { db } from "@/db";
import { appOffers } from "@/db/app-schema-booking";
import { supplierMode } from "../config";
import { AppError } from "../http";
import type { BookingFlightOffer, BookingHotelOffer } from "../suppliers/booking-types";
import { SupplierDown } from "../suppliers/mock/flights";
import { bookingSuppliers, householdOf, isUuid, today, travellersOf } from "./common";

/*
 * Search: flights and stays through the supplier interfaces, cached for 10 minutes; each option the traveller sees is
 * stored as an offer with our own id and the supplier's hold (20 minutes), so the order sheet prices exactly that.
 */

const CACHE_MS = 10 * 60_000;
type CacheEntry<T> = { at: number; value: T };
const g = globalThis as unknown as { __madaSearchCache?: Map<string, CacheEntry<unknown>> };
const cache = (g.__madaSearchCache ??= new Map());

async function cached<T>(key: string, run: () => Promise<T>): Promise<{ value: T; at: number }> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < CACHE_MS) return { value: hit.value, at: hit.at };
  const value = await run();
  const at = Date.now();
  cache.set(key, { at, value });
  if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS) cache.delete(k);
  return { value, at };
}
export const clearSearchCache = () => cache.clear();

const hhmm = (local: string) => local.slice(11, 16);
/** Our price hold: 20 minutes from when the traveller saw it. */
export const HOLD_MS = 20 * 60_000;
const holdEnds = () => new Date(Date.now() + HOLD_MS);

/**
 * Every option of one search in one INSERT (ids made here, so each row already carries the option the app sees).
 * One row at a time was two round trips per option to the database: with 200 Hotelbeds hotels that was minutes.
 */
async function storeOffers(rows: (typeof appOffers.$inferInsert)[]) {
  for (let i = 0; i < rows.length; i += 250) await db.insert(appOffers).values(rows.slice(i, i + 250));
}

export function flightOptionOf(o: BookingFlightOffer, id: string, adults: number, infants: number): FlightOption {
  const out = o.out[0]!;
  const lastOut = o.out[o.out.length - 1]!;
  const back = o.back[0] ?? null;
  const carrier = CARRIERS[out.carrier];
  const pp = o.pricePerPerson.amount;
  const infant = sarToHalalas(infantSar(pp / 100));
  return {
    id, label: o.meta?.label ?? (o.label === "lowest" || o.label === "earliest" || o.label === "fastest" ? o.label : "best"),
    carrier: out.carrier, airline: out.carrierName, brand: carrier?.brand ?? "#1e352d",
    out: { flightNumber: out.flightNumber, from: out.from, to: lastOut.to, date: out.departLocal.slice(0, 10), dep: hhmm(out.departLocal), arr: hhmm(lastOut.arriveLocal), durationMin: o.out.reduce((a, l) => a + l.durationMin, 0) },
    back: back ? { flightNumber: back.flightNumber, from: back.from, to: o.back[o.back.length - 1]!.to, date: back.departLocal.slice(0, 10), dep: hhmm(back.departLocal), arr: hhmm(o.back[o.back.length - 1]!.arriveLocal), durationMin: o.back.reduce((a, l) => a + l.durationMin, 0) } : null,
    stop: o.meta?.stop ?? (o.out.length > 1 ? `One stop in ${o.out[0]!.to}` : null),
    reason: o.reason, bags: o.baggage, changeRule: o.changeRule, refundRule: o.refundRule, refundable: o.meta?.refundable ?? o.refundRule !== "Not refundable",
    cabin: o.cabin, adults, infants, pricePerPerson: money(pp), infantPrice: money(infant), total: money(pp * adults + infant * infants), expiresAt: o.expiresAt,
  };
}

export async function searchFlights(ownerId: string, input: FlightSearchRequest, demo: Set<DemoFlag>): Promise<FlightSearchResponse> {
  const q = FlightSchema.parse(input);
  const dest = DESTINATIONS[q.destination];
  if (!dest) throw new AppError("VALIDATION", { fields: { destination: "Unknown destination" } });
  if (q.return && q.return <= q.depart) throw new AppError("VALIDATION", { fields: { return: "Return must be after the day out" } });
  if (q.depart < today()) throw new AppError("VALIDATION", { fields: { depart: "That day has passed" } });
  const people = await travellersOf(ownerId, q.travellerIds);
  const n = people.length;
  const base = { destination: dest.key, destinationName: dest.name, from: q.from, depart: q.depart, return: q.return, cabin: q.cabin, unavailable: [] as { carrier: string; airline: string }[], bundle: null };
  const until = (at: number) => new Date(at + CACHE_MS).toISOString();
  if (dest.byHand) return { ...base, outcome: "by_hand", checked: 0, options: [], cachedUntil: until(Date.now()) };
  let depart = q.depart;
  if (demo.has("noResults")) {
    if (!q.flexibleDays) return { ...base, outcome: "none", checked: CHECKED_FARES[dest.key] ?? 9, options: [], cachedUntil: until(Date.now()) };
    // A day either side: the day after has room.
    const later = addDays(q.depart, 1);
    if (!q.return || later < q.return) depart = later;
  }
  const from = dest.code === q.from ? (q.from === "RUH" ? "JED" : "RUH") : q.from;
  const key = JSON.stringify(["f", supplierMode("flights"), from, dest.code, depart, q.return, n, q.infants, q.cabin]);
  let offers: BookingFlightOffer[];
  let at: number;
  try {
    ({ value: offers, at } = await cached(key, () => bookingSuppliers.flights().search({ from, to: dest.code, depart, return: q.return, adults: n, infants: q.infants, cabin: q.cabin })));
  } catch (e) {
    if (e instanceof SupplierDown) return { ...base, depart, outcome: "partial", checked: 0, options: [], unavailable: [{ carrier: "*", airline: "The airline" }], cachedUntil: until(Date.now()) };
    throw e;
  }
  const unavailable: { carrier: string; airline: string }[] = [];
  if (demo.has("supplierDown") && offers.some((o) => o.out[0]?.carrier === "SV")) {
    offers = offers.filter((o) => o.out[0]?.carrier !== "SV");
    unavailable.push({ carrier: "SV", airline: CARRIERS.SV!.name });
  }
  const search = { kind: "flight", destination: dest.key, from, depart, return: q.return, travellerIds: people.map((p) => p.id), infants: q.infants, cabin: q.cabin };
  const expiresAt = holdEnds();
  const options: FlightOption[] = offers.map((o) => ({ ...flightOptionOf(o, randomUUID(), n, q.infants), expiresAt: expiresAt.toISOString() }));
  await storeOffers(offers.map((o, i) => ({
    id: options[i]!.id, ownerId, kind: "flight", supplier: o.supplier, supplierOfferId: o.id, search, payload: options[i] as unknown as Record<string, unknown>, total: options[i]!.total.amount, expiresAt,
  })));
  const b = dest.key === "istanbul" && q.return ? bundleFor(n, depart, q.return) : null;
  return {
    ...base, depart, outcome: options.length ? (unavailable.length ? "partial" : "ok") : "none", checked: CHECKED_FARES[dest.key] ?? 9, options, unavailable,
    bundle: b ? { nights: b.nights, stay: money(sarToHalalas(b.staySar)), pickup: money(sarToHalalas(b.pickupSar)), total: money(sarToHalalas(b.totalSar)), hotelName: b.hotel.name, rooms: b.rooms } : null,
    cachedUntil: until(at),
  };
}

export function stayOptionOf(h: BookingHotelOffer, id: string, n: number, checkIn: string): StayOption {
  return {
    id, label: h.meta?.label ?? "best", name: h.name, area: h.area, address: h.address,
    note: n > 2 ? h.note : n === 2 ? h.meta?.noteTwo ?? h.note : h.meta?.noteOne ?? h.note,
    rating: h.rating ? h.rating.toFixed(1) : "", photo: h.meta?.photo ?? "hotel-room", focal: h.meta?.focal ?? "50% 50%",
    checkIn, nights: h.nights, rooms: roomsFor(n), roomsLabel: roomsLabel(n), total: money(h.total.amount), cancellation: h.cancellation,
    freeCancelUntil: h.freeCancelUntil, expiresAt: h.expiresAt,
    ...(h.meta?.facts ? { facts: h.meta.facts, badge: h.meta.badge ?? null, score: h.meta.score ?? 0 } : {}),
    ...(h.meta?.hotelCode ? { hotel: { code: h.meta.hotelCode, category: h.meta.category ?? null, imageUrl: h.meta.imageUrl ?? null, room: h.meta.room ?? null, board: h.meta.board ?? null, rateComments: h.meta.rateComments ?? null, rateCommentsId: h.meta.rateCommentsId ?? null, supplier: "hotelbeds" as const } } : {}),
  };
}

export async function searchStays(ownerId: string, input: StaySearchRequest, demo: Set<DemoFlag>): Promise<StaySearchResponse> {
  const q = StaySchema.parse(input);
  const dest = DESTINATIONS[q.destination];
  if (!dest) throw new AppError("VALIDATION", { fields: { destination: "Unknown destination" } });
  const people = await travellersOf(ownerId, q.travellerIds);
  const n = people.length;
  const base = { destination: dest.key, destinationName: dest.name, cachedUntil: new Date(Date.now() + CACHE_MS).toISOString() };
  if (!CATALOGUE_HOTELS[dest.key] && supplierMode("hotels") === "mock") return { ...base, outcome: "by_hand", options: [] };
  if (demo.has("noResults")) return { ...base, outcome: "none", options: [] };
  // Who is going decides what fits (docs/app/RANKING.md): a family, a couple, someone alone, a group.
  const shape = tripShape(people, q.checkIn);
  const key = JSON.stringify(["h", supplierMode("hotels"), dest.key, q.checkIn, q.nights, n, shape.shape]);
  // Children's ages on the day they check in (Hotelbeds prices children by age; the catalogue ignores them).
  const childAges = people.map((p) => (p.dateOfBirth ? daysBetween(p.dateOfBirth, q.checkIn) / 365.25 : 99)).filter((a) => a < 18).map((a) => Math.floor(a));
  const { value: offers } = await cached(key, () => bookingSuppliers.hotels().search({ city: dest.name, checkIn: q.checkIn, nights: q.nights, adults: n, rooms: roomsFor(n), childAges } as Parameters<ReturnType<typeof bookingSuppliers.hotels>["search"]>[0]));
  const expiresAt = holdEnds();
  const search = { kind: "stay", destination: dest.key, checkIn: q.checkIn, nights: q.nights, travellerIds: people.map((p) => p.id) };
  // Ranked for this trip, with one "Best for you" and one "Lowest price"; the reasons are stored with each offer.
  const ranked = rankStays(offers.map((h) => ({ h, name: h.name, total: h.total, facts: h.meta?.facts ?? null })), { shape: shape.shape, city: dest.key, radiusKm: 8 });
  const options: StayOption[] = ranked.map((r) => ({ ...stayOptionOf(r.h, randomUUID(), n, q.checkIn), label: r.badge === "lowest" ? "lowest" as const : "best" as const, badge: r.badge, score: r.score, fit: r.fit, expiresAt: expiresAt.toISOString() }));
  await storeOffers(ranked.map(({ h }, i) => ({
    id: options[i]!.id, ownerId, kind: "stay", supplier: h.supplier, supplierOfferId: h.id, search, payload: options[i] as unknown as Record<string, unknown>, total: h.total.amount, expiresAt,
  })));
  return { ...base, outcome: options.length ? "ok" : "none", options, shape: { shape: shape.shape, because: shape.because, travellers: shape.travellers, under12: shape.under12 } };
}

export type OfferRow = typeof appOffers.$inferSelect;

/**
 * The rooms of the hotel in a stay offer, for its details screen: priced now for the same stay and party, each stored
 * as an offer the order sheet can take. Suppliers without a choice of rooms answer with the offer itself.
 */
export async function stayRooms(ownerId: string, id: string): Promise<StayOption[]> {
  const row = await ownOffer(ownerId, id);
  if (row.kind !== "stay") throw new AppError("NOT_FOUND");
  const shown = row.payload as unknown as StayOption;
  const supplier = bookingSuppliers.hotels();
  if (row.supplier !== "hotelbeds" || !supplier.rooms) return [shown];
  const search = row.search as { travellerIds?: string[]; checkIn?: string };
  const n = search.travellerIds?.length ?? 1;
  const offers = await supplier.rooms(row.supplierOfferId);
  if (!offers.length) return [shown];
  const expiresAt = holdEnds();
  const options = offers.map((h) => ({ ...stayOptionOf(h, h.id === row.supplierOfferId ? row.id : randomUUID(), n, search.checkIn ?? shown.checkIn), badge: null, expiresAt: expiresAt.toISOString() }));
  const fresh = offers.map((h, i) => ({ h, o: options[i]! })).filter(({ h }) => h.id !== row.supplierOfferId);
  if (fresh.length) await storeOffers(fresh.map(({ h, o }) => ({ id: o.id, ownerId, kind: "stay", supplier: h.supplier, supplierOfferId: h.id, search: row.search as Record<string, unknown>, payload: o as unknown as Record<string, unknown>, total: o.total.amount, expiresAt })));
  // The room the traveller tapped stays first when it's still there, as it was shown.
  const same = options.find((o) => o.id === row.id);
  return same ? [shown, ...options.filter((o) => o !== same)] : options;
}

export async function ownOffer(ownerId: string, id: string): Promise<OfferRow> {
  if (!isUuid(id)) throw new AppError("NOT_FOUND");
  const [row] = await db.select().from(appOffers).where(and(eq(appOffers.id, id), eq(appOffers.ownerId, ownerId)));
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

export function offerView(row: OfferRow, changedBy: number | null = null): OfferResponse {
  return {
    kind: row.kind as "flight" | "stay",
    flight: row.kind === "flight" ? (row.payload as unknown as FlightOption) : null,
    stay: row.kind === "stay" ? (row.payload as unknown as StayOption) : null,
    expired: row.expiresAt.getTime() <= Date.now(), changedBy,
  };
}

/**
 * "Check the price again": the supplier prices the offer for this many travellers now, and the hold starts again.
 * Used by the order sheet when the hold ends and when the travellers change.
 */
export async function repriceOffer(ownerId: string, id: string, travellerCount?: number): Promise<{ row: OfferRow; changedBy: number }> {
  const row = await ownOffer(ownerId, id);
  const search = row.search as { travellerIds?: string[]; infants?: number; checkIn?: string };
  const n = travellerCount ?? search.travellerIds?.length ?? 1;
  let payload: Record<string, unknown>;
  let total: number;
  let expiresAt: Date;
  if (row.kind === "flight") {
    const o = await bookingSuppliers.flights().price(row.supplierOfferId, n);
    const opt = flightOptionOf(o, row.id, n, search.infants ?? 0);
    payload = opt as unknown as Record<string, unknown>;
    total = opt.total.amount;
    expiresAt = holdEnds();
    payload.expiresAt = expiresAt.toISOString();
  } else {
    const supplierId = row.supplierOfferId.replace(/\.(\d+)$/, `.${n}`);
    const h = await bookingSuppliers.hotels().price(supplierId);
    const opt = stayOptionOf(h, row.id, n, search.checkIn ?? h.freeCancelUntil ?? today());
    expiresAt = holdEnds();
    payload = { ...opt, expiresAt: expiresAt.toISOString() } as unknown as Record<string, unknown>;
    total = opt.total.amount;
  }
  const changedBy = n === (search.travellerIds?.length ?? n) ? total - row.total : 0;
  const [updated] = await db.update(appOffers).set({ payload, total, expiresAt }).where(eq(appOffers.id, row.id)).returning();
  return { row: updated!, changedBy };
}

/* ───────────── entry checks ───────────── */

export async function checkEntry(ownerId: string, input: EntryCheckRequest, demo: Set<DemoFlag>): Promise<EntryCheckResponse> {
  const q = EntrySchema.parse(input);
  if (!DESTINATIONS[q.destination]) throw new AppError("VALIDATION", { fields: { destination: "Unknown destination" } });
  const travellers = await travellersOf(ownerId, q.travellerIds);
  const mock = supplierMode("flights") === "mock";
  return entryChecks({
    destination: q.destination, travellers, depart: q.depart, return: q.return, answers: q.answers, today: today(),
    demo: { passportProblemFor: demo.has("passportProblem") ? demoPassportTarget(await householdOf(ownerId)) : null }, iqamaOf: mock ? demoIqama : undefined,
  });
}

export const nightsOf = (a: string, b: string | null) => (b ? Math.max(1, daysBetween(a, b)) : 6);
