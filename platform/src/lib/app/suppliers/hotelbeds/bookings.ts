import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { appPeople, appRequests, appUsers } from "@/db/app-schema";
import { appOffers, appOrderEvents, appOrders } from "@/db/app-schema-booking";
import { appSupplierBookings } from "@/db/app-schema-hotelbeds";
import { appAuditLog } from "../../audit";
import { AppError } from "../../http";
import { HotelbedsError, hotelbedsEnv } from "./client";
import { decodeOfferId, isHotelbedsOfferId, type HbPax } from "./hotels";
import { hotelbedsBookingAllowed, hotelbedsHotels, hotelbedsMode, hotelbedsTransfers, staysMode } from "./app";

/*
 * Booking on Hotelbeds from what the traveller chose, by the desk ("Book on Hotelbeds") or, for stays in live mode,
 * automatically once the card is authorised. Every attempt is a row in app_supplier_bookings first (one live row per
 * order or request, so a second click or a retry finds the first), then the call, then the answer.
 *
 *   booking    the call is out             confirmed  Hotelbeds confirmed: supplier_ref is their reference
 *   failed     they said no (price moved, sold out, bad data): the desk picks again or books by hand
 *   unknown    no answer (timeout): look the booking up in their extranet by our clientReference before trying again
 *   cancelled  cancelled with Hotelbeds (cancel_fee is what they charged)
 */

export type DeskActor = { name: string; opsUserId?: string | null };
export type SupplierBookingRow = typeof appSupplierBookings.$inferSelect;

export class SupplierBookingError extends Error {}

const live = sql`${appSupplierBookings.status} in ('booking','confirmed','unknown')`;

export async function supplierBookingsFor(sourceKind: "order" | "request", sourceId: string): Promise<SupplierBookingRow[]> {
  return db.select().from(appSupplierBookings).where(and(eq(appSupplierBookings.sourceKind, sourceKind), eq(appSupplierBookings.sourceId, sourceId))).orderBy(desc(appSupplierBookings.createdAt));
}

/* ───────────── who is travelling ───────────── */

type Traveller = { givenNames: string; surname: string; dateOfBirth: string | null; isSelf: boolean };

const latin = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z' -]/g, "").trim().slice(0, 50);

async function partyOf(ownerId: string, ids: string[]) {
  const [owner] = await db.select({ name: appUsers.name, phone: appUsers.phone, email: appUsers.email }).from(appUsers).where(eq(appUsers.id, ownerId));
  const people: Traveller[] = ids.length
    ? await db.select({ givenNames: appPeople.givenNames, surname: appPeople.surname, dateOfBirth: appPeople.dateOfBirth, isSelf: appPeople.isSelf }).from(appPeople)
      .where(and(eq(appPeople.ownerId, ownerId), inArray(appPeople.id, ids), isNull(appPeople.deletedAt)))
    : [];
  const self = people.find((p) => p.isSelf) ?? people[0];
  const [first, ...rest] = (owner?.name ?? "").split(" ");
  const holder = {
    name: latin(self?.givenNames || first || "") || "Guest",
    surname: latin(self?.surname || rest.join(" ") || "") || latin(people.find((p) => p.surname)?.surname ?? "") || "Mada",
  };
  return { owner, people, holder };
}

const ageOn = (dob: string | null, day: string) => (dob ? Math.floor((Date.parse(day) - Date.parse(dob)) / (365.25 * 86_400_000)) : 30);

/** Paxes by room: adults spread over the rooms first, children after, each with their age. */
export function paxesFor(people: Traveller[], rooms: number, checkIn: string, holder: { name: string; surname: string }): HbPax[] {
  const list = people.length ? people : [{ givenNames: holder.name, surname: holder.surname, dateOfBirth: null, isSelf: true }];
  const withAge = list.map((p) => ({ p, age: ageOn(p.dateOfBirth, checkIn) }));
  const adults = withAge.filter((x) => x.age >= 18);
  const kids = withAge.filter((x) => x.age < 18);
  const n = Math.max(1, Math.min(rooms, adults.length || 1));
  const out: HbPax[] = [];
  [...adults, ...kids].forEach((x, i) => {
    const roomId = (i % n) + 1;
    out.push({ roomId, type: x.age >= 18 ? "AD" : "CH", ...(x.age < 18 ? { age: Math.max(0, x.age) } : {}), name: latin(x.p.givenNames) || holder.name, surname: latin(x.p.surname) || holder.surname });
  });
  return out;
}

/* ───────────── the row ───────────── */

async function begin(v: { product: "stay" | "transfer"; sourceKind: "order" | "request"; sourceId: string; ownerId: string; rateKey: string; clientReference: string; sell: number | null; actor: DeskActor; product2: "hotels" | "transfers" }) {
  const [existing] = await db.select().from(appSupplierBookings).where(and(eq(appSupplierBookings.supplier, "hotelbeds"), eq(appSupplierBookings.sourceKind, v.sourceKind), eq(appSupplierBookings.sourceId, v.sourceId), live));
  if (existing) return { row: existing, fresh: false };
  try {
    const [row] = await db.insert(appSupplierBookings).values({
      supplier: "hotelbeds", product: v.product, sourceKind: v.sourceKind, sourceId: v.sourceId, ownerId: v.ownerId, rateKey: v.rateKey, clientReference: v.clientReference,
      status: "booking", sell: v.sell, environment: hotelbedsEnv(), mode: hotelbedsMode(v.product2), bookedBy: v.actor.name,
    }).returning();
    return { row: row!, fresh: true };
  } catch {
    // Someone else's click got there first (the partial unique index): theirs is the booking.
    const [other] = await db.select().from(appSupplierBookings).where(and(eq(appSupplierBookings.supplier, "hotelbeds"), eq(appSupplierBookings.sourceKind, v.sourceKind), eq(appSupplierBookings.sourceId, v.sourceId), live));
    if (other) return { row: other, fresh: false };
    throw new SupplierBookingError("Couldn't start the booking. Try again.");
  }
}

async function settle(id: string, e: unknown): Promise<SupplierBookingRow> {
  const he = e instanceof HotelbedsError ? e : null;
  // No answer means we don't know: the booking may exist on their side.
  const status = he?.transport || (e instanceof AppError && (e.code === "SUPPLIER_DOWN" || e.code === "SUPPLIER_UNAVAILABLE")) ? "unknown" : "failed";
  const problem = he ? `${he.code}${he.info.supplierCode ? ` ${he.info.supplierCode}` : ""}: ${he.message}`.slice(0, 400) : e instanceof Error ? e.message.slice(0, 400) : "error";
  const [row] = await db.update(appSupplierBookings).set({ status, problem, updatedAt: new Date() }).where(eq(appSupplierBookings.id, id)).returning();
  return row!;
}

/* ───────────── stays ───────────── */

/** The order's Hotelbeds rate, if it has one (a stay picked from Hotelbeds results). */
export async function stayRateOf(order: typeof appOrders.$inferSelect): Promise<{ rateKey: string; recheck: boolean; party: number; offerId: string } | null> {
  if (order.kind !== "stay") return null;
  const offerId = (order.draft as { stayOfferId?: string }).stayOfferId;
  if (!offerId) return null;
  const [offer] = await db.select({ supplier: appOffers.supplier, supplierOfferId: appOffers.supplierOfferId }).from(appOffers).where(eq(appOffers.id, offerId));
  if (!offer || offer.supplier !== "hotelbeds" || !isHotelbedsOfferId(offer.supplierOfferId)) return null;
  const d = decodeOfferId(offer.supplierOfferId);
  return d ? { ...d, offerId } : null;
}

export async function bookStayOnHotelbeds(orderId: string, actor: DeskActor): Promise<SupplierBookingRow> {
  const [o] = await db.select().from(appOrders).where(eq(appOrders.id, orderId));
  if (!o) throw new AppError("NOT_FOUND");
  if (!["pending_agent", "held", "price_locked", "needs_answer", "issuing"].includes(o.status)) throw new SupplierBookingError("This order isn't waiting to be booked.");
  const rate = await stayRateOf(o);
  if (!rate) throw new SupplierBookingError("This stay wasn't picked from Hotelbeds results. Book it by hand.");
  const allowed = hotelbedsBookingAllowed("hotels");
  if (!allowed.ok) throw new SupplierBookingError(allowed.why);
  const { row, fresh } = await begin({ product: "stay", product2: "hotels", sourceKind: "order", sourceId: o.id, ownerId: o.ownerId, rateKey: rate.rateKey, clientReference: o.id.replace(/-/g, "").slice(0, 20), sell: o.total, actor });
  if (!fresh) return row;
  const hotels = hotelbedsHotels();
  try {
    let rateKey = rate.rateKey;
    // RECHECK rates must go through checkrates first; the answer may carry a new key.
    if (rate.recheck) {
      const cr = await hotels.checkRate([rateKey]);
      rateKey = cr.hotel?.rooms?.[0]?.rates?.[0]?.rateKey ?? rateKey;
    }
    const stay = (o.snapshot as { stay?: { checkIn?: string; rooms?: number; name?: string } }).stay ?? {};
    const { people, holder } = await partyOf(o.ownerId, o.travellerIds);
    const res = await hotels.book({
      rateKey, holder, paxes: paxesFor(people, stay.rooms ?? 1, stay.checkIn ?? new Date().toISOString().slice(0, 10), holder),
      clientReference: row.clientReference, remark: `Mada Trips order ${o.ref ?? o.id.slice(0, 8)}`,
      tolerancePct: Number(process.env.HOTELBEDS_TOLERANCE_PCT ?? 0) || undefined,
    });
    const b = res.booking;
    const [done] = await db.update(appSupplierBookings).set({
      status: b.status === "CONFIRMED" ? "confirmed" : "unknown", supplierRef: b.reference, rateKey, net: String(b.totalNet ?? b.hotel?.totalNet ?? ""), currency: b.currency ?? b.hotel?.currency ?? null,
      details: { hotel: b.hotel?.name ?? stay.name ?? null, checkIn: b.hotel?.checkIn ?? null, checkOut: b.hotel?.checkOut ?? null, supplier: b.hotel?.supplier ?? null, rateComments: b.hotel?.rooms?.[0]?.rates?.[0]?.rateComments ?? null },
      updatedAt: new Date(),
    }).where(eq(appSupplierBookings.id, row.id)).returning();
    await db.transaction(async (tx) => {
      await tx.update(appOrders).set({ supplierRef: b.reference, updatedAt: new Date() }).where(eq(appOrders.id, o.id));
      await tx.insert(appOrderEvents).values({ orderId: o.id, kind: "supplier_booked", actorKind: actor.opsUserId ? "agent" : "system", actorName: actor.name, data: { supplier: "hotelbeds", reference: b.reference } });
      await appAuditLog(tx, { actorKind: actor.opsUserId ? "agent" : "system", actorId: actor.opsUserId ?? null, action: "supplier.booked", entityType: "app_order", entityId: o.id, summary: `Booked on Hotelbeds (${hotelbedsEnv()}): ${b.reference}`, data: { supplierBookingId: row.id } });
    });
    return done!;
  } catch (e) {
    return settle(row.id, e);
  }
}

/**
 * Live mode: book the stay on Hotelbeds as soon as the order is with the desk. Never throws; anything that doesn't
 * go through stays with the desk, who sees why on the order.
 */
export async function autoBookStay(orderId: string): Promise<SupplierBookingRow | null> {
  try {
    if (staysMode() !== "live") return null;
    const [o] = await db.select().from(appOrders).where(eq(appOrders.id, orderId));
    if (!o || o.status !== "pending_agent" || !(await stayRateOf(o))) return null;
    return await bookStayOnHotelbeds(orderId, { name: "Mada (automatic)" });
  } catch (e) {
    console.warn("[hotelbeds] automatic stay booking left to the desk:", e instanceof Error ? e.message : "error");
    return null;
  }
}

/* ───────────── transfers ───────────── */

export type TransferDetails = {
  offerId: string; rateKey: string; total: number; net: number; currency: string; kind: "private" | "shared"; vehicle: string; category: string;
  airport: string; arrival: string; flightNumber: string | null; carrier: string | null; hotel: string | null; hotelCode: number | null; freeCancelUntil: string | null; people: number;
};

export async function bookTransferOnHotelbeds(requestId: string, actor: DeskActor): Promise<SupplierBookingRow> {
  const [r] = await db.select().from(appRequests).where(eq(appRequests.id, requestId));
  if (!r) throw new AppError("NOT_FOUND");
  const tr = (r.details as { transfer?: TransferDetails }).transfer;
  if (!tr) throw new SupplierBookingError("This request has no Hotelbeds rate on it.");
  if (["cancelled", "done"].includes(r.status)) throw new SupplierBookingError("This request is closed.");
  const allowed = hotelbedsBookingAllowed("transfers");
  if (!allowed.ok) throw new SupplierBookingError(allowed.why);
  const { row, fresh } = await begin({ product: "transfer", product2: "transfers", sourceKind: "request", sourceId: r.id, ownerId: r.ownerId, rateKey: tr.rateKey, clientReference: r.id.replace(/-/g, "").slice(0, 20), sell: tr.total, actor });
  if (!fresh) return row;
  try {
    const { owner, holder } = await partyOf(r.ownerId, r.travellerIds);
    const res = await hotelbedsTransfers().book({
      rateKey: tr.rateKey,
      // Hotelbeds needs a contact for the driver: the account's phone, and Mada's desk address for the voucher.
      holder: { ...holder, email: process.env.HOTELBEDS_VOUCHER_EMAIL || owner?.email || "desk@madatrips.com", phone: owner?.phone ?? process.env.APP_DESK_PHONE ?? "+966000000000" },
      flight: tr.flightNumber ? { number: tr.flightNumber, direction: "ARRIVAL", companyName: tr.carrier } : null,
      clientReference: row.clientReference, remark: `Mada Trips request ${r.id.slice(0, 8)}`,
    });
    const b = res.bookings[0]!;
    const [done] = await db.update(appSupplierBookings).set({
      status: b.status === "CONFIRMED" ? "confirmed" : "unknown", supplierRef: b.reference, net: String(b.totalAmount ?? tr.net), currency: b.currency ?? tr.currency,
      details: { vehicle: tr.vehicle, kind: tr.kind, airport: tr.airport, arrival: tr.arrival, hotel: tr.hotel }, updatedAt: new Date(),
    }).where(eq(appSupplierBookings.id, row.id)).returning();
    await db.transaction(async (tx) => {
      await tx.update(appRequests).set({ details: { ...(r.details as Record<string, unknown>), supplierRef: b.reference }, updatedAt: new Date() }).where(eq(appRequests.id, r.id));
      await appAuditLog(tx, { actorKind: actor.opsUserId ? "agent" : "system", actorId: actor.opsUserId ?? null, action: "supplier.booked", entityType: "app_request", entityId: r.id, summary: `Transfer booked on Hotelbeds (${hotelbedsEnv()}): ${b.reference}`, data: { supplierBookingId: row.id } });
    });
    return done!;
  } catch (e) {
    return settle(row.id, e);
  }
}

/* ───────────── cancellation (simulate, then cancel) ───────────── */

export type CancelOutcome = { simulated: boolean; amount: number; currency: string | null; row: SupplierBookingRow };

export async function cancelSupplierBooking(id: string, actor: DeskActor, opts: { confirm: boolean }): Promise<CancelOutcome> {
  const [row] = await db.select().from(appSupplierBookings).where(eq(appSupplierBookings.id, id));
  if (!row) throw new AppError("NOT_FOUND");
  if (row.status !== "confirmed" || !row.supplierRef) throw new SupplierBookingError("Only a confirmed booking can be cancelled here.");
  const simulate = !opts.confirm;
  const r = row.product === "stay" ? await hotelbedsHotels().cancel(row.supplierRef, simulate) : await hotelbedsTransfers().cancel(row.supplierRef, simulate);
  if (simulate) return { simulated: true, amount: r.amount, currency: r.currency, row };
  const [u] = await db.update(appSupplierBookings).set({ status: "cancelled", cancelFee: String(r.amount), cancelledAt: new Date(), updatedAt: new Date() }).where(eq(appSupplierBookings.id, id)).returning();
  await db.transaction(async (tx) => {
    await appAuditLog(tx, { actorKind: actor.opsUserId ? "agent" : "system", actorId: actor.opsUserId ?? null, action: "supplier.cancelled", entityType: row.sourceKind === "order" ? "app_order" : "app_request", entityId: row.sourceId, summary: `Cancelled on Hotelbeds: ${row.supplierRef} (fee ${r.amount} ${r.currency ?? ""})`.trim() });
  });
  return { simulated: false, amount: r.amount, currency: r.currency, row: u! };
}

/** The order behind a desk request (orders show on the desk by their request id). */
export async function orderForRequest(requestId: string) {
  const [o] = await db.select().from(appOrders).where(eq(appOrders.requestId, requestId)).orderBy(desc(appOrders.createdAt)).limit(1);
  return o ?? null;
}
