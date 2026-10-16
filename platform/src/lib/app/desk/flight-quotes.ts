import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { FareOption, t as copy, tn, type CopyKey, type FareOption as FareOptionT, type Vars } from "@mada/shared";
import { db, type Tx } from "@/db";
import { appMessages, appNotifications, appQuotes, appRequests, appUsers } from "@/db/app-schema";
import { appAgents } from "@/db/app-schema-desk";
import { isFlightAsk } from "@/lib/app/booking/flight-requests";
import { inRequestOwnerLocale, localeOfUser } from "@/lib/app/locale";
import { withCopy } from "@/lib/app/notify-copy";
import { assertCap, deskAudit, DeskError, sarText, shortRef, type DeskActor } from "./core";

/*
 * Flights by request, on the desk. The agent books (or holds) the fares in Mada's own system, then sends them here:
 * up to four options, each with its flights, a price for each traveller, bags, change and refund rules, and how long
 * the hold lasts. The traveller chooses one and pays in the app; the order then sits on the desk's Orders page, where
 * "Issue tickets" records the PNR and a ticket number per traveller and writes the trip (lib/app/booking/desk.ts).
 *
 * Also here: an order from an account without a verified phone (APP_BOOKING_REQUIRES_PHONE=no) carries a contact
 * number; the desk calls it and marks the booking "confirmed by call".
 */

const Leg = z.object({
  direction: z.enum(["out", "back"]),
  flightNumber: z.string().trim().toUpperCase().regex(/^([A-Z][A-Z0-9]|[0-9][A-Z])\s?\d{1,4}$/, "Flight numbers look like SV263"),
  from: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Airports are three letters"),
  to: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Airports are three letters"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date of each flight"),
  dep: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Times are HH:MM"),
  arr: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Times are HH:MM"),
  arrDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  durationMin: z.number().int().positive().max(2400).nullish(),
});

const Option = z.object({
  airline: z.string().trim().min(1, "Name the airline").max(60),
  carrier: z.string().trim().toUpperCase().regex(/^([A-Z][A-Z0-9]|[0-9][A-Z])$/, "The airline code is two characters"),
  cabin: z.enum(["economy", "premium", "business", "first"]),
  legs: z.array(Leg).min(1, "Add the flights").max(8),
  prices: z.array(z.object({ personId: z.string().uuid().nullable(), name: z.string().trim().min(1).max(80), type: z.enum(["adult", "child", "infant"]), amount: z.number().int().min(0).max(100_000_000_00) })).min(1).max(12),
  baggage: z.string().trim().min(1, "Say what bags are included").max(120),
  changeRule: z.string().trim().min(1, "Say what a change costs").max(160),
  refundRule: z.string().trim().min(1, "Say what a refund gives back").max(160),
  refundable: z.boolean(),
  note: z.string().trim().max(200).nullish(),
});

/** What the quote builder posts (amounts in halalas). */
export const FlightQuoteInput = z.object({
  options: z.array(Option).min(1, "Add at least one fare").max(4, "Up to four fares"),
  /** When the hold ends (ISO), between 10 minutes and 7 days from now. */
  holdUntil: z.string().min(10),
  message: z.string().trim().max(600).nullish(),
  /** The PNR in Mada's system, when the agent already holds the seats. Shown only on the desk. */
  pnr: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{5,8}$/, "A PNR is 5 to 8 letters and numbers").nullish().or(z.literal("")),
});
export type FlightQuoteInput = z.input<typeof FlightQuoteInput>;

async function agentName(tx: Tx | typeof db, actor: DeskActor) {
  const [a] = await tx.select({ name: appAgents.displayName }).from(appAgents).where(eq(appAgents.opsUserId, actor.id)).limit(1);
  return a?.name ?? actor.name.split(" ")[0] ?? actor.name;
}

async function notify(tx: Tx, userId: string, n: { title: CopyKey; body: CopyKey; vars?: Vars; href: string }) {
  const locale = await localeOfUser(userId, tx);
  const clip = (s: string, k: number) => (s.length > k ? `${s.slice(0, k - 1)}…` : s);
  await tx.insert(appNotifications).values({ userId, kind: "agent_reply", level: "active", title: clip(copy(n.title, n.vars, locale), 32), body: clip(copy(n.body, n.vars, locale), 90), href: n.href, data: withCopy(null, { title: [n.title, n.vars], body: [n.body, n.vars] }) });
}

/** Check the builder's options and make them the shape the app reads. Totals are always added up here. */
export function buildFareOptions(input: FlightQuoteInput, travellerIds: string[]): FareOptionT[] {
  const v = FlightQuoteInput.parse(input);
  return v.options.map((o, i) => {
    if (!o.legs.some((l) => l.direction === "out")) throw new DeskError(`Fare ${i + 1}: add the outbound flight`);
    for (const p of o.prices) if (p.personId && !travellerIds.includes(p.personId)) throw new DeskError(`Fare ${i + 1}: that traveller isn't on this request`);
    if (o.prices.every((p) => p.amount === 0)) throw new DeskError(`Fare ${i + 1}: enter the price for each traveller`);
    const fare = {
      id: `opt${i + 1}`, airline: o.airline, carrier: o.carrier, cabin: o.cabin,
      legs: o.legs.map((l) => ({ ...l, carrier: l.flightNumber.replace(/\s/g, "").slice(0, 2), flightNumber: l.flightNumber.replace(/\s/g, ""), arrDate: l.arrDate ?? null, durationMin: l.durationMin ?? null })),
      prices: o.prices.map((p) => ({ personId: p.personId, name: p.name, type: p.type, amount: { amount: p.amount, currency: "SAR" as const } })),
      total: { amount: o.prices.reduce((a, p) => a + p.amount, 0), currency: "SAR" as const },
      baggage: o.baggage, changeRule: o.changeRule, refundRule: o.refundRule, refundable: o.refundable, note: o.note || null,
    };
    const parsed = FareOption.safeParse(fare);
    if (!parsed.success) throw new DeskError(`Fare ${i + 1}: ${parsed.error.issues[0]?.message ?? "check the details"}`);
    return parsed.data;
  });
}

/** Send fare options for a flight request. A new quote replaces the open one. */
async function sendFlightQuoteHere(actor: DeskActor, requestId: string, input: FlightQuoteInput) {
  assertCap(actor, "desk.act");
  const parsed = FlightQuoteInput.safeParse(input);
  if (!parsed.success) throw new DeskError(parsed.error.issues[0]?.message ?? "Check the fares");
  const holdUntil = new Date(parsed.data.holdUntil);
  const ms = holdUntil.getTime() - Date.now();
  if (!Number.isFinite(ms) || ms < 10 * 60_000) throw new DeskError("The hold must last at least 10 minutes");
  if (ms > 7 * 86_400_000) throw new DeskError("Holds last 7 days at most");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(appRequests).where(eq(appRequests.id, requestId)).for("update");
    if (!r) throw new DeskError("Request not found", "NOT_FOUND");
    if (!isFlightAsk(r.details)) throw new DeskError("Fares go on a flight request");
    if (!["sent", "reviewing", "needs_answer", "quoted"].includes(r.status)) throw new DeskError("This request is already paid or closed", "CONFLICT");
    const options = buildFareOptions(parsed.data, r.travellerIds);
    const total = Math.min(...options.map((o) => o.total.amount));
    const name = await agentName(tx, actor);
    const lead = parsed.data.message?.trim() || tn("beta.fq.lead", options.length);
    await tx.update(appQuotes).set({ status: "withdrawn" }).where(and(eq(appQuotes.requestId, requestId), eq(appQuotes.status, "open")));
    const [q] = await tx.insert(appQuotes).values({
      requestId, total, status: "open", expiresAt: holdUntil, createdByOpsUserId: actor.id, cancellation: options[0]!.refundRule,
      lines: options.flatMap((o, i) => o.prices.map((p) => ({ label: `${i + 1}. ${o.airline}: ${p.name}`, amount: p.amount.amount, kind: "flight" }))),
      offerSnapshot: { kind: "flight", source: "desk", options, text: lead, lead, breakdown: [], needLines: [], pnr: parsed.data.pnr || null },
    }).returning();
    await tx.update(appRequests).set({
      status: "quoted", updatedAt: new Date(), agentOpsUserId: r.agentOpsUserId ?? actor.id, agentName: r.agentOpsUserId ? r.agentName : name,
      details: sql`${appRequests.details} || ${JSON.stringify({ quote: total, quoteText: lead })}::jsonb`,
    }).where(eq(appRequests.id, requestId));
    await tx.insert(appMessages).values({ threadKind: "request", threadId: requestId, authorKind: "agent", authorOpsUserId: actor.id, authorName: name, body: lead, card: { quoteId: q!.id, flight: true } });
    await notify(tx, r.ownerId, { title: "notify.desk.quote.title", body: "notify.desk.quote.body", vars: { agent: name, summary: r.summary }, href: `/requests/${requestId}` });
    await deskAudit(tx, actor, {
      action: "desk.quote.flight_sent", entityType: "request", entityId: requestId, ref: shortRef(requestId),
      summary: `Sent ${options.length} fare${options.length === 1 ? "" : "s"} for ${shortRef(requestId)}, from ${sarText(total)}, held until ${holdUntil.toISOString().slice(0, 16).replace("T", " ")} UTC`,
      data: { quoteId: q!.id, options: options.map((o) => ({ id: o.id, carrier: o.carrier, total: o.total.amount })), pnr: parsed.data.pnr || null },
    });
    return q!;
  });
}

export const sendFlightQuote = (actor: DeskActor, requestId: string, input: FlightQuoteInput) => inRequestOwnerLocale(requestId, () => sendFlightQuoteHere(actor, requestId, input));

/* ───────────── a contact number that isn't verified ───────────── */

export type ContactState = { phone: string; verified: boolean; confirmedAt?: string | null; confirmedBy?: string | null } | null;

/** The number to call for a request or order whose account has no verified phone (null when it has one). */
export function contactOf(details: unknown): ContactState {
  const d = (details ?? {}) as { contactPhone?: string; contactVerified?: boolean; contactConfirmedAt?: string | null; contactConfirmedBy?: string | null };
  return d.contactPhone ? { phone: d.contactPhone, verified: !!d.contactVerified, confirmedAt: d.contactConfirmedAt ?? null, confirmedBy: d.contactConfirmedBy ?? null } : null;
}

/** "Mark confirmed by call": the agent rang the number and the traveller confirmed the booking. Audited. */
export async function confirmContactByCall(actor: DeskActor, requestId: string) {
  assertCap(actor, "desk.act");
  await db.transaction(async (tx) => {
    const [r] = await tx.select({ details: appRequests.details, ownerId: appRequests.ownerId }).from(appRequests).where(eq(appRequests.id, requestId)).for("update");
    if (!r) throw new DeskError("Request not found", "NOT_FOUND");
    const c = contactOf(r.details);
    if (!c) throw new DeskError("This booking has a verified phone");
    if (c.confirmedAt) throw new DeskError("Already confirmed by call", "CONFLICT");
    const [u] = await tx.select({ phone: appUsers.phone }).from(appUsers).where(eq(appUsers.id, r.ownerId));
    const name = await agentName(tx, actor);
    await tx.update(appRequests).set({ details: sql`${appRequests.details} || ${JSON.stringify({ contactConfirmedAt: new Date().toISOString(), contactConfirmedBy: name })}::jsonb`, updatedAt: new Date() }).where(eq(appRequests.id, requestId));
    await deskAudit(tx, actor, {
      action: "desk.contact.confirmed_by_call", entityType: "request", entityId: requestId, ref: shortRef(requestId, "O"),
      summary: `${name} called the contact number (not verified) and the traveller confirmed the booking`, data: { verifiedPhoneOnAccount: !!u?.phone },
    });
  });
}
