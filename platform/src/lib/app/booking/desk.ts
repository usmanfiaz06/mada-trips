import "server-only";
import { and, eq, sql } from "drizzle-orm";
import {
  CARRIERS, CATALOGUE_HOTELS, DESTINATIONS, ENTRY_RULES, PICKUP_SAR, addDays, instalments, sarToHalalas, seatsFor, t, zonedToInstant,
  type FlightOption, type OrderLine, type StayOption,
} from "@mada/shared";
import { db, type Tx } from "@/db";
import { appNotifications, appPayments, appPickups, appQuotes, appRequests, appSegments, appStays, appTrips } from "@/db/app-schema";
import { appOrderEvents, appOrders, appTripBookings } from "@/db/app-schema-booking";
import { appTripCharges, appTripFacts } from "@/db/app-schema-trips";
import { appAuditLog } from "../audit";
import { addCredit } from "../credit";
import { AppError } from "../http";
import { AIRPORT_TZ } from "../suppliers/mock/data";
import { bookingSuppliers, newRef } from "./common";
import { reauthorize } from "./payments";

/*
 * The agent desk's actions on an order. The desk UI (Mada Ops) calls these; in mock mode the autopilot in orders.ts
 * calls the same functions on a timer so the app's flow completes on its own.
 *
 *   acceptOrder     the desk picks it up and holds the seats (pending_agent → held)
 *   lockPrice       the supplier confirmed the fare (held → price_locked)
 *   askQuestion     a question for the traveller (→ needs_answer); answered in the app
 *   priceChanged    the fare moved while holding (→ fare_changed); the traveller accepts or stops
 *   startIssuing    tickets are being issued (price_locked → issuing)
 *   issueTickets    flights: capture the card, write the trip, confirmed
 *   confirmOrder    any kind: capture, write the trip or the request, confirmed (issueTickets calls it)
 *   failTicketing   the airline didn't issue: void the authorisation (→ ticketing_failed)
 *   cancelOrder     void and cancel
 * Every action writes an order event and an audit row, in one transaction with the row locked.
 */

export type DeskAgent = { name: string; opsUserId?: string | null };
export type OrderRow = typeof appOrders.$inferSelect;

async function locked(tx: Tx, orderId: string): Promise<OrderRow> {
  const rows = await tx.select().from(appOrders).where(eq(appOrders.id, orderId)).for("update");
  if (!rows[0]) throw new AppError("NOT_FOUND");
  return rows[0];
}

export async function orderEvent(tx: Tx, orderId: string, kind: string, actor: { kind: "user" | "agent" | "system"; name?: string | null }, data?: Record<string, unknown>) {
  await tx.insert(appOrderEvents).values({ orderId, kind, actorKind: actor.kind, actorName: actor.name ?? null, data: data ?? null });
}

const audit = (tx: Tx, o: OrderRow, agent: DeskAgent | null, action: string, summary: string, data?: Record<string, unknown>) =>
  appAuditLog(tx, { actorKind: agent ? "agent" : "system", actorId: agent?.opsUserId ?? agent?.name ?? null, action, entityType: "app_order", entityId: o.id, summary, data });

/** Moves an order on when it is in one of `from`; anything else is a stale click and is refused. */
async function move(orderId: string, from: string[], fn: (tx: Tx, o: OrderRow) => Promise<Partial<typeof appOrders.$inferInsert> | null>): Promise<OrderRow> {
  return db.transaction(async (tx) => {
    const o = await locked(tx, orderId);
    if (!from.includes(o.status)) throw new AppError("VALIDATION", { message: t("error.validation") });
    const patch = await fn(tx, o);
    if (!patch) return o;
    const [u] = await tx.update(appOrders).set({ ...patch, updatedAt: new Date() }).where(eq(appOrders.id, orderId)).returning();
    return u!;
  });
}

export const acceptOrder = (orderId: string, agent: DeskAgent) => move(orderId, ["pending_agent"], async (tx, o) => {
  let supplierRef = o.supplierRef;
  const f = (o.snapshot as { flight?: FlightOption; flightSupplierId?: string }).flight;
  const sid = (o.snapshot as { flightSupplierId?: string }).flightSupplierId;
  if (f && sid) {
    try { supplierRef = (await bookingSuppliers.flights().hold(sid, o.travellerIds.map(() => ({ givenNames: "", surname: "" })))).pnr; } catch { /* the agent holds by hand */ }
  }
  await orderEvent(tx, o.id, "held", { kind: "agent", name: agent.name }, { supplierRef });
  await audit(tx, o, agent, "order.held", `${agent.name} held the booking`);
  return { status: "held", step: 1, supplierRef, agentName: agent.name };
});

export const lockPrice = (orderId: string, agent: DeskAgent) => move(orderId, ["held"], async (tx, o) => {
  await orderEvent(tx, o.id, "price_locked", { kind: "agent", name: agent.name });
  return { status: "price_locked", step: 2 };
});

export const askQuestion = (orderId: string, agent: DeskAgent, text: string) => move(orderId, ["pending_agent", "held", "price_locked"], async (tx, o) => {
  await orderEvent(tx, o.id, "question", { kind: "agent", name: agent.name }, { text });
  return { status: "needs_answer", question: { text, options: ["yes", "call"], calling: false, answer: null, resume: o.status } as never };
});

/** The fare moved while the desk held the seats: per person, in halalas. */
export const priceChanged = (orderId: string, agent: DeskAgent, perPerson: number) => move(orderId, ["pending_agent", "held", "price_locked"], async (tx, o) => {
  const total = perPerson * Math.max(1, o.travellerIds.length);
  await orderEvent(tx, o.id, "fare_changed", { kind: "agent", name: agent.name }, { perPerson, total });
  await audit(tx, o, agent, "order.fare_changed", `${agent.name} reported a fare change of ${total} halalas`, { perPerson, total });
  return { status: "fare_changed", fareChange: { perPerson, total } };
});

export const startIssuing = (orderId: string, agent: DeskAgent) => move(orderId, ["price_locked"], async (tx, o) => {
  await orderEvent(tx, o.id, "issuing", { kind: "agent", name: agent.name });
  return { status: "issuing", step: 3 };
});

/** The airline didn't issue: the hold on the card is released (voided), the seats stay held for 2 hours. */
export async function failTicketing(orderId: string, agent: DeskAgent, reason = "timed out"): Promise<OrderRow> {
  return move(orderId, ["held", "price_locked", "issuing"], async (tx, o) => {
    await voidPayment(tx, o);
    await orderEvent(tx, o.id, "ticketing_failed", { kind: "agent", name: agent.name }, { reason });
    await audit(tx, o, agent, "order.ticketing_failed", `Tickets didn't issue (${reason}); the card authorisation was voided`);
    return { status: "ticketing_failed", problem: reason, step: Math.min(o.step, 2) };
  });
}

export async function cancelOrder(orderId: string, actor: { kind: "user" | "agent"; name: string }): Promise<OrderRow> {
  return move(orderId, ["requires_action", "pending_agent", "held", "price_locked", "needs_answer", "fare_changed", "ticketing_failed"], async (tx, o) => {
    await voidPayment(tx, o);
    await returnCredit(tx, o);
    await orderEvent(tx, o.id, "cancelled", actor);
    await appAuditLog(tx, { actorKind: actor.kind, actorId: actor.kind === "user" ? o.ownerId : actor.name, action: "order.cancelled", entityType: "app_order", entityId: o.id, summary: "Booking cancelled before it was confirmed; nothing was charged" });
    return { status: "cancelled" };
  });
}

/** Credit held for a booking that won't happen goes back to the traveller. */
export async function returnCredit(tx: Tx, o: OrderRow) {
  if (o.creditUsed > 0) await addCredit(tx, { userId: o.ownerId, amount: o.creditUsed, kind: "adjustment", note: "Booking not made: credit back", actor: { kind: "system", id: null } });
}

async function voidPayment(tx: Tx, o: OrderRow) {
  if (!o.paymentId) return;
  const [p] = await tx.select().from(appPayments).where(eq(appPayments.id, o.paymentId));
  if (!p?.providerRef || !["authorized", "requires_action"].includes(p.status)) return;
  const r = await bookingSuppliers.payments().void(p.providerRef);
  await tx.update(appPayments).set({ status: r.status === "voided" ? "voided" : p.status, updatedAt: new Date() }).where(eq(appPayments.id, p.id));
  await appAuditLog(tx, { actorKind: "system", actorId: null, action: "payment.voided", entityType: "app_payment", entityId: p.id, summary: `Authorisation of ${p.amount} halalas released` });
}

/** Flights: tickets are issued. Capture, then the trip. If the capture fails, ticketing failed (and the hold is voided). */
export async function issueTickets(orderId: string, agent: DeskAgent): Promise<OrderRow> {
  return confirmOrder(orderId, agent, { from: ["issuing", "price_locked"] });
}

/** The booking is confirmed by a named person: capture the card, write what was booked, tell the traveller. */
export async function confirmOrder(orderId: string, agent: DeskAgent, opts: { from?: string[] } = {}): Promise<OrderRow> {
  const from = opts.from ?? ["pending_agent", "held", "price_locked", "issuing"];
  const out = await db.transaction(async (tx) => {
    const o = await locked(tx, orderId);
    if (!from.includes(o.status)) throw new AppError("VALIDATION");
    const captured = await capture(tx, o);
    if (!captured) return { o, failed: true };
    const ref = o.ref ?? newRef();
    const now = new Date();
    let tripId = o.tripId;
    if (o.kind === "trip" || o.kind === "stay") tripId = await writeTrip(tx, { ...o, ref }, agent, now);
    if (o.kind === "package") {
      const plan = (o.snapshot as { plan?: { title: string } }).plan;
      await tx.insert(appRequests).values({
        ownerId: o.ownerId, kind: "trip", status: "done", summary: t("request.title.package", { title: plan?.title ?? "" }), travellerIds: o.travellerIds, agentName: agent.name,
        details: { askKind: "package", title: t("request.title.package", { title: plan?.title ?? "" }), detail: "", orderId: o.id },
      });
    }
    if (o.kind === "quote" && o.requestId) {
      await tx.update(appRequests).set({ status: "confirmed", updatedAt: now }).where(eq(appRequests.id, o.requestId));
      await tx.update(appQuotes).set({ status: "accepted" }).where(and(eq(appQuotes.requestId, o.requestId), eq(appQuotes.status, "open")));
    }
    if (o.requestId && o.kind !== "quote") await tx.update(appRequests).set({ status: "confirmed", tripId, agentName: agent.name, updatedAt: now }).where(eq(appRequests.id, o.requestId));
    if (o.kind === "trip" || o.kind === "stay" || o.kind === "package") {
      const city = (o.snapshot as { place?: string }).place ?? "";
      await tx.insert(appNotifications).values({
        userId: o.ownerId, kind: "booking_confirmed", level: "active",
        title: t("notify.confirmed.title", { city }).slice(0, 32), body: t("notify.confirmed.body", { agent: agent.name, ref }).slice(0, 90),
        href: tripId ? `/trips/${tripId}` : "/trips", data: { orderId: o.id, ref },
      });
    }
    await orderEvent(tx, o.id, "confirmed", { kind: "agent", name: agent.name }, { ref });
    await audit(tx, o, agent, "order.confirmed", `${agent.name} confirmed booking ${ref}`, { ref, total: o.total + o.extra });
    const [u] = await tx.update(appOrders).set({ status: "confirmed", step: 3, ref, tripId, confirmedByName: agent.name, confirmedAt: now, updatedAt: now }).where(eq(appOrders.id, o.id)).returning();
    return { o: u!, failed: false };
  });
  if (out.failed) return failTicketing(orderId, agent, "the card capture didn't go through");
  return out.o;
}

async function capture(tx: Tx, o: OrderRow): Promise<boolean> {
  if (!o.paymentId) return true; // Mada credit covered it all
  const [p] = await tx.select().from(appPayments).where(eq(appPayments.id, o.paymentId));
  if (!p) return true;
  if (p.status === "captured") return true;
  if (p.status !== "authorized" || !p.providerRef) return false;
  if (p.provider === "tabby" || p.provider === "tamara") {
    await tx.update(appPayments).set({ status: "captured", updatedAt: new Date() }).where(eq(appPayments.id, p.id));
    return true;
  }
  const r = await bookingSuppliers.payments().capture(p.providerRef, p.amount);
  if (r.status !== "captured") return false;
  await tx.update(appPayments).set({ status: "captured", updatedAt: new Date() }).where(eq(appPayments.id, p.id));
  await appAuditLog(tx, { actorKind: "system", actorId: null, action: "payment.captured", entityType: "app_payment", entityId: p.id, summary: `Captured ${p.amount} halalas on issue` });
  return true;
}

/* ───────────── the trip the booking writes (read by Trips through GET /trips/{id}) ───────────── */

const SV_DRIVER = { home: { driver: "Khalid", phone: "+966 55 014 2287", waits: "10 min" }, arrive: { driver: "Ahmet", car: "Grey Mercedes Vito", plate: "34 MDA 21", door: "Door 3", phone: "+90 532 418 6610", waits: "60 min" } };

async function writeTrip(tx: Tx, o: OrderRow & { ref: string }, agent: DeskAgent, now: Date): Promise<string> {
  const snap = o.snapshot as { flight?: FlightOption; stay?: StayOption; search?: { destination?: string }; bundle?: boolean; draft?: { tripId?: string | null } };
  const n = Math.max(1, o.travellerIds.length);
  const dest = DESTINATIONS[snap.search?.destination ?? ""] ?? null;
  const country = dest ? ENTRY_RULES[dest.country]?.name ?? null : null;
  const lines = o.lines as OrderLine[];
  const amountOf = (keys: string[]) => lines.filter((l) => keys.includes(l.key)).reduce((a, l) => a + l.amount, 0) + (keys.includes("flight") ? o.extra : 0);
  const f = snap.flight;
  const startDate = f ? f.out.date : snap.stay!.checkIn;
  const stayEnd = snap.stay ? addDays(snap.stay.checkIn, snap.stay.nights) : null;
  const endDate = f ? f.back?.date ?? (snap.bundle ? null : null) : stayEnd;
  let tripId = snap.draft?.tripId ?? null;
  if (tripId) {
    const [own] = await tx.select({ id: appTrips.id }).from(appTrips).where(and(eq(appTrips.id, tripId), eq(appTrips.ownerId, o.ownerId)));
    if (!own) tripId = null;
  }
  if (!tripId) {
    const [trip] = await tx.insert(appTrips).values({
      ownerId: o.ownerId, city: dest?.name ?? (snap.stay ? "Istanbul" : ""), country, imageUrl: dest?.photo ?? null, startDate, endDate,
      travellerIds: o.travellerIds, status: "booked", bookingRef: o.ref, confirmedByName: agent.name, confirmedByOpsUserId: agent.opsUserId ?? null,
    }).returning({ id: appTrips.id });
    tripId = trip!.id;
  }
  const segmentIds: string[] = [];
  const stayFacts: Record<string, Record<string, unknown>> = {};
  const pickupFacts: Record<string, Record<string, unknown>> = {};
  if (f) {
    const carrier = CARRIERS[f.carrier];
    const legs = [{ leg: f.out, dir: "out" as const, back: false }, ...(f.back ? [{ leg: f.back, dir: "back" as const, back: true }] : [])];
    for (const [i, { leg, dir, back }] of legs.entries()) {
      const arriveDay = leg.arr < leg.dep ? addDays(leg.date, 1) : leg.date;
      const [s] = await tx.insert(appSegments).values({
        tripId, direction: dir, sort: i, carrier: f.carrier, carrierName: f.airline, flightNumber: leg.flightNumber, fromAirport: leg.from, toAirport: leg.to,
        departLocal: `${leg.date}T${leg.dep}`, departTz: AIRPORT_TZ[leg.from] ?? "Asia/Riyadh", arriveLocal: `${arriveDay}T${leg.arr}`, arriveTz: AIRPORT_TZ[leg.to] ?? "Asia/Riyadh",
        durationMin: leg.durationMin, cabin: f.cabin, terminal: back ? null : carrier?.terminal ?? null, gate: null, seats: seatsFor(n, f.cabin, back),
        baggage: f.bags, status: "scheduled", pnr: o.supplierRef && /^[A-Z0-9]{5,8}$/.test(o.supplierRef) ? o.supplierRef : o.ref,
      }).returning({ id: appSegments.id });
      segmentIds.push(s!.id);
    }
  }
  const stayLine = lines.find((l) => l.key === "stay");
  if (snap.stay || (snap.bundle && stayLine && f)) {
    const hotel = snap.stay ?? null;
    const galata = CATALOGUE_HOTELS.istanbul![0]!;
    const checkIn = hotel?.checkIn ?? f!.out.date;
    const nights = hotel?.nights ?? Math.max(1, Math.round((Date.parse(`${f!.back!.date}T00:00:00Z`) - Date.parse(`${f!.out.date}T00:00:00Z`)) / 86_400_000));
    const [st] = await tx.insert(appStays).values({
      tripId, name: hotel?.name ?? galata.name, area: hotel?.area ?? galata.area, address: hotel?.address ?? galata.address, checkIn, nights, rooms: hotel?.rooms ?? (n > 2 ? 2 : 1),
      price: amountOf(["stay"]), cancellation: hotel?.cancellation ?? t("pay.rule.stay", { date: addDays(checkIn, -7) }), status: "booked", confirmation: o.ref, supplier: "catalogue",
    }).returning({ id: appStays.id });
    stayFacts[st!.id] = { addressShort: hotel ? null : "Galata Kulesi Sk. 12, Beyoğlu", walk: hotel ? null : "3 min walk to Galata Tower", phone: "+90 212 000 0000", fromAirport: "45 min", roomType: n > 2 ? "Connecting rooms" : "A quiet room", plan: o.plan };
  }
  if (f && lines.some((l) => l.key === "pickup")) {
    const pickupPrice = amountOf(["pickup"]);
    const toAt = new Date(zonedToInstant(`${f.out.date}T${f.out.dep}`, AIRPORT_TZ[f.out.from] ?? "Asia/Riyadh").getTime() - 155 * 60_000);
    const [home] = await tx.insert(appPickups).values({
      tripId, direction: "to_airport", at: toAt, driverName: SV_DRIVER.home.driver, car: n > 3 ? "Black GMC Yukon" : "Grey Lexus ES", plate: null, meetingPoint: null,
      phone: SV_DRIVER.home.phone, price: f.back ? Math.round(pickupPrice / 2) : pickupPrice, status: "booked",
    }).returning({ id: appPickups.id });
    pickupFacts[home!.id] = { room: n > 3 ? "room for 8 bags" : "room for 4 bags", waits: SV_DRIVER.home.waits, offsetMin: -155, city: "Riyadh" };
    if (f.back) {
      const landAt = zonedToInstant(`${f.out.arr < f.out.dep ? addDays(f.out.date, 1) : f.out.date}T${f.out.arr}`, AIRPORT_TZ[f.out.to] ?? "Europe/Istanbul");
      const [arr] = await tx.insert(appPickups).values({
        tripId, direction: "from_airport", at: landAt, driverName: SV_DRIVER.arrive.driver, car: SV_DRIVER.arrive.car, plate: SV_DRIVER.arrive.plate, meetingPoint: SV_DRIVER.arrive.door,
        phone: SV_DRIVER.arrive.phone, price: pickupPrice - Math.round(pickupPrice / 2), status: "booked",
      }).returning({ id: appPickups.id });
      pickupFacts[arr!.id] = { waits: SV_DRIVER.arrive.waits, offsetMin: null, city: dest?.name ?? null };
    }
  }
  const [pay] = o.paymentId ? await tx.select().from(appPayments).where(eq(appPayments.id, o.paymentId)) : [];
  await tx.insert(appTripBookings).values({
    tripId, orderId: o.id, ref: o.ref, lines,
    paid: { subtotal: o.subtotal + o.extra, discount: o.discount, promo: o.promo, creditUsed: o.creditUsed, charged: o.total + o.extra, card: o.paymentLabel },
    payPlan: o.plan, bookedAt: o.createdAt,
    details: { segments: segmentIds, fare: f ? { bags: f.bags, change: f.changeRule, refund: f.refundRule, refundable: f.refundable } : null, stays: stayFacts, pickups: pickupFacts },
  });
  // The trip screens' own tables (M3): the agent, per-row facts and the charges, so GET /trips/{id} shows them.
  try {
    await tx.transaction(async (sp) => {
      await sp.insert(appTripFacts).values({ tripId: tripId!, agentName: agent.name, stays: stayFacts as never, pickups: pickupFacts as never, discount: o.discount, bookedAt: o.createdAt })
        .onConflictDoUpdate({ target: appTripFacts.tripId, set: { agentName: agent.name, stays: sql`${appTripFacts.stays} || ${JSON.stringify(stayFacts)}::jsonb`, pickups: sql`${appTripFacts.pickups} || ${JSON.stringify(pickupFacts)}::jsonb` } });
      const method = pay?.method ?? "credit";
      for (const [item, keys] of [["flight", ["flight", "infants"]], ["stay", ["stay"]], ["pickup", ["pickup"]]] as const) {
        const amount = amountOf([...keys]);
        if (!amount) continue;
        const plan = item === "flight" ? o.plan : o.plan;
        await sp.insert(appTripCharges).values({
          tripId: tripId!, ownerId: o.ownerId, paymentId: o.paymentId, item, title: lines.find((l) => keys.includes(l.key as never))?.text ?? item, amount, method, label: o.paymentLabel, plan,
          instalments: plan === "full" ? null : instalments(amount, plan === "tabby" ? 4 : 3).map((a, i) => ({ seq: i + 1, dueOn: addDays(now.toISOString().slice(0, 10), i * 30), amount: a, paidAt: i === 0 ? now.toISOString() : null })),
          creditUsed: item === "flight" ? o.creditUsed : 0, discount: item === "flight" ? o.discount : 0, paidAt: now,
        });
      }
    });
  } catch (e) {
    console.warn("[booking] trip facts/charges not written (trips tables not there yet?)", e instanceof Error ? e.message : "");
  }
  return tripId!;
}

/* ───────────── what the traveller does while the desk works ───────────── */

/** Faisal's question answered: carry on from where it was. "Call me" carries on once the call is done. */
export async function answerQuestion(orderId: string, ownerId: string, answer: "yes" | "call"): Promise<OrderRow> {
  return move(orderId, ["needs_answer"], async (tx, o) => {
    if (o.ownerId !== ownerId) throw new AppError("NOT_FOUND");
    const q = (o.question ?? { text: "", options: [] }) as { text: string; options: string[]; resume?: string };
    await orderEvent(tx, o.id, "answered", { kind: "user" }, { answer });
    const resume = q.resume ?? (o.step >= 2 ? "price_locked" : o.step >= 1 ? "held" : "pending_agent");
    if (answer === "call") return { question: { ...q, calling: true, answer: "call" } as never, autopilotAt: new Date(Date.now() + 3000), status: resume };
    return { question: { ...q, answer: "yes" } as never, status: resume };
  });
}

/** The traveller accepts the new fare: the old authorisation is released and the new total authorised. */
export async function acceptFare(orderId: string, ownerId: string): Promise<OrderRow> {
  return move(orderId, ["fare_changed"], async (tx, o) => {
    if (o.ownerId !== ownerId) throw new AppError("NOT_FOUND");
    const change = (o.fareChange ?? { total: 0 }) as { total: number };
    await voidPayment(tx, o);
    const paymentId = await reauthorize(tx, o, o.total + o.extra + change.total);
    await orderEvent(tx, o.id, "fare_accepted", { kind: "user" }, { extra: change.total });
    await appAuditLog(tx, { actorKind: "user", actorId: o.ownerId, action: "order.fare_accepted", entityType: "app_order", entityId: o.id, summary: `Accepted ${change.total} halalas more for the same flight` });
    return { status: "pending_agent", extra: o.extra + change.total, fareChange: null, paymentId, autopilotDone: [...o.autopilotDone, "fare"] };
  });
}

/** Tickets didn't issue: the traveller asks Mada to try by phone. The card is authorised again for the same total. */
export async function retryByPhone(orderId: string, ownerId: string): Promise<OrderRow> {
  return move(orderId, ["ticketing_failed"], async (tx, o) => {
    if (o.ownerId !== ownerId) throw new AppError("NOT_FOUND");
    const paymentId = await reauthorize(tx, o, o.total + o.extra);
    await orderEvent(tx, o.id, "retry_by_phone", { kind: "user" });
    return { status: "price_locked", step: 2, problem: null, paymentId, autopilotDone: [...o.autopilotDone, "ticketing"] };
  });
}

/** Mock-mode demo amount: Saudia sold the last seats, SAR 120 more each (FLOWS.md §2). */
export const DEMO_FARE_RISE_EACH = sarToHalalas(120);
export const PICKUP_TOTAL = sarToHalalas(PICKUP_SAR);
