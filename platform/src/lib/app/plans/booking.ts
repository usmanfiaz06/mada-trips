import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { OrderDraft, money, type BookReadyResponse, type DemoFlag } from "@mada/shared";
import { db, type Tx } from "@/db";
import { appRequests, appTrips } from "@/db/app-schema";
import { appOffers, appOrders } from "@/db/app-schema-booking";
import { appPlanItems, appPlans } from "@/db/app-schema-plans";
import { listPeople } from "../people";
import { priceDraft } from "../booking/pricing";
import { emit } from "./events";
import { deriveStatus, loadBookings, planEvent, readPlan, type By } from "./plans";

/*
 * Booking from the plan (docs/app/ASK-INTEGRATED.md §7, U7). Prices come from tools: an item is `priced` when a search
 * the traveller chose priced it (the offer's id on the item), `requested` when the desk is working on it (the request's
 * id on the item and the item's id on the request), and its order moves it on (held → booked → confirmed, cancelled
 * after a refund): the order's draft carries the item ids, the listener links them. One way to pay: every item is its
 * own order through the same priceDraft and createOrder the pay sheet always used; nothing here charges.
 */

/** Live items of this account's plans, with the plan and trip they belong to. Ids not the caller's are dropped. */
export async function ownItems(ownerId: string, itemIds: string[], q: typeof db | Tx = db) {
  const ids = [...new Set(itemIds)].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return [];
  return q.select({ item: appPlanItems, planId: appPlans.id, version: appPlans.version, tripId: appTrips.id, travellerIds: appTrips.travellerIds })
    .from(appPlanItems).innerJoin(appPlans, eq(appPlans.id, appPlanItems.planId)).innerJoin(appTrips, eq(appTrips.id, appPlans.tripId))
    .where(and(inArray(appPlanItems.id, ids), isNull(appPlanItems.deletedAt), eq(appTrips.ownerId, ownerId)));
}

/**
 * Item ids as the model gives them: the 8-character ids the plan gist shows ("[a1b2c3d4]") or full ones, on this
 * account's plans (this chat's trip first). An id that matches nothing, or more than one item, is dropped.
 */
export async function resolveItemIds(ownerId: string, tripId: string | null, raw: unknown): Promise<string[]> {
  const list = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : []).filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().replace(/^\[|\]$/g, "").toLowerCase()).filter((x) => /^[0-9a-f-]{6,36}$/.test(x)).slice(0, 12);
  if (!list.length) return [];
  const rows = await db.select({ id: appPlanItems.id, tripId: appTrips.id }).from(appPlanItems).innerJoin(appPlans, eq(appPlans.id, appPlanItems.planId)).innerJoin(appTrips, eq(appTrips.id, appPlans.tripId))
    .where(and(eq(appTrips.ownerId, ownerId), isNull(appPlanItems.deletedAt), ...(tripId ? [eq(appTrips.id, tripId)] : [])));
  const out: string[] = [];
  for (const x of list) {
    const hits = rows.filter((r) => r.id.startsWith(x));
    if (hits.length === 1 && !out.includes(hits[0]!.id)) out.push(hits[0]!.id);
  }
  return out;
}

type Owned = Awaited<ReturnType<typeof ownItems>>[number];
const BOOKED = new Set(["held", "booked", "confirmed"]);

/** Writes the items' new link and status, one plan event each, one version per plan, then tells the plan's listeners. */
async function write(rows: Owned[], by: By, set: (r: Owned) => Partial<typeof appPlanItems.$inferInsert> & { status: string }) {
  if (!rows.length) return;
  const plans = new Map<string, { tripId: string; version: number }>();
  await db.transaction(async (tx) => {
    for (const r of rows) {
      const next = set(r);
      await tx.update(appPlanItems).set({ ...next, updatedAt: new Date() }).where(eq(appPlanItems.id, r.item.id));
      await planEvent(tx, r.planId, by, "status", r.item.id, { title: r.item.title, day: r.item.day, from: r.item.status, to: next.status });
      plans.set(r.planId, { tripId: r.tripId, version: r.version + 1 });
    }
    for (const [id, p] of plans) await tx.update(appPlans).set({ version: p.version, updatedAt: new Date() }).where(eq(appPlans.id, id));
  });
  for (const [planId, p] of plans) await emit({ kind: "plan.changed", tripId: p.tripId, planId, version: p.version, by });
}

/**
 * A search result the traveller chose prices these items (price_quote_for_pay, find_for_item): the offer's id on each,
 * status priced. Booked items keep their booking. Returns the trip the items are on (the order books onto it).
 */
export async function priceItems(ownerId: string, itemIds: string[], offerId: string): Promise<{ tripId: string | null; itemIds: string[] }> {
  const rows = (await ownItems(ownerId, itemIds)).filter((r) => !BOOKED.has(r.item.status) && r.item.status !== "skipped");
  await write(rows, "ask", () => ({ offerId, status: "priced", statusNote: null }));
  return { tripId: rows[0]?.tripId ?? null, itemIds: rows.map((r) => r.item.id) };
}

/** An eSIM has no search offer: one is kept for the price the sheet showed, so the item reads priced until it runs out. */
export async function esimOffer(ownerId: string, o: { packageId: string; count: number; where: string | null; tripId: string | null; travellerIds: string[]; total: number; demo: boolean }): Promise<string> {
  const [row] = await db.insert(appOffers).values({
    ownerId, kind: "esim", supplier: "esim", supplierOfferId: o.packageId,
    search: { kind: "esim", destination: o.where, travellerIds: o.travellerIds, tripId: o.tripId, count: o.count },
    payload: { packageId: o.packageId, count: o.count, demo: o.demo }, total: o.total, expiresAt: new Date(Date.now() + 30 * 60_000),
  }).returning({ id: appOffers.id });
  return row!.id;
}

/** A request made for a plan item: the item reads "With the team · back by 18:40" and the request knows its item and trip. */
export async function linkRequest(ownerId: string, itemId: string, requestId: string): Promise<{ tripId: string } | null> {
  const [r] = (await ownItems(ownerId, [itemId])).filter((x) => !BOOKED.has(x.item.status));
  if (!r) return null;
  await db.update(appRequests).set({ planItemId: r.item.id, tripId: r.tripId, updatedAt: new Date() }).where(and(eq(appRequests.id, requestId), eq(appRequests.ownerId, ownerId)));
  await write([r], "ask", () => ({ requestId, status: "requested", statusNote: null }));
  return { tripId: r.tripId };
}

/**
 * An order made from the pay sheet for plan items (its draft's planItemIds, or a quote paid for an item's request):
 * each item points at the order and reads its status from it; the order is put on the plan's trip, so its
 * confirmation reaches the plan (desk.ts confirmOrder → order.confirmed → syncTripBookings).
 */
export async function linkOrder(ownerId: string, orderId: string, itemIds: string[], requestId: string | null): Promise<number> {
  const [order] = await db.select({ status: appOrders.status, tripId: appOrders.tripId }).from(appOrders).where(and(eq(appOrders.id, orderId), eq(appOrders.ownerId, ownerId)));
  if (!order || order.status === "declined") return 0;
  const byRequest = requestId
    ? (await db.select({ id: appPlanItems.id }).from(appPlanItems).innerJoin(appPlans, eq(appPlans.id, appPlanItems.planId)).innerJoin(appTrips, eq(appTrips.id, appPlans.tripId))
      .where(and(eq(appPlanItems.requestId, requestId), isNull(appPlanItems.deletedAt), eq(appTrips.ownerId, ownerId)))).map((x) => x.id)
    : [];
  const rows = (await ownItems(ownerId, [...itemIds, ...byRequest])).filter((r) => !BOOKED.has(r.item.status) || r.item.bookingId === orderId);
  if (!rows.length) return 0;
  if (!order.tripId) await db.update(appOrders).set({ tripId: rows[0]!.tripId, updatedAt: new Date() }).where(eq(appOrders.id, orderId));
  const b = await loadBookings(rows[0]!.tripId, [{ bookingKind: "order", bookingId: orderId, requestId: null, offerId: null }]);
  const status = deriveStatus({ status: "idea", statusNote: null, bookingKind: "order", bookingId: orderId, requestId: null, offerId: null }, b, null).status;
  await write(rows, "system", () => ({ bookingKind: "order", bookingId: orderId, status, statusNote: null }));
  return rows.length;
}

/* ───────────── "Book what's ready" ───────────── */

/** The order a priced item would be: the offer it was priced from, on the plan's trip, for the people the search was for. */
function draftOf(offer: typeof appOffers.$inferSelect, itemId: string, tripId: string, people: string[], fallback: string[]): OrderDraft | null {
  const s = (offer.search ?? {}) as { travellerIds?: unknown; destination?: string | null; count?: number };
  const said = Array.isArray(s.travellerIds) ? s.travellerIds.filter((x): x is string => typeof x === "string" && people.includes(x)) : [];
  const travellerIds = said.length ? said : fallback;
  if (!travellerIds.length) return null;
  const planItemIds = [itemId];
  if (offer.kind === "flight") return { kind: "trip", flightOfferId: offer.id, bundle: false, travellerIds: travellerIds.slice(0, 9), tripId, planItemIds };
  if (offer.kind === "stay") return { kind: "stay", stayOfferId: offer.id, travellerIds, tripId, planItemIds };
  if (offer.kind === "esim") {
    const p = offer.payload as { packageId?: string; count?: number };
    if (!p.packageId) return null;
    const where = typeof s.destination === "string" && /^[A-Za-z-]{2,20}$/.test(s.destination) ? s.destination : undefined;
    return { kind: "esim", count: Math.max(1, p.count ?? travellerIds.length), packageId: p.packageId, ...(where ? { where } : {}), tripId, travellerIds, planItemIds };
  }
  return null;
}

/**
 * Every item on the trip's plan that can be paid now (priced by a tool, or quoted by the desk), each priced again by
 * the server as the order it would be, with its own lines; and the items whose price ran out, to price again.
 */
export async function bookReady(ownerId: string, tripId: string, demo: Set<DemoFlag>): Promise<BookReadyResponse> {
  const plan = await readPlan(ownerId, tripId);
  const people = (await listPeople(ownerId)).map((p) => p.id);
  const fallback = plan.travellerIds.filter((id) => people.includes(id));
  const self = fallback.length ? fallback : people.slice(0, 1);
  const priced = plan.items.filter((i) => i.status === "priced" && i.offerId);
  const offers = priced.length ? await db.select().from(appOffers).where(inArray(appOffers.id, priced.map((i) => i.offerId!))) : [];
  const candidates: { item: (typeof plan.items)[number]; draft: OrderDraft; quote: boolean }[] = [];
  for (const it of priced) {
    const o = offers.find((x) => x.id === it.offerId && (x.ownerId === ownerId || !x.ownerId));
    const d = o ? draftOf(o, it.id, plan.tripId, people, self) : null;
    if (d) candidates.push({ item: it, draft: d, quote: false });
  }
  for (const it of plan.items.filter((i) => i.status === "requested" && i.quote && i.requestId)) {
    candidates.push({ item: it, draft: { kind: "quote", requestId: it.requestId!, planItemIds: [it.id] }, quote: true });
  }
  const items: BookReadyResponse["items"] = [];
  const expired: BookReadyResponse["expired"] = plan.items.filter((i) => i.priceExpired).map((i) => ({ itemId: i.id, title: i.title, kind: i.kind, mode: i.mode, day: i.day }));
  for (const c of candidates) {
    try {
      const { preview } = await priceDraft(ownerId, { draft: c.draft, useCredit: false }, { demo });
      if (preview.holdExpiresAt && Date.parse(preview.holdExpiresAt) <= Date.now()) {
        expired.push({ itemId: c.item.id, title: c.item.title, kind: c.item.kind, mode: c.item.mode, day: c.item.day });
        continue;
      }
      items.push({
        itemId: c.item.id, kind: c.item.kind, mode: c.item.mode, day: c.item.day, title: c.item.title, draft: OrderDraft.parse(c.draft), lines: preview.lines, total: preview.total, rule: preview.rule,
        demo: !!preview.demoFare || !!c.item.price?.demo, quote: c.quote, expiresAt: preview.holdExpiresAt ?? c.item.price?.expiresAt ?? c.item.quote?.expiresAt ?? null,
      });
    } catch (e) {
      // An offer the supplier no longer holds reads as a price to check again, never as an error on the sheet.
      console.warn("[plans] book-ready item not priced", e instanceof Error ? e.message.slice(0, 120) : "");
      expired.push({ itemId: c.item.id, title: c.item.title, kind: c.item.kind, mode: c.item.mode, day: c.item.day });
    }
  }
  return {
    tripId: plan.tripId, title: plan.title, items, expired,
    total: money(items.reduce((a, i) => a + i.total.amount, 0)), demo: items.some((i) => i.demo),
  };
}

