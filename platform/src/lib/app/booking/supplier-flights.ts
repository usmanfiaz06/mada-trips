import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { ageAt, type FlightOption, type OrderLine } from "@mada/shared";
import { db } from "@/db";
import { appPeople, appUsers } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { decryptField, passportAad } from "../crypto";
import { canTicket, type FlightBookingRef, type FlightOutcome, type FlightPassenger, type TicketingFlightSupplier } from "../suppliers/flight-ticketing";
import { bookingSuppliers } from "./common";
import { cancelOrder, failTicketing, issueTickets, lockPrice, orderEvent, priceChanged, startIssuing, type DeskAgent, type OrderRow } from "./desk";

/*
 * A flight order whose offer came from a supplier that books and tickets by itself (TBO Air): the desk's order page
 * drives it with "Hold with TBO", "Ticket now" and "Check with TBO" (lib/app/desk/flight-supplier.ts). What the
 * supplier says lands as the outcome the traveller already knows from the desk's own buttons:
 *
 *   held / ticket_now   the order is held; a full-service airline has a PNR and a last day to ticket
 *   price_changed       priceChanged(): the traveller sees the new fare and takes it or stops (the card hold moves)
 *   sold_out            cancelOrder(sold_out): nothing charged, other dates offered
 *   ticketed            the PNR and ticket numbers go on the order, then issueTickets() captures and writes the trip
 *   failed (ticketing)  failTicketing(): the card hold is released and the traveller can ask Mada to try by phone
 *   pending / failed (hold), schedule_changed   stay with the desk, written on the order for whoever looks next
 *
 * The supplier's booking (FlightBookingRef) lives on the order (snapshot.flightBooking) and is written before every
 * request that books or tickets, so a retry, a second server or a second click never books or tickets twice.
 */

export type FlightBookingState = FlightBookingRef & {
  state: "held" | "ticket_now" | "pending" | "ticketed" | "price_changed" | "schedule_changed" | "failed" | "ticketed_unpaid";
  note: string | null;
  at: string;
};

type Snap = { flight?: FlightOption; flightSupplierId?: string | null; flightBooking?: FlightBookingState | null; search?: { infants?: number }; applied?: { ssr?: string[]; remarks?: string[] }; contact?: { phone?: string | null } };

/** This order's flight came from a supplier that books by itself, and that supplier is the one running now. */
export function supplierFlightOf(o: Pick<OrderRow, "snapshot">): { supplier: TicketingFlightSupplier; offerId: string } | null {
  const s = o.snapshot as Snap;
  const id = s.flightSupplierId;
  if (!s.flight || !id) return null;
  const supplier = bookingSuppliers.flights();
  if (!canTicket(supplier) || !id.startsWith(`${supplier.name}.`)) return null;
  return { supplier, offerId: id };
}

export const flightBookingOf = (o: Pick<OrderRow, "snapshot">): FlightBookingState | null => (o.snapshot as Snap).flightBooking ?? null;

/** What the card holds for the flight (the fare lines plus any accepted rise), in halalas: the most a fare may be. */
export function paidForFlight(o: OrderRow): number {
  const lines = o.lines as OrderLine[];
  return lines.filter((l) => ["flight", "children", "infants"].includes(l.key)).reduce((a, l) => a + l.amount, 0) + o.extra;
}

/** ISO 3166 alpha-3 → alpha-2 for the nationalities we see most; others stay missing (the desk fills them in). */
const ISO2: Record<string, string> = {
  SAU: "SA", ARE: "AE", BHR: "BH", KWT: "KW", OMN: "OM", QAT: "QA", YEM: "YE", JOR: "JO", EGY: "EG", SYR: "SY", LBN: "LB", IRQ: "IQ", PSE: "PS",
  SDN: "SD", MAR: "MA", TUN: "TN", DZA: "DZ", LBY: "LY", TUR: "TR", PAK: "PK", IND: "IN", BGD: "BD", IDN: "ID", MYS: "MY", PHL: "PH", NPL: "NP",
  LKA: "LK", AFG: "AF", IRN: "IR", AZE: "AZ", GEO: "GE", GBR: "GB", USA: "US", CAN: "CA", FRA: "FR", DEU: "DE", ITA: "IT", ESP: "ES", NLD: "NL",
  AUS: "AU", ETH: "ET", ERI: "ER", SOM: "SO", NGA: "NG", KEN: "KE", MRT: "MR", CHN: "CN", RUS: "RU", UZB: "UZ", KAZ: "KZ",
};
const iso2 = (c: string | null | undefined) => (!c ? null : c.length === 2 ? c.toUpperCase() : ISO2[c.toUpperCase()] ?? null);

/**
 * The passengers, in the order's traveller order, then babies on a lap (household babies under 2 not on a seat). Passport
 * numbers are decrypted here, for the supplier only: never logged, never stored on the order.
 */
export async function passengersFor(o: OrderRow): Promise<FlightPassenger[]> {
  const s = o.snapshot as Snap;
  const dayOut = s.flight?.out.date ?? new Date().toISOString().slice(0, 10);
  const [people, [user]] = await Promise.all([
    db.select().from(appPeople).where(and(eq(appPeople.ownerId, o.ownerId), isNull(appPeople.deletedAt))),
    db.select({ phone: appUsers.phone, email: appUsers.email }).from(appUsers).where(eq(appUsers.id, o.ownerId)),
  ]);
  const seated = o.travellerIds.map((id) => people.find((p) => p.id === id)).filter((p): p is (typeof people)[number] => !!p);
  const lapCount = s.flight?.infants ?? s.search?.infants ?? 0;
  const laps = people.filter((p) => !o.travellerIds.includes(p.id) && (ageAt(p.dateOfBirth, dayOut) ?? 99) < 2).slice(0, lapCount);
  const ssr = s.applied?.ssr ?? [];
  const remarks = s.applied?.remarks ?? [];
  const adultMeal = ssr.find((c) => /^[A-Z]{2}ML$/.test(c) && c !== "CHML") ?? null;
  const seat = remarks.includes("SEAT WINDOW") ? "window" : remarks.includes("SEAT AISLE") ? "aisle" : null;
  const phone = user?.phone ?? s.contact?.phone ?? null;
  const toPax = (p: (typeof people)[number], lap: boolean): FlightPassenger => {
    const age = ageAt(p.dateOfBirth, dayOut);
    const type: FlightPassenger["type"] = lap ? "infant" : age != null && age < 12 ? "child" : "adult";
    let passportNumber: string | null = null;
    if (p.passportNumberEnc) { try { passportNumber = decryptField(p.passportNumberEnc, passportAad(p.id)); } catch { passportNumber = null; } }
    return {
      personId: p.id, givenNames: p.givenNames, surname: p.surname, type, dateOfBirth: p.dateOfBirth, sex: p.sex === "M" || p.sex === "F" ? p.sex : null,
      nationality: iso2(p.passportNationality ?? p.nationality), passportNumber, passportExpiry: p.passportExpiry, passportCountry: iso2(p.passportIssuingCountry),
      lead: false, phone, email: user?.email ?? null,
      meal: type === "child" && ssr.includes("CHML") ? "CHML" : type === "adult" ? adultMeal : null, seat: type === "infant" ? null : seat,
    };
  };
  const out = [...seated.map((p) => toPax(p, false)), ...laps.map((p) => toPax(p, true))];
  const lead = out.find((p) => p.type === "adult" && people.find((x) => x.id === p.personId)?.isSelf) ?? out.find((p) => p.type === "adult");
  if (lead) lead.lead = true;
  // A lap baby the household hasn't added: the airline can't take a nameless passenger, so the desk adds them.
  for (let i = laps.length; i < lapCount; i++) out.push({ personId: `lap-${i}`, givenNames: "", surname: "", type: "infant", dateOfBirth: null, sex: null, nationality: null, passportNumber: null, passportExpiry: null, passportCountry: null, lead: false, phone: null, email: null });
  return out;
}

/** The supplier's booking, written on the order (merged into the snapshot: nothing else on it changes). */
async function save(orderId: string, ref: FlightBookingRef | null, state: FlightBookingState["state"] | null, note: string | null = null) {
  const value = ref && state ? { ...ref, state, note, at: new Date().toISOString() } : null;
  await db.update(appOrders).set({ snapshot: sql`${appOrders.snapshot} || ${JSON.stringify({ flightBooking: value })}::jsonb`, updatedAt: new Date() }).where(eq(appOrders.id, orderId));
}
const persistFor = (orderId: string, state: FlightBookingState["state"]) => (ref: FlightBookingRef) => save(orderId, ref, state, null);

async function order(orderId: string): Promise<OrderRow> {
  const [o] = await db.select().from(appOrders).where(eq(appOrders.id, orderId));
  if (!o) throw Object.assign(new Error("Order not found"), { code: "NOT_FOUND" });
  return o;
}

async function event(orderId: string, kind: string, agent: DeskAgent, data: Record<string, unknown>) {
  await db.transaction((tx) => orderEvent(tx, orderId, kind, { kind: "agent", name: agent.name }, data));
}

/** The airline's rules for the booked fare, for the trip's fare sheet (change and refund fees, bags). Best effort. */
async function saveRules(o: OrderRow, offerId: string) {
  const sf = supplierFlightOf(o);
  if (!sf) return;
  try {
    const { changeAllowed: _c, changeRule: _r, refundRule: _f, text: _t, ...rules } = await sf.supplier.fareRules(offerId);
    await db.update(appOrders).set({ snapshot: sql`${appOrders.snapshot} || ${JSON.stringify({ flightRules: rules })}::jsonb` }).where(eq(appOrders.id, o.id));
  } catch { /* the carrier's usual rules stand */ }
}

export type SupplierStep = { outcome: FlightOutcome["outcome"] | "manual"; message: string };

const perPersonRise = (o: OrderRow, total: number) => Math.max(0, Math.ceil((total - paidForFlight(o)) / Math.max(1, o.travellerIds.length)));

/**
 * Hold the seats at the supplier (after the desk confirmed the order: status held). Full-service airlines get a PNR;
 * low-cost airlines have nothing to hold and are ticketed straight away.
 */
export async function holdWithSupplier(orderId: string, agent: DeskAgent): Promise<SupplierStep> {
  const o = await order(orderId);
  const sf = supplierFlightOf(o);
  if (!sf) return { outcome: "manual", message: "This flight isn't from a supplier that books by itself: hold it in Mada's system." };
  const known = flightBookingOf(o);
  const people = await passengersFor(o);
  const r = await sf.supplier.book(sf.offerId, people, { key: `hold:${o.id}`, paidTotal: paidForFlight(o), known, ssr: (o.snapshot as Snap).applied?.ssr ?? [], persist: persistFor(o.id, "pending") });
  return settle(o, r, agent, "hold");
}

/** Issue the tickets at the supplier, then capture the card and write the trip (issueTickets). */
export async function ticketWithSupplier(orderId: string, agent: DeskAgent): Promise<SupplierStep> {
  let o = await order(orderId);
  const sf = supplierFlightOf(o);
  const fb = flightBookingOf(o);
  if (!sf || !fb) return { outcome: "manual", message: "Nothing is held at the supplier for this order yet." };
  if (!["held", "price_locked", "issuing"].includes(o.status)) return { outcome: "manual", message: "This order isn't ready to ticket." };
  if (o.status === "held") o = await lockPrice(o.id, agent);
  if (o.status === "price_locked") o = await startIssuing(o.id, agent);
  // The traveller took a higher fare since a ticket request said the price changed: the next request accepts it.
  const ref: FlightBookingRef = { ...fb, parts: fb.parts.map((p) => (fb.state === "price_changed" && !p.lcc ? { ...p, priceChangeAccepted: true } : p)) };
  const people = await passengersFor(o);
  const r = await sf.supplier.ticket(ref, people, { key: `ticket:${o.id}`, paidTotal: paidForFlight(o), persist: persistFor(o.id, "pending") });
  return settle(o, r, agent, "ticket");
}

/** Ask the supplier how the booking stands (after a lost answer, or tickets still in progress). Issued: as Ticket now. */
export async function checkWithSupplier(orderId: string, agent: DeskAgent): Promise<SupplierStep> {
  const o = await order(orderId);
  const sf = supplierFlightOf(o);
  const fb = flightBookingOf(o);
  if (!sf || !fb) return { outcome: "manual", message: "Nothing is booked at the supplier for this order." };
  const people = await passengersFor(o);
  const lead = people.find((p) => p.lead);
  const d = await sf.supplier.bookingDetails(fb, lead ? { givenNames: lead.givenNames, surname: lead.surname } : undefined);
  if (d.tickets.length && d.tickets.every(Boolean) && d.ref.parts.every((p) => p.tickets.length)) return settle(o, { outcome: "ticketed", ref: d.ref, tickets: d.tickets }, agent, "ticket");
  const held = d.ref.parts.every((p) => p.lcc || p.bookingId);
  const state: FlightBookingState["state"] = d.status === "held" && held ? (d.ref.parts.every((p) => p.lcc) ? "ticket_now" : "held") : d.status === "failed" || d.status === "cancelled" ? "failed" : "pending";
  const note = state === "pending" ? "Still being worked on at the supplier." : state === "failed" ? `The supplier says: ${d.status}.` : null;
  await save(o.id, d.ref, state, note);
  await event(o.id, "supplier_checked", agent, { status: d.status });
  return { outcome: state === "held" ? "held" : state === "ticket_now" ? "ticket_now" : state === "failed" ? "failed" : "pending", message: note ?? "Held at the supplier." };
}

/** What the supplier said, as the order's next state. */
async function settle(o: OrderRow, r: FlightOutcome, agent: DeskAgent, step: "hold" | "ticket"): Promise<SupplierStep> {
  const pnrs = (ref: FlightBookingRef) => ref.parts.map((p) => p.pnr).filter((p): p is string => !!p);
  switch (r.outcome) {
    case "held":
    case "ticket_now": {
      const pnr = pnrs(r.ref)[0] ?? null;
      // Held again after the traveller took a fare that rose at ticketing: the next ticket request accepts it.
      await save(o.id, r.ref, flightBookingOf(o)?.state === "price_changed" ? "price_changed" : r.outcome);
      if (pnr) await db.update(appOrders).set({ supplierRef: pnr }).where(eq(appOrders.id, o.id));
      await saveRules(o, r.ref.offerId);
      await event(o.id, pnr ? "pnr" : "supplier_fare_confirmed", agent, { pnr, bookingIds: r.ref.parts.map((p) => p.bookingId), lcc: r.ref.parts.map((p) => p.lcc) });
      return { outcome: r.outcome, message: r.outcome === "held" ? `Held · PNR ${pnrs(r.ref).join(", ")}` : "Fare confirmed. A low-cost airline doesn't hold seats: ticket now." };
    }
    case "pending":
      await save(o.id, r.ref, "pending", r.why);
      await event(o.id, step === "ticket" ? "ticketing_pending" : "hold_pending", agent, {});
      return { outcome: "pending", message: r.why };
    case "price_changed": {
      const rise = perPersonRise(o, r.total);
      await save(o.id, r.ref ?? flightBookingOf(o), r.ref ? "price_changed" : null);
      if (rise > 0) await priceChanged(o.id, agent, rise);
      return { outcome: "price_changed", message: rise > 0 ? `The fare rose by ${(rise / 100).toFixed(0)} riyals a person. The traveller has been asked.` : "The fare moved but not above what was paid. Try again." };
    }
    case "schedule_changed":
      await save(o.id, r.ref ?? flightBookingOf(o) ?? { supplier: "", offerId: "", traceId: "", parts: [], ssrForDesk: [] }, "schedule_changed", "The airline changed the times.");
      await event(o.id, "schedule_changed", agent, {});
      return { outcome: "schedule_changed", message: "The airline changed the flight times. Ask the traveller before going on." };
    case "sold_out":
      // While issuing, the order can't be cancelled under the traveller: tickets didn't issue (card hold released).
      if (step === "ticket") { await save(o.id, r.ref ?? flightBookingOf(o), "failed", "Sold out at the airline."); await failTicketing(o.id, agent, "sold out at the airline"); return { outcome: "sold_out", message: "Sold out at the airline. The card hold is released." }; }
      await save(o.id, null, null);
      await cancelOrder(o.id, { kind: "agent", name: agent.name }, { reason: "sold_out" });
      return { outcome: "sold_out", message: "Sold out at the airline. The order is closed and nothing was charged." };
    case "failed":
      if (step === "hold") {
        // Nothing held at the supplier: the order stays with the desk to hold by hand or close.
        await save(o.id, r.ref ?? { supplier: "", offerId: "", traceId: "", parts: [], ssrForDesk: [] }, "failed", r.reason);
        await event(o.id, "hold_failed", agent, { reason: r.reason });
        return { outcome: "failed", message: r.reason };
      }
      await save(o.id, r.ref ?? flightBookingOf(o), "failed", r.reason);
      await failTicketing(o.id, agent, r.reason);
      return { outcome: "failed", message: r.reason };
    case "ticketed": {
      const pnr = pnrs(r.ref)[0] ?? o.supplierRef;
      await save(o.id, r.ref, "ticketed");
      await db.update(appOrders).set({ supplierRef: pnr, snapshot: sql`${appOrders.snapshot} || ${JSON.stringify({ tickets: r.tickets })}::jsonb` }).where(eq(appOrders.id, o.id));
      await event(o.id, "tickets", agent, { pnr, tickets: r.tickets });
      const done = await issueTickets(o.id, agent);
      if (done.status !== "confirmed") {
        // Issued at the airline, but the card didn't capture: the tickets must be voided at the supplier today.
        await save(o.id, r.ref, "ticketed_unpaid", "Tickets issued but the card capture failed: void them at TBO today.");
        return { outcome: "failed", message: "Tickets issued, but the card capture failed. Void the tickets at TBO today." };
      }
      return { outcome: "ticketed", message: `Ticketed · PNR ${pnr} · ${r.tickets.length} ticket${r.tickets.length === 1 ? "" : "s"}` };
    }
  }
}
