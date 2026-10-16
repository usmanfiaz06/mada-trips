import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { splitEven, statementText, t, type TripDetail, type TripMoney, type TripMoneyItem, type TripMoneyPending, type TripMoneySplit, type TripPayment } from "@mada/shared";
export { statementHtml } from "@mada/shared";
import { db } from "@/db";
import { appCircles, appMessages, appRequests, appQuotes } from "@/db/app-schema";
import { appOrders, appTripBookings } from "@/db/app-schema-booking";
import { appTripCharges } from "@/db/app-schema-trips";
import { appCircleSplitShares } from "@/db/app-schema-circles";
import { getBalance } from "../credit";
import { peopleByIds } from "../circles/common";
import { ensureCharges, listPayments } from "./money";

/*
 * The trip's Money screen (owner audit item 7): everything paid on the trip per traveller and in total, refunds,
 * what is priced but not paid yet (a booking a friend was asked to pay, a quote waiting for you), who actually paid,
 * splits in circles that belong to this trip, and a statement in words. Reads the same charges as Payments and
 * invoices (money.ts), so the two never disagree.
 */

const SAR = (amount: number) => ({ amount, currency: "SAR" as const });

/** Flights (and changes to them) are per person; a room, the pickups and extras are shared by everyone on the trip. */
export function divide(item: TripPayment["item"], amount: number, travellerIds: string[]): { personId: string; amount: number }[] {
  const ids = travellerIds.length ? travellerIds : [];
  if (!ids.length) return [];
  return splitEven(amount, ids.length).map((a, i) => ({ personId: ids[i]!, amount: a }));
}

export async function tripMoney(ownerId: string, trip: TripDetail, locale?: "en" | "ar"): Promise<TripMoney> {
  await ensureCharges(trip);
  const [payments, credit, bookings, chargeRows] = await Promise.all([
    listPayments(trip), getBalance(ownerId),
    db.select({ o: appOrders }).from(appTripBookings).innerJoin(appOrders, eq(appOrders.id, appTripBookings.orderId)).where(eq(appTripBookings.tripId, trip.id)),
    db.select({ id: appTripCharges.id, paymentId: appTripCharges.paymentId }).from(appTripCharges).where(eq(appTripCharges.tripId, trip.id)),
  ]);
  const orders = bookings.map((b) => b.o);
  const byPayment = new Map(orders.filter((o) => o.paymentId).map((o) => [o.paymentId!, o]));
  const paymentOfCharge = new Map(chargeRows.map((c) => [c.id, c.paymentId]));
  const travellerIds = trip.travellers.map((p) => p.id);
  const me = trip.travellers.find((p) => p.isSelf)?.id ?? null;

  const payerOf = (p: TripPayment): { name: string; mine: boolean } => {
    const pid = paymentOfCharge.get(p.id);
    const o = pid ? byPayment.get(pid) ?? null : null;
    const pr = (o?.snapshot as { payRequest?: { name: string; paidAt: string | null } } | undefined)?.payRequest;
    if (o && (o.paymentMethod as { method?: string }).method === "someone_else" && pr) return { name: pr.name, mine: false };
    if (p.method === "credit") return { name: t("pay.paidCredit", undefined, locale), mine: true };
    return { name: p.method === "tabby" ? "Tabby" : p.method === "tamara" ? "Tamara" : p.label ?? p.method, mine: true };
  };

  const items: TripMoneyItem[] = payments.map((p) => {
    const net = p.amount.amount - (p.refunded?.amount ?? 0);
    const payer = payerOf(p);
    return {
      id: p.id, item: p.item, title: p.title, amount: p.amount, refunded: p.refunded, paidAt: p.paidAt, paidBy: payer.name, invoiceId: p.invoiceId,
      perTraveller: divide(p.item, net, travellerIds).map((x) => ({ personId: x.personId, amount: SAR(x.amount) })),
    };
  });
  const paid = payments.reduce((a, p) => a + p.amount.amount, 0);
  const refunded = payments.reduce((a, p) => a + (p.refunded?.amount ?? 0), 0);

  const perPerson = new Map<string, number>(travellerIds.map((id) => [id, 0]));
  for (const it of items) for (const x of it.perTraveller) perPerson.set(x.personId, (perPerson.get(x.personId) ?? 0) + x.amount.amount);
  const travellers = trip.travellers.map((p) => ({ personId: p.id, name: p.isSelf ? t("money.you", undefined, locale) : p.firstName, isSelf: p.isSelf, amount: SAR(perPerson.get(p.id) ?? 0) }));

  const payerSums = new Map<string, { amount: number; mine: boolean }>();
  for (const p of payments) {
    const payer = payerOf(p);
    const net = p.amount.amount - (p.refunded?.amount ?? 0);
    const cur = payerSums.get(payer.name) ?? { amount: 0, mine: payer.mine };
    payerSums.set(payer.name, { amount: cur.amount + net, mine: payer.mine });
    if (p.creditUsed.amount > 0) {
      const k = t("pay.paidCredit", undefined, locale);
      const c = payerSums.get(k) ?? { amount: 0, mine: true };
      payerSums.set(k, { amount: c.amount + p.creditUsed.amount, mine: true });
    }
  }
  const payers = [...payerSums.entries()].map(([name, v]) => ({ name, amount: SAR(v.amount), mine: v.mine })).sort((a, b) => b.amount.amount - a.amount.amount);

  // Priced but not paid: a booking on this trip a friend was asked to pay, and quotes from the desk waiting for you.
  const pendingOrders = await db.select().from(appOrders).where(and(eq(appOrders.ownerId, ownerId), eq(appOrders.status, "payment_requested"), sql`${appOrders.draft}->>'tripId' = ${trip.id}`));
  const openQuotes = await db.select({ r: appRequests, q: appQuotes }).from(appRequests).innerJoin(appQuotes, eq(appQuotes.requestId, appRequests.id))
    .where(and(eq(appRequests.ownerId, ownerId), eq(appRequests.tripId, trip.id), inArray(appRequests.status, ["quoted", "awaiting_payment"]), eq(appQuotes.status, "open")));
  const pending: TripMoneyPending[] = [
    ...pendingOrders.map((o) => { const pr = (o.snapshot as { payRequest?: { name: string }; title?: string }); return { id: o.id, title: pr.title ?? "", amount: SAR(o.total), kind: "friend" as const, who: pr.payRequest?.name ?? null, since: o.createdAt.toISOString() }; }),
    ...openQuotes.map(({ r, q }) => ({ id: r.id, title: r.summary, amount: SAR(q.total), kind: "you" as const, who: null, since: r.updatedAt.toISOString() })),
  ];
  const pendingTotal = pending.reduce((a, p) => a + p.amount.amount, 0);

  // Splits in circles that belong to this trip: a booking's pay link (card.orderId), or a split tagged with the trip.
  const orderIds = [...orders.map((o) => o.id), ...pendingOrders.map((o) => o.id)];
  const splitRows = await db.select({ m: appMessages, circleName: appCircles.name }).from(appMessages).innerJoin(appCircles, eq(appCircles.id, appMessages.threadId))
    .where(and(eq(appMessages.threadKind, "circle"), sql`${appMessages.card}->>'t' = 'split'`, sql`(${appMessages.card}->>'tripId' = ${trip.id}${orderIds.length ? sql` OR ${appMessages.card}->>'orderId' IN (${sql.join(orderIds.map((id) => sql`${id}`), sql`, `)})` : sql``})`))
    .orderBy(desc(appMessages.createdAt)).limit(20);
  const shares = splitRows.length ? await db.select().from(appCircleSplitShares).where(inArray(appCircleSplitShares.messageId, splitRows.map((r) => r.m.id))) : [];
  const peopleIds = [...new Set(shares.flatMap((s) => s.userIds).concat(splitRows.map((r) => String((r.m.card as { paidBy?: string }).paidBy ?? ""))).filter(Boolean))];
  const people = peopleIds.length ? await peopleByIds(peopleIds) : new Map();
  const nameOf = (id: string) => (id === ownerId ? t("money.you", undefined, locale) : people.get(id)?.short ?? t("circles.someone", undefined, locale));
  const splits: TripMoneySplit[] = splitRows.map(({ m, circleName }) => {
    const c = m.card as { what?: string; total?: number; paidBy?: string; cancelled?: boolean };
    const sh = shares.filter((s) => s.messageId === m.id);
    return {
      circleId: m.threadId, circleName, messageId: m.id, what: String(c.what ?? m.body), total: SAR(Number(c.total ?? 0)), paidByName: nameOf(String(c.paidBy ?? "")),
      shares: sh.map((s) => ({ key: s.key, names: s.userIds.map(nameOf), amount: SAR(Number(s.amount)), paid: !!s.paidAt, mine: s.userIds.includes(ownerId) })),
      settled: sh.length > 0 && sh.every((s) => !!s.paidAt),
    };
  }).filter((s) => !(s.total.amount === 0));

  const total = paid - refunded;
  const generatedAt = new Date();
  const statement = statementText({ trip, items, travellers, payers, total, refunded, pending, generatedAt, locale });
  return { tripId: trip.id, city: trip.city, ref: trip.bookingRef ?? null, total: SAR(total), paid: SAR(paid), refunded: SAR(refunded), pendingTotal: SAR(pendingTotal), credit: SAR(credit), items, travellers, payers, pending, splits, statement, generatedAt: generatedAt.toISOString() };
}
