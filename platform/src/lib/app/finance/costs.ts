import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { appInvoices, appPayments, appQuotes, appRequests } from "@/db/app-schema";
import { appOrderEvents, appOrders } from "@/db/app-schema-booking";
import { appEsims } from "@/db/app-schema-esim";
import { appSupplierBookings } from "@/db/app-schema-hotelbeds";
import { appTripCharges } from "@/db/app-schema-trips";
import { appOrderCosts } from "@/db/app-schema-finance";
import { fxRates } from "@/lib/app/suppliers/hotelbeds/money";
import { businessDate } from "@/lib/dates";
import { getSettings } from "@/lib/settings";

/*
 * What each sold line cost us (DESK-PLAN U6). Written once per captured app payment, by the finance job (and on demand
 * from the revenue page), one app_order_costs row per line, with the supplier's own figure, its currency and the rate to
 * SAR at that moment, so a rate that moves later never rewrites a margin already earned.
 *
 * Where the cost comes from, best first:
 *   eSIM        app_esims.net_usd_cents (the supplier's price for that eSIM), at the USD peg          basis supplier
 *   Hotelbeds   app_supplier_bookings net + currency for the order or request                         basis supplier
 *   TBO flight  no net on the offer: the line less TBO_AIR_MARKUP_BPS (what we added to their fare)   basis estimated
 *   anything else (a desk-quoted visa, a flight the desk bought elsewhere): no cost known yet          basis missing
 * Finance types a cost on a missing or estimated line from the revenue page (basis manual).
 *
 * VAT inside each line: the trip charge's own invoice lines when there are some, else the invoice's VAT shared by
 * amount, else none (the line had no invoice).
 */

export const CAPTURED = ["captured", "partially_refunded", "refunded"] as const;
export type Product = "flight" | "stay" | "esim" | "transfer" | "activity" | "request" | "other";
export const PRODUCTS: Product[] = ["flight", "stay", "esim", "transfer", "activity", "request", "other"];

const ICON_PRODUCT: Record<string, Product> = { flight: "flight", stay: "stay", globe: "esim", car: "transfer", star: "activity", doc: "request" };
const QUOTE_PRODUCT: Record<string, Product> = { flight: "flight", stay: "stay", pickup: "transfer", visa: "request", service: "request", other: "other" };
const ORDER_PRODUCT: Record<string, Product> = { trip: "flight", stay: "stay", package: "flight", esim: "esim", quote: "request", share: "other" };

/** SAR for one unit of a currency: the same table the app priced with (APP_FX_RATES over the defaults; USD is the peg). */
export function sarPerUnit(currency: string): number | null {
  const r = fxRates()[currency.toUpperCase()];
  return r && r > 0 ? r : null;
}

/** A supplier amount in halalas at a rate, rounded to the halala. */
export const toHalalas = (amount: number, rate: number) => Math.round(amount * rate * 100);

const tboMarkupBps = () => { const n = Number(process.env.TBO_AIR_MARKUP_BPS ?? 0); return Number.isFinite(n) && n >= 0 && n <= 5000 ? n : 0; };

/** Share `total` over `weights` in proportion, in whole halalas, the remainder on the largest so the parts add up exactly. */
export function shareOut(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, w) => a + Math.max(0, w), 0);
  if (sum <= 0 || total === 0) return weights.map(() => 0);
  const parts = weights.map((w) => Math.floor((total * Math.max(0, w)) / sum));
  const rest = total - parts.reduce((a, p) => a + p, 0);
  const big = weights.indexOf(Math.max(...weights));
  parts[big] = (parts[big] ?? 0) + rest;
  return parts;
}

export type CostLine = {
  lineKey: string; product: Product; label: string; sell: number; vat: number; supplier: string | null; supplierRef: string | null;
  netAmount: string; currency: string; fxRate: string; netSar: number; basis: "supplier" | "estimated" | "missing" | "manual";
};

type Pay = typeof appPayments.$inferSelect;
type Order = typeof appOrders.$inferSelect;

/** When a payment was captured: the order's "captured" event, else its confirmation, else the payment's own last change. */
async function capturedAt(q: Tx | typeof db, p: Pay, o: Order | null): Promise<Date> {
  if (o) {
    const [e] = await q.select({ at: appOrderEvents.createdAt }).from(appOrderEvents).where(and(eq(appOrderEvents.orderId, o.id), eq(appOrderEvents.kind, "captured"))).orderBy(asc(appOrderEvents.createdAt)).limit(1);
    if (e) return e.at;
    if (o.confirmedAt) return o.confirmedAt;
  }
  return p.updatedAt ?? p.createdAt;
}

/** The lines of one captured payment and what each cost, worked out from what the database holds. Pure reads. */
export async function costLinesFor(q: Tx | typeof db, p: Pay): Promise<{ lines: CostLine[]; order: Order | null; at: Date }> {
  const [o] = await q.select().from(appOrders).where(eq(appOrders.paymentId, p.id)).orderBy(desc(appOrders.createdAt)).limit(1);
  const order = o ?? null;
  const at = await capturedAt(q, p, order);

  // The sold lines: the order's lines (discount shared over them), else the accepted quote's, else one line for it all.
  type Raw = { key: string; product: Product; label: string; amount: number };
  let raw: Raw[] = [];
  let sold = p.amount;
  if (order) {
    const pos = order.lines.filter((l) => l.amount > 0);
    raw = pos.map((l, i) => ({ key: `${l.key}:${i}`, product: ICON_PRODUCT[l.icon] ?? ORDER_PRODUCT[order.kind] ?? "other", label: l.text, amount: l.amount }));
    // What was sold is the lines less the discount (credit the traveller spent is money we already hold, so it counts).
    sold = Math.max(0, order.subtotal - order.discount + order.extra);
    if (order.extra > 0 && raw.length) raw[0]!.amount += order.extra;
  } else if (p.quoteId) {
    const [qt] = await q.select().from(appQuotes).where(eq(appQuotes.id, p.quoteId));
    const lines = (qt?.lines ?? []) as { label: string; amount: number; kind?: string }[];
    raw = lines.filter((l) => l.amount > 0).map((l, i) => ({ key: `${l.kind ?? "other"}:${i}`, product: QUOTE_PRODUCT[l.kind ?? "other"] ?? "other", label: l.label, amount: l.amount }));
    const neg = lines.filter((l) => l.amount < 0).reduce((a, l) => a + l.amount, 0);
    sold = Math.max(0, raw.reduce((a, l) => a + l.amount, 0) + neg);
  }
  if (!raw.length) {
    let product: Product = "other";
    if (p.requestId) {
      const [r] = await q.select({ kind: appRequests.kind }).from(appRequests).where(eq(appRequests.id, p.requestId));
      product = r ? (QUOTE_PRODUCT[r.kind] ?? (["visa", "umrah", "car", "restaurant", "activity", "general"].includes(r.kind) ? "request" : "other")) : "other";
    }
    raw = [{ key: "all:0", product, label: "Payment", amount: p.amount }];
    sold = p.amount;
  }
  const sells = shareOut(sold, raw.map((l) => l.amount));

  // VAT inside: the trip charge's invoice lines, else the invoice shared by amount.
  const charges = await q.select({ lines: appTripCharges.lines }).from(appTripCharges).where(eq(appTripCharges.paymentId, p.id));
  const chargeVat = charges.flatMap((c) => c.lines).reduce((a, l) => a + (l.vat ?? 0), 0);
  const [inv] = chargeVat ? [] : await q.select({ vat: appInvoices.vat }).from(appInvoices).where(eq(appInvoices.paymentId, p.id)).limit(1);
  const vats = shareOut(chargeVat || inv?.vat || 0, sells);

  // Supplier costs.
  const esims = order?.kind === "esim" || raw.some((l) => l.product === "esim")
    ? await q.select({ cents: appEsims.netUsdCents, supplier: appEsims.supplier, ref: appEsims.supplierOrderId, status: appEsims.status }).from(appEsims).where(eq(appEsims.orderId, order?.id ?? "00000000-0000-0000-0000-000000000000"))
    : [];
  const sources = [order?.id, p.requestId, order?.requestId].filter((x): x is string => !!x);
  const hb = sources.length ? await q.select().from(appSupplierBookings).where(and(inArray(appSupplierBookings.sourceId, sources), inArray(appSupplierBookings.status, ["confirmed", "cancelled"]))) : [];
  const snap = (order?.snapshot ?? {}) as { flightSupplierId?: string | null; flightBooking?: { parts?: { pnr?: string | null }[] } | null };
  const tbo = !!snap.flightSupplierId?.startsWith("tbo") || !!snap.flightBooking;

  const usd = sarPerUnit("USD") ?? 3.75;
  const lines: CostLine[] = raw.map((l, i) => {
    const sell = sells[i]!;
    const base = { lineKey: l.key, product: l.product, label: l.label.slice(0, 160), sell, vat: vats[i] ?? 0 };
    if (l.product === "esim" && esims.length) {
      const cents = esims.filter((e) => e.status !== "refunded").reduce((a, e) => a + e.cents, 0);
      return { ...base, supplier: esims[0]!.supplier, supplierRef: esims[0]!.ref, netAmount: (cents / 100).toFixed(2), currency: "USD", fxRate: String(usd), netSar: toHalalas(cents / 100, usd), basis: "supplier" };
    }
    const stay = hb.find((b) => (l.product === "stay" && b.product === "stay") || (l.product === "transfer" && b.product === "transfer"));
    if (stay && stay.net && stay.currency) {
      const rate = sarPerUnit(stay.currency);
      const net = Number(stay.net);
      if (rate && Number.isFinite(net)) return { ...base, supplier: "hotelbeds", supplierRef: stay.supplierRef, netAmount: net.toFixed(2), currency: stay.currency.toUpperCase(), fxRate: String(rate), netSar: toHalalas(net, rate), basis: "supplier" };
    }
    if (l.product === "flight" && tbo) {
      const net = Math.round((sell - (vats[i] ?? 0)) / (1 + tboMarkupBps() / 10_000));
      return { ...base, supplier: "tbo", supplierRef: snap.flightBooking?.parts?.[0]?.pnr ?? null, netAmount: (net / 100).toFixed(2), currency: "SAR", fxRate: "1", netSar: net, basis: "estimated" };
    }
    return { ...base, supplier: null, supplierRef: null, netAmount: "0", currency: "SAR", fxRate: "1", netSar: 0, basis: "missing" };
  });
  return { lines, order, at };
}

/**
 * Write the cost lines of a captured payment, once. Lines already there are kept (a manual cost is never overwritten);
 * returns how many were added.
 */
export async function recordCosts(paymentId: string, opts: { closeHour?: number } = {}): Promise<number> {
  const [p] = await db.select().from(appPayments).where(eq(appPayments.id, paymentId));
  if (!p || !(CAPTURED as readonly string[]).includes(p.status)) return 0;
  const closeHour = opts.closeHour ?? (await getSettings()).closeHour;
  const { lines, order, at } = await costLinesFor(db, p);
  if (!lines.length) return 0;
  const day = businessDate(at, closeHour);
  const rows = await db.insert(appOrderCosts).values(lines.map((l) => ({
    paymentId: p.id, orderId: order?.id ?? null, requestId: p.requestId ?? order?.requestId ?? null, ...l, businessDate: day, capturedAt: at,
  }))).onConflictDoNothing({ target: [appOrderCosts.paymentId, appOrderCosts.lineKey] }).returning({ id: appOrderCosts.id });
  return rows.length;
}

/** Captured payments with no cost lines yet. */
export async function paymentsWithoutCosts(limit = 200) {
  return db.select({ id: appPayments.id }).from(appPayments)
    .leftJoin(appOrderCosts, eq(appOrderCosts.paymentId, appPayments.id))
    .where(and(inArray(appPayments.status, [...CAPTURED]), isNull(appOrderCosts.id)))
    .groupBy(appPayments.id).orderBy(asc(appPayments.createdAt)).limit(limit);
}

/** The finance job's first step: cost lines for every captured payment that has none. */
export async function costsJob(): Promise<{ costed: number; lines: number }> {
  const { closeHour } = await getSettings();
  const todo = await paymentsWithoutCosts();
  let lines = 0;
  for (const p of todo) lines += await recordCosts(p.id, { closeHour });
  return { costed: todo.length, lines };
}

/** Finance types the supplier's cost for one line (the rate to SAR is today's, written with it). */
export async function setLineCost(actorId: string, id: string, v: { amount: number; currency: string }) {
  const cur = v.currency.trim().toUpperCase();
  const rate = sarPerUnit(cur);
  if (!rate) throw new Error(`No rate for ${cur}. Use SAR, or add it to APP_FX_RATES`);
  if (!Number.isFinite(v.amount) || v.amount < 0 || v.amount > 10_000_000) throw new Error("Enter the supplier's cost");
  const [row] = await db.update(appOrderCosts).set({ netAmount: v.amount.toFixed(2), currency: cur, fxRate: String(rate), netSar: toHalalas(v.amount, rate), basis: "manual", updatedBy: actorId })
    .where(eq(appOrderCosts.id, id)).returning();
  if (!row) throw new Error("Line not found");
  return row;
}

/** Lines still without a supplier cost. */
export async function missingCostCount(): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(appOrderCosts).where(eq(appOrderCosts.basis, "missing"));
  return r?.n ?? 0;
}
