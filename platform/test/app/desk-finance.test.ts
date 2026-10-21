import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { appPayments, appPeople, appRefunds, appUsers } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appSupplierBookings } from "@/db/app-schema-hotelbeds";
import { appOrderCosts, appReconRows } from "@/db/app-schema-finance";
import type { DeskActor } from "@/lib/app/desk/core";
import type { TicketingFlightSupplier } from "@/lib/app/suppliers/flight-ticketing";
import { approveRefund, rejectRefund } from "@/lib/app/desk/adapters";
import { cancelApproval, decide } from "@/lib/approvals";
import { computeSettlement } from "@/lib/finance";
import { dashboardData } from "@/lib/dashboard";
import type { CurrentUser } from "@/lib/auth";
import { costsJob, recordCosts, shareOut } from "@/lib/app/finance/costs";
import { postAppSale, postingJob } from "@/lib/app/finance/ops-posting";
import { markRefundSent, refundsSentJob, sendLeadApproved, startDeskRefund } from "@/lib/app/finance/refunds";
import { importSettlement, isoDay, readSettlement, sarToHalalas } from "@/lib/app/finance/recon";
import { periodOf, revenueReport, vatReport } from "@/lib/app/finance/revenue";
import { supplierBalances } from "@/lib/app/finance/balances";
import { seedFinance, settlementCsv, type FinanceSeed } from "@/lib/app/finance/seed-data";

/* App finance on the desk (DESK-PLAN U6): refunds after the decision, costs and margin, Ops posting, reconciliation. */

// The Hotelbeds adapter as the desk calls it; the mock supplier only cancels bookings it made itself, so the test
// stands in for it here (the supplier side is covered in hotelbeds.test.ts).
vi.mock("@/lib/app/suppliers/hotelbeds/bookings", async (orig) => {
  const real = await orig<typeof import("@/lib/app/suppliers/hotelbeds/bookings")>();
  return {
    ...real,
    cancelSupplierBooking: vi.fn(async (id: string, _actor: unknown, opts: { confirm: boolean }) => {
      const { db: d } = await import("@/db");
      const [row] = await d.select().from(appSupplierBookings).where(eq(appSupplierBookings.id, id));
      if (!opts.confirm) return { simulated: true, amount: 103.12, currency: "EUR", row };
      const [u] = await d.update(appSupplierBookings).set({ status: "cancelled", cancelFee: "103.12", cancelledAt: new Date() }).where(eq(appSupplierBookings.id, id)).returning();
      return { simulated: false, amount: 103.12, currency: "EUR", row: u };
    }),
  };
});

const H = (sar: number) => Math.round(sar * 100);

describe("finance helpers (pure)", () => {
  it("shares an amount in proportion, to the halala, adding up exactly", () => {
    expect(shareOut(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(shareOut(1001, [3, 7]).reduce((a, b) => a + b, 0)).toBe(1001);
    expect(shareOut(27913, [214000])).toEqual([27913]);
    expect(shareOut(0, [5, 5])).toEqual([0, 0]);
  });

  it("reads a MyFatoorah settlement file by column names, refunds by type or sign", () => {
    const lines = readSettlement('﻿Invoice Id,Transaction Type,Invoice Value,Service Charge,Deposit Date,Refund Reference\n"123",Payment,"1,250.50",28.14,18/10/2026,\n123,Refund,-200.00,0,2026-10-19 10:00:00,RF-9\n');
    expect(lines).toEqual([
      expect.objectContaining({ kind: "capture", providerRef: "123", amount: 125050, fee: 2814, settledOn: "2026-10-18", refundRef: null }),
      expect.objectContaining({ kind: "refund", providerRef: "123", amount: 20000, settledOn: "2026-10-19", refundRef: "RF-9" }),
    ]);
    expect(() => readSettlement("Name,Total\nx,1\n")).toThrow(/Invoice Id/);
    expect(sarToHalalas("SAR 99")).toBe(9900);
    expect(isoDay("2026-1-5")).toBeNull();
  });
});

/* ───────────── against the database ───────────── */

let seq = 0;
async function opsUser(name: string, perms: string[]): Promise<DeskActor & { team: string }> {
  seq += 1;
  const [role] = await db.insert(schema.roles).values({ key: `fin_test_${Date.now()}_${seq}`, name: `Finance ${seq}`, nameAr: "مالية", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name, email: `fin${Date.now()}${seq}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name, permissions: new Set(perms), team: "riyadh" };
}

async function traveller(name = "Reem Alotaibi") {
  const [u] = await db.insert(appUsers).values({ name, phone: `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` }).returning();
  const [p] = await db.insert(appPeople).values({ ownerId: u!.id, isSelf: true, givenNames: name.split(" ")[0]!, surname: name.split(" ")[1] ?? "", relation: "self", nationality: "SAU" }).returning();
  return { user: u!, person: p! };
}

/** A captured card payment on a confirmed order, through the mock gateway (a real mock reference, so refunds go through it). */
async function capturedOrder(userId: string, o: { amount: number; kind?: string; lines?: { key: string; icon: string; text: string; amount: number }[]; snapshot?: Record<string, unknown> }) {
  seq += 1;
  const key = `fin-test:${Date.now()}:${seq}`;
  const auth = await (await import("@/lib/app/booking/common")).bookingSuppliers.payments().authorize({ amount: o.amount, method: "card", token: "tok_visa", idempotencyKey: key, description: "test" } as never);
  const [p] = await db.insert(appPayments).values({ ownerId: userId, method: "card", status: "captured", amount: o.amount, label: "Visa ending 41", provider: "mock", providerRef: auth.providerRef, idempotencyKey: key }).returning();
  const lines = o.lines ?? [{ key: "flight", icon: "flight", text: "Riyadh to Cairo", amount: o.amount }];
  const [ord] = await db.insert(appOrders).values({ ownerId: userId, kind: o.kind ?? "trip", status: "confirmed", idempotencyKey: key, draft: {}, snapshot: o.snapshot ?? {}, lines, subtotal: o.amount, total: o.amount,
    paymentLabel: "Visa ending 41", paymentMethod: { method: "card" }, paymentId: p!.id, ref: `MT-T${seq}${Date.now().toString(36).slice(-4).toUpperCase()}`, confirmedAt: new Date() }).returning();
  return { payment: p!, order: ord! };
}

async function refundRow(paymentId: string, amount: number) {
  const [f] = await db.insert(appRefunds).values({ paymentId, amount, stage: "requested", destination: "original", reason: "Changed plans" }).returning();
  return f!;
}
const refundOf = async (id: string) => (await db.select().from(appRefunds).where(eq(appRefunds.id, id)))[0]!;

let lead: DeskActor, agent: DeskActor, viewer: DeskActor;
beforeAll(async () => {
  lead = await opsUser("Huda Lead", ["desk.view", "desk.act", "desk.refund", "desk.admin", "approvals.decide"]);
  agent = await opsUser("Omar Agent", ["desk.view", "desk.act", "desk.refund"]);
  viewer = await opsUser("Sami Viewer", ["desk.view", "desk.act"]);
});

describe("refunds: partial, limits, approved → sent", () => {
  it("a partial card refund is approved for less than asked, then moves to Sent when the provider confirms, and posts to Ops", async () => {
    const { user } = await traveller();
    const { payment } = await capturedOrder(user.id, { amount: H(1200) });
    const f = await refundRow(payment.id, H(400));
    const r = await approveRefund(agent, f.id, { destination: "original", amount: H(250) });
    expect(r.status).toBe("approved");
    let row = await refundOf(f.id);
    expect(row).toMatchObject({ stage: "approved", amount: H(250), requestedAmount: H(400), decidedBy: agent.id });
    expect(row.providerRef).toMatch(/_rf/);
    expect((await db.select().from(appPayments).where(eq(appPayments.id, payment.id)))[0]!.status).toBe("partially_refunded");

    const job = await refundsSentJob();
    expect(job.sent).toBeGreaterThanOrEqual(1);
    row = await refundOf(f.id);
    expect(row.stage).toBe("sent");
    expect(row.sentAt).toBeInstanceOf(Date);
    // Told once, and the job doesn't move it twice.
    const notes = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM app_notifications WHERE user_id = ${user.id} AND data->>'refundId' = ${f.id}`);
    expect(notes[0]!.n).toBe(1);
    await refundsSentJob();
    expect((await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM app_notifications WHERE user_id = ${user.id} AND data->>'refundId' = ${f.id}`))[0]!.n).toBe(1);

    // In Ops: the sale, lowered by the refund, and its payment lowered by what went back to the card.
    const [p] = await db.select().from(appPayments).where(eq(appPayments.id, payment.id));
    expect(p!.opsPaymentId).toBeTruthy();
    const [op] = await db.select().from(schema.payments).where(eq(schema.payments.id, p!.opsPaymentId!));
    const [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, op!.bookingId!));
    expect(b).toMatchObject({ channel: "app", status: "issued", sellPrice: H(950) });
    const pays = await db.select().from(schema.payments).where(eq(schema.payments.bookingId, b!.id));
    expect(pays.map((x) => x.amount)).toEqual([H(950)]);
    expect((await refundOf(f.id)).opsPaymentId).toBeTruthy();
  });

  it("a full card refund marks the Ops sale refunded, so its money leaves the bank balance and the settlement", async () => {
    const { user } = await traveller();
    const { payment } = await capturedOrder(user.id, { amount: H(500) });
    const f = await refundRow(payment.id, H(500));
    await approveRefund(agent, f.id, { destination: "original" });
    await refundsSentJob();
    const [p] = await db.select().from(appPayments).where(eq(appPayments.id, payment.id));
    expect(p!.status).toBe("refunded");
    const [op] = await db.select().from(schema.payments).where(eq(schema.payments.id, p!.opsPaymentId!));
    const [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, op!.bookingId!));
    expect(b).toMatchObject({ status: "refunded", sellPrice: H(500) });
  });

  it("a refund the provider still holds stays on its way; one it refuses goes back to the desk", async () => {
    const { user } = await traveller();
    const a = await capturedOrder(user.id, { amount: H(300) });
    const b = await capturedOrder(user.id, { amount: H(300) });
    const fa = await refundRow(a.payment.id, H(100));
    const fb = await refundRow(b.payment.id, H(100));
    await approveRefund(agent, fa.id, { destination: "original" });
    await approveRefund(agent, fb.id, { destination: "original" });
    await db.update(appRefunds).set({ providerRef: "mf_x_rf_pending" }).where(eq(appRefunds.id, fa.id));
    await db.update(appRefunds).set({ providerRef: "mf_x_rf_fail" }).where(eq(appRefunds.id, fb.id));
    await refundsSentJob();
    expect(await refundOf(fa.id)).toMatchObject({ stage: "approved", checks: 1 });
    const back = await refundOf(fb.id);
    expect(back.stage).toBe("requested");
    expect(back.note).toMatch(/failed/);
    expect((await db.select().from(appPayments).where(eq(appPayments.id, b.payment.id)))[0]!.status).toBe("captured");
  });

  it("refuses more than was asked or more than is left; Mada credit is Sent at once", async () => {
    const { user } = await traveller();
    const { payment } = await capturedOrder(user.id, { amount: H(200) });
    const f = await refundRow(payment.id, H(150));
    await expect(approveRefund(agent, f.id, { destination: "credit", amount: H(151) })).rejects.toThrow(/more than was asked/);
    expect((await approveRefund(agent, f.id, { destination: "credit" })).status).toBe("sent");
    const g = await refundRow(payment.id, H(100));
    await expect(approveRefund(agent, g.id, { destination: "credit" })).rejects.toThrow(/left to refund/);
    await expect(approveRefund(viewer, g.id, { destination: "credit" })).rejects.toThrow(/access/);
  });

  it("over the agent's limit it waits for a lead in Ops Approvals, then the job sends it on the lead's name", async () => {
    const { user } = await traveller();
    const { payment } = await capturedOrder(user.id, { amount: H(2000) });
    const f = await refundRow(payment.id, H(900));
    const r = await approveRefund(agent, f.id, { destination: "original", amount: H(800) });
    expect(r).toMatchObject({ status: "awaiting_lead", reason: "over_limit" });
    const pending = await refundOf(f.id);
    expect(pending.stage).toBe("awaiting_lead");
    const [req] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, pending.approvalId!));
    expect(req).toMatchObject({ kind: "app_refund", amount: H(800), approverPool: "permission:desk.admin", status: "pending" });
    // The agent can't approve their own request; the lead can.
    await expect(db.transaction((tx) => decide(tx, req!.id, agent.id, "approve", null))).rejects.toThrow();
    expect(await db.transaction((tx) => decide(tx, req!.id, lead.id, "approve", null))).toBe("approved");
    expect((await refundOf(f.id)).stage).toBe("lead_approved");
    const sent = await sendLeadApproved();
    expect(sent.sent).toBeGreaterThanOrEqual(1);
    expect(await refundOf(f.id)).toMatchObject({ stage: "approved", amount: H(800), requestedAmount: H(900), decidedBy: lead.id });
  });

  it("withdrawn (or declined by every lead) it goes back to To decide; a lead alone has no limit", async () => {
    const { user } = await traveller();
    const { payment } = await capturedOrder(user.id, { amount: H(3000) });
    const f = await refundRow(payment.id, H(700));
    const r = await approveRefund(agent, f.id, { destination: "credit" });
    expect(r.status).toBe("awaiting_lead");
    const { approvalId } = await refundOf(f.id);
    // A lead's no ends it when no other lead is left to approve; otherwise it waits for them, and the agent withdraws it.
    const outcome = await db.transaction((tx) => decide(tx, approvalId!, lead.id, "reject", "Offer a partial refund instead"));
    if (outcome === null) await db.transaction((tx) => cancelApproval(tx, approvalId!, agent.id));
    expect((await refundOf(f.id)).stage).toBe("requested");
    expect((await approveRefund(lead, f.id, { destination: "credit" })).status).toBe("sent");
  });

  it("counts what the agent approved today toward the daily limit", async () => {
    const solo = await opsUser("Daily Agent", ["desk.view", "desk.act", "desk.refund"]);
    const { user } = await traveller();
    const { payment } = await capturedOrder(user.id, { amount: H(5000) });
    for (let i = 0; i < 4; i++) expect((await approveRefund(solo, (await refundRow(payment.id, H(480))).id, { destination: "credit" })).status).toBe("sent");
    const fifth = await approveRefund(solo, (await refundRow(payment.id, H(100))).id, { destination: "credit" });
    expect(fifth).toMatchObject({ status: "awaiting_lead", reason: "over_daily" });
  });

  it("an instalment refund can be marked sent by hand, with the provider's reference, once", async () => {
    const { user } = await traveller();
    const { payment } = await capturedOrder(user.id, { amount: H(600) });
    const f = await refundRow(payment.id, H(100));
    await approveRefund(agent, f.id, { destination: "original" });
    await expect(markRefundSent(agent, f.id, "x")).rejects.toThrow(/reference/);
    await markRefundSent(agent, f.id, "TBY-REF-1");
    expect(await refundOf(f.id)).toMatchObject({ stage: "sent", providerRef: "TBY-REF-1" });
    await expect(markRefundSent(agent, f.id, "TBY-REF-1")).rejects.toThrow(/approved/);
    await expect(rejectRefund(agent, f.id, { reason: "Too late to change this one" })).rejects.toThrow(/decided/);
  });
});

describe("desk-started cancel and refund", () => {
  it("Hotelbeds: shows what the hotel keeps, cancels, and opens the refund for the rest", async () => {
    const { user } = await traveller();
    const { order, payment } = await capturedOrder(user.id, { amount: H(2140), kind: "stay", lines: [{ key: "stay", icon: "stay", text: "Taksim · 4 nights", amount: H(2140) }] });
    const [b] = await db.insert(appSupplierBookings).values({ supplier: "hotelbeds", product: "stay", sourceKind: "order", sourceId: order.id, ownerId: user.id, rateKey: "k", clientReference: "C1",
      status: "confirmed", supplierRef: "102-555", net: "412.50", currency: "EUR", sell: H(2140), environment: "test", mode: "mock" }).returning();
    const preview = await startDeskRefund(agent, { orderRef: order.ref!, cancel: `hotelbeds:${b!.id}`, reason: "", confirm: false });
    expect(preview).toMatchObject({ preview: true, fee: H(535) });
    expect(preview.refund).toBe(H(2140) - H(535));
    expect((await db.select().from(appSupplierBookings).where(eq(appSupplierBookings.id, b!.id)))[0]!.status).toBe("confirmed");
    const done = await startDeskRefund(agent, { orderRef: order.ref!, cancel: `hotelbeds:${b!.id}`, reason: "Hotel overbooked", confirm: true });
    expect(done.preview).toBe(false);
    if (done.preview) return;
    expect(await refundOf(done.refundId)).toMatchObject({ stage: "requested", origin: "desk", amount: H(1605), paymentId: payment.id });
    expect((await refundOf(done.refundId)).note).toMatch(/Cancelled on Hotelbeds 102-555/);
    expect((await db.select().from(appSupplierBookings).where(eq(appSupplierBookings.id, b!.id)))[0]!.status).toBe("cancelled");
  });

  it("TBO: asks the supplier for the refund and opens it for the amount the desk enters", async () => {
    const { user } = await traveller();
    const { order } = await capturedOrder(user.id, { amount: H(3480), snapshot: { flight: {}, flightSupplierId: "tbo.ob9", flightBooking: { supplier: "tbo", offerId: "tbo.ob9", traceId: "t", parts: [{ pnr: "K7Q2LM" }], state: "ticketed", note: null, at: "" } } });
    const cancel = vi.fn(async () => ({ released: false, changeRequestIds: [9911], note: "asked" }));
    const tbo = { name: "tbo", cancel } as unknown as TicketingFlightSupplier;
    // The TBO option shows only when TBO is the flight supplier running (mock flights here), so that check is stood in for.
    const booking = await import("@/lib/app/booking/supplier-flights");
    const spy = vi.spyOn(booking, "supplierFlightOf").mockReturnValue({ supplier: tbo, offerId: "tbo.ob9" });
    const preview = await startDeskRefund(agent, { orderRef: order.ref!, cancel: "tbo", reason: "", confirm: false }, { flightSupplier: tbo });
    expect(preview).toMatchObject({ preview: true, refund: H(3480) });
    expect(cancel).not.toHaveBeenCalled();
    const r2 = await startDeskRefund(agent, { orderRef: order.ref!, cancel: "tbo", amount: H(2900), reason: "Second leg dropped", confirm: true }, { flightSupplier: tbo });
    spy.mockRestore();
    expect(cancel).toHaveBeenCalledWith(expect.objectContaining({ offerId: "tbo.ob9" }), expect.stringMatching(/Second leg dropped/));
    if (r2.preview) throw new Error("expected a refund");
    expect(await refundOf(r2.refundId)).toMatchObject({ amount: H(2900), origin: "desk", stage: "requested" });
    expect((await refundOf(r2.refundId)).note).toMatch(/change request 9911/);
    // More than is left is refused before anything is asked of the supplier.
    await expect(startDeskRefund(agent, { orderRef: order.ref!, cancel: "none", amount: H(600), reason: "Too much now", confirm: true })).rejects.toThrow(/left to refund/);
  });
});

describe("costs, margin, Ops and reconciliation on the seeded week", () => {
  let seed: FinanceSeed;
  beforeAll(async () => {
    seed = await seedFinance(db, { tag: `t${Date.now().toString(36)}` });
    await costsJob();
  });

  it("writes one cost line per sold line, with the supplier's figure and the rate at capture", async () => {
    const lines = await db.select().from(appOrderCosts).innerJoin(appPayments, eq(appPayments.id, appOrderCosts.paymentId)).where(inArray(appPayments.ownerId, seed.userIds));
    const by = (label: RegExp) => lines.find((l) => label.test(l.app_order_costs.label))!.app_order_costs;
    expect(by(/Taksim/)).toMatchObject({ product: "stay", supplier: "hotelbeds", netAmount: "412.50", currency: "EUR", basis: "supplier", netSar: Math.round(412.5 * 4.15 * 100) });
    expect(by(/eSIM/)).toMatchObject({ product: "esim", currency: "USD", netAmount: "6.80", netSar: Math.round(6.8 * 3.75 * 100), basis: "supplier" });
    expect(by(/Istanbul/)).toMatchObject({ product: "flight", supplier: "tbo", basis: "estimated", supplierRef: "K7Q2LM" });
    expect(by(/visa/)).toMatchObject({ product: "request", basis: "missing", netSar: 0 });
    // VAT inside the invoice is shared over the package's two lines by amount and adds back up.
    const pkg = lines.filter((l) => /Tbilisi/.test(l.app_order_costs.label)).map((l) => l.app_order_costs);
    expect(pkg.reduce((a, l) => a + l.vat, 0)).toBe(H(423.91));
    // Recording again adds nothing.
    for (const l of lines) expect(await recordCosts(l.app_payments.id)).toBe(0);
  });

  it("margin per product is exactly the sum of its order lines", async () => {
    const p = periodOf({ from: "2020-01-01", to: "2099-12-31" });
    const r = await revenueReport(p);
    const all = await db.select().from(appOrderCosts);
    for (const k of ["flight", "stay", "esim", "request"] as const) {
      const mine = all.filter((l) => l.product === k);
      expect(r.products[k].margin).toBe(mine.reduce((a, l) => a + l.sell - l.vat - l.netSar, 0));
      expect(r.products[k].gross).toBe(mine.reduce((a, l) => a + l.sell, 0));
    }
    expect(r.total.margin).toBe(all.reduce((a, l) => a + l.sell - l.vat - l.netSar, 0));
    expect(r.rows.reduce((a, x) => a + x.margin, 0)).toBe(r.total.margin);
  });

  it("the settlement file of the seeded week matches 100% of its captures and settles the sent refund", async () => {
    await postingJob();
    const res = await importSettlement(lead.id, { fileName: "myfatoorah-settlement.csv", text: settlementCsv(seed) });
    expect(res.rows).toBe(seed.captures.length + seed.refunds.length);
    expect(res).toMatchObject({ matched: res.rows, mismatched: 0, missingOurs: 0, missingProvider: 0, amountMismatch: 0 });
    expect(res.fees).toBe(seed.captures.reduce((a, c) => a + c.fee, 0));
    const sent = await db.select().from(appRefunds).where(eq(appRefunds.providerRef, seed.refunds[0]!.refundRef));
    expect(sent[0]!.stage).toBe("settled");
    // Matched captures are cleared in Ops on the deposit day.
    const ops = await db.select({ cleared: schema.payments.clearedOn }).from(appPayments).innerJoin(schema.payments, eq(schema.payments.id, appPayments.opsPaymentId))
      .where(and(inArray(appPayments.ownerId, seed.userIds), eq(appPayments.provider, "mock")));
    expect(ops.length).toBe(seed.captures.length);
    expect(ops.every((o) => !!o.cleared)).toBe(true);
  });

  it("shows what doesn't match: a different amount, a line we don't have, a capture missing from the file", async () => {
    const [first, second, ...rest] = seed.captures;
    const csv = settlementCsv({ captures: [{ ...first!, amount: first!.amount + 100 }, { ref: "mf_unknown_1", amount: 5000, day: first!.day, fee: 10 }, ...rest], refunds: [] });
    void second;
    const res = await importSettlement(lead.id, { fileName: "bad.csv", text: csv });
    expect(res.amountMismatch).toBe(1);
    expect(res.missingOurs).toBe(1);
    expect(res.missingProvider).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(appReconRows).where(eq(appReconRows.importId, res.importId));
    expect(rows.find((r) => r.status === "missing_provider" && r.providerRef === second!.ref)).toBeTruthy();
  });

  it("posts each captured app sale to Ops once, under channel app, and shows it on the Ops dashboard", async () => {
    const pays = await db.select().from(appPayments).where(inArray(appPayments.ownerId, seed.userIds));
    const posted = pays.filter((p) => p.opsPaymentId);
    expect(posted.length).toBe(pays.length);
    expect(await postAppSale(posted[0]!.id)).toBe(posted[0]!.opsPaymentId);
    const again = await postingJob();
    expect(again.failed).toBe(0);
    const books = await db.select().from(schema.bookings).innerJoin(schema.payments, eq(schema.payments.bookingId, schema.bookings.id))
      .where(inArray(schema.payments.id, posted.map((p) => p.opsPaymentId!)));
    expect(books.every((b) => b.bookings.channel === "app" && b.bookings.status === "issued")).toBe(true);
    const stay = books.find((b) => /Taksim/.test(b.bookings.description ?? ""))!.bookings;
    expect(stay).toMatchObject({ serviceType: "hotel", supplier: "hotelbeds", supplierPaid: false });
    const esimSale = books.find((b) => /eSIM/.test(b.bookings.description ?? ""))!.bookings;
    expect(esimSale.supplierPaid).toBe(true);

    const director = await opsUser("Dashboard Partner", ["sales.view_all", "finance.view"]);
    const me: CurrentUser = { ...director, email: "p@x", locale: "en", partnerId: null, isDirector: false, mustChangePassword: false, role: { id: "r", key: "partner", name: "Partner", nameAr: "شريك" }, permissions: director.permissions as CurrentUser["permissions"] };
    const d = await dashboardData(me);
    const app = d.cycleBookings.filter((b) => b.channel === "app");
    expect(app.length).toBeGreaterThan(0);
    expect(app.some((b) => b.ref.startsWith("APP-"))).toBe(true);
  });

  it("keeps app sales out of the partner settlement until APP_SALES_IN_SETTLEMENT=yes", async () => {
    const from = "2020-01-01", to = "2099-12-31";
    const without = await db.transaction((tx) => computeSettlement(tx, from, to, {}, 0, 3000, 0));
    process.env.APP_SALES_IN_SETTLEMENT = "yes";
    try {
      const withApp = await db.transaction((tx) => computeSettlement(tx, from, to, {}, 0, 3000, 0));
      const appIds = (await db.select({ id: schema.bookings.id }).from(schema.bookings).where(eq(schema.bookings.channel, "app"))).map((b) => b.id);
      expect(without.bookingIds.some((id) => appIds.includes(id))).toBe(false);
      expect(withApp.bookingIds.some((id) => appIds.includes(id))).toBe(true);
      expect(withApp.revenue).toBeGreaterThan(without.revenue);
    } finally { delete process.env.APP_SALES_IN_SETTLEMENT; }
  });

  it("the VAT report sums the invoices by month and lists ZATCA refusals", async () => {
    const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric" }).format(new Date()));
    const v = await vatReport(year);
    expect(v.total.vat).toBeGreaterThanOrEqual(H(279.13) + H(6.39) + H(423.91) + H(123.91));
    expect(v.failures.some((f) => f.vat === H(6.39))).toBe(true);
    expect(v.months.reduce((a, m) => a + m.vat, 0)).toBe(v.total.vat);
  });

  it("supplier balances: the eSIM Access balance, and credit lines as set or 'not set'", async () => {
    const rows = await supplierBalances();
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.hotelbeds!.state).toBe("not_set");
    expect(by.hotelbeds!.used).toBeGreaterThan(0); // the seeded stays are still owed to Hotelbeds
    await db.insert(schema.settings).values({ key: "appHotelbedsCreditLine", value: H(50_000) }).onConflictDoUpdate({ target: schema.settings.key, set: { value: H(50_000) } });
    const after = Object.fromEntries((await supplierBalances()).map((r) => [r.key, r]));
    expect(after.hotelbeds).toMatchObject({ state: "ok", line: H(50_000), balance: H(50_000) - after.hotelbeds!.used! });
    expect(after.tbo!.state).toBe("not_set");
    expect(["esimaccess"]).toContain(after.esimaccess!.key);
  });
});
