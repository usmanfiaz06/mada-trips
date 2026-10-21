import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as app from "../../../db/app-schema";
import * as booking from "../../../db/app-schema-booking";
import * as esim from "../../../db/app-schema-esim";
import * as hb from "../../../db/app-schema-hotelbeds";

/*
 * App finance demo data (DESK-PLAN U6), shared by the tests and the local demo seed (seed-finance.ts): captured app
 * sales a few days back across products (a TBO flight, a Hotelbeds stay, an eSIM, a flight and stay, a desk-quoted visa
 * with no supplier cost yet, a Tabby payment), invoices with VAT, a partial card refund on its way and one already sent.
 * settlementCsv() writes the MyFatoorah settlement file those captures and refunds would appear in.
 * No "server-only" and no @/db: the script runs it with its own connection.
 */

const H = (sar: number) => Math.round(sar * 100);
export type FinanceSeed = { captures: { ref: string; amount: number; day: string; fee: number }[]; refunds: { invoice: string; refundRef: string; amount: number; day: string }[]; userIds: string[] };

const dayOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export async function seedFinance<T extends Record<string, unknown>>(db: PostgresJsDatabase<T>, opts: { now?: number; tag?: string } = {}): Promise<FinanceSeed> {
  const NOW = opts.now ?? Date.now();
  const tag = opts.tag ?? NOW.toString(36);
  const at = (days: number, hour = 11) => { const d = new Date(NOW - days * 86_400_000); d.setUTCHours(hour - 3, 10, 0, 0); return d; };
  const [noura, khalid] = await db.insert(app.appUsers).values([
    { name: "Noura Alharbi", phone: `+9665${String(NOW % 1e8).padStart(8, "0")}` },
    { name: "Khalid Alzahrani", phone: `+9665${String((NOW + 7) % 1e8).padStart(8, "0")}` },
  ]).returning();
  const seed: FinanceSeed = { captures: [], refunds: [], userIds: [noura!.id, khalid!.id] };
  let n = 0;

  const sale = async (o: { who: string; kind: string; days: number; method?: string; provider?: string; label?: string; lines: { key: string; icon: string; text: string; amount: number }[]; snapshot?: Record<string, unknown>; vat?: number; ref?: string; requestId?: string | null }) => {
    n += 1;
    const total = o.lines.reduce((a, l) => a + l.amount, 0);
    const method = o.method ?? "card";
    const provider = o.provider ?? (method === "tabby" ? "tabby" : "mock");
    const providerRef = `mf_seed_fin${String(n).padStart(2, "0")}_${tag}`;
    const when = at(o.days);
    const [p] = await db.insert(app.appPayments).values({ ownerId: o.who, requestId: o.requestId ?? null, method, status: "captured", amount: total, label: o.label ?? "Visa ending 41", instalments: method === "tabby" ? 4 : 1,
      provider, providerRef, idempotencyKey: `fin-seed:${tag}:${n}`, createdAt: when, updatedAt: when }).returning();
    const [ord] = await db.insert(booking.appOrders).values({
      ownerId: o.who, kind: o.kind, status: "confirmed", idempotencyKey: `fin-seed:${tag}:${n}`, draft: {}, snapshot: o.snapshot ?? {}, lines: o.lines, subtotal: total, total,
      paymentLabel: o.label ?? "Visa ending 41", paymentMethod: { method }, paymentId: p!.id, requestId: o.requestId ?? null, ref: o.ref ?? `MT-F${(700 + n).toString(36).toUpperCase()}${tag.slice(-2).toUpperCase()}`,
      confirmedAt: when, createdAt: when, updatedAt: when,
    }).returning();
    await db.insert(booking.appOrderEvents).values({ orderId: ord!.id, kind: "captured", actorKind: "agent", actorName: "Faisal", createdAt: when });
    if (o.vat) await db.insert(app.appInvoices).values({ ownerId: o.who, number: `INV-F${tag}-${n}`, paymentId: p!.id, total, vat: o.vat, issuedAt: when, zatcaStatus: n === 3 ? "failed" : "reported" });
    if (provider !== "tabby") seed.captures.push({ ref: providerRef, amount: total, day: dayOf(when), fee: Math.round(total * 0.0225) });
    return { p: p!, o: ord!, when };
  };

  // A TBO flight: cost from TBO's fare less our markup (estimated).
  const flight = await sale({ who: noura!.id, kind: "trip", days: 6, ref: `MT-TBO${tag.slice(-3).toUpperCase()}`, lines: [{ key: "flight", icon: "flight", text: "Riyadh to Istanbul, return · 2 adults", amount: H(3480) }],
    snapshot: { flightSupplierId: "tbo.ob1", flightBooking: { supplier: "tbo", offerId: "tbo.ob1", traceId: "t", parts: [{ pnr: "K7Q2LM" }] } } });
  // A Hotelbeds stay, net in EUR (VAT inside the sell price).
  const stay = await sale({ who: khalid!.id, kind: "stay", days: 5, lines: [{ key: "stay", icon: "stay", text: "Taksim City Rooms · 4 nights", amount: H(2140) }], vat: H(279.13) });
  await db.insert(hb.appSupplierBookings).values({ supplier: "hotelbeds", product: "stay", sourceKind: "order", sourceId: stay.o.id, ownerId: khalid!.id, rateKey: "seed", clientReference: `FIN${tag}`,
    status: "confirmed", supplierRef: `102-${tag.slice(-6)}`, net: "412.50", currency: "EUR", sell: H(2140), environment: "test", mode: "mock" });
  // An eSIM: the supplier's own net in USD.
  const sim = await sale({ who: noura!.id, kind: "esim", days: 4, label: "Mada ending 12", method: "mada", lines: [{ key: "esim", icon: "globe", text: "Türkiye eSIM · 10 GB · 15 days", amount: H(49) }], vat: H(6.39) });
  await db.insert(esim.appEsims).values({ ownerId: noura!.id, orderId: sim.o.id, idx: 0, supplier: "esimaccess", packageId: "TR-10GB-15", plan: { coverage: { name: "Türkiye" } }, netUsdCents: 680, status: "active", supplierOrderId: `B${tag}` });
  // Flights and a stay together: TBO for the flight, Hotelbeds for the room.
  const pkg = await sale({ who: khalid!.id, kind: "package", days: 4, label: "Apple Pay", method: "applepay", lines: [
    { key: "flight", icon: "flight", text: "Jeddah to Tbilisi, return", amount: H(2620) }, { key: "stay", icon: "stay", text: "Rooms Hotel Tbilisi · 5 nights", amount: H(3250) },
  ], snapshot: { flightSupplierId: "tbo.ob2", flightBooking: { supplier: "tbo", offerId: "tbo.ob2", traceId: "t", parts: [{ pnr: "TB8812" }] } }, vat: H(423.91) });
  await db.insert(hb.appSupplierBookings).values({ supplier: "hotelbeds", product: "stay", sourceKind: "order", sourceId: pkg.o.id, ownerId: khalid!.id, rateKey: "seed2", clientReference: `FIN2${tag}`,
    status: "confirmed", supplierRef: `102-${tag.slice(-5)}9`, net: "640.00", currency: "EUR", sell: H(3250), environment: "test", mode: "mock" });
  // A desk-quoted visa: no supplier cost known yet.
  await sale({ who: noura!.id, kind: "quote", days: 3, lines: [{ key: "visa", icon: "doc", text: "UK visit visa · appointment and forms", amount: H(950) }], vat: H(123.91) });
  // Tabby: not in MyFatoorah's settlement.
  await sale({ who: khalid!.id, kind: "trip", days: 3, method: "tabby", label: "Tabby", lines: [{ key: "flight", icon: "flight", text: "Riyadh to Dubai, one way", amount: H(780) }] });

  // A partial card refund on its way (the stay: SAR 600 of 2,140 asked back as 800), and a sent one on the flight.
  await db.insert(app.appRefunds).values({ paymentId: stay.p.id, amount: H(600), requestedAmount: H(800), stage: "approved", destination: "original", reason: "One night less: arrived a day late",
    providerRef: `${stay.p.providerRef}_rfpart`, expectedBy: new Date(NOW + 8 * 86_400_000), decidedAt: at(2), createdAt: at(2, 9), updatedAt: at(2) });
  await db.update(app.appPayments).set({ status: "partially_refunded" }).where(eq(app.appPayments.id, stay.p.id));
  const sentRef = `${flight.p.providerRef}_rf1`;
  await db.insert(app.appRefunds).values({ paymentId: flight.p.id, amount: H(450), requestedAmount: H(450), stage: "sent", destination: "original", reason: "Seat upgrade not given",
    providerRef: sentRef, decidedAt: at(5), sentAt: at(4), createdAt: at(5, 9), updatedAt: at(4) });
  await db.update(app.appPayments).set({ status: "partially_refunded" }).where(eq(app.appPayments.id, flight.p.id));
  seed.refunds.push({ invoice: flight.p.providerRef!, refundRef: sentRef, amount: H(450), day: dayOf(at(4)) });
  // One waiting for a decision, over an agent's SAR 500 limit.
  await db.insert(app.appRefunds).values({ paymentId: pkg.p.id, amount: H(1250), stage: "requested", destination: "original", reason: "Hotel closed the pool for works", createdAt: at(0, 8), updatedAt: at(0, 8) });
  return seed;
}

const csvCell = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const sar2 = (h: number) => (h / 100).toFixed(2);

/** The MyFatoorah settlement (deposit) report, as the portal exports it, for these captures and refunds. */
export function settlementCsv(s: Pick<FinanceSeed, "captures" | "refunds">): string {
  const head = ["Invoice Id", "Transaction Type", "Invoice Value", "Service Charge", "Deposited Amount", "Deposit Date", "Refund Reference"];
  const rows = [
    ...s.captures.map((c) => [c.ref, "Payment", sar2(c.amount), sar2(c.fee), sar2(c.amount - c.fee), c.day, ""]),
    ...s.refunds.map((r) => [r.invoice, "Refund", `-${sar2(r.amount)}`, "0.00", `-${sar2(r.amount)}`, r.day, r.refundRef]),
  ];
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
