import "server-only";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { appPayments, appPeople, appRefunds, appUsers } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appTrips } from "@/db/app-schema";
import { appOrderCosts } from "@/db/app-schema-finance";
import { nextRef } from "@/lib/refs";
import { businessDate } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { CAPTURED, recordCosts } from "./costs";

/*
 * Captured app sales in Ops finance (DESK-PLAN U6, §7 default 3). Each captured app payment becomes one Ops sale
 * (bookings, channel "app") and one Ops payment, written once (app_payments.ops_payment_id), so the dashboard and
 * the daily close show app money beside retail and corporate. A partial card refund lowers the sale and its payment
 * (what stays in the bank); a full refund marks the sale refunded; a refund to Mada credit only lowers the sale.
 *
 *   client       one Ops client "Mada app travellers" (contract ref mada-app); the traveller's name is on the sale
 *   prepared by  an inactive Ops user "Mada app" that can't sign in; commission 0
 *   status       issued (the desk already issued it in the app); not on credit; never via BSP
 *   sell         what was captured on the card (credit the traveller spent was money we already held)
 *   net          the sum of the payment's cost lines (app_order_costs); supplier paid when the supplier is prepaid
 *                (eSIM) or the cost isn't known yet, else it waits in Payables like any other supplier cost
 *   account      retail (MyFatoorah settles into the retail account); cleared when the settlement file matches it
 *
 * Partner settlement: app sales are left out until the owner says yes (APP_SALES_IN_SETTLEMENT=yes), lib/finance.ts.
 */

export const APP_CHANNEL = "app";
export const APP_CLIENT_REF = "mada-app";
const APP_USER_EMAIL = "app-sales@system.madatrips.invalid";
const PREPAID = new Set(["esimaccess", "airalo", "mock"]);

/** Whether app sales count toward the Day-25 partner settlement (DESK-PLAN §7 default 3: no, until the owner says so). */
export const appSalesInSettlement = () => (process.env.APP_SALES_IN_SETTLEMENT ?? "no").trim().toLowerCase() === "yes";

const SERVICE: Record<string, string> = { flight: "flight", stay: "hotel", transfer: "transport", activity: "event", esim: "other", request: "other", other: "other" };

/** The Ops client and user app sales are written under, made the first time. */
export async function appOpsParties(tx: Tx): Promise<{ clientId: string; userId: string }> {
  let [c] = await tx.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.contractRef, APP_CLIENT_REF)).limit(1);
  if (!c) [c] = await tx.insert(schema.clients).values({ name: "Mada app travellers", type: "retail", contractRef: APP_CLIENT_REF, notes: "Sales made in the Mada Trips app, posted automatically by the app desk." }).returning({ id: schema.clients.id });
  let [u] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, APP_USER_EMAIL)).limit(1);
  if (!u) {
    let [role] = await tx.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.key, "system_app")).limit(1);
    if (!role) [role] = await tx.insert(schema.roles).values({ key: "system_app", name: "Mada app (system)", nameAr: "تطبيق مادا (النظام)", description: "Posts app sales into Ops. Can't sign in.", permissions: [], isSystem: true }).returning({ id: schema.roles.id });
    [u] = await tx.insert(schema.users).values({ name: "Mada app", email: APP_USER_EMAIL, passwordHash: "!disabled", roleId: role!.id, team: "management", active: false }).returning({ id: schema.users.id });
  }
  return { clientId: c!.id, userId: u!.id };
}

const opsMethod = (m: string) => (m === "mada" ? "mada" : "card");

/** Post one captured app payment into Ops as a sale and a payment. Returns the Ops payment id (existing or new), or null when it isn't posted. */
export async function postAppSale(paymentId: string): Promise<string | null> {
  const [pre] = await db.select().from(appPayments).where(eq(appPayments.id, paymentId));
  if (!pre || !(CAPTURED as readonly string[]).includes(pre.status) || pre.amount <= 0 || pre.provider === "mada_credit") return null;
  if (pre.opsPaymentId) return pre.opsPaymentId;
  const s = await getSettings();
  await recordCosts(paymentId, { closeHour: s.closeHour });
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(appPayments).where(eq(appPayments.id, paymentId)).for("update");
    if (!p || p.opsPaymentId) return p?.opsPaymentId ?? null;
    const lines = await tx.select().from(appOrderCosts).where(eq(appOrderCosts.paymentId, p.id));
    const [o] = await tx.select().from(appOrders).where(eq(appOrders.paymentId, p.id)).limit(1);
    const [owner] = await tx.select({ name: appUsers.name }).from(appUsers).where(eq(appUsers.id, p.ownerId));
    const people = o?.travellerIds.length ? await tx.select({ g: appPeople.givenNames, s: appPeople.surname }).from(appPeople).where(inArray(appPeople.id, o.travellerIds)) : [];
    const [trip] = o?.tripId ? await tx.select({ start: appTrips.startDate }).from(appTrips).where(eq(appTrips.id, o.tripId)) : [];
    const { clientId, userId } = await appOpsParties(tx);

    const at = lines[0]?.capturedAt ?? p.updatedAt;
    const day = businessDate(at, s.closeHour);
    const products = [...new Set(lines.map((l) => l.product))];
    const serviceType = products.length > 1 && products.includes("flight") && products.includes("stay") ? "package" : SERVICE[products[0] ?? "other"] ?? "other";
    const soldTotal = lines.reduce((a, l) => a + l.sell, 0) || p.amount;
    // The sale is what the card paid; its net and VAT are the lines', in proportion when credit paid part of it.
    const share = (x: number) => (soldTotal > 0 ? Math.round((x * p.amount) / soldTotal) : 0);
    const net = lines.reduce((a, l) => a + l.netSar, 0);
    const vat = share(lines.reduce((a, l) => a + l.vat, 0));
    const suppliers = [...new Set(lines.map((l) => l.supplier).filter((x): x is string => !!x))];
    const paid = net === 0 || suppliers.every((x) => PREPAID.has(x));
    const names = people.map((x) => `${x.g} ${x.s}`.trim()).filter(Boolean);
    const passengers = (names.length ? names.join(", ") : owner?.name ?? "App traveller").slice(0, 300);

    const ref = await nextRef(tx, "APP");
    const [b] = await tx.insert(schema.bookings).values({
      ref, channel: APP_CHANNEL, account: "retail", serviceType, clientId, passengers, paxCount: Math.max(1, names.length),
      description: `${o?.ref ? `${o.ref} · ` : ""}${lines.map((l) => l.label).join(" + ").slice(0, 240) || "Mada app"}`,
      details: { app: { paymentId: p.id, orderId: o?.id ?? null, orderRef: o?.ref ?? null, refunds: [] } },
      supplier: suppliers.join(", ") || null, pnr: o?.supplierRef ?? null, travelDate: trip?.start ?? null,
      netCost: net, supplierPaid: paid, supplierReviewed: true, viaBsp: false, sellPrice: p.amount, vatAmount: vat, commissionBps: 0,
      status: "issued", onCredit: false, businessDate: day, preparedBy: userId, issuedBy: userId, issuedAt: at,
    }).returning({ id: schema.bookings.id });
    const [op] = await tx.insert(schema.payments).values({
      bookingId: b!.id, clientId, account: "retail", method: opsMethod(p.method), amount: p.amount, reference: p.providerRef ? `${p.provider}:${p.providerRef}`.slice(0, 120) : p.provider,
      collectedAt: at, businessDate: day, recordedBy: userId,
    }).returning({ id: schema.payments.id });
    await tx.update(appPayments).set({ opsPaymentId: op!.id }).where(eq(appPayments.id, p.id));
    await tx.insert(schema.auditEvents).values({ actorId: null, action: "app.sale.posted", entityType: "booking", entityId: b!.id, entityRef: ref,
      summary: `App sale ${o?.ref ?? ""} posted to Ops as ${ref}: SAR ${(p.amount / 100).toFixed(2)}`.replace("  ", " ") });
    return op!.id;
  });
}

/** Post a sent (or settled) app refund against its Ops sale, once. */
export async function postAppRefund(refundId: string): Promise<boolean> {
  const [f] = await db.select().from(appRefunds).where(eq(appRefunds.id, refundId));
  if (!f || !["sent", "settled"].includes(f.stage)) return false;
  const opsPaymentId = await postAppSale(f.paymentId);
  if (!opsPaymentId) return false;
  return db.transaction(async (tx) => {
    const [op] = await tx.select().from(schema.payments).where(eq(schema.payments.id, opsPaymentId));
    if (!op?.bookingId) return false;
    const [b] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, op.bookingId)).for("update");
    if (!b) return false;
    const details = (b.details ?? {}) as { app?: { refunds?: string[] } & Record<string, unknown> };
    const done = details.app?.refunds ?? [];
    if (done.includes(refundId)) return false;
    // Ops keeps money positive and models a full refund by status (a refunded sale's payments leave the bank balance
    // and the settlement), so: a full refund marks the sale refunded; a part lowers the sale and, for a card refund,
    // the payment it came out of (what stays in the bank). A refund to credit lowers only the sale.
    const amount = Math.min(f.amount, b.sellPrice);
    const full = amount >= b.sellPrice;
    const sell = full ? b.sellPrice : b.sellPrice - amount;
    const vat = full || b.sellPrice <= 0 ? b.vatAmount : Math.round((b.vatAmount * sell) / b.sellPrice);
    const toCard = f.destination === "original";
    if (!full && toCard) await tx.update(schema.payments).set({ amount: Math.max(1, op.amount - amount) }).where(eq(schema.payments.id, op.id));
    await tx.update(schema.bookings).set({ sellPrice: sell, vatAmount: vat, status: full ? "refunded" : b.status, details: { ...details, app: { ...details.app, refunds: [...done, refundId] } }, updatedAt: new Date() }).where(eq(schema.bookings.id, b.id));
    if (toCard) await tx.update(appRefunds).set({ opsPaymentId: op.id }).where(eq(appRefunds.id, refundId));
    await tx.insert(schema.auditEvents).values({ actorId: null, action: "app.refund.posted", entityType: "booking", entityId: b.id, entityRef: b.ref,
      summary: `App refund of SAR ${(amount / 100).toFixed(2)} posted to ${b.ref}${full ? " (refunded in full)" : ""}${toCard ? "" : " (to Mada credit: no money left the bank)"}` });
    return true;
  });
}

/** The finance job's posting step: captured payments and finished refunds not in Ops yet. */
export async function postingJob(): Promise<{ sales: number; refunds: number; failed: number }> {
  const sales = await db.select({ id: appPayments.id }).from(appPayments)
    .where(and(inArray(appPayments.status, [...CAPTURED]), isNull(appPayments.opsPaymentId), ne(appPayments.provider, "mada_credit"), sql`${appPayments.amount} > 0`))
    .orderBy(asc(appPayments.createdAt)).limit(200);
  let posted = 0, refunds = 0, failed = 0;
  for (const p of sales) {
    try { if (await postAppSale(p.id)) posted += 1; } catch (e) { failed += 1; console.error("[finance] app sale not posted", p.id, e instanceof Error ? e.message : ""); }
  }
  // Refunds finished but not in Ops: card refunds have no Ops payment yet; credit ones are checked on the sale's own list.
  const open = await db.select({ id: appRefunds.id, dest: appRefunds.destination, ops: appRefunds.opsPaymentId }).from(appRefunds)
    .where(inArray(appRefunds.stage, ["sent", "settled"])).orderBy(asc(appRefunds.updatedAt)).limit(500);
  for (const f of open.filter((x) => !(x.dest === "original" && x.ops))) {
    try { if (await postAppRefund(f.id)) refunds += 1; } catch (e) { failed += 1; console.error("[finance] app refund not posted", f.id, e instanceof Error ? e.message : ""); }
  }
  return { sales: posted, refunds, failed };
}
