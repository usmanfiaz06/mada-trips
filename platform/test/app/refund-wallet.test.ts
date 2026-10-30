import { afterEach, describe, expect, it } from "vitest";
import { and, eq, sql as rawSql } from "drizzle-orm";
import { PaymentsResponse, RefundQuoteResponse, RefundResponse, SignInResponse, CreditResponse } from "@mada/shared";
import { db, schema } from "@/db";
import { appNotifications, appPayments, appRefunds } from "@/db/app-schema";
import { appDeskBlocks } from "@/db/app-schema-desk";
import { appRefundItems } from "@/db/app-schema-trips";
import { POST as otpStart } from "@/app/api/app/v1/auth/otp/start/route";
import { POST as otpVerify } from "@/app/api/app/v1/auth/otp/verify/route";
import { GET as paymentsGet } from "@/app/api/app/v1/trips/[id]/payments/route";
import { GET as quoteGet } from "@/app/api/app/v1/trips/[id]/refunds/quote/route";
import { POST as refundPost } from "@/app/api/app/v1/trips/[id]/refunds/route";
import { GET as refundGet } from "@/app/api/app/v1/refunds/[id]/route";
import { GET as creditGet } from "@/app/api/app/v1/credit/route";
import { approveRefund, getRefund } from "@/lib/app/desk/adapters";
import type { DeskActor } from "@/lib/app/desk/core";
import { markRefundSent, refundsSentJob } from "@/lib/app/finance/refunds";
import { seedDemoTrip } from "@/lib/app/trips/seed";
import { call, freshIp, newPhone, type Handler } from "./helpers";

/*
 * Refunds v2 (APP-FINANCE.md "Auto-approval" and "Mada Wallet"): the rules approve a clear refund at once (to the
 * Mada Wallet, credited now; to the card, straight to the provider), everything else waits at the desk; the tracker
 * carries the bank's reference; the traveller hears once per step.
 */

type P = Record<string, string>;
const withP = <T extends P>(h: (req: Request, ctx: { params: Promise<T> }) => Promise<Response>, params: T): Handler => (req) => h(req, { params: Promise.resolve(params) });
const key = () => `k-${Math.random().toString(36).slice(2, 12)}`;

async function signIn() {
  const phone = newPhone();
  const ip = freshIp();
  await call(otpStart, { body: { phone }, ip });
  const r = SignInResponse.parse((await call(otpVerify, { body: { phone, code: "123456" }, ip })).json);
  return { token: r.tokens.accessToken, userId: r.user.id };
}

/** A traveller with the Istanbul demo trip (early: the pickup and the stay are free to cancel, the flights carry a fee). */
async function withTrip() {
  const u = await signIn();
  const tripId = await seedDemoTrip(u.userId);
  const pays = PaymentsResponse.parse((await call(withP(paymentsGet, { id: tripId }), { method: "GET", token: u.token })).json).payments;
  return { ...u, tripId, pays, pickup: pays.find((p) => p.item === "pickup")!, flight: pays.find((p) => p.item === "flight")!, stay: pays.find((p) => p.item === "stay")! };
}

async function ask(t: Awaited<ReturnType<typeof withTrip>>, paymentId: string, destination: "credit" | "original") {
  const r = await call(withP(refundPost, { id: t.tripId }), { token: t.token, body: { paymentIds: [paymentId], reason: "plans", destination, clientKey: key() } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return RefundResponse.parse(r.json).refund;
}

const refundRows = (groupId: string) => db.select({ f: appRefunds }).from(appRefunds).innerJoin(appRefundItems, eq(appRefundItems.refundId, appRefunds.id)).where(eq(appRefundItems.groupId, groupId)).then((x) => x.map((r) => r.f));
const pushes = (userId: string) => db.select().from(appNotifications).where(and(eq(appNotifications.userId, userId), eq(appNotifications.kind, "refund_moved"))).orderBy(appNotifications.createdAt);
const copyOf = (n: { data: Record<string, unknown> | null }) => ((n.data as { copy?: { title?: [string] } } | null)?.copy?.title?.[0] ?? "").replace(/\.title$/, "");

let seq = 0;
async function desk(perms = ["desk.view", "desk.act", "desk.refund", "desk.admin", "desk.moderate"]): Promise<DeskActor> {
  seq += 1;
  const [role] = await db.insert(schema.roles).values({ key: `rf2_${Date.now()}_${seq}`, name: `Refunds ${seq}`, nameAr: "استرداد", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name: `Desk ${seq}`, email: `rf2${Date.now()}${seq}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name: `Desk ${seq}`, permissions: new Set(perms) };
}

afterEach(() => { delete process.env.APP_REFUND_AUTO_MAX; });

describe("auto-approval: the Mada Wallet", () => {
  it("credits a clear refund at once, with a line in the Wallet, an Auto audit and one push that opens the Wallet", async () => {
    const t = await withTrip();
    const quote = RefundQuoteResponse.parse((await call(withP(quoteGet, { id: t.tripId }), { method: "GET", token: t.token })).json);
    expect(quote.autoMax).toEqual({ amount: 500_00, currency: "SAR" });
    const r = await ask(t, t.pickup.id, "credit");
    expect(r).toMatchObject({ stage: "sent", destination: "credit", auto: true, amount: { amount: 440_00 } });
    const { credit } = CreditResponse.parse((await call(creditGet, { method: "GET", token: t.token })).json);
    expect(credit.balance.amount).toBe(440_00);
    expect(credit.entries).toEqual([expect.objectContaining({ amount: 440_00, kind: "refund", note: "Airport pickup both ways, Istanbul" })]);
    const [row] = await refundRows(r.id);
    expect(row).toMatchObject({ stage: "sent", destination: "credit", autoRule: "No fee under the rules, to Mada Wallet, SAR 440 within SAR 500, no open flag" });
    expect((await getRefund(row!.id))?.autoRule).toBe(row!.autoRule);
    const ops = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.entityId, row!.id), eq(schema.auditEvents.action, "desk.refund.auto_approved")));
    expect(ops).toHaveLength(1);
    expect(ops[0]!.summary).toContain("No fee under the rules");
    const app = await db.execute<{ data: { rule: string } }>(rawSql`SELECT data FROM app_audit WHERE action = 'refund.auto_approved' AND entity_id = ${r.id}`);
    expect(app[0]?.data.rule).toBe(row!.autoRule);
    const n = await pushes(t.userId);
    expect(n.map((x) => [copyOf(x), x.href])).toEqual([["notify.trip.credit", "/wallet?credit=1"]]);
    expect(n[0]!.title).toBe("In your Mada Wallet");
  });

  it("waits at the desk when it is over APP_REFUND_AUTO_MAX: one 'looking' push, then one 'in your wallet' when the desk approves", async () => {
    process.env.APP_REFUND_AUTO_MAX = "100";
    const t = await withTrip();
    const r = await ask(t, t.pickup.id, "credit");
    expect(r).toMatchObject({ stage: "requested", destination: "credit", auto: false });
    const { credit } = CreditResponse.parse((await call(creditGet, { method: "GET", token: t.token })).json);
    expect(credit.balance.amount).toBe(0);
    const [row] = await refundRows(r.id);
    expect(row).toMatchObject({ stage: "requested", autoRule: null });
    expect((await pushes(t.userId)).map(copyOf)).toEqual(["notify.refundLooking"]);
    await approveRefund(await desk(), row!.id, { destination: "credit" });
    const after = RefundResponse.parse((await call(withP(refundGet, { id: r.id }), { method: "GET", token: t.token })).json).refund;
    expect(after).toMatchObject({ stage: "sent", destination: "credit", auto: false });
    expect((await pushes(t.userId)).map(copyOf)).toEqual(["notify.refundLooking", "notify.trip.credit"]);
    expect(CreditResponse.parse((await call(creditGet, { method: "GET", token: t.token })).json).credit.balance.amount).toBe(440_00);
  });

  it("waits when the rules keep a fee (not clear), even under the limit", async () => {
    process.env.APP_REFUND_AUTO_MAX = "1000000";
    const t = await withTrip();
    const r = await ask(t, t.flight.id, "credit");
    expect(r).toMatchObject({ stage: "requested", auto: false });
    expect(r.amount.amount).toBeLessThan(t.flight.amount.amount);
  });

  it("waits when the account has an open abuse flag (an unlifted desk block), and goes again once it is lifted", async () => {
    const t = await withTrip();
    const lead = await desk();
    await db.insert(appDeskBlocks).values({ userId: t.userId, reason: "Selling visas in tips", blockedBy: lead.id });
    expect(await ask(t, t.pickup.id, "credit")).toMatchObject({ stage: "requested", auto: false });
    await db.update(appDeskBlocks).set({ liftedAt: new Date(), liftedBy: lead.id }).where(eq(appDeskBlocks.userId, t.userId));
    const t2 = await withTrip();
    expect(await ask(t2, t2.pickup.id, "credit")).toMatchObject({ stage: "sent", auto: true });
  });

  it("never auto-approves instalments: Tabby goes to a person", async () => {
    const t = await withTrip();
    expect(await ask(t, t.stay.id, "credit")).toMatchObject({ destination: "instalments", stage: "requested", auto: false });
  });
});

describe("auto-approval: back to the card", () => {
  it("goes straight to approved and the provider, then the tracker shows the bank's reference; one push per step", async () => {
    const t = await withTrip();
    // A reference the mock gateway answers for (the demo seed's own refs are not ones it issued).
    await db.update(appPayments).set({ providerRef: `mf_seed_rf2_${t.pickup.id.slice(0, 8)}` }).where(eq(appPayments.id, (await db.execute<{ payment_id: string }>(rawSql`SELECT payment_id FROM app_trip_charges WHERE id = ${t.pickup.id}`))[0]!.payment_id));
    const r = await ask(t, t.pickup.id, "original");
    expect(r).toMatchObject({ stage: "approved", destination: "original", auto: true, reference: null });
    const [row] = await refundRows(r.id);
    expect(row).toMatchObject({ stage: "approved", autoRule: expect.stringContaining("to the card") });
    expect(row!.providerRef).toBeTruthy();
    expect((await pushes(t.userId)).map(copyOf)).toEqual(["notify.refundApproved"]);
    // The desk marks it sent with the bank's reference (the ARN): it shows on the tracker and in the one "sent" push.
    await markRefundSent(await desk(), row!.id, "74382219004511870000001");
    const sent = RefundResponse.parse((await call(withP(refundGet, { id: r.id }), { method: "GET", token: t.token })).json).refund;
    expect(sent).toMatchObject({ stage: "sent", reference: "74382219004511870000001" });
    expect(sent.sentAt).toBeTruthy();
    expect((await getRefund(row!.id))?.bankReference).toBe("74382219004511870000001");
    const n = await pushes(t.userId);
    expect(n.map(copyOf)).toEqual(["notify.refundApproved", "notify.refundRef"]);
    expect(n[1]!.body).toContain("Reference 74382219004511870000001");
    // The finance job finds nothing more to send: no second "sent" push.
    await refundsSentJob();
    expect((await pushes(t.userId)).map(copyOf)).toEqual(["notify.refundApproved", "notify.refundRef"]);
  });

  it("goes back to the desk when the provider turns the card refund down", async () => {
    const t = await withTrip();
    // The demo seed's own references are unknown to the mock gateway: it refuses the refund.
    const r = await ask(t, t.pickup.id, "original");
    expect(r).toMatchObject({ stage: "requested", auto: false });
    const [row] = await refundRows(r.id);
    expect(row).toMatchObject({ stage: "requested", autoRule: null });
    expect(row!.note).toMatch(/didn't go through at the provider/);
    expect((await pushes(t.userId)).map(copyOf)).toEqual(["notify.refundLooking"]);
    const failed = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.entityId, row!.id), eq(schema.auditEvents.action, "desk.refund.auto_failed")));
    expect(failed).toHaveLength(1);
  });
});
