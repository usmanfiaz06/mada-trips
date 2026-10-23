import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { MAX_STAY_QUOTE_OPTIONS, StayQuoteOption, formatSar, nightsBetween, stayQuoteOf, tn, type ChatCard, type StayQuoteOption as StayQuoteOptionT } from "@mada/shared";
import { db, type Tx } from "@/db";
import { appMessages, appQuotes, appRequests } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appAskThreads } from "@/db/app-schema-ask";
import { appAgents } from "@/db/app-schema-desk";
import * as booking from "@/lib/app/booking/desk";
import { inRequestOwnerLocale, localeOfUser } from "@/lib/app/locale";
import { appendLine, newThread, primaryThreadOf } from "@/lib/app/ask-chat/store";
import { notify } from "@/lib/app/trips/notify";
import { pricingRules, UnknownCurrency, type PricingRules } from "@/lib/app/suppliers/hotelbeds/money";
import { riyadhDate } from "@/lib/dates";
import { toHalalas } from "@/lib/money";
import { assertCap, deskAudit, DeskError, sarText, shortRef, type DeskActor } from "./core";
import { engine, linkedOrder } from "./adapters";
import { BOARDS, HAND_SUPPLIERS, handStayCostsOf, handStayPrice, isStayAsk, type HandStayCost } from "./hotel-quote-math";

export { handStayCostsOf, type HandStayCost };

/*
 * Stays found by hand, on the desk. Until Mada has a live supplier key for a hotel, Ask sends a stay request
 * (booking/requests.ts). The agent finds the room on the Hotelbeds or TBO agent portal, or with the hotel itself, by
 * hand, and adds up to three hotels here: hotel, city, room, board, dates, guests, where it was found, the net cost
 * and its currency, the cancellation, a line for the traveller and the supplier's reference.
 *
 * The selling price is worked out as an instant stay's is (hotel-quote-math.ts over suppliers/hotelbeds/money.ts); the
 * agent may set another, with a reason, and both are audited. "Send to the traveller" writes the quote, posts the card
 * in the traveller's Ask chat (the one the request came from) with a push, and the request reads "quoted". The
 * traveller books one option and pays in the app (booking/pricing.ts prices it as a stay); the order then waits here
 * as "Paid · confirm on the portal" until the agent enters the hotel's reference, which writes the stay on the trip.
 *
 * What Mada pays and who it books with stay on the desk: they are kept under `wholesale` on the quote (a key the
 * app's shield drops, lib/app/shield.ts), never in the options the app reads, and reach finance as the line's cost
 * (finance/costs.ts).
 */

/** A hotel quote holds its price this long; after that the traveller asks again (or the desk sends a new one). */
export const HOTEL_QUOTE_HOLD_HOURS = 24;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

const Option = z.object({
  hotel: z.string().trim().min(2, "Name the hotel").max(120, "Keep the hotel's name under 120 characters"),
  city: z.string().trim().min(1, "Name the city").max(80),
  room: z.string().trim().min(1, "Say the room type").max(120),
  board: z.enum(BOARDS, { message: "Pick the board" }),
  checkIn: z.string().regex(DAY, "Choose the check-in date"),
  checkOut: z.string().regex(DAY, "Choose the check-out date"),
  guests: z.coerce.number({ message: "Say how many guests" }).int("Guests is a whole number").min(1, "At least one guest").max(20, "Up to 20 guests"),
  supplier: z.enum(HAND_SUPPLIERS, { message: "Say where you found it" }),
  net: z.coerce.number({ message: "Enter the net cost" }).positive("Enter the net cost").max(10_000_000, "Check the net cost"),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Currencies are three letters, like EUR"),
  /** Free to cancel until this time at the hotel; empty or null: non-refundable. */
  freeCancelUntil: z.string().trim().nullish(),
  note: z.string().trim().max(300, "Keep the note under 300 characters").nullish(),
  supplierRef: z.string().trim().max(60).nullish(),
  /** Another selling price than the worked-out one, in SAR, with the reason (audited). */
  sellSar: z.string().trim().max(20).nullish(),
  overrideReason: z.string().trim().max(200).nullish(),
});

/** What the "Add hotel quote" form posts (the net in the supplier's currency, an override in SAR). */
export const HotelQuoteInput = z.object({
  options: z.array(Option).min(1, "Add the hotel").max(MAX_STAY_QUOTE_OPTIONS, `Up to ${MAX_STAY_QUOTE_OPTIONS} hotels in one quote`),
  message: z.string().trim().max(600).nullish(),
});
export type HotelQuoteInput = z.input<typeof HotelQuoteInput>;

/** Check the form and price each option. Throws a DeskError naming the option and the field. Pure but for `today`. */
export function buildHotelQuote(input: HotelQuoteInput, opts: { rules?: PricingRules; today?: string } = {}): { options: StayQuoteOptionT[]; costs: HandStayCost[]; message: string | null } {
  const parsed = HotelQuoteInput.safeParse(input);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    const n = i?.path[0] === "options" && typeof i.path[1] === "number" ? `Hotel ${i.path[1] + 1}: ` : "";
    throw new DeskError(`${n}${i?.message ?? "Check the hotel quote"}`);
  }
  const rules = opts.rules ?? pricingRules();
  const today = opts.today ?? riyadhDate();
  const options: StayQuoteOptionT[] = [];
  const costs: HandStayCost[] = [];
  parsed.data.options.forEach((o, i) => {
    const fail = (m: string): never => { throw new DeskError(`Hotel ${i + 1}: ${m}`); };
    const nights = nightsBetween(o.checkIn, o.checkOut);
    if (o.checkIn < today) fail("check-in is in the past");
    if (!nights) fail("check-out must be after check-in");
    if (nights > 60) fail("60 nights at most");
    const until = o.freeCancelUntil || null;
    if (until) {
      if (!LOCAL.test(until)) fail("say until when it's free to cancel (date and time at the hotel)");
      if (until.slice(0, 10) < today) fail("free cancellation has already ended: choose non-refundable");
      if (until.slice(0, 10) > o.checkIn) fail("free cancellation can't run past check-in");
    }
    let price;
    try { price = handStayPrice(o.net, o.currency, rules); } catch (e) {
      if (e instanceof UnknownCurrency) fail(`no rate for ${e.currency}: use SAR, or ask finance to add it to APP_FX_RATES`);
      throw e;
    }
    let sell = price.sell;
    const reason = o.overrideReason?.trim() || null;
    if (o.sellSar) {
      let v = 0;
      try { v = toHalalas(o.sellSar); } catch { fail("check the selling price"); }
      if (v <= 0) fail("the selling price must be more than zero");
      if (v !== price.sell && (!reason || reason.length < 3)) fail("say why the price is different");
      sell = v;
    }
    const id = `h${i + 1}`;
    const option = StayQuoteOption.parse({
      id, hotel: o.hotel, city: o.city, room: o.room, board: o.board, checkIn: o.checkIn, checkOut: o.checkOut, nights, guests: o.guests, total: sell,
      freeCancelUntil: until, note: o.note || null,
    });
    options.push(option);
    costs.push({
      id, supplier: o.supplier, supplierRef: o.supplierRef || null, netAmount: o.net.toFixed(2), currency: o.currency, costHalalas: price.cost,
      autoSell: price.sell, sell, marginHalalas: sell - price.cost, overrideReason: sell !== price.sell ? reason : null,
    });
  });
  return { options, costs, message: parsed.data.message || null };
}

async function agentName(tx: Tx | typeof db, actor: DeskActor) {
  const [a] = await tx.select({ name: appAgents.displayName }).from(appAgents).where(eq(appAgents.opsUserId, actor.id)).limit(1);
  return a?.name ?? actor.name.split(" ")[0] ?? actor.name;
}

/**
 * The Ask chat a request came from: the chat whose turn sent it (create_request's answer names the request), else
 * the chat about its trip, else the traveller's latest chat, else a new one. Remembered on the request.
 */
export async function askThreadFor(r: Pick<typeof appRequests.$inferSelect, "id" | "ownerId" | "tripId" | "details">): Promise<string> {
  const known = (r.details as { askThreadId?: string } | null)?.askThreadId;
  if (known) {
    const [ok] = await db.select({ id: appAskThreads.id }).from(appAskThreads).where(and(eq(appAskThreads.id, known), eq(appAskThreads.ownerId, r.ownerId)));
    if (ok) return ok.id;
  }
  const [sent] = await db.select({ id: appAskThreads.id }).from(appAskThreads)
    .where(and(eq(appAskThreads.ownerId, r.ownerId), sql`(${appAskThreads.messages}::text LIKE ${`%${r.id}%`} OR ${appAskThreads.transcript}::text LIKE ${`%${r.id}%`})`))
    .orderBy(desc(appAskThreads.updatedAt)).limit(1);
  let id = sent?.id ?? (r.tripId ? (await primaryThreadOf(r.ownerId, r.tripId))?.id : undefined);
  if (!id) {
    const [latest] = await db.select({ id: appAskThreads.id }).from(appAskThreads).where(and(eq(appAskThreads.ownerId, r.ownerId), sql`${appAskThreads.archivedAt} IS NULL`)).orderBy(desc(appAskThreads.updatedAt)).limit(1);
    id = latest?.id ?? (await newThread(r.ownerId, await localeOfUser(r.ownerId), r.tripId ?? null)).id;
  }
  await db.update(appRequests).set({ details: sql`${appRequests.details} || ${JSON.stringify({ askThreadId: id })}::jsonb` }).where(eq(appRequests.id, r.id));
  return id;
}

/** Send hotel options for a stay request. A new quote replaces the open one. */
async function sendHotelQuoteHere(actor: DeskActor, requestId: string, input: HotelQuoteInput) {
  assertCap(actor, "desk.act");
  const built = buildHotelQuote(input);
  const sent = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(appRequests).where(eq(appRequests.id, requestId)).for("update");
    if (!r) throw new DeskError("Request not found", "NOT_FOUND");
    if (!isStayAsk(r.details)) throw new DeskError("Hotel quotes go on a stay request");
    if (!["sent", "reviewing", "needs_answer", "quoted"].includes(r.status)) throw new DeskError("This request is already paid or closed", "CONFLICT");
    const name = await agentName(tx, actor);
    const n = built.options.length;
    const total = Math.min(...built.options.map((o) => o.total));
    const lead = built.message || tn("chat.stayQuote.lead", n, { agent: name });
    const expiresAt = new Date(Date.now() + HOTEL_QUOTE_HOLD_HOURS * 3_600_000);
    await tx.update(appQuotes).set({ status: "withdrawn" }).where(and(eq(appQuotes.requestId, requestId), eq(appQuotes.status, "open")));
    const [q] = await tx.insert(appQuotes).values({
      requestId, total, status: "open", expiresAt, createdByOpsUserId: actor.id,
      cancellation: built.options[0]!.freeCancelUntil ? `Free cancellation until ${built.options[0]!.freeCancelUntil.replace("T", " ")} hotel time` : "Non-refundable",
      lines: built.options.map((o, i) => ({ label: `${i + 1}. ${o.hotel}: ${o.room}`.slice(0, 80), amount: o.total, kind: "stay" })),
      offerSnapshot: { kind: "stay", source: "desk-hand", options: built.options, text: lead, lead, breakdown: [], needLines: [], wholesale: built.costs },
    }).returning();
    await tx.update(appRequests).set({
      status: "quoted", updatedAt: new Date(), agentOpsUserId: r.agentOpsUserId ?? actor.id, agentName: r.agentOpsUserId ? r.agentName : name,
      details: sql`${appRequests.details} || ${JSON.stringify({ quote: total, quoteText: lead })}::jsonb`,
    }).where(eq(appRequests.id, requestId));
    // The request's own thread keeps it too (Trips → Requests, the desk's conversation).
    await tx.insert(appMessages).values({ threadKind: "request", threadId: requestId, authorKind: "agent", authorOpsUserId: actor.id, authorName: name, body: lead, card: { quoteId: q!.id, stay: true } });
    const overridden = built.costs.filter((c) => c.sell !== c.autoSell);
    await deskAudit(tx, actor, {
      action: "desk.quote.stay_sent", entityType: "request", entityId: requestId, ref: shortRef(requestId),
      summary: `Sent ${n} hotel${n === 1 ? "" : "s"} for ${shortRef(requestId)}, from ${sarText(total)}${overridden.length ? ` (${overridden.length} price${overridden.length === 1 ? "" : "s"} set by hand)` : ""}`,
      data: { quoteId: q!.id, options: built.costs.map((c, i) => ({ id: c.id, hotel: built.options[i]!.hotel, supplier: c.supplier, net: `${c.netAmount} ${c.currency}`, cost: c.costHalalas, autoSell: c.autoSell, sell: c.sell, margin: c.marginHalalas, overrideReason: c.overrideReason })) },
    });
    if (overridden.length) {
      await deskAudit(tx, actor, {
        action: "desk.quote.stay_price_override", entityType: "request", entityId: requestId, ref: shortRef(requestId),
        summary: overridden.map((c) => `${c.id}: ${sarText(c.autoSell)} → ${sarText(c.sell)} (${c.overrideReason})`).join("; "),
        data: { quoteId: q!.id, overrides: overridden.map((c) => ({ id: c.id, autoSell: c.autoSell, sell: c.sell, reason: c.overrideReason })) },
      });
    }
    return { r, q: q!, lead, total, name };
  });
  // In the traveller's Ask chat, with the card, and one push that opens it (after the commit, like plans/nudges.ts).
  const threadId = await askThreadFor(sent.r);
  const card: ChatCard = { type: "stay_quote", requestId, quoteId: sent.q.id, options: built.options, expiresAt: sent.q.expiresAt?.toISOString() ?? null };
  await appendLine(sent.r.ownerId, threadId, { who: "mada", text: sent.lead, kept: [card], at: new Date().toISOString() });
  const one = built.options.length === 1 ? built.options[0]! : null;
  await notify(sent.r.ownerId, {
    kind: "agent_reply", level: "active", copy: one ? "notify.stayQuote" : "notify.stayQuotes",
    vars: one ? { hotel: one.hotel, amount: formatSar(one.total) } : { count: String(built.options.length), city: built.options[0]!.city, amount: formatSar(sent.total) },
    href: `/ask/${threadId}`, data: { requestId, quoteId: sent.q.id, threadId },
  }).catch((e) => console.warn("[desk] hotel quote push failed", e instanceof Error ? e.message : e));
  if (sent.r.planItemId) {
    const { quoteReady } = await import("../plans/nudges");
    await quoteReady(requestId).catch(() => false);
  }
  return { quote: sent.q, threadId };
}

export const sendHotelQuote = (actor: DeskActor, requestId: string, input: HotelQuoteInput) => inRequestOwnerLocale(requestId, () => sendHotelQuoteHere(actor, requestId, input));

/* ───────────── paid: confirm on the portal ───────────── */

/** The room the traveller paid for, when the request's order is a stay priced by hand (null for anything else). */
export function handStayOf(order: { snapshot: unknown } | null | undefined): StayQuoteOptionT | null {
  const s = (order?.snapshot ?? null) as { quotedStay?: unknown } | null;
  const p = StayQuoteOption.safeParse(s?.quotedStay);
  return p.success ? p.data : null;
}

export const ConfirmHandStay = z.object({
  hotelRef: z.string().trim().min(3, "Enter the hotel's confirmation number").max(40, "Check the confirmation number").regex(/^[\w\-/. #]+$/, "Letters, numbers and - / . # only"),
  supplierRef: z.string().trim().max(60).nullish(),
});

/**
 * Paid, and booked on the portal by hand: the agent enters the hotel's confirmation (shown to the traveller on the
 * stay and its voucher) and the supplier's booking reference (desk and finance only). Captures the card and writes
 * the stay on the trip through the booking engine's own confirm (booking/desk.ts confirmOrder).
 */
async function confirmHandStayHere(actor: DeskActor, requestId: string, input: z.input<typeof ConfirmHandStay>) {
  assertCap(actor, "desk.issue");
  const v = ConfirmHandStay.safeParse(input);
  if (!v.success) throw new DeskError(v.error.issues[0]?.message ?? "Check the references");
  const o = await linkedOrder(requestId);
  if (!o || !handStayOf(o)) throw new DeskError("There's no paid hotel quote on this request", "NOT_FOUND");
  if (!["pending_agent", "held", "price_locked"].includes(o.status)) throw new DeskError(o.status === "confirmed" ? "Already confirmed" : "This booking isn't waiting to be confirmed", "CONFLICT");
  const name = await agentName(db, actor);
  const agent = { name, opsUserId: actor.id };
  if (o.status === "pending_agent") await engine(() => booking.acceptOrder(o.id, agent));
  if (o.status === "pending_agent" || o.status === "held") await engine(() => booking.lockPrice(o.id, agent));
  const hotelRef = v.data.hotelRef, supplierRef = v.data.supplierRef || null;
  await db.transaction(async (tx) => {
    await tx.update(appOrders).set({ supplierRef, snapshot: sql`${appOrders.snapshot} || ${JSON.stringify({ hotelRef })}::jsonb` }).where(eq(appOrders.id, o.id));
    await booking.orderEvent(tx, o.id, "hotel_confirmed", { kind: "agent", name }, { hotelRef });
  });
  const done = await engine(() => booking.issueTickets(o.id, agent));
  const ok = done.status === "confirmed";
  await db.transaction(async (tx) => {
    await deskAudit(tx, actor, {
      action: ok ? "desk.stay.confirmed_by_hand" : "desk.order.capture_failed", entityType: "request", entityId: requestId, ref: done.ref ?? shortRef(requestId, "O"),
      summary: ok ? `Confirmed the stay on the portal: hotel confirmation ${hotelRef}${supplierRef ? ` · supplier ${supplierRef}` : ""}` : `Payment capture didn't go through for ${done.ref ?? shortRef(requestId, "O")}. Stay not confirmed`,
      data: { orderId: o.id, hotelRef, supplierRef },
    }, { app: false });
  });
  return { ok, order: done };
}

export const confirmHandStay = (actor: DeskActor, requestId: string, input: z.input<typeof ConfirmHandStay>) => inRequestOwnerLocale(requestId, () => confirmHandStayHere(actor, requestId, input));

/** The quote's options with their desk-only costs, for the request page. */
export function handQuoteRows(snapshot: unknown): { option: StayQuoteOptionT; cost: HandStayCost | null }[] {
  const options = stayQuoteOf(snapshot) ?? [];
  const costs = handStayCostsOf(snapshot);
  return options.map((option) => ({ option, cost: costs.find((c) => c.id === option.id) ?? null }));
}
