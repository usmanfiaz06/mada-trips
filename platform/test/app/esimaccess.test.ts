import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { CreateOrderResponse, EsimPlansResponse, EsimResponse, EsimsResponse, PreviewResponse, ESIM_PRICING_DEFAULTS, EsimPricingRules, esimCostChanges, esimSellPrice, roundFriendly, usdSarOf, FX_FALLBACK, type OrderDraft } from "@mada/shared";
import { db } from "@/db";
import { appAudit, appNotifications, appPayments } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appEsimCatalogue, appEsims } from "@/db/app-schema-esim";
import { appRuntime } from "@/db/app-schema-resilience";
import { EA_WAIT, esimAccess, esimAccessWebhookAllowed, fromE4, packageFrom, resetEsimAccessCache, sign, usageFrom } from "@/lib/app/suppliers/live/esimaccess";
import { resetBreakers } from "@/lib/app/resilience/breaker";
import { mockEsimBalance, mockEsimCalls, resetMockEsim } from "@/lib/app/suppliers/mock/esim";
import { deskRetryEsim, fulfilEsimOrder } from "@/lib/app/esim/service";
import { editRules, pricingRules, savePricingRules } from "@/lib/app/esim/pricing";
import { esimJob, esimsNeedingDesk } from "@/lib/app/esim/ops";
import { catalogueStatus, syncCatalogue } from "@/lib/app/esim/catalogue";
import { deskInbox } from "@/lib/app/desk/inbox";
import { outbox } from "@/lib/app/suppliers";
import { GET as plansGet } from "@/app/api/app/v1/esim/plans/route";
import { GET as esimsGet } from "@/app/api/app/v1/esims/route";
import { GET as esimGet } from "@/app/api/app/v1/esims/[id]/route";
import { POST as eaHook } from "@/app/api/app/v1/esim/esimaccess/webhook/route";
import { POST as previewPost } from "@/app/api/app/v1/orders/preview/route";
import { POST as ordersPost } from "@/app/api/app/v1/orders/route";
import { GET as peopleGet } from "@/app/api/app/v1/people/route";
import { POST as cardsPost } from "@/app/api/app/v1/cards/route";
import { callP, signIn } from "./wallet-helpers";
import * as F from "./fixtures/esimaccess";

/* eSIM Access: signing, units, never buying twice, eSIMs that come a little later, its webhook, our balance running out after a traveller paid, and the owner's pricing rules. */

const KEYS = { ESIMACCESS_ACCESS_CODE: "access-test", ESIMACCESS_SECRET_KEY: "secret-test-0123456789" };
const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });

/** A stand-in for api.esimaccess.com, answering in its documented shapes. */
function fakeEsimAccess() {
  const s = {
    calls: [] as { path: string; body: Record<string, unknown>; headers: Record<string, string>; raw: string }[],
    orders: new Map<string, string>(), // transactionId → orderNo
    profiles: new Map<string, unknown[]>(), // orderNo → eSIMs
    allocating: 0, // esim/query answers 200010 this many times first
    low: false,
    bought: 0, // distinct purchases (a repeated transactionId is the same purchase)
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace("/api/v1/open/", "");
    const raw = String(init.body ?? "");
    const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
    s.calls.push({ path, body, headers: init.headers as Record<string, string>, raw });
    if (path === "package/list") return ok(body.locationCode === "TR" || body.locationCode === "" ? F.PACKAGES_TR : F.PACKAGES_EMPTY);
    if (path === "balance/query") return ok(F.BALANCE);
    if (path === "esim/order") {
      if (s.low) return ok(F.LOW_BALANCE);
      const tx = String(body.transactionId);
      let no = s.orders.get(tx);
      if (!no) {
        no = `B2610171605${String(s.orders.size).padStart(4, "0")}`;
        s.orders.set(tx, no);
        s.bought += 1;
        const count = Number((body.packageInfoList as { count: number }[])[0]!.count);
        s.profiles.set(no, Array.from({ length: count }, (_, i) => F.esimOf(i, tx, no!)));
      }
      return ok({ ...F.ORDER_OK, obj: { orderNo: no, transactionId: tx } });
    }
    if (path === "esim/query") {
      if (body.orderNo) {
        if (s.allocating > 0) { s.allocating -= 1; return ok(F.ALLOCATING); }
        return ok(F.query(s.profiles.get(String(body.orderNo)) ?? []));
      }
      const all = [...s.profiles.values()].flat() as { esimTranNo: string; iccid: string }[];
      if (body.esimTranNo) return ok(F.query(all.filter((e) => e.esimTranNo === body.esimTranNo).map((e) => ({ ...e, esimStatus: "IN_USE", smdpStatus: "ENABLED", orderUsage: 2 * F.GB }))));
      if (body.iccid) return ok(F.query(all.filter((e) => e.iccid === body.iccid)));
      return ok(F.query(all));
    }
    if (path === "esim/cancel") return ok({ success: true, errorCode: "0", errorMsg: null, obj: {} });
    return ok({ success: false, errorCode: "000104", errorMsg: "request json invalid", obj: null });
  }));
  return s;
}

describe("eSIM Access adapter", () => {
  beforeEach(() => { Object.assign(process.env, KEYS); resetEsimAccessCache(); EA_WAIT.totalMs = 50; EA_WAIT.everyMs = 5; });
  afterEach(() => { vi.unstubAllGlobals(); for (const k of Object.keys(KEYS)) delete process.env[k]; resetEsimAccessCache(); });

  it("signs exactly as documented: HMAC-SHA256 of timestamp + request id + access code + body, lowercase hex", () => {
    // The docs' own example.
    const h = sign('{"imsi":"326543826"}', "11111", "1111", 1628670421, "4ce9d9cdac9e4e17b3a2c66c358c1ce2");
    expect(h["RT-Signature"]).toBe("7eb765e27df5373dea2dbc8c41a7d9557743e46c8054750f3d851b3fd01d0835");
    expect(h).toMatchObject({ "RT-AccessCode": "11111", "RT-RequestID": "4ce9d9cdac9e4e17b3a2c66c358c1ce2", "RT-Timestamp": "1628670421" });
  });

  it("signs the body it sends, reads prices in USD × 10,000 and data in bytes, daily plans too", async () => {
    const fake = fakeEsimAccess();
    const list = await esimAccess.packages({ country: "TR" });
    const call = fake.calls[0]!;
    expect(call.path).toBe("package/list");
    const want = createHmac("sha256", KEYS.ESIMACCESS_SECRET_KEY).update(call.headers["RT-Timestamp"]! + call.headers["RT-RequestID"]! + KEYS.ESIMACCESS_ACCESS_CODE + call.raw).digest("hex");
    expect(call.headers["RT-Signature"]).toBe(want);
    expect(Math.abs(Number(call.headers["RT-Timestamp"]) - Date.now())).toBeLessThan(5000);
    expect(list.find((p) => p.id === "TR_1_7")).toMatchObject({ gb: 1, days: 7, netUsd: 0.9, retailUsd: 4.5, operator: "Turkcell", coverage: { kind: "local", code: "TR", countries: ["TR"] }, topup: true });
    expect(list.find((p) => p.id === "TR_1_Daily")).toMatchObject({ gb: 1, days: 1, netUsd: 1.6, daily: true });
    expect(fromE4(23000)).toBe(2.3);
    expect(packageFrom({ packageCode: "X", price: 10000, volume: F.GB / 2, duration: 7, location: "FR,DE,IT", locationCode: "EU-3" })).toMatchObject({ gb: 0.5, netUsd: 1, coverage: { kind: "regional", code: "EU-3" } });
    // Cached for an hour.
    await esimAccess.packages({ country: "TR" });
    expect(fake.calls.filter((c) => c.path === "package/list").length).toBe(1);
    expect(await esimAccess.balance!()).toEqual({ usd: 94 });
  });

  it("orders with our reference as the transactionId, waits for the profiles, and a retry never buys twice", async () => {
    const fake = fakeEsimAccess();
    fake.allocating = 2;
    const o = await esimAccess.order({ packageId: "TR_5_30", quantity: 2, description: "mada:o1" });
    expect(o.pending).toBe(false);
    expect(o.sims).toHaveLength(2);
    expect(o.sims[0]).toMatchObject({ iccid: "8943108170003131570", ref: "26101716050000", smdp: "rsp-eu.simlessly.com", lpa: "LPA:1$rsp-eu.simlessly.com$B1CA5A707D30488AA84D670AADD14410", apn: { value: "drei.at" } });
    expect(fake.calls.find((c) => c.path === "esim/order")!.body).toMatchObject({ transactionId: "mada:o1", packageInfoList: [{ packageCode: "TR_5_30", count: 2 }] });
    // The same transactionId again is the same purchase.
    await esimAccess.order({ packageId: "TR_5_30", quantity: 2, description: "mada:o1" });
    expect(fake.bought).toBe(1);
    // Found again by the order number, or by the transactionId among the last days' eSIMs.
    expect((await esimAccess.findOrder("mada:o1", o.id))?.sims).toHaveLength(2);
    expect((await esimAccess.findOrder("mada:o1"))?.id).toBe(o.id);
    expect(await esimAccess.findOrder("mada:nothing")).toBeNull();
    // Daily plans carry the number of days.
    await esimAccess.order({ packageId: "TR_1_Daily", quantity: 1, description: "mada:o2", days: 6 });
    expect(fake.calls.filter((c) => c.path === "esim/order").at(-1)!.body).toMatchObject({ packageInfoList: [{ packageCode: "TR_1_Daily", count: 1, periodNum: 6 }] });
  });

  it("leaves an order pending while the profiles are being made, and says low balance plainly", async () => {
    const fake = fakeEsimAccess();
    fake.allocating = 1000;
    const o = await esimAccess.order({ packageId: "TR_1_7", quantity: 1, description: "mada:o3" });
    expect(o).toMatchObject({ pending: true, sims: [] });
    fake.low = true;
    await expect(esimAccess.order({ packageId: "TR_1_7", quantity: 1, description: "mada:o4" })).rejects.toMatchObject({ supplierCode: "200007", lowBalance: true });
    expect(usageFrom({ totalVolume: 5 * F.GB, orderUsage: 2 * F.GB, esimStatus: "IN_USE", expiredTime: "2026-12-16T14:21:37+0000" })).toMatchObject({ totalMb: 5120, leftMb: 3072, state: "active", expiresAt: "2026-12-16T14:21:37.000Z" });
  });

  it("lets a webhook in by the secret in its URL, or else by eSIM Access's own addresses", () => {
    expect(esimAccessWebhookAllowed(null, "3.1.131.226")).toBe(true);
    expect(esimAccessWebhookAllowed(null, "203.0.113.9")).toBe(false);
    process.env.ESIMACCESS_WEBHOOK_SECRET = "hook-secret-0123456789";
    try {
      expect(esimAccessWebhookAllowed("hook-secret-0123456789", "203.0.113.9")).toBe(true);
      expect(esimAccessWebhookAllowed("wrong", "3.1.131.226")).toBe(false);
      expect(esimAccessWebhookAllowed(null, "3.1.131.226")).toBe(false);
    } finally { delete process.env.ESIMACCESS_WEBHOOK_SECRET; }
  });
});

/* ───────────── the owner's pricing rules ───────────── */

describe("eSIM pricing rules (desk)", () => {
  const tr = (netUsd: number, id = "TR_5_30", retailUsd: number | null = null) => ({ id, netUsd, retailUsd, coverage: { code: "TR" } });

  it("margin or minimum profit after the card fee, friendly rounding, never below the guard", () => {
    // $3.10 → SAR 11.63; 30% → 15.12; SAR 10 profit after 2.5% → 22.19 → the next 9: SAR 29.
    const b = esimSellPrice(tr(3.1), ESIM_PRICING_DEFAULTS, 3.75);
    expect(b).toMatchObject({ cost: 1163, sell: 2900, rule: "min_profit", fee: 73 });
    expect(b.margin).toBe(2900 - 1163 - 73);
    expect(b.margin).toBeGreaterThanOrEqual(1000);
    // A big plan: the margin wins.
    expect(esimSellPrice(tr(40), ESIM_PRICING_DEFAULTS, 3.75)).toMatchObject({ cost: 15000, sell: 19900, rule: "margin" });
    expect(roundFriendly(1512, "x9")).toBe(1900);
    expect(roundFriendly(1900, "x9")).toBe(1900);
    expect(roundFriendly(10_001, "x9")).toBe(10_900);
    expect(roundFriendly(1512, "whole")).toBe(1600);
    // Zero margin and profit: still never below cost plus the fee.
    const zero = EsimPricingRules.parse({ marginPct: 0, minProfitSar: 0, rounding: "none", paymentFeePct: 3, paymentFeeFixedSar: 1 });
    const g = esimSellPrice(tr(10), zero, 3.75);
    expect(g.sell - g.fee).toBeGreaterThanOrEqual(g.cost);
    expect(g.margin).toBeGreaterThanOrEqual(0);
    // A fixed price below cost is lifted to the guard.
    const fixed = EsimPricingRules.parse({ plans: { TR_5_30: { fixedSar: 5 } } });
    expect(esimSellPrice(tr(3.1), fixed, 3.75)).toMatchObject({ rule: "floor" });
    expect(esimSellPrice(tr(3.1), EsimPricingRules.parse({ plans: { TR_5_30: { fixedSar: 35 } } }), 3.75)).toMatchObject({ rule: "fixed", sell: 3500 });
    // Match suggested retail.
    expect(esimSellPrice(tr(3.1, "TR_5_30", 12), EsimPricingRules.parse({ matchRetail: true }), 3.75)).toMatchObject({ rule: "retail", sell: 4500, retail: 4500 });
    // A place's own rule beats the global one; a plan's beats the place's.
    const placed = EsimPricingRules.parse({ where: { TR: { marginPct: 100, minProfitSar: 0 } }, rounding: "none" });
    expect(esimSellPrice(tr(10), placed, 3.75).sell).toBe(7500);
    expect(esimSellPrice(tr(10), { ...placed, plans: { TR_5_30: { marginPct: 50, minProfitSar: null, fixedSar: null } } }, 3.75).sell).toBe(5625);
    expect(usdSarOf(FX_FALLBACK)).toBeCloseTo(3.75, 2);
    expect(esimCostChanges(new Map([["a", 1], ["b", 2], ["c", 3]]), [{ id: "a", netUsd: 1.2 }, { id: "b", netUsd: 1.5 }, { id: "d", netUsd: 1 }])).toEqual({ up: ["a"], down: ["b"], added: ["d"], gone: ["c"] });
  });

  it("desk edits: global, per place, per plan, hide and pick, saved with an audit line", async () => {
    let r = ESIM_PRICING_DEFAULTS;
    r = editRules(r, { kind: "global", fields: { marginPct: "35", minProfitSar: "12", paymentFeePct: "2.75", rounding: "whole", matchRetail: "on", holdMinutes: "45" } }).rules;
    expect(r).toMatchObject({ marginPct: 35, minProfitSar: 12, paymentFeePct: 2.75, rounding: "whole", matchRetail: true, holdMinutes: 45 });
    r = editRules(r, { kind: "place", code: "TR", marginPct: "50", minProfitSar: "" }).rules;
    expect(r.where.TR).toEqual({ marginPct: 50, minProfitSar: null, fixedSar: null });
    r = editRules(r, { kind: "place", code: "TR", marginPct: "", minProfitSar: "" }).rules;
    expect(r.where.TR).toBeUndefined();
    r = editRules(r, { kind: "plan", packageId: "TR_5_30", marginPct: "", minProfitSar: "", fixedSar: "39" }).rules;
    expect(r.plans.TR_5_30?.fixedSar).toBe(39);
    r = editRules(r, { kind: "hide", packageId: "TR_1_7", hidden: true }).rules;
    expect(r.hidden).toEqual(["TR_1_7"]);
    for (const id of ["a", "b", "c"]) r = editRules(r, { kind: "recommend", code: "TR", packageId: id, on: true }).rules;
    expect(() => editRules(r, { kind: "recommend", code: "TR", packageId: "d", on: true })).toThrow(/Three picks/);
    expect(() => editRules(r, { kind: "global", fields: { marginPct: "900" } })).toThrow();
    const saved = await savePricingRules(r, { name: "Faisal", opsUserId: "00000000-0000-4000-8000-000000000001" }, "test edit");
    expect(saved.updatedBy).toBe("Faisal");
    expect((await pricingRules()).recommended.TR).toEqual(["a", "b", "c"]);
    expect((await db.select().from(appAudit).where(eq(appAudit.action, "esim.pricing"))).some((a) => a.summary.includes("Faisal changed eSIM pricing"))).toBe(true);
    await db.delete(appRuntime).where(eq(appRuntime.key, "esim.pricing"));
  });
});

/* ───────────── through the Core API ───────────── */

const post = (h: Parameters<typeof callP>[0], token: string, body: unknown, query = "", params: Record<string, string> = {}) => callP(h, params, { method: "POST", token, body, query });
const get = (h: Parameters<typeof callP>[0], token: string, params: Record<string, string> = {}, query = "") => callP(h, params, { method: "GET", token, query });

async function traveller() {
  const { token } = await signIn();
  const me = ((await get(peopleGet, token)).json.people as { id: string; isSelf: boolean }[]).find((p) => p.isSelf)!.id;
  const card = await post(cardsPost, token, { token: "tok_mock_visa41", brand: "visa", last4: "4241", exp: "08/28", makeDefault: true });
  return { token, me, cardId: (card.json.cards as { id: string }[])[0]!.id };
}
async function pay(token: string, draft: OrderDraft, cardId: string) {
  const p = PreviewResponse.parse((await post(previewPost, token, { draft, useCredit: false })).json).preview;
  const r = await post(ordersPost, token, { draft, useCredit: false, payment: { method: "card", cardId }, plan: "full", expectedTotal: p.total.amount, idempotencyKey: `ea-${Math.random().toString(36).slice(2)}` });
  expect([200, 201], JSON.stringify(r.json)).toContain(r.status);
  return { preview: p, out: CreateOrderResponse.parse(r.json) };
}

describe("eSIM Access through the Core API", () => {
  const LIVE = { ...KEYS, SUPPLIER_MODE_ESIM: "esimaccess", ESIMACCESS_ALLOW_OUTSIDE_PRODUCTION: "yes" };
  beforeEach(() => { Object.assign(process.env, LIVE); resetEsimAccessCache(); resetBreakers(); EA_WAIT.totalMs = 50; EA_WAIT.everyMs = 5; });
  afterEach(() => { vi.unstubAllGlobals(); for (const k of Object.keys(LIVE)) delete process.env[k]; resetEsimAccessCache(); });

  it("prices by the rules, holds the price shown, buys once, and finishes an order the webhook says is ready", async () => {
    const fake = fakeEsimAccess();
    const f = await traveller();
    const plans = EsimPlansResponse.parse((await get(plansGet, f.token, {}, "?destination=istanbul&days=7")).json);
    expect(plans).toMatchObject({ outcome: "ok", supplier: "esimaccess", where: { code: "TR" } });
    const five = [...plans.plans, ...plans.more].find((p) => p.id === "TR_5_30")!;
    expect(five.price.amount).toBe(2900);
    expect(plans.more.some((p) => p.id === "TR_1_Daily" && p.daily && p.days === 7)).toBe(true);

    // The owner doubles the margin: what the traveller was just shown still stands for the hold window.
    await db.insert(appRuntime).values({ key: "esim.pricing", value: EsimPricingRules.parse({ marginPct: 200 }) }).onConflictDoUpdate({ target: appRuntime.key, set: { value: EsimPricingRules.parse({ marginPct: 200 }) } });
    fake.allocating = 1000; // the profiles take a while
    const { preview, out } = await pay(f.token, { kind: "esim", count: 1, packageId: "TR_5_30", where: "TR", travellerIds: [f.me] }, f.cardId);
    expect(preview.total.amount).toBe(2900);
    if (out.outcome !== "paid") throw new Error("not paid");
    expect(out.order.status).toBe("confirmed");
    expect(fake.bought).toBe(1);
    let rows = await db.select().from(appEsims).where(eq(appEsims.orderId, out.order.id));
    expect(rows[0]).toMatchObject({ status: "ordering", supplier: "esimaccess", iccid: null });
    expect(rows[0]!.supplierOrderId).toBeTruthy();

    // Their ORDER_STATUS webhook: looked up, not believed. A wrong key is refused outright.
    fake.allocating = 0;
    process.env.ESIMACCESS_WEBHOOK_SECRET = "hook-secret-0123456789";
    const body = JSON.stringify(F.hook("ORDER_STATUS", { orderNo: rows[0]!.supplierOrderId, orderStatus: "GOT_RESOURCE", transactionId: `mada:${out.order.id}` }, "n-1"));
    expect((await callP(eaHook, {}, { method: "POST", raw: body, query: "?key=wrong" })).status).toBe(401);
    expect((await callP(eaHook, {}, { method: "POST", raw: body, query: "?key=hook-secret-0123456789" })).status).toBe(200);
    // The same notice twice does nothing more.
    expect((await callP(eaHook, {}, { method: "POST", raw: body, query: "?key=hook-secret-0123456789" })).status).toBe(200);
    delete process.env.ESIMACCESS_WEBHOOK_SECRET;
    rows = await db.select().from(appEsims).where(eq(appEsims.orderId, out.order.id));
    expect(rows[0]).toMatchObject({ status: "ready", supplierRef: "26101716050000" });
    expect(rows[0]!.iccid).toMatch(/^8943/);

    // Never twice: our write lost, the desk orders again → found by the order number.
    await db.update(appEsims).set({ iccid: null, status: "stuck", install: null }).where(eq(appEsims.orderId, out.order.id));
    await deskRetryEsim(out.order.id, { name: "Faisal" });
    await fulfilEsimOrder(out.order.id);
    expect(fake.bought).toBe(1);
    expect(fake.calls.filter((c) => c.path === "esim/order").length).toBe(1);
    const e = EsimsResponse.parse((await get(esimsGet, f.token, {}, `?order=${out.order.id}`)).json).esims[0]!;
    expect(e).toMatchObject({ install: { smdp: "rsp-eu.simlessly.com" } });
    expect(["ready", "active"]).toContain(e.status);

    // ESIM_STATUS: on the phone now; usage is read back by its esimTranNo.
    const hook2 = JSON.stringify(F.hook("ESIM_STATUS", { iccid: e.iccid, esimTranNo: "26101716050000", esimStatus: "IN_USE", smdpStatus: "ENABLED" }));
    expect((await callP(eaHook, {}, { method: "POST", raw: hook2, headers: { "x-real-ip": "3.1.131.226" } })).status).toBe(200);
    const now = EsimResponse.parse((await get(esimGet, f.token, { id: e.id })).json).esim;
    expect(now.installedAt).toBeTruthy();
    expect(now.usage).toMatchObject({ totalMb: 5120, leftMb: 3072, state: "active" });
    await db.delete(appRuntime).where(eq(appRuntime.key, "esim.pricing"));
  });
});

describe("our supplier balance runs out after the traveller paid (mock supplier)", () => {
  beforeEach(() => resetMockEsim());

  it("promises a time, puts it on the desk, emails ops, orders again when the balance is back", async () => {
    process.env.APP_OPS_EMAIL = "ops@example.com";
    try {
      const f = await traveller();
      mockEsimBalance.usd = 0;
      const { out } = await pay(f.token, { kind: "esim", count: 1, packageId: "merhaba-30days-5gb", where: "TR", travellerIds: [f.me] }, f.cardId);
      if (out.outcome !== "paid") throw new Error("not paid");
      expect(out.order.status).toBe("confirmed");
      const e = EsimsResponse.parse((await get(esimsGet, f.token, {}, `?order=${out.order.id}`)).json).esims[0]!;
      expect(e.status).toBe("stuck");
      expect(Date.parse(e.readyBy!) - Date.now()).toBeGreaterThan(100 * 60_000);
      expect((await db.select().from(appNotifications).where(eq(appNotifications.userId, (await db.select().from(appOrders).where(eq(appOrders.id, out.order.id)))[0]!.ownerId))).some((n) => n.title === "Mada is on your eSIM")).toBe(true);
      expect((await esimsNeedingDesk()).some((x) => x.orderId === out.order.id && x.problem === "low_balance")).toBe(true);
      expect((await deskInbox(new Date())).items.some((i) => i.href === `/adminwork/desk/esims/${e.id}` && i.urgent)).toBe(true);
      expect(outbox.some((m) => m.channel === "email" && m.to === "ops@example.com" && m.body.startsWith("Urgent"))).toBe(true);

      // Still low: the job waits (the promise stands). Topped up: ordered again.
      await esimJob();
      expect((await db.select().from(appEsims).where(eq(appEsims.orderId, out.order.id)))[0]!.status).toBe("stuck");
      mockEsimBalance.usd = 500;
      const ran = await esimJob();
      expect(ran.delivered).toBe(1);
      expect((await db.select().from(appEsims).where(eq(appEsims.orderId, out.order.id)))[0]).toMatchObject({ status: "ready", dueAt: null });
      expect(mockEsimCalls.orders).toBe(1);

      // Another one past its promised time: the money goes back on its own.
      mockEsimBalance.usd = 0;
      const second = await pay(f.token, { kind: "esim", count: 1, packageId: "merhaba-7days-1gb", where: "TR", travellerIds: [f.me] }, f.cardId);
      if (second.out.outcome !== "paid") throw new Error("not paid");
      await db.update(appEsims).set({ dueAt: new Date(Date.now() - 60_000) }).where(eq(appEsims.orderId, second.out.order.id));
      expect((await esimJob()).refunded).toBe(1);
      const o = (await db.select().from(appOrders).where(eq(appOrders.id, second.out.order.id)))[0]!;
      expect(o.status).toBe("cancelled");
      expect((await db.select().from(appPayments).where(eq(appPayments.id, o.paymentId!)))[0]!.status).toBe("refunded");
    } finally { delete process.env.APP_OPS_EMAIL; mockEsimBalance.usd = 500; }
  });

  it("shows the owner's picks first, best value recommended, and never a hidden plan", async () => {
    const f = await traveller();
    const rules = EsimPricingRules.parse({ hidden: ["merhaba-30days-5gb"], recommended: { TR: ["merhaba-15days-3gb", "merhaba-30days-10gb"] } });
    await db.insert(appRuntime).values({ key: "esim.pricing", value: rules }).onConflictDoUpdate({ target: appRuntime.key, set: { value: rules } });
    try {
      const plans = EsimPlansResponse.parse((await get(plansGet, f.token, {}, "?destination=istanbul&days=7")).json);
      expect(plans.plans.map((p) => p.id)).toEqual(["merhaba-15days-3gb", "merhaba-30days-10gb"]);
      expect(plans.recommended).toBe("merhaba-30days-10gb");
      expect([...plans.plans, ...plans.more].some((p) => p.id === "merhaba-30days-5gb")).toBe(false);
      expect(plans.more.length).toBeGreaterThan(0);
      expect((await post(previewPost, f.token, { draft: { kind: "esim", count: 1, packageId: "merhaba-30days-5gb", where: "TR" } })).status).toBe(404);
    } finally { await db.delete(appRuntime).where(eq(appRuntime.key, "esim.pricing")); }
  });

  it("syncs the catalogue and says which plans cost more than yesterday", async () => {
    const first = await syncCatalogue();
    expect(first.total).toBeGreaterThan(10);
    await db.update(appEsimCatalogue).set({ costE4: 10_000 }).where(eq(appEsimCatalogue.packageId, "merhaba-7days-1gb"));
    const second = await syncCatalogue();
    expect(second.up).toEqual(["merhaba-7days-1gb"]);
    expect((await catalogueStatus()).up).toEqual(["merhaba-7days-1gb"]);
    const [row] = await db.select().from(appEsimCatalogue).where(eq(appEsimCatalogue.packageId, "merhaba-7days-1gb"));
    expect(row).toMatchObject({ costE4: 36_000, prevCostE4: 10_000 });
    expect(row!.retailE4).toBeGreaterThan(row!.costE4);
  });
});
