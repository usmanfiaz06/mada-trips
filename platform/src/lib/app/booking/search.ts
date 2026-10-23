import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  CARRIERS, CATALOGUE_HOTELS, ENTRY_RULES, rankStays, tripShape, demoPassportTarget, CHECKED_FARES, DESTINATIONS, addDays, bundleFor, daysBetween, demoIqama, entryChecks, childSar, childSeats, flightTotal, infantSar, money, roomsFor, roomsLabel, sarToHalalas,
  type DemoFlag, type EntryCheckRequest, type EntryCheckResponse, type FlightOption, type FlightSearchRequest, type FlightSearchResponse, type OfferResponse,
  type StayOption, type StaySearchRequest, type StaySearchResponse, EntryCheckRequest as EntrySchema, FlightSearchRequest as FlightSchema, StaySearchRequest as StaySchema,
} from "@mada/shared";
import { db } from "@/db";
import { appOffers, appSearchCache } from "@/db/app-schema-booking";
import { supplierMode } from "../config";
import { AppError } from "../http";
import type { BookingFlightOffer, BookingHotelOffer } from "../suppliers/booking-types";
import { SupplierDown } from "../suppliers/mock/flights";
import { bookingSuppliers, householdOf, isUuid, renewalsAsked, today, travellersOf } from "./common";
import { guestPeople } from "../guest";
import { entryRulesSupplier, withEntryRequirements } from "../suppliers/sherpa";
import { duffelSource } from "../suppliers/duffel";
import { rateHawkSource } from "../suppliers/ratehawk";
import { destinationIn, resolveStayPlace } from "./stay-place";

/*
 * Search: flights and stays through the supplier interfaces, cached for 10 minutes; each option the traveller sees is
 * stored as an offer with our own id and the supplier's hold (20 minutes), so the order sheet prices exactly that.
 * A live supplier's answer is also kept in app_search_cache, so every server instance shares it (a hotel search takes
 * Hotelbeds seconds; the shared copy is one database read).
 */

const CACHE_MS = 10 * 60_000;
type CacheEntry<T> = { at: number; value: T };
const g = globalThis as unknown as { __madaSearchCache?: Map<string, CacheEntry<unknown>> };
const cache = (g.__madaSearchCache ??= new Map());

/**
 * The supplier's answer for this key: this instance's copy, else (shared) the database's, else the supplier's.
 * `saved` settles when a new answer is in the database; callers await it with their own writes (no extra wait).
 */
export async function cached<T>(key: string, run: () => Promise<T>, shared = false): Promise<{ value: T; at: number; saved: Promise<void> }> {
  const done = Promise.resolve();
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < CACHE_MS) return { value: hit.value, at: hit.at, saved: done };
  if (shared) {
    const row = await db.select({ value: appSearchCache.value, at: appSearchCache.createdAt }).from(appSearchCache)
      .where(and(eq(appSearchCache.key, key), sql`${appSearchCache.createdAt} > now() - interval '10 minutes'`)).limit(1)
      .then((r) => r[0], () => undefined);
    if (row) {
      const at = Math.min(row.at.getTime(), Date.now());
      remember(key, { at, value: row.value });
      return { value: row.value as T, at, saved: done };
    }
  }
  const value = await run();
  const at = Date.now();
  remember(key, { at, value });
  // One statement: this answer in, answers over an hour old out. A failure only costs the next instance a search.
  const saved = shared
    ? db.execute(sql`WITH gone AS (DELETE FROM app_search_cache WHERE created_at < now() - interval '1 hour')
        INSERT INTO app_search_cache (key, value, created_at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`).then(() => undefined, (e) => { console.warn("[search] cache not saved", e instanceof Error ? e.message : ""); })
    : done;
  return { value, at, saved };
}

function remember(key: string, entry: CacheEntry<unknown>) {
  cache.set(key, entry);
  if (cache.size > 500) for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS) cache.delete(k);
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

/** `adults` is every seat, `children` the seats on a child fare among them, `infants` the babies on a lap. */
export function flightOptionOf(o: BookingFlightOffer, id: string, adults: number, infants: number, children = 0): FlightOption {
  const out = o.out[0]!;
  const lastOut = o.out[o.out.length - 1]!;
  const back = o.back[0] ?? null;
  const carrier = CARRIERS[out.carrier];
  const pp = o.pricePerPerson.amount;
  // The supplier's own fare per passenger type when it sends one (Duffel does), else the usual share of the adult fare.
  const child = o.childPrice?.amount ?? sarToHalalas(childSar(pp / 100));
  const infant = o.infantPrice?.amount ?? sarToHalalas(infantSar(pp / 100));
  const kids = Math.min(children, adults);
  return {
    id, label: o.meta?.label ?? (o.label === "lowest" || o.label === "earliest" || o.label === "fastest" ? o.label : "best"),
    carrier: out.carrier, airline: out.carrierName, brand: carrier?.brand ?? "#1e352d",
    out: { flightNumber: out.flightNumber, from: out.from, to: lastOut.to, date: out.departLocal.slice(0, 10), dep: hhmm(out.departLocal), arr: hhmm(lastOut.arriveLocal), durationMin: o.out.reduce((a, l) => a + l.durationMin, 0) },
    back: back ? { flightNumber: back.flightNumber, from: back.from, to: o.back[o.back.length - 1]!.to, date: back.departLocal.slice(0, 10), dep: hhmm(back.departLocal), arr: hhmm(o.back[o.back.length - 1]!.arriveLocal), durationMin: o.back.reduce((a, l) => a + l.durationMin, 0) } : null,
    stop: o.meta?.stop ?? (o.out.length > 1 ? `One stop in ${o.out[0]!.to}` : null),
    reason: o.reason, bags: o.baggage, changeRule: o.changeRule, refundRule: o.refundRule, refundable: o.meta?.refundable ?? o.refundRule !== "Not refundable",
    cabin: o.cabin, adults, infants, children: kids, pricePerPerson: money(pp), childPrice: money(child), infantPrice: money(infant),
    total: money(flightTotal({ pricePerPerson: money(pp), childPrice: money(child), infantPrice: money(infant) }, adults, kids, infants)), expiresAt: o.expiresAt,
    // A sample fare from the mock catalogue: every card and the pay sheet say "Demo fare · not bookable".
    ...(demoFlights() ? { demo: true } : {}),
  };
}

/** Flights come from the mock catalogue (never on a production deployment unless APP_ALLOW_MOCKS=yes). */
export function demoFlights(): boolean {
  try { return supplierMode("flights") === "mock"; } catch { return true; }
}

/** Who is going: the household's people when signed in, else the people a guest said (priced, never stored). */
const partyOf = (ownerId: string | null, ids: string[], guests: Parameters<typeof guestPeople>[1]) => (ownerId ? travellersOf(ownerId, ids) : Promise.resolve(guestPeople(ids, guests)));

export async function searchFlights(ownerId: string | null, input: FlightSearchRequest, demo: Set<DemoFlag>): Promise<FlightSearchResponse> {
  const q = FlightSchema.parse(input);
  const dest = DESTINATIONS[q.destination];
  if (!dest) throw new AppError("VALIDATION", { fields: { destination: "Unknown destination" } });
  if (q.return && q.return <= q.depart) throw new AppError("VALIDATION", { fields: { return: "Return must be after the day out" } });
  if (q.depart < today()) throw new AppError("VALIDATION", { fields: { depart: "That day has passed" } });
  const people = await partyOf(ownerId, q.travellerIds, q.guests);
  const n = people.length;
  // Children 2 to 11 and babies with a seat fly on a child fare (their age on the day out).
  const kids = childSeats(people, q.depart);
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
  const key = JSON.stringify(["f", supplierMode("flights"), from, dest.code, depart, q.return, n, kids, q.infants, q.cabin, ...(duffelSource() ? ["duffel"] : [])]);
  let offers: BookingFlightOffer[];
  let at: number;
  let saved: Promise<void>;
  try {
    ({ value: offers, at, saved } = await cached(key, () => bookingSuppliers.flights().search({ from, to: dest.code, depart, return: q.return, adults: Math.max(1, n - kids), children: Math.min(kids, n - 1), infants: q.infants, cabin: q.cabin }), supplierMode("flights") === "live"));
  } catch (e) {
    if (e instanceof SupplierDown) return { ...base, depart, outcome: "partial", checked: 0, options: [], unavailable: [{ carrier: "*", airline: "The airline" }], cachedUntil: until(Date.now()) };
    // A live supplier (TBO) that can't answer this route: the desk books it by hand, as a request (never an error screen).
    if (supplierMode("flights") === "live" && !(e instanceof AppError && e.code === "VALIDATION")) {
      console.warn("[search] live flights didn't answer; this route goes to the desk", e instanceof AppError ? e.code : e instanceof Error ? e.message.slice(0, 120) : "");
      return { ...base, depart, outcome: "by_hand", checked: 0, options: [], cachedUntil: until(Date.now()) };
    }
    throw e;
  }
  const unavailable: { carrier: string; airline: string }[] = [];
  if (demo.has("supplierDown") && offers.some((o) => o.out[0]?.carrier === "SV")) {
    offers = offers.filter((o) => o.out[0]?.carrier !== "SV");
    unavailable.push({ carrier: "SV", airline: CARRIERS.SV!.name });
  }
  const search = { kind: "flight", destination: dest.key, from, depart, return: q.return, travellerIds: people.map((p) => p.id), infants: q.infants, cabin: q.cabin };
  const expiresAt = holdEnds();
  const options: FlightOption[] = offers.map((o) => ({ ...flightOptionOf(o, randomUUID(), n, q.infants, kids), expiresAt: expiresAt.toISOString() }));
  await Promise.all([saved, storeOffers(offers.map((o, i) => ({
    id: options[i]!.id, ownerId, kind: "flight", supplier: o.supplier, supplierOfferId: o.id, search, payload: options[i] as unknown as Record<string, unknown>, total: options[i]!.total.amount, expiresAt,
  })))]);
  const b = dest.key === "istanbul" && q.return ? bundleFor(n, depart, q.return) : null;
  return {
    ...base, depart, outcome: options.length ? (unavailable.length ? "partial" : "ok") : "none", checked: CHECKED_FARES[dest.key] ?? 9, options, unavailable,
    bundle: b ? { nights: b.nights, stay: money(sarToHalalas(b.staySar)), pickup: money(sarToHalalas(b.pickupSar)), total: money(sarToHalalas(b.totalSar)), hotelName: b.hotel.name, rooms: b.rooms } : null,
    cachedUntil: until(at),
  };
}

/** A stay option as stored on the offer: the app's shape plus which essential information to fetch (never sent). */
export type StoredStay = StayOption & { hotel?: (NonNullable<StayOption["hotel"]> & { rateCommentsId?: string | null }) | null };

export function stayOptionOf(h: BookingHotelOffer, id: string, n: number, checkIn: string): StoredStay {
  return {
    id, label: h.meta?.label ?? "best", name: h.name, area: h.area, address: h.address,
    note: n > 2 ? h.note : n === 2 ? h.meta?.noteTwo ?? h.note : h.meta?.noteOne ?? h.note,
    rating: h.rating ? h.rating.toFixed(1) : "", photo: h.meta?.photo ?? "hotel-room", focal: h.meta?.focal ?? "50% 50%",
    checkIn, nights: h.nights, rooms: roomsFor(n), roomsLabel: roomsLabel(n), total: money(h.total.amount), cancellation: h.cancellation,
    freeCancelUntil: h.freeCancelUntil, expiresAt: h.expiresAt,
    ...(h.meta?.facts ? { facts: h.meta.facts, badge: h.meta.badge ?? null, score: h.meta.score ?? 0 } : {}),
    ...(h.meta?.hotelCode ? { hotel: { code: String(h.meta.hotelCode), category: h.meta.category ?? null, imageUrl: h.meta.imageUrl ?? null, room: h.meta.room ?? null, board: h.meta.board ?? null, rateComments: h.meta.rateComments ?? null, rateCommentsId: h.meta.rateCommentsId ?? null } } : {}),
  };
}

/** Where a stay search looks: one of our destination keys, or a place anywhere else (stay-place.ts). */
type StayTarget = { key: string | null; name: string; nameAr: string | null; country: string | null; centre: { lat: number; lng: number } | null; radiusKm: number };

async function stayTarget(destination: string, place: { name: string; lat?: number | null; lng?: number | null } | null | undefined): Promise<StayTarget | null> {
  const dest = DESTINATIONS[destination] ?? (place ? destinationIn(place.name) : null);
  if (dest) return { key: dest.key, name: dest.name, nameAr: null, country: ENTRY_RULES[dest.country]?.name ?? null, centre: null, radiusKm: 8 };
  // A destination that isn't a key and isn't "other" is read as the place's name ("lahore").
  const said = place ?? (destination !== "other" ? { name: destination } : null);
  if (!said) throw new AppError("VALIDATION", { fields: { destination: "Unknown destination" } });
  const w = await resolveStayPlace(said);
  return w ? { key: null, name: w.name, nameAr: w.nameAr, country: w.country, centre: { lat: w.lat, lng: w.lng }, radiusKm: w.radiusKm } : null;
}

/**
 * Stays in one of our cities, or anywhere in the world (`destination: "other"` with `place`): a place without a key is
 * searched around its point (Hotelbeds by geolocation) and answers `destination: "other"` with `place`. The catalogue
 * (mock) has rooms only in our cities: anywhere else answers "none", never a sample hotel.
 * `hotelCodes`: only these hotels (a hotel the traveller named in Ask, named-hotel.ts); suppliers without codes ignore it.
 */
export async function searchStays(ownerId: string | null, input: StaySearchRequest, demo: Set<DemoFlag>, only: { hotelCodes?: number[] } = {}): Promise<StaySearchResponse> {
  const q = StaySchema.parse(input);
  const where = await stayTarget(q.destination, q.place);
  const people = await partyOf(ownerId, q.travellerIds, q.guests);
  const n = people.length;
  const cachedUntil = new Date(Date.now() + CACHE_MS).toISOString();
  // A place nobody could put on the map: nothing to search; the answer says so (the place as it was said).
  if (!where) return { destination: "other", destinationName: q.place?.name ?? q.destination, cachedUntil, outcome: "none", options: [], place: null };
  const anywhere = where.key ? null : { name: where.name, nameAr: where.nameAr, country: where.country, lat: where.centre!.lat, lng: where.centre!.lng };
  const base = { destination: where.key ?? "other", destinationName: where.name, cachedUntil, ...(anywhere ? { place: anywhere } : {}) };
  if (where.key && !CATALOGUE_HOTELS[where.key] && supplierMode("hotels") === "mock") return { ...base, outcome: "by_hand", options: [] };
  if (demo.has("noResults")) return { ...base, outcome: "none", options: [] };
  // Who is going decides what fits (docs/app/RANKING.md): a family, a couple, someone alone, a group.
  const shape = tripShape(people, q.checkIn);
  const at = anywhere ? `geo:${anywhere.lat.toFixed(3)},${anywhere.lng.toFixed(3)},${where.radiusKm}` : where.key;
  const key = JSON.stringify(["h", supplierMode("hotels"), at, q.checkIn, q.nights, n, shape.shape, ...(rateHawkSource() ? ["ratehawk"] : []), ...(only.hotelCodes?.length ? [only.hotelCodes] : [])]);
  // Children's ages on the day they check in (Hotelbeds prices children by age; the catalogue ignores them).
  const childAges = people.map((p) => (p.dateOfBirth ? daysBetween(p.dateOfBirth, q.checkIn) / 365.25 : 99)).filter((a) => a < 18).map((a) => Math.floor(a));
  const geo = anywhere ? { geo: { lat: anywhere.lat, lng: anywhere.lng, radiusKm: where.radiusKm } } : {};
  const { value: offers, saved } = await cached(key, () => bookingSuppliers.hotels().search({ city: where.name, checkIn: q.checkIn, nights: q.nights, adults: n, rooms: roomsFor(n), childAges, ...geo, ...(only.hotelCodes?.length ? { hotelCodes: only.hotelCodes } : {}) } as unknown as Parameters<ReturnType<typeof bookingSuppliers.hotels>["search"]>[0]), supplierMode("hotels") === "live");
  const expiresAt = holdEnds();
  // The place travels with the offer: the order sheet, the trip and the desk name it from here (no key to look up).
  const search = { kind: "stay", destination: where.key ?? "other", ...(anywhere ? { destinationName: where.name, place: anywhere } : {}), checkIn: q.checkIn, nights: q.nights, travellerIds: people.map((p) => p.id) };
  // Ranked for this trip, with one "Best for you" and one "Lowest price"; the reasons are stored with each offer.
  const ranked = rankStays(offers.map((h) => ({ h, name: h.name, total: h.total, facts: h.meta?.facts ?? null })), { shape: shape.shape, city: where.key, centre: where.centre, radiusKm: where.radiusKm });
  const options: StayOption[] = ranked.map((r) => ({ ...stayOptionOf(r.h, randomUUID(), n, q.checkIn), label: r.badge === "lowest" ? "lowest" as const : "best" as const, badge: r.badge, score: r.score, fit: r.fit, expiresAt: expiresAt.toISOString() }));
  await Promise.all([saved, storeOffers(ranked.map(({ h }, i) => ({
    id: options[i]!.id, ownerId, kind: "stay", supplier: h.supplier, supplierOfferId: h.id, search, payload: options[i] as unknown as Record<string, unknown>, total: h.total.amount, expiresAt,
  })))]);
  return { ...base, outcome: options.length ? "ok" : "none", options, shape: { shape: shape.shape, because: shape.because, travellers: shape.travellers, under12: shape.under12 } };
}

/** The place a stay offer was searched for, by name: a key's city, or the place stored with it (anywhere else). */
export const stayPlaceName = (search: unknown): string => {
  const s = (search ?? {}) as { destination?: string; destinationName?: string | null };
  return (s.destination ? DESTINATIONS[s.destination]?.name : undefined) ?? s.destinationName ?? "";
};

export type OfferRow = typeof appOffers.$inferSelect;

/**
 * The rooms of the hotel in a stay offer, for its details screen: priced now for the same stay and party, each stored
 * as an offer the order sheet can take. Suppliers without a choice of rooms answer with the offer itself.
 */
export async function stayRooms(ownerId: string | null, id: string): Promise<StayOption[]> {
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

/**
 * The offer as its owner may see it. An offer a guest searched has no owner: a guest can read it, and the first
 * account to use it (the guest who just signed in to book it) takes it, so the order sheet prices exactly that.
 */
export async function ownOffer(ownerId: string | null, id: string): Promise<OfferRow> {
  if (!isUuid(id)) throw new AppError("NOT_FOUND");
  const [row] = await db.select().from(appOffers).where(and(eq(appOffers.id, id), ownerId ? or(eq(appOffers.ownerId, ownerId), isNull(appOffers.ownerId)) : isNull(appOffers.ownerId)));
  if (!row) throw new AppError("NOT_FOUND");
  if (ownerId && !row.ownerId) {
    const [claimed] = await db.update(appOffers).set({ ownerId }).where(and(eq(appOffers.id, id), isNull(appOffers.ownerId))).returning();
    // Someone else took it in the same instant: it isn't this account's.
    if (!claimed) throw new AppError("NOT_FOUND");
    return claimed;
  }
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
export async function repriceOffer(ownerId: string | null, id: string, travellerCount?: number, children?: number, demo?: Set<DemoFlag>): Promise<{ row: OfferRow; changedBy: number }> {
  const row = await ownOffer(ownerId, id);
  const search = row.search as { travellerIds?: string[]; infants?: number; checkIn?: string };
  const n = travellerCount ?? search.travellerIds?.length ?? 1;
  let payload: Record<string, unknown>;
  let total: number;
  let expiresAt: Date;
  if (row.kind === "flight") {
    const kids = Math.min(children ?? (row.payload as { children?: number }).children ?? 0, n);
    const o = await bookingSuppliers.flights().price(row.supplierOfferId, n, kids);
    // Demo: the fare comes back SAR 60 lower a seat, to show "Now SAR X, down from Y" on the pay sheet.
    const less = demo?.has("priceDown") ? 6000 : 0;
    const priced = less ? { ...o, pricePerPerson: money(Math.max(0, o.pricePerPerson.amount - less)), childPrice: o.childPrice ? money(Math.max(0, o.childPrice.amount - less)) : undefined } : o;
    const opt = flightOptionOf(priced, row.id, n, search.infants ?? 0, kids);
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

export async function checkEntry(ownerId: string | null, input: EntryCheckRequest, demo: Set<DemoFlag>): Promise<EntryCheckResponse> {
  const q = EntrySchema.parse(input);
  if (!DESTINATIONS[q.destination]) throw new AppError("VALIDATION", { fields: { destination: "Unknown destination" } });
  // Renewals already asked for count as answered (pricing.ts renewalsAsked): the passport card says Mada is on it.
  const [travellers, asked] = await Promise.all([partyOf(ownerId, q.travellerIds, q.guests), ownerId ? renewalsAsked(ownerId) : Promise.resolve({})]);
  const mock = supplierMode("flights") === "mock";
  const answers = { ...asked, ...q.answers };
  const rules = entryChecks({
    destination: q.destination, travellers, depart: q.depart, return: q.return, answers, today: today(),
    demo: { passportProblemFor: demo.has("passportProblem") && ownerId ? demoPassportTarget(await householdOf(ownerId)) : null }, iqamaOf: mock ? demoIqama : undefined,
  });
  // Sherpa (when switched on) decides each passport's visa line; the built-in rules stay as the fallback.
  const sherpa = entryRulesSupplier();
  if (!sherpa) return rules;
  return withEntryRequirements(sherpa, rules, { country: DESTINATIONS[q.destination]!.country, travellers, depart: q.depart, return: q.return, answers });
}

export const nightsOf = (a: string, b: string | null) => (b ? Math.max(1, daysBetween(a, b)) : 6);
