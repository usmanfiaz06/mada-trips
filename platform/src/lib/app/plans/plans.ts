import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  ENTRY_RULES, addDays, daysBetween, formatSar, planTitle, t, type CreatePlanRequest, type Plan, type PlanItem, type PlanItemStatus, type PlaceInput,
} from "@mada/shared";
import { db, type Tx } from "@/db";
import { appPickups, appQuotes, appRequests, appSegments, appStays, appTrips } from "@/db/app-schema";
import { appAskMemory } from "@/db/app-schema-ask";
import { appOffers, appOrders, appTripBookings } from "@/db/app-schema-booking";
import { appEsims } from "@/db/app-schema-esim";
import { appPlanEvents, appPlanItems, appPlans, type PlanPlaceJson } from "@/db/app-schema-plans";
import { appTripFacts } from "@/db/app-schema-trips";
import { AppError } from "../http";
import { listPeople } from "../people";
import { computeChecks } from "./checks";
import { placeInText, resolvePlace, samePlace } from "./places";
import { templateOf, type PlanTemplate } from "./templates";

/*
 * The living plan (docs/app/ASK-INTEGRATED.md §3): building a plan from a shape or a template, reading it with each
 * item's status derived from the booking it points at, and keeping items linked to the trip's bookings. Writes that
 * take a version (edits, origin changes) and the plan's creation live in ops.ts; both go through the same rows.
 *
 * The rule: a booking row decides an item's status. An item never says "confirmed" on its own; the status column is
 * only a cache the listener (syncTripBookings) writes, for lists that don't load the bookings.
 */

export type ItemRow = typeof appPlanItems.$inferSelect;
export type PlanRow = typeof appPlans.$inferSelect;
export type TripRow = typeof appTrips.$inferSelect;
export type ItemDraft = Omit<typeof appPlanItems.$inferInsert, "planId" | "id">;
export type Origin = PlanPlaceJson & { source: "said" | "memory" | "booking" | "profile" | "default" };
export type By = "ask" | "traveller" | "desk" | "system";

/* ───────────── building ───────────── */

const placeName = (p: PlanPlaceJson | null | undefined) => (p ? p.city || p.name : "");
export const legTitle = (from: PlanPlaceJson | null, to: PlanPlaceJson | null) => [placeName(from), placeName(to)].filter(Boolean).join(" → ");
const timeOn = (start: string, day: number, at: string | null | undefined) => (at ? `${addDays(start, day)}T${at}` : null);

/**
 * The mode of a leg the traveller didn't name. The first and last legs fly unless the trip is a road trip; legs between
 * stops drive on a mixed trip, and otherwise fly only between two airports in different countries.
 */
export function legMode(from: PlanPlaceJson | null, to: PlanPlaceJson | null, travelMode: "fly" | "drive" | "mixed" | null | undefined, edge: boolean): "flight" | "drive" {
  if (travelMode === "drive") return "drive";
  if (travelMode === "fly") return "flight";
  if (edge) return "flight";
  if (travelMode === "mixed") return "drive";
  return from?.code && to?.code && from.country && to.country && from.country !== to.country ? "flight" : "drive";
}

/** The leg from the origin to the first stop, and from the last stop home, with a template's time only where it holds. */
export function originLegs(input: {
  origin: PlanPlaceJson | null; returnTo: PlanPlaceJson | null; first: PlanPlaceJson; last: PlanPlaceJson; start: string; lastDay: number;
  travelMode?: "fly" | "drive" | "mixed" | null; template?: PlanTemplate | null;
}): ItemDraft[] {
  const out: ItemDraft[] = [];
  const tpl = input.template ?? null;
  // A template's flight times and notes were written for one airport: from anywhere else the leg has no time yet.
  const own = !!tpl && !!input.origin?.code && input.origin.code === tpl.writtenFrom;
  if (input.origin && !samePlace(input.origin, input.first)) {
    out.push({
      day: 0, sort: -100, kind: "leg", mode: legMode(input.origin, input.first, input.travelMode, true), title: legTitle(input.origin, input.first),
      note: own ? tpl!.out?.note ?? null : null, fromPlace: input.origin, toPlace: input.first, startsAt: own ? timeOn(input.start, 0, tpl!.out?.at) : null,
      status: "idea", originLeg: "out", source: tpl ? "template" : "ask",
    });
  }
  if (input.returnTo && !samePlace(input.returnTo, input.last)) {
    const homeOwn = own && !!input.returnTo.code && input.returnTo.code === tpl!.writtenFrom;
    const day = tpl?.home?.day ?? input.lastDay;
    out.push({
      day, sort: 1000, kind: "leg", mode: legMode(input.last, input.returnTo, input.travelMode, true), title: legTitle(input.last, input.returnTo),
      note: homeOwn ? tpl!.home?.note ?? null : null, fromPlace: input.last, toPlace: input.returnTo, startsAt: homeOwn ? timeOn(input.start, day, tpl!.home?.at) : null,
      status: "idea", originLeg: "home", source: tpl ? "template" : "ask",
    });
  }
  return out;
}

export type Shape = {
  stops: { place: PlanPlaceJson; nights: number }[];
  start: string;
  origin: PlanPlaceJson | null;
  returnTo: PlanPlaceJson | null;
  travelMode?: "fly" | "drive" | "mixed" | null;
  must?: string[];
};

/**
 * Days, legs and stays from a shape (places and nights per place). No times: the model never writes one, and a time
 * comes later from a search or the traveller. Drive legs leave km and time empty for the drive interface (U4).
 */
export function buildFromShape(s: Shape): { items: ItemDraft[]; days: number; kind: "simple" | "multi" | "road" } {
  const items: ItemDraft[] = [];
  let day = 0;
  s.stops.forEach((stop, i) => {
    if (i > 0) {
      const prev = s.stops[i - 1]!.place;
      if (!samePlace(prev, stop.place)) {
        items.push({ day, sort: 0, kind: "leg", mode: legMode(prev, stop.place, s.travelMode, false), title: legTitle(prev, stop.place), fromPlace: prev, toPlace: stop.place, status: "idea", source: "ask" });
      }
    }
    if (stop.nights > 0) items.push({ day, sort: 10, kind: "stay", title: `Stay in ${placeName(stop.place)}`, place: stop.place, nights: stop.nights, status: "idea", source: "ask" });
    day += stop.nights;
  });
  const days = Math.max(1, day + 1);
  // Must-dos go on the first full day at the first stop, untimed.
  const mustDay = Math.min(days - 1, s.stops[0]!.nights > 0 ? 1 : 0);
  (s.must ?? []).forEach((m, i) => items.push({ day: mustDay, sort: 20 + i, kind: "activity", title: m, place: { name: placeName(s.stops[0]!.place), kind: "city", city: s.stops[0]!.place.city ?? s.stops[0]!.place.name, country: s.stops[0]!.place.country ?? null }, status: "idea", source: "ask" }));
  items.push(...originLegs({ origin: s.origin, returnTo: s.returnTo, first: s.stops[0]!.place, last: s.stops[s.stops.length - 1]!.place, start: s.start, lastDay: days - 1, travelMode: s.travelMode }));
  const inner = items.filter((x) => x.kind === "leg" && !x.originLeg);
  const kind = s.stops.length === 1 ? "simple" : inner.some((x) => x.mode === "drive") ? "road" : "multi";
  return { items: sortDrafts(items), days, kind };
}

export function buildFromTemplate(tpl: PlanTemplate, start: string, origin: PlanPlaceJson | null, returnTo: PlanPlaceJson | null): { items: ItemDraft[]; days: number; kind: "simple" } {
  const items: ItemDraft[] = tpl.items.map((x, i) => ({
    day: x.day, sort: i * 10, kind: x.kind, mode: x.mode ?? null, title: x.title, note: x.note ?? null, place: x.place ?? null, fromPlace: x.from ?? null, toPlace: x.to ?? null,
    startsAt: timeOn(start, x.day, x.at), nights: x.nights ?? null, status: "idea", source: "template",
  }));
  items.push(...originLegs({ origin, returnTo, first: tpl.destination, last: tpl.destination, start, lastDay: tpl.days - 1, template: tpl }));
  return { items: sortDrafts(items), days: tpl.days, kind: "simple" };
}

/** Day order, then time, then the order given; sort renumbered 10 apart so an insert fits between two. */
function sortDrafts(items: ItemDraft[]): ItemDraft[] {
  const ordered = items.map((x, i) => ({ x, i })).sort((a, b) =>
    (a.x.day ?? 1e6) - (b.x.day ?? 1e6) || (a.x.sort ?? 0) - (b.x.sort ?? 0) || (a.x.startsAt ?? "").localeCompare(b.x.startsAt ?? "") || a.i - b.i);
  const out: ItemDraft[] = [];
  let lastDay: number | null | undefined;
  let n = 0;
  for (const { x } of ordered) {
    if (x.day !== lastDay) { n = 0; lastDay = x.day; }
    out.push({ ...x, sort: (n += 10) });
  }
  return out;
}

/** The first Thursday at least a month away: the default start when nobody named one (§8 create_plan). */
export function defaultStart(today: string): string {
  let d = addDays(today, 30);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 4) d = addDays(d, 1);
  return d;
}

/* ───────────── origin ───────────── */

/**
 * Where the trip starts, in the spec's order (§3.8): said now, the remembered home airport, the last booked flight out.
 * Nothing known → null, and the plan asks (originNeeded). The profile has no country yet, so step 4 is skipped.
 */
export async function resolveOrigin(ownerId: string, said: PlaceInput | null | undefined): Promise<Origin | null> {
  if (said) {
    const p = resolvePlace(said);
    return p ? { ...p, source: "said" } : null;
  }
  const [mem] = await db.select({ text: appAskMemory.text }).from(appAskMemory)
    .where(and(eq(appAskMemory.ownerId, ownerId), eq(appAskMemory.kind, "home_airport"))).orderBy(desc(appAskMemory.createdAt)).limit(1);
  const fromMemory = mem ? placeInText(mem.text) : null;
  if (fromMemory) return { ...fromMemory, source: "memory" };
  const [seg] = await db.select({ from: appSegments.fromAirport }).from(appSegments).innerJoin(appTrips, eq(appTrips.id, appSegments.tripId))
    .where(and(eq(appTrips.ownerId, ownerId), eq(appSegments.direction, "out"))).orderBy(desc(appSegments.departLocal)).limit(1);
  const fromBooking = seg ? resolvePlace({ name: seg.from, code: seg.from, kind: "airport" }) : null;
  if (fromBooking?.code) return { ...fromBooking, source: "booking" };
  return null;
}

/**
 * The airport a flight search leaves from when nobody said one (U9, memory → origin): the remembered home airport when
 * it is one we search from (RUH, JED, DMM), else Riyadh, as before.
 */
export async function homeAirport(ownerId: string): Promise<"RUH" | "JED" | "DMM"> {
  const [mem] = await db.select({ text: appAskMemory.text }).from(appAskMemory)
    .where(and(eq(appAskMemory.ownerId, ownerId), eq(appAskMemory.kind, "home_airport"))).orderBy(desc(appAskMemory.createdAt)).limit(1);
  const code = mem ? placeInText(mem.text)?.code : null;
  return code === "JED" || code === "DMM" ? code : "RUH";
}

/* ───────────── statuses from bookings ───────────── */

type Stay = typeof appStays.$inferSelect;
type Segment = typeof appSegments.$inferSelect;
type Pickup = typeof appPickups.$inferSelect;
type Esim = typeof appEsims.$inferSelect;
export type Bookings = {
  stays: Stay[];
  segments: Segment[];
  pickups: Pickup[];
  esims: Esim[];
  orders: Map<string, { status: string; ref: string | null; total?: number; demo?: boolean }>;
  /** promisedBy: when the team gets back; quote: the desk's open quote on it (U7). */
  requests: Map<string, { status: string; promisedBy?: Date | null; quote?: { amount: number; expiresAt: Date | null } | null }>;
  /** total and demo: the price a tool gave (halalas) and whether it was a sample fare; createdAt is its "as of". */
  offers: Map<string, { expiresAt: Date; total?: number; demo?: boolean; createdAt?: Date }>;
  /** What each linked order wrote on the trip, so a booked item moves onto its stay or flight once confirmed (U7). */
  wrote?: Map<string, { stays: string[]; segments: string[]; esims: string[] }>;
};
export type Link = { kind: "stay" | "segment" | "pickup" | "esim"; id: string };

const localOf = (s: string) => s.replace(" ", "T").slice(0, 16);
const dayOfDate = (start: string, date: string) => daysBetween(start, date.slice(0, 10));

/**
 * Bookings on the trip that fulfil items not yet linked to one: a stay by its nights, a flight by its airports (and day
 * when it can tell), a transfer by its day. Each booking fulfils at most one item. Pure; the listener persists it.
 */
export function matchBookings(items: Pick<ItemRow, "id" | "kind" | "mode" | "day" | "nights" | "fromPlace" | "toPlace" | "bookingKind" | "bookingId" | "status" | "deletedAt">[], b: Pick<Bookings, "stays" | "segments" | "pickups">, start: string): Map<string, Link> {
  const out = new Map<string, Link>();
  const taken = new Set(items.filter((i) => i.bookingId).map((i) => `${i.bookingKind}:${i.bookingId}`));
  const open = items.filter((i) => !i.bookingId && !i.deletedAt && i.status !== "skipped");
  const take = (kind: Link["kind"], id: string, itemId: string) => { taken.add(`${kind}:${id}`); out.set(itemId, { kind, id }); };
  for (const it of open.filter((i) => i.kind === "stay" && i.day != null)) {
    const from = it.day!, to = it.day! + (it.nights ?? 1);
    const free = b.stays.filter((s) => !taken.has(`stay:${s.id}`) && s.status !== "cancelled");
    const exact = free.find((s) => dayOfDate(start, s.checkIn) === from);
    const overlap = exact ?? free.find((s) => { const d = dayOfDate(start, s.checkIn); return d < to && d + s.nights > from; });
    if (overlap) take("stay", overlap.id, it.id);
  }
  for (const it of open.filter((i) => i.kind === "leg" && i.mode === "flight")) {
    const fits = (s: Segment) => !taken.has(`segment:${s.id}`) && codeOrCity(it.fromPlace, s.fromAirport) && codeOrCity(it.toPlace, s.toAirport);
    const sameDay = b.segments.find((s) => fits(s) && it.day != null && dayOfDate(start, localOf(s.departLocal)) === it.day);
    const any = sameDay ?? b.segments.find(fits);
    if (any) take("segment", any.id, it.id);
  }
  for (const it of open.filter((i) => i.kind === "leg" && i.mode === "transfer" && i.day != null)) {
    const p = b.pickups.find((x) => !taken.has(`pickup:${x.id}`) && dayOfDate(start, x.at.toISOString()) === it.day);
    if (p) take("pickup", p.id, it.id);
  }
  return out;
}

function codeOrCity(place: PlanPlaceJson | null, code: string): boolean {
  if (!place) return false;
  if (place.code) return place.code === code;
  const p = resolvePlace({ name: code, code });
  return samePlace(place, p);
}

/** "18:40", Riyadh time: when the team gets back on a request. */
export const riyadhHm = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hour12: false });

export type Derived = { status: PlanItemStatus; line: string | null; booking: PlanItem["booking"] };

/** An item's status, read from what it points at: the booking row first, then a request, then a priced offer. */
export function deriveStatus(item: Pick<ItemRow, "status" | "statusNote" | "bookingKind" | "bookingId" | "requestId" | "offerId">, b: Bookings, link: Link | null, now = new Date()): Derived {
  if (item.status === "skipped") return { status: "skipped", line: null, booking: null };
  const kind = link?.kind ?? item.bookingKind;
  const id = link?.id ?? item.bookingId;
  if (kind && id) {
    if (kind === "stay") {
      const s = b.stays.find((x) => x.id === id);
      if (s) {
        const status: PlanItemStatus = s.status === "cancelled" || s.status === "refunded" ? "cancelled" : s.status === "held" ? "held" : s.status === "confirmed" || !!s.supplierRef ? "confirmed" : "booked";
        return { status, line: `${status === "cancelled" ? "Cancelled" : status === "held" ? "Held" : status === "confirmed" ? "Confirmed" : "Booked"} · ${s.name}`, booking: { kind: "stay", id: s.id, name: s.name, ref: s.confirmation } };
      }
    }
    if (kind === "segment") {
      const s = b.segments.find((x) => x.id === id);
      if (s) {
        const status: PlanItemStatus = s.status === "cancelled" ? "cancelled" : s.pnr ? "confirmed" : "booked";
        const name = `${s.carrierName} ${s.flightNumber}`;
        return { status, line: `${status === "cancelled" ? "Cancelled" : status === "confirmed" ? "Confirmed" : "Booked"} · ${name}`, booking: { kind: "segment", id: s.id, name, ref: s.pnr } };
      }
    }
    if (kind === "pickup") {
      const p = b.pickups.find((x) => x.id === id);
      if (p) {
        const status: PlanItemStatus = p.status === "cancelled" ? "cancelled" : p.status === "held" ? "held" : p.driverName ? "confirmed" : "booked";
        return { status, line: p.driverName && status === "confirmed" ? `Confirmed · ${p.driverName}` : null, booking: { kind: "pickup", id: p.id, name: p.driverName, ref: null } };
      }
    }
    if (kind === "esim") {
      const e = b.esims.find((x) => x.id === id);
      if (e) {
        const status: PlanItemStatus = e.status === "refunded" ? "cancelled" : e.status === "ordering" || e.status === "stuck" ? "booked" : "confirmed";
        return { status, line: null, booking: { kind: "esim", id: e.id, name: null, ref: null } };
      }
    }
    if (kind === "order") {
      const o = b.orders.get(id);
      if (o) {
        // A card the bank declined books nothing: the item is back to its price (below).
        if (o.status !== "declined") {
          const status: PlanItemStatus = ["cancelled", "refunded"].includes(o.status) ? "cancelled"
            : ["held", "price_locked", "fare_changed", "awaiting_payment", "payment_requested", "requires_action"].includes(o.status) ? "held"
            : o.status === "confirmed" ? "confirmed" : "booked";
          return { status, line: null, booking: { kind: "order", id, name: null, ref: status === "confirmed" ? o.ref : null } };
        }
      }
    }
    if (kind === "order" && b.orders.get(id)?.status === "declined") return deriveStatus({ ...item, bookingKind: null, bookingId: null }, b, null, now);
    // A booking we can't see any more (deleted, or a kind with no table yet): keep the cached status, say nothing new.
    return { status: item.status as PlanItemStatus, line: item.statusNote, booking: null };
  }
  if (item.requestId) {
    const r = b.requests.get(item.requestId);
    if (r && !["cancelled", "declined", "withdrawn"].includes(r.status)) {
      // The desk's quote is the item's price now ("Quote ready · SAR 4,200", with Pay); else when the team gets back.
      if (r.quote && (!r.quote.expiresAt || r.quote.expiresAt.getTime() > now.getTime())) return { status: "requested", line: t("plan.line.quoteReady", { amount: formatSar(r.quote.amount) }), booking: null };
      const by = r.promisedBy && r.promisedBy.getTime() > now.getTime() ? riyadhHm(r.promisedBy) : null;
      return { status: "requested", line: by ? t("plan.line.withTeam", { time: by }) : t("plan.line.withTeamNow"), booking: null };
    }
  }
  if (item.offerId) {
    const o = b.offers.get(item.offerId);
    if (o && o.expiresAt.getTime() > now.getTime()) return { status: "priced", line: null, booking: null };
    return { status: "idea", line: t("plan.line.priceExpired"), booking: null };
  }
  const cached = item.status as PlanItemStatus;
  if (cached === "priced" || cached === "requested") return { status: "idea", line: item.statusNote, booking: null };
  return { status: cached, line: item.statusNote, booking: null };
}

export async function loadBookings(tripId: string, items: Pick<ItemRow, "bookingKind" | "bookingId" | "requestId" | "offerId">[], q: typeof db | Tx = db): Promise<Bookings> {
  const orderIds = items.filter((i) => i.bookingKind === "order" && i.bookingId).map((i) => i.bookingId!);
  const requestIds = items.map((i) => i.requestId).filter((x): x is string => !!x);
  const offerIds = items.map((i) => i.offerId).filter((x): x is string => !!x);
  const [stays, segments, pickups, esims, orders, requests, offers, quotes, wrote] = await Promise.all([
    q.select().from(appStays).where(eq(appStays.tripId, tripId)).orderBy(asc(appStays.checkIn)),
    q.select().from(appSegments).where(eq(appSegments.tripId, tripId)).orderBy(asc(appSegments.sort)),
    q.select().from(appPickups).where(eq(appPickups.tripId, tripId)).orderBy(asc(appPickups.at)),
    q.select().from(appEsims).where(eq(appEsims.tripId, tripId)),
    orderIds.length ? q.select({ id: appOrders.id, status: appOrders.status, ref: appOrders.ref, total: appOrders.total, demo: sql<boolean>`coalesce((${appOrders.snapshot}->'preview'->>'demoFare')::boolean, false)` }).from(appOrders).where(inArray(appOrders.id, orderIds)) : Promise.resolve([]),
    requestIds.length ? q.select({ id: appRequests.id, status: appRequests.status, promisedBy: appRequests.promisedBy }).from(appRequests).where(inArray(appRequests.id, requestIds)) : Promise.resolve([]),
    offerIds.length ? q.select({ id: appOffers.id, expiresAt: appOffers.expiresAt, total: appOffers.total, payload: appOffers.payload, createdAt: appOffers.createdAt }).from(appOffers).where(inArray(appOffers.id, offerIds)) : Promise.resolve([]),
    requestIds.length ? q.select({ requestId: appQuotes.requestId, total: appQuotes.total, expiresAt: appQuotes.expiresAt }).from(appQuotes).where(and(inArray(appQuotes.requestId, requestIds), eq(appQuotes.status, "open"))).orderBy(desc(appQuotes.createdAt)) : Promise.resolve([]),
    orderIds.length ? q.select({ orderId: appTripBookings.orderId, details: appTripBookings.details }).from(appTripBookings).where(inArray(appTripBookings.orderId, orderIds)) : Promise.resolve([]),
  ]);
  const quoteOf = (id: string) => { const x = quotes.find((r) => r.requestId === id); return x ? { amount: x.total, expiresAt: x.expiresAt } : null; };
  return {
    stays, segments, pickups, esims,
    orders: new Map(orders.map((o) => [o.id, { status: o.status, ref: o.ref, total: o.total, demo: !!o.demo }])),
    requests: new Map(requests.map((r) => [r.id, { status: r.status, promisedBy: r.promisedBy, quote: quoteOf(r.id) }])),
    offers: new Map(offers.map((o) => [o.id, { expiresAt: o.expiresAt, total: o.total, demo: (o.payload as { demo?: unknown }).demo === true, createdAt: o.createdAt }])),
    wrote: new Map(orderIds.map((id) => {
      const d = (wrote.find((w) => w.orderId === id)?.details ?? {}) as { segments?: string[]; stays?: Record<string, unknown> };
      return [id, { stays: Object.keys(d.stays ?? {}), segments: d.segments ?? [], esims: esims.filter((e) => e.orderId === id).map((e) => e.id) }];
    })),
  };
}

/* ───────────── reading ───────────── */

export async function ownTrip(ownerId: string, tripId: string, q: typeof db | Tx = db): Promise<TripRow> {
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) throw new AppError("NOT_FOUND");
  const [trip] = await q.select().from(appTrips).where(and(eq(appTrips.id, tripId), eq(appTrips.ownerId, ownerId)));
  if (!trip) throw new AppError("NOT_FOUND");
  return trip;
}

export async function liveItems(planId: string, q: typeof db | Tx = db): Promise<ItemRow[]> {
  return q.select().from(appPlanItems).where(and(eq(appPlanItems.planId, planId), isNull(appPlanItems.deletedAt)))
    .orderBy(asc(appPlanItems.day), asc(appPlanItems.sort), asc(appPlanItems.createdAt));
}

/** The places the trip goes to, in order (not the origin, not the way home): for the title and the entry checks. */
export function stopsOf(items: Pick<ItemRow, "kind" | "place" | "toPlace" | "originLeg">[], trip: Pick<TripRow, "city">): PlanPlaceJson[] {
  const out: PlanPlaceJson[] = [];
  for (const it of items) {
    if (it.kind === "leg" && it.originLeg !== "home" && it.toPlace && it.toPlace.kind !== "place") out.push(it.toPlace);
    if (it.kind === "stay" && it.place) out.push(it.place.city ? resolvePlace({ name: it.place.city }) ?? it.place : it.place);
  }
  const dedup = out.filter((p, i) => i === 0 || !samePlace(p, out[i - 1]));
  return dedup.length ? dedup : [resolvePlace({ name: trip.city }) ?? { name: trip.city, kind: "city" }];
}

export const titleOf = (trip: Pick<TripRow, "title" | "city">, origin: PlanPlaceJson | null, items: Pick<ItemRow, "kind" | "place" | "toPlace" | "originLeg">[]) =>
  trip.title ?? planTitle(origin, stopsOf(items, trip));

export async function planRowOf(tripId: string, q: typeof db | Tx = db): Promise<PlanRow | null> {
  const [p] = await q.select().from(appPlans).where(eq(appPlans.tripId, tripId));
  return p ?? null;
}

/** The plan as every screen reads it: items with statuses from the bookings, checks, the title from the origin. */
export async function readPlan(ownerId: string, tripId: string): Promise<Plan> {
  const trip = await ownTrip(ownerId, tripId);
  const plan = await planRowOf(trip.id);
  if (!plan) throw new AppError("NOT_FOUND");
  const items = await liveItems(plan.id);
  const [bookings, people, [facts]] = await Promise.all([
    loadBookings(trip.id, items),
    listPeople(ownerId),
    db.select({ noStay: appTripFacts.noStay }).from(appTripFacts).where(eq(appTripFacts.tripId, trip.id)),
  ]);
  const links = matchBookings(items, bookings, plan.startDate);
  const out: PlanItem[] = items.map((it) => {
    const d = deriveStatus(it, bookings, links.get(it.id) ?? null);
    return {
      id: it.id, day: it.day, sort: it.sort, kind: it.kind as PlanItem["kind"], mode: (it.mode ?? null) as PlanItem["mode"], title: it.title, note: it.note,
      place: it.place ?? null, from: it.fromPlace ?? null, to: it.toPlace ?? null, startsAt: it.startsAt, endsAt: it.endsAt, tz: it.tz, nights: it.nights,
      status: d.status, statusLine: d.line, booking: d.booking, requestId: it.requestId, offerId: it.offerId, drive: it.drive ?? null, source: it.source as PlanItem["source"],
      ...moneyOf(it, d, bookings),
    };
  });
  const travellers = people.filter((p) => trip.travellerIds.includes(p.id));
  const origin = (trip.origin ?? plan.origin ?? null) as Origin | null;
  const days = daysBetween(plan.startDate, plan.endDate) + 1;
  const checks = computeChecks({
    startDate: plan.startDate, endDate: plan.endDate, days, travellers, noStay: !!facts?.noStay,
    items: out.map((i) => ({ kind: i.kind, mode: i.mode, day: i.day, nights: i.nights, status: i.status })),
    countries: stopsOf(items, trip).map((p) => p.country).filter((c): c is string => !!c),
    originCountry: origin?.country ?? null,
    esims: bookings.esims,
  });
  return {
    id: plan.id, tripId: trip.id, version: plan.version, title: titleOf(trip, origin, items), kind: (trip.kind ?? "simple") as Plan["kind"],
    origin: origin ? { ...origin, source: origin.source as Origin["source"] } : null, originNeeded: !origin, returnTo: plan.returnTo ?? null,
    startDate: plan.startDate, endDate: plan.endDate, days, pace: plan.pace as Plan["pace"], templateId: plan.templateId, travellerIds: trip.travellerIds,
    notes: plan.notes, items: out, checks, totals: planTotals(out), createdBy: plan.createdBy as Plan["createdBy"], updatedAt: plan.updatedAt.toISOString(),
  };
}

/* ───────────── money on the plan (U7) ───────────── */

/**
 * What an item costs, only as a tool, a quote or a booking said: the offer's price while it lives (with its "as of"),
 * the desk's open quote, or what the order charged. A price that ran out is flagged so the plan offers "Price again".
 */
export function moneyOf(it: Pick<ItemRow, "offerId" | "requestId" | "bookingKind" | "bookingId">, d: Derived, b: Bookings): Pick<PlanItem, "price" | "quote" | "promisedBy" | "priceExpired"> {
  const out: Pick<PlanItem, "price" | "quote" | "promisedBy" | "priceExpired"> = { price: null, quote: null, promisedBy: null };
  const offer = it.offerId ? b.offers.get(it.offerId) : undefined;
  if (d.status === "priced" && offer?.total != null) {
    out.price = { amount: offer.total, currency: "SAR", asOf: (offer.createdAt ?? new Date()).toISOString(), expiresAt: offer.expiresAt.toISOString(), demo: !!offer.demo };
  }
  const order = it.bookingKind === "order" && it.bookingId ? b.orders.get(it.bookingId) : undefined;
  if (["held", "booked", "confirmed"].includes(d.status) && order?.total != null) out.price = { amount: order.total, currency: "SAR", asOf: new Date().toISOString(), expiresAt: null, demo: !!order.demo };
  const r = it.requestId ? b.requests.get(it.requestId) : undefined;
  if (d.status === "requested" && r) {
    if (r.quote && (!r.quote.expiresAt || r.quote.expiresAt.getTime() > Date.now())) out.quote = { requestId: it.requestId!, amount: r.quote.amount, currency: "SAR", expiresAt: r.quote.expiresAt?.toISOString() ?? null };
    out.promisedBy = r.promisedBy?.toISOString() ?? null;
  }
  if (d.status === "idea" && it.offerId) out.priceExpired = true;
  return out;
}

/** The plan's totals: what "Book what's ready" would charge, what's paid, and a demo flag when any of it is a sample (§7.4). */
export function planTotals(items: Pick<PlanItem, "status" | "price" | "quote">[]): NonNullable<Plan["totals"]> | null {
  let priced = 0, booked = 0, ready = 0, demo = false, any = false;
  for (const i of items) {
    if (i.status === "priced" && i.price) { priced += i.price.amount; ready++; demo ||= i.price.demo; any = true; }
    else if (i.status === "requested" && i.quote) { priced += i.quote.amount; ready++; any = true; }
    else if (["held", "booked", "confirmed"].includes(i.status) && i.price) { booked += i.price.amount; demo ||= i.price.demo; any = true; }
  }
  return any ? { priced, booked, currency: "SAR", demo, ready } : null;
}

/* ───────────── events and the booking listener ───────────── */

const DIFF_MAX = 2048;
/** A plan event: what changed, by whom, short and redacted (titles, days, statuses; never documents or prices). */
export async function planEvent(q: typeof db | Tx, planId: string, by: By, op: string, itemId: string | null, diff: Record<string, unknown>) {
  let d = diff;
  if (JSON.stringify(d).length > DIFF_MAX) d = { title: String(diff.title ?? "").slice(0, 120), truncated: true };
  await q.insert(appPlanEvents).values({ planId, itemId, byKind: by, op, diff: d, seenInThread: by === "ask" });
}

/** Changes the trip's chat hasn't been told about yet (§3.6), oldest first; marked seen when the chat says so. */
export async function unseenEvents(ownerId: string, tripId: string) {
  const trip = await ownTrip(ownerId, tripId);
  const plan = await planRowOf(trip.id);
  if (!plan) return [];
  return db.select().from(appPlanEvents).where(and(eq(appPlanEvents.planId, plan.id), eq(appPlanEvents.seenInThread, false))).orderBy(asc(appPlanEvents.at));
}

export async function markEventsSeen(ownerId: string, tripId: string, ids: string[]): Promise<void> {
  const trip = await ownTrip(ownerId, tripId);
  const plan = await planRowOf(trip.id);
  if (!plan || !ids.length) return;
  await db.update(appPlanEvents).set({ seenInThread: true }).where(and(eq(appPlanEvents.planId, plan.id), inArray(appPlanEvents.id, ids)));
}

/**
 * After a booking lands on a trip (an order confirmed, a stay changed, an eSIM bought): link each booking to the item
 * it fulfils, add an item for a booking the plan didn't have, cache the statuses, and mark a planning trip booked.
 * Safe to run any number of times.
 */
export async function syncTripBookings(tripId: string): Promise<{ changed: number }> {
  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(appPlans).where(eq(appPlans.tripId, tripId)).for("update");
    if (!plan) return { changed: 0 };
    const [trip] = await tx.select().from(appTrips).where(eq(appTrips.id, tripId));
    if (!trip) return { changed: 0 };
    const items = await liveItems(plan.id, tx);
    const b = await loadBookings(tripId, items, tx);
    // An item booked through its own order (U7) moves onto what that order wrote once it's confirmed: the hotel on
    // its nights, the flight on its leg. Before that it reads the order's status.
    const fromOrder = relinkOrders(items, b);
    const links = matchBookings(items.filter((i) => !fromOrder.has(i.id)), b, plan.startDate);
    for (const [k, v] of fromOrder) links.set(k, v);
    const days = daysBetween(plan.startDate, plan.endDate) + 1;
    let changed = 0;
    let anyBooked = false;
    for (const it of items) {
      const link = links.get(it.id) ?? null;
      const d = deriveStatus(it, b, link);
      if (d.status === "booked" || d.status === "confirmed") anyBooked = true;
      if (!link && d.status === it.status && d.line === it.statusNote) continue;
      await tx.update(appPlanItems).set({
        ...(link ? { bookingKind: link.kind, bookingId: link.id, offerId: null } : {}), status: d.status, statusNote: d.line, updatedAt: new Date(),
      }).where(eq(appPlanItems.id, it.id));
      await planEvent(tx, plan.id, "system", "status", it.id, { title: it.title, day: it.day, from: it.status, to: d.status });
      changed++;
    }
    // Bookings no item asked for: they still belong on the plan, on their day.
    const linked = new Set([...items.filter((i) => i.bookingId).map((i) => `${i.bookingKind}:${i.bookingId}`), ...[...links.values()].map((l) => `${l.kind}:${l.id}`)]);
    for (const s of b.stays.filter((x) => !linked.has(`stay:${x.id}`) && x.status !== "cancelled")) {
      const day = dayOfDate(plan.startDate, s.checkIn);
      if (day < 0 || day >= days) continue;
      const d = deriveStatus({ status: "idea", statusNote: null, bookingKind: "stay", bookingId: s.id, requestId: null, offerId: null }, b, null);
      const [row] = await tx.insert(appPlanItems).values({
        planId: plan.id, day, sort: 5, kind: "stay", title: s.name, place: { name: s.name, kind: "place", city: trip.city, country: null }, nights: s.nights,
        status: d.status, statusNote: d.line, bookingKind: "stay", bookingId: s.id, source: "booking",
      }).returning({ id: appPlanItems.id });
      await planEvent(tx, plan.id, "system", "add", row!.id, { title: s.name, day, to: d.status });
      if (d.status === "booked" || d.status === "confirmed") anyBooked = true;
      changed++;
    }
    for (const s of b.segments.filter((x) => !linked.has(`segment:${x.id}`) && x.status !== "cancelled")) {
      const day = dayOfDate(plan.startDate, localOf(s.departLocal));
      if (day < 0 || day >= days) continue;
      const from = resolvePlace({ name: s.fromAirport, code: s.fromAirport, kind: "airport" });
      const to = resolvePlace({ name: s.toAirport, code: s.toAirport, kind: "airport" });
      const d = deriveStatus({ status: "idea", statusNote: null, bookingKind: "segment", bookingId: s.id, requestId: null, offerId: null }, b, null);
      const [row] = await tx.insert(appPlanItems).values({
        planId: plan.id, day, sort: 1, kind: "leg", mode: "flight", title: legTitle(from, to), fromPlace: from, toPlace: to,
        startsAt: localOf(s.departLocal), endsAt: localOf(s.arriveLocal), tz: s.departTz, status: d.status, statusNote: d.line, bookingKind: "segment", bookingId: s.id, source: "booking",
      }).returning({ id: appPlanItems.id });
      await planEvent(tx, plan.id, "system", "add", row!.id, { title: legTitle(from, to), day, to: d.status });
      if (d.status === "booked" || d.status === "confirmed") anyBooked = true;
      changed++;
    }
    if (changed) await tx.update(appPlans).set({ version: plan.version + 1, updatedAt: new Date() }).where(eq(appPlans.id, plan.id));
    if (anyBooked && trip.status === "planning") await tx.update(appTrips).set({ status: "booked", updatedAt: new Date() }).where(eq(appTrips.id, trip.id));
    return { changed };
  });
}

/** Items linked to an order whose booking rows exist now: each takes the first row of its kind that order wrote. */
export function relinkOrders(items: Pick<ItemRow, "id" | "kind" | "mode" | "bookingKind" | "bookingId" | "deletedAt">[], b: Pick<Bookings, "wrote" | "stays" | "segments" | "esims">): Map<string, Link> {
  const out = new Map<string, Link>();
  const used = new Set<string>();
  for (const it of items) {
    if (it.deletedAt || it.bookingKind !== "order" || !it.bookingId) continue;
    const w = b.wrote?.get(it.bookingId);
    if (!w) continue;
    const pick = (kind: "stay" | "segment" | "esim", ids: string[]) => { const id = ids.find((x) => !used.has(`${kind}:${x}`)); if (id) { used.add(`${kind}:${id}`); out.set(it.id, { kind, id }); } };
    if (it.kind === "stay") pick("stay", w.stays.filter((id) => b.stays.some((s) => s.id === id)));
    else if (it.kind === "leg" && it.mode === "flight") pick("segment", w.segments.filter((id) => b.segments.some((s) => s.id === id)));
    else if (w.esims.length) pick("esim", w.esims);
  }
  return out;
}

/* ───────────── create helpers shared with ops.ts ───────────── */

/** The shape a create request describes, with places resolved; the template's own when there is one. */
export function shapeOf(b: CreatePlanRequest, start: string, origin: PlanPlaceJson | null, returnTo: PlanPlaceJson | null) {
  const tpl = templateOf(b.templateId);
  if (tpl) return { ...buildFromTemplate(tpl, start, origin, returnTo), main: tpl.destination, template: tpl };
  const stops = (b.stops ?? []).map((s) => ({ place: resolvePlace(s.place)!, nights: s.nights }));
  // "days" with one stop and no nights given: the nights follow from the days.
  if (stops.length === 1 && b.days && stops[0]!.nights === 0) stops[0]!.nights = b.days - 1;
  const built = buildFromShape({ stops, start, origin, returnTo, travelMode: b.travelMode ?? null, must: b.must });
  const main = [...stops].sort((a, c) => c.nights - a.nights)[0]!.place;
  return { ...built, main, template: null };
}

export const countryName = (p: PlanPlaceJson) => (p.country ? ENTRY_RULES[p.country]?.name?.replace(/^the /, "") ?? null : null);
