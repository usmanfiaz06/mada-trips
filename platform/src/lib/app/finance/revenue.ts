import "server-only";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { appInvoices, appPayments, appRefunds, appUsers } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appInvoiceDetails } from "@/db/app-schema-trips";
import { appOrderCosts } from "@/db/app-schema-finance";
import { addDays, riyadhDate } from "@/lib/dates";
import { PRODUCTS, type Product } from "./costs";

/*
 * App revenue and margin (DESK-PLAN U6, screen 8) and the VAT report. Everything here is a sum of app_order_costs
 * lines, so a product's margin is exactly the sum of its lines: gross (VAT inside) − VAT − supplier cost.
 */

export type Totals = { gross: number; vat: number; net: number; cost: number; margin: number; lines: number; missing: number };
const zero = (): Totals => ({ gross: 0, vat: 0, net: 0, cost: 0, margin: 0, lines: 0, missing: 0 });
export const marginBps = (t: Pick<Totals, "net" | "margin">) => (t.net > 0 ? Math.round((t.margin / t.net) * 10_000) : 0);

export type Period = { from: string; to: string; by: "day" | "month" };

/** The period from the URL: the last 30 days by day unless a range or month view is asked for. */
export function periodOf(sp: { from?: string; to?: string; by?: string }): Period {
  const iso = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const to = iso(sp.to) ?? riyadhDate();
  const by = sp.by === "month" ? "month" : "day";
  const from = iso(sp.from) ?? addDays(to, by === "month" ? -364 : -29);
  return from <= to ? { from, to, by } : { from: to, to: from, by };
}

const sums = {
  gross: sql<number>`coalesce(sum(${appOrderCosts.sell}),0)::bigint`.mapWith(Number),
  vat: sql<number>`coalesce(sum(${appOrderCosts.vat}),0)::bigint`.mapWith(Number),
  cost: sql<number>`coalesce(sum(${appOrderCosts.netSar}),0)::bigint`.mapWith(Number),
  lines: sql<number>`count(*)::int`,
  missing: sql<number>`count(*) FILTER (WHERE ${appOrderCosts.basis} = 'missing')::int`,
};
const totalsOf = (r: { gross: number; vat: number; cost: number; lines: number; missing: number }): Totals => {
  const net = r.gross - r.vat;
  return { gross: r.gross, vat: r.vat, net, cost: r.cost, margin: net - r.cost, lines: r.lines, missing: r.missing };
};

/** Revenue and margin over a period: overall, by product, and by day (or month) and product; refunds sent in it. */
export async function revenueReport(p: Period, opts: { product?: string } = {}) {
  const inPeriod = and(gte(appOrderCosts.businessDate, p.from), lte(appOrderCosts.businessDate, p.to), opts.product ? eq(appOrderCosts.product, opts.product) : undefined);
  const bucket = p.by === "month" ? sql<string>`to_char(${appOrderCosts.businessDate}, 'YYYY-MM')` : sql<string>`${appOrderCosts.businessDate}::text`;
  const [byProduct, byBucket, refunds] = await Promise.all([
    db.select({ product: appOrderCosts.product, ...sums }).from(appOrderCosts).where(inPeriod).groupBy(appOrderCosts.product),
    db.select({ bucket, product: appOrderCosts.product, ...sums }).from(appOrderCosts).where(inPeriod).groupBy(bucket, appOrderCosts.product).orderBy(desc(bucket)),
    db.select({ n: sql<number>`count(*)::int`, v: sql<number>`coalesce(sum(${appRefunds.amount}),0)::bigint`.mapWith(Number) }).from(appRefunds)
      .where(and(inArray(appRefunds.stage, ["approved", "sent", "settled"]), sql`(${appRefunds.decidedAt} AT TIME ZONE 'Asia/Riyadh')::date BETWEEN ${p.from}::date AND ${p.to}::date`)),
  ]);
  const products = Object.fromEntries(PRODUCTS.map((k) => [k, zero()])) as Record<Product, Totals>;
  for (const r of byProduct) products[(r.product as Product) in products ? (r.product as Product) : "other"] = totalsOf(r);
  const total = Object.values(products).reduce((a, t) => ({ gross: a.gross + t.gross, vat: a.vat + t.vat, net: a.net + t.net, cost: a.cost + t.cost, margin: a.margin + t.margin, lines: a.lines + t.lines, missing: a.missing + t.missing }), zero());
  const rows = byBucket.map((r) => ({ bucket: r.bucket, product: r.product as Product, ...totalsOf(r) }));
  return { total, products, rows, refunds: { count: refunds[0]?.n ?? 0, amount: refunds[0]?.v ?? 0 } };
}

/** The lines behind a number on the revenue page, 50 at a time: product, a day or month, a search, or only those without a cost. */
export async function costLines(p: Period, opts: { product?: string; bucket?: string; q?: string; missing?: boolean; limit?: number; offset?: number } = {}) {
  const q = opts.q?.trim();
  const bucketWhere = opts.bucket && /^\d{4}-\d{2}(-\d{2})?$/.test(opts.bucket)
    ? (opts.bucket.length === 7 ? sql`to_char(${appOrderCosts.businessDate}, 'YYYY-MM') = ${opts.bucket}` : eq(appOrderCosts.businessDate, opts.bucket)) : undefined;
  const where = and(gte(appOrderCosts.businessDate, p.from), lte(appOrderCosts.businessDate, p.to), opts.product ? eq(appOrderCosts.product, opts.product) : undefined, bucketWhere,
    opts.missing ? eq(appOrderCosts.basis, "missing") : undefined,
    q ? or(ilike(appOrderCosts.label, `%${q}%`), ilike(appOrders.ref, `%${q}%`), ilike(appUsers.name, `%${q}%`), ilike(appOrderCosts.supplierRef, `%${q}%`)) : undefined);
  const base = () => db.select({ c: appOrderCosts, ref: appOrders.ref, requestId: appOrders.requestId, owner: appUsers.name, ownerId: appUsers.id }).from(appOrderCosts)
    .innerJoin(appPayments, eq(appPayments.id, appOrderCosts.paymentId)).innerJoin(appUsers, eq(appUsers.id, appPayments.ownerId)).leftJoin(appOrders, eq(appOrders.id, appOrderCosts.orderId));
  const [rows, [n]] = await Promise.all([
    base().where(where).orderBy(desc(appOrderCosts.capturedAt), appOrderCosts.lineKey).limit(opts.limit ?? 50).offset(opts.offset ?? 0),
    db.select({ n: sql<number>`count(*)::int` }).from(appOrderCosts).innerJoin(appPayments, eq(appPayments.id, appOrderCosts.paymentId)).innerJoin(appUsers, eq(appUsers.id, appPayments.ownerId))
      .leftJoin(appOrders, eq(appOrders.id, appOrderCosts.orderId)).where(where),
  ]);
  return { rows: rows.map((r) => ({ ...r.c, ref: r.ref, requestId: r.requestId, owner: r.owner, ownerId: r.ownerId, margin: r.c.sell - r.c.vat - r.c.netSar })), total: n?.n ?? 0 };
}

/** The VAT report: output VAT by month from the app's invoices (credit notes take it back), and ZATCA reporting. */
export async function vatReport(year: number) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const day = sql`(${appInvoices.issuedAt} AT TIME ZONE 'Asia/Riyadh')::date`;
  const credit = sql<boolean>`coalesce(${appInvoiceDetails.kind} = 'credit_note', false)`;
  const rows = await db.select({
    month: sql<string>`to_char(${day}, 'YYYY-MM')`,
    invoices: sql<number>`count(*) FILTER (WHERE NOT ${credit})::int`,
    notes: sql<number>`count(*) FILTER (WHERE ${credit})::int`,
    gross: sql<number>`coalesce(sum(CASE WHEN ${credit} THEN -abs(${appInvoices.total}) ELSE ${appInvoices.total} END),0)::bigint`.mapWith(Number),
    vat: sql<number>`coalesce(sum(CASE WHEN ${credit} THEN -abs(${appInvoices.vat}) ELSE ${appInvoices.vat} END),0)::bigint`.mapWith(Number),
    failed: sql<number>`count(*) FILTER (WHERE ${appInvoices.zatcaStatus} IN ('failed','rejected','error'))::int`,
    pending: sql<number>`count(*) FILTER (WHERE ${appInvoices.zatcaStatus} = 'pending')::int`,
  }).from(appInvoices).leftJoin(appInvoiceDetails, eq(appInvoiceDetails.invoiceId, appInvoices.id))
    .where(and(sql`${day} BETWEEN ${from}::date AND ${to}::date`, sql`${appInvoices.zatcaStatus} <> 'not_required'`))
    .groupBy(sql`1`).orderBy(desc(sql`1`));
  const failures = await db.select({ id: appInvoices.id, number: appInvoices.number, total: appInvoices.total, vat: appInvoices.vat, issuedAt: appInvoices.issuedAt, status: appInvoices.zatcaStatus, owner: appUsers.name, ownerId: appUsers.id })
    .from(appInvoices).innerJoin(appUsers, eq(appUsers.id, appInvoices.ownerId)).where(and(inArray(appInvoices.zatcaStatus, ["failed", "rejected", "error"]), sql`${day} BETWEEN ${from}::date AND ${to}::date`))
    .orderBy(desc(appInvoices.issuedAt)).limit(50);
  const months = rows.map((r) => ({ ...r, net: r.gross - r.vat }));
  const total = months.reduce((a, m) => ({ gross: a.gross + m.gross, vat: a.vat + m.vat, net: a.net + m.net, invoices: a.invoices + m.invoices, notes: a.notes + m.notes, failed: a.failed + m.failed, pending: a.pending + m.pending }),
    { gross: 0, vat: 0, net: 0, invoices: 0, notes: 0, failed: 0, pending: 0 });
  return { months, total, failures };
}

/** This cycle's app sales for the Ops dashboard tile, straight from the cost lines (gross and margin). */
export async function appSalesBetween(from: string, to: string) {
  const [r] = await db.select(sums).from(appOrderCosts).where(and(gte(appOrderCosts.businessDate, from), lte(appOrderCosts.businessDate, to)));
  return totalsOf(r ?? { gross: 0, vat: 0, cost: 0, lines: 0, missing: 0 });
}
