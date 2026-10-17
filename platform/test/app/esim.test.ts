import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { CreateOrderResponse, EsimPlansResponse, EsimResponse, EsimsResponse, EsimTopupsResponse, PreviewResponse, esimPhoneFit, esimPrice, suggestEsimPlans, ESIM_FIXTURE_PACKAGES, type OrderDraft } from "@mada/shared";
import { db } from "@/db";
import { appNotifications, appPayments, appRefunds } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appEsims } from "@/db/app-schema-esim";
import { airaloEsim, airaloToken, packagesFrom, resetAiraloCache, simFrom, verifyAiraloSignature } from "@/lib/app/suppliers/live/airalo";
import { mockEsimCalls, resetMockEsim } from "@/lib/app/suppliers/mock/esim";
import { deskRefundEsim, deskRetryEsim, fulfilEsimOrder } from "@/lib/app/esim/service";
import { GET as plansGet } from "@/app/api/app/v1/esim/plans/route";
import { GET as esimsGet } from "@/app/api/app/v1/esims/route";
import { GET as esimGet } from "@/app/api/app/v1/esims/[id]/route";
import { GET as topupsGet } from "@/app/api/app/v1/esims/[id]/topups/route";
import { POST as installedPost } from "@/app/api/app/v1/esims/[id]/installed/route";
import { POST as webhookPost } from "@/app/api/app/v1/esim/airalo/webhook/route";
import { POST as previewPost } from "@/app/api/app/v1/orders/preview/route";
import { POST as ordersPost } from "@/app/api/app/v1/orders/route";
import { GET as peopleGet, POST as peoplePost } from "@/app/api/app/v1/people/route";
import { POST as cardsPost } from "@/app/api/app/v1/cards/route";
import { callP, signIn } from "./wallet-helpers";

/* eSIMs on Airalo: the live adapter against Airalo's documented shapes, then plans → pay → order after capture → install → usage → top-up, the refund when the supplier says no, and never buying twice. */

const ENV = { AIRALO_CLIENT_ID: "client-test", AIRALO_CLIENT_SECRET: "secret-test-0123456789" };

describe("Airalo live adapter", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let tokenCalls = 0;
  beforeEach(() => {
    Object.assign(process.env, ENV);
    resetAiraloCache();
    calls.length = 0;
    tokenCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const u = new URL(url);
      const ok = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
      if (u.pathname === "/v2/token") { tokenCalls += 1; await new Promise((r) => setTimeout(r, 20)); return ok({ data: { token_type: "Bearer", expires_in: 31622400, access_token: `tok-${tokenCalls}` }, meta: { message: "success" } }); }
      if (u.pathname === "/v2/packages") return ok({ data: [{ slug: "turkey", country_code: "TR", title: "Turkey", operators: [{ id: 1, title: "Merhaba", is_roaming: true, rechargeability: true, apn_type: "automatic", apn_value: null, countries: [{ country_code: "TR" }], packages: [{ id: "merhaba-7days-1gb", type: "sim", net_price: 3.6, price: 4.5, amount: 1024, day: 7, is_unlimited: false }, { id: "merhaba-30days-5gb", type: "sim", net_price: 10.4, amount: 5120, day: 30, is_unlimited: false }] }] }] });
      if (u.pathname === "/v2/orders" && init.method === "POST") return ok({ data: { id: 583747, code: "20250415-583747", package_id: "merhaba-7days-1gb", quantity: "2", description: "mada:o1", net_price: 7.2, sims: [
        { iccid: "8944465400003573253", lpa: "RSP-3088.IDEMIA.IO", matching_id: "YVTGM-5LZC6", qrcode: "LPA:1$RSP-3088.IDEMIA.IO$YVTGM-5LZC6", direct_apple_installation_url: "https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=LPA:1$RSP-3088.IDEMIA.IO$YVTGM-5LZC6", apn_type: "manual", apn_value: "globaldata", is_roaming: true, apn: { ios: { apn_type: "automatic", apn_value: "globaldata" }, android: { apn_type: "manual", apn_value: "globaldata" } } },
        { iccid: "8944465400003573254", lpa: "RSP-3088.IDEMIA.IO", matching_id: "ABCDE-12345", qrcode: "LPA:1$RSP-3088.IDEMIA.IO$ABCDE-12345", apn_type: "automatic", apn_value: null, is_roaming: true },
      ] }, meta: { message: "success" } });
      if (u.pathname === "/v2/orders") return ok({ data: [{ id: 1, description: "mada:o1-other", sims: [] }, { id: 2, description: "mada:o1", package_id: "merhaba-7days-1gb", sims: [{ iccid: "1", qrcode: "LPA:1$a.b$c" }] }] });
      if (u.pathname.endsWith("/usage")) return ok({ data: { remaining: 767, total: 2048, expired_at: "2026-10-30 09:00:00", is_unlimited: false, status: "ACTIVE" } });
      if (u.pathname === "/v2/orders/topups") return ok({ code: 23, reason: "Top-up disabled by the operator" }, 422);
      return ok({ data: [], meta: { message: "messages.resource_not_found" } }, 404);
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); for (const k of Object.keys(ENV)) delete process.env[k]; resetAiraloCache(); });

  it("asks for a token once, form-encoded, and shares it between calls in flight", async () => {
    const [a, b] = await Promise.all([airaloToken(), airaloToken()]);
    expect(a).toBe("tok-1");
    expect(b).toBe("tok-1");
    await airaloEsim.packages({ country: "TR" });
    await airaloEsim.usage("8944465400003573253");
    expect(tokenCalls).toBe(1);
    const tok = calls.find((c) => c.url.endsWith("/v2/token"))!;
    expect((tok.init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(String(tok.init.body)).toContain("grant_type=client_credentials");
    expect((calls.find((c) => c.url.includes("/usage"))!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
  });

  it("reads packages, caches them for an hour, and orders with our reference as the description", async () => {
    const list = await airaloEsim.packages({ country: "TR" });
    expect(list[0]).toMatchObject({ id: "merhaba-7days-1gb", gb: 1, days: 7, netUsd: 3.6, operator: "Merhaba", coverage: { kind: "local", code: "TR" } });
    await airaloEsim.packages({ country: "TR" });
    expect(calls.filter((c) => c.url.includes("/v2/packages")).length).toBe(1);
    const o = await airaloEsim.order({ packageId: "merhaba-7days-1gb", quantity: 2, description: "mada:o1" });
    const sent = calls.find((c) => c.url.endsWith("/v2/orders") && c.init.method === "POST")!.init.body as FormData;
    expect(sent.get("package_id")).toBe("merhaba-7days-1gb");
    expect(sent.get("quantity")).toBe("2");
    expect(sent.get("description")).toBe("mada:o1");
    expect(o.quantity).toBe(2);
    expect(o.sims[0]).toMatchObject({ iccid: "8944465400003573253", smdp: "RSP-3088.IDEMIA.IO", matchingId: "YVTGM-5LZC6", lpa: "LPA:1$RSP-3088.IDEMIA.IO$YVTGM-5LZC6", apn: { type: "manual", value: "globaldata" } });
    expect(o.sims[1]!.iosLink).toBe("https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=LPA:1$RSP-3088.IDEMIA.IO$ABCDE-12345");
    // The look-up before a retry matches the description exactly (Airalo's filter is a LIKE search).
    expect((await airaloEsim.findOrder("mada:o1"))?.id).toBe("2");
    expect(await airaloEsim.findOrder("mada:nothing")).toBeNull();
  });

  it("reads usage, says no plainly, and checks Airalo's signature", async () => {
    expect(await airaloEsim.usage("x")).toMatchObject({ leftMb: 767, totalMb: 2048, state: "active", expiresAt: "2026-10-30T09:00:00.000Z" });
    await expect(airaloEsim.topup({ iccid: "x", packageId: "p", description: "d" })).rejects.toMatchObject({ supplierCode: 23, retryable: false });
    const raw = JSON.stringify({ level: "90%", iccid: "1" });
    expect(verifyAiraloSignature(raw, createHmac("sha512", ENV.AIRALO_CLIENT_SECRET).update(raw).digest("hex"))).toBe(true);
    expect(verifyAiraloSignature(raw, "00")).toBe(false);
  });

  it("answers NOT_CONFIGURED without keys", async () => {
    for (const k of Object.keys(ENV)) delete process.env[k];
    await expect(airaloEsim.packages({ country: "TR" })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("reads Airalo's paged object shape, regions and the world", () => {
    const list = packagesFrom({ 0: { slug: "europe", country_code: null, title: "Europe", operators: [{ title: "Eurolink", countries: [{ country_code: "FR" }, { country_code: "DE" }], packages: [{ id: "eurolink-7days-1gb", amount: 1024, day: 7, net_price: 4 }] }] }, 1: { slug: "world", title: "Discover Global", operators: [{ title: "Discover", packages: [{ id: "discover-7days-1gb", amount: 1024, day: 7, net_price: 7.2, is_unlimited: false }] }] } });
    expect(list.map((p) => [p.coverage.kind, p.coverage.code])).toEqual([["regional", "europe"], ["global", "world"]]);
    expect(simFrom({ iccid: "1", lpa: "a.b", matching_id: "C" }).lpa).toBe("LPA:1$a.b$C");
  });
});

describe("the plan for a trip (shared rules)", () => {
  it("picks the country's own plans, a region or global, in 2–3 sizes that last the trip", () => {
    const tr = suggestEsimPlans(ESIM_FIXTURE_PACKAGES, { countries: ["TR"], days: 7 });
    expect(tr.coverage?.code).toBe("TR");
    expect(tr.plans.map((p) => [p.size, p.gb, p.days])).toEqual([["light", 3, 15], ["regular", 5, 30], ["heavy", 10, 30]]);
    expect(tr.recommended).toBe("merhaba-30days-5gb");
    expect(suggestEsimPlans(ESIM_FIXTURE_PACKAGES, { countries: ["FR", "DE"], days: 10 }).coverage?.code).toBe("europe");
    expect(suggestEsimPlans(ESIM_FIXTURE_PACKAGES, { countries: ["JP"], days: 5 }).coverage?.code).toBe("world");
    expect(suggestEsimPlans(ESIM_FIXTURE_PACKAGES, { countries: ["AQ"], days: 5 }).plans).toEqual([]);
    const long = suggestEsimPlans(ESIM_FIXTURE_PACKAGES, { countries: ["TR"], days: 45 });
    expect(long.plans.every((p) => !p.fits && p.days === 30)).toBe(true);
    expect(esimPrice(3.6)).toBe(1800); // 3.6 × 3.75 × 1.3 = 17.55 → SAR 18
    expect(esimPhoneFit("iPhone 15 Pro")).toBe("yes");
    expect(esimPhoneFit("iPhone 8")).toBe("no");
    expect(esimPhoneFit("Galaxy S23")).toBe("yes");
    expect(esimPhoneFit("Nokia 3310")).toBe("unsure");
  });
});

/* ───────────── through the Core API ───────────── */

const post = (h: Parameters<typeof callP>[0], token: string, body: unknown, query = "", params: Record<string, string> = {}) => callP(h, params, { method: "POST", token, body, query });
const get = (h: Parameters<typeof callP>[0], token: string, params: Record<string, string> = {}, query = "") => callP(h, params, { method: "GET", token, query });

async function traveller() {
  const { token } = await signIn();
  const hessa = (await post(peoplePost, token, { givenNames: "Hessa", surname: "Alharbi", relation: "spouse", dateOfBirth: "1988-07-24" })).json.person.id as string;
  const me = ((await get(peopleGet, token)).json.people as { id: string; isSelf: boolean }[]).find((p) => p.isSelf)!.id;
  const card = await post(cardsPost, token, { token: "tok_mock_visa41", brand: "visa", last4: "4241", exp: "08/28", makeDefault: true });
  const cardId = (card.json.cards as { id: string }[])[0]!.id;
  return { token, me, hessa, cardId };
}

async function pay(token: string, draft: OrderDraft, cardId: string, query = "") {
  const p = PreviewResponse.parse((await post(previewPost, token, { draft, useCredit: false })).json).preview;
  const body = { draft, useCredit: false, payment: { method: "card", cardId }, plan: "full", expectedTotal: p.total.amount, idempotencyKey: `es-${Math.random().toString(36).slice(2)}` };
  const r = await post(ordersPost, token, body, query);
  expect([200, 201], JSON.stringify(r.json)).toContain(r.status);
  const again = async () => CreateOrderResponse.parse((await post(ordersPost, token, body, query)).json);
  return { preview: p, out: CreateOrderResponse.parse(r.json), again };
}

describe("eSIMs through the Core API (mock supplier)", () => {
  beforeEach(() => resetMockEsim());

  it("suggests, sells, orders after capture, installs, reads what's left and tops up", async () => {
    const f = await traveller();
    const plans = EsimPlansResponse.parse((await get(plansGet, f.token, {}, "?destination=istanbul&days=7")).json);
    expect(plans).toMatchObject({ outcome: "ok", where: { code: "TR", kind: "local" }, recommended: "merhaba-30days-5gb", supplier: "mock" });
    expect(plans.plans).toHaveLength(3);
    expect(plans.people.map((p) => p.id).sort()).toEqual([f.me, f.hessa].sort());
    const plan = plans.plans.find((p) => p.id === plans.recommended)!;

    const { preview, out } = await pay(f.token, { kind: "esim", count: 2, packageId: plan.id, where: "TR", travellerIds: [f.me, f.hessa] }, f.cardId);
    expect(preview.total.amount).toBe(plan.price.amount * 2);
    expect(preview.lines[0]!.text).toContain("Türkiye");
    expect(out.outcome).toBe("paid");
    if (out.outcome !== "paid") return;
    expect(out.order.status).toBe("confirmed");
    const [pmt] = await db.select().from(appPayments).where(eq(appPayments.id, (await db.select().from(appOrders).where(eq(appOrders.id, out.order.id)))[0]!.paymentId!));
    expect(pmt!.status).toBe("captured");
    expect(mockEsimCalls.orders).toBe(1);

    const { esims } = EsimsResponse.parse((await get(esimsGet, f.token, {}, `?order=${out.order.id}`)).json);
    expect(esims).toHaveLength(2);
    expect(esims.map((e) => e.travellerId).sort()).toEqual([f.me, f.hessa].sort());
    const e = esims[0]!;
    expect(e).toMatchObject({ status: "ready", where: "Türkiye", plan: { gb: 5, days: 30 } });
    expect(e.install?.iosLink).toMatch(/^https:\/\/esimsetup\.apple\.com\/esim_qrcode_provisioning\?carddata=LPA:1\$/);
    expect(e.iccid).toMatch(/^89\d{18}$/);

    // Never twice: fulfilling the same order again (a retry, another server) buys nothing.
    await fulfilEsimOrder(out.order.id);
    // Even when our write was lost after the supplier sold it: the look-up by description finds it.
    await db.update(appEsims).set({ iccid: null, status: "ordering", problem: null, install: null }).where(eq(appEsims.orderId, out.order.id));
    await deskRetryEsim(out.order.id, { name: "Faisal" });
    expect(mockEsimCalls.orders).toBe(1);
    expect((await db.select().from(appEsims).where(eq(appEsims.orderId, out.order.id))).every((r) => !!r.iccid && r.status === "ready")).toBe(true);

    // Someone else can't see it.
    const other = await signIn();
    expect((await get(esimGet, other.token, { id: e.id })).status).toBe(404);

    const inst = EsimResponse.parse((await post(installedPost, f.token, {}, "", { id: e.id })).json).esim;
    expect(inst.installedAt).toBeTruthy();
    expect(inst.status).toBe("active");
    expect(inst.usage).toMatchObject({ totalMb: 5120, leftMb: 3174, state: "active" });

    const tops = EsimTopupsResponse.parse((await get(topupsGet, f.token, { id: e.id })).json);
    expect(tops.plans.length).toBeGreaterThan(0);
    const t1 = tops.plans[0]!;
    const top = await pay(f.token, { kind: "esim", count: 1, packageId: t1.id, topupOf: e.id }, f.cardId);
    expect(top.out.outcome).toBe("paid");
    expect(top.preview.title).toContain("More GB");
    expect(mockEsimCalls.topups).toBe(1);
    const after = EsimResponse.parse((await get(esimGet, f.token, { id: e.id })).json).esim;
    expect(after.topups).toHaveLength(1);
  });

  it("plans for a trip of the household, other places and nowhere", async () => {
    const f = await traveller();
    expect(EsimPlansResponse.parse((await get(plansGet, f.token, {}, "?countries=FR,DE&days=10")).json).where?.code).toBe("europe");
    expect(EsimPlansResponse.parse((await get(plansGet, f.token, {}, "?countries=JP&days=5")).json).where?.code).toBe("world");
    expect(EsimPlansResponse.parse((await get(plansGet, f.token, {}, "?countries=AQ")).json).outcome).toBe("none");
    // A price is always the server's: an unknown package can't be paid.
    expect((await post(previewPost, f.token, { draft: { kind: "esim", count: 1, packageId: "made-up-1gb", where: "TR" } })).status).toBe(404);
  });

  it("refunds at once, with the outcome, when the supplier can't give the eSIM", async () => {
    const f = await traveller();
    const { out, again } = await pay(f.token, { kind: "esim", count: 1, packageId: "merhaba-7days-1gb", where: "TR", travellerIds: [f.me] }, f.cardId, "?demo=esimFails");
    expect(out.outcome).toBe("paid");
    if (out.outcome !== "paid") return;
    expect(out.order.status).toBe("cancelled");
    // The same order sent again (a retry) answers the same, and buys and charges nothing more.
    const replay = await again();
    expect(replay).toMatchObject({ outcome: "paid", order: { id: out.order.id, status: "cancelled" } });
    expect(out.order.result).toMatchObject({ kind: "refused", money: { kind: "refund", amount: { amount: out.order.total.amount } }, next: ["talk"] });
    const { esims } = EsimsResponse.parse((await get(esimsGet, f.token, {}, `?order=${out.order.id}`)).json);
    expect(esims[0]).toMatchObject({ status: "refunded", iccid: null, result: { money: { kind: "refund" } } });
    const o = (await db.select().from(appOrders).where(eq(appOrders.id, out.order.id)))[0]!;
    expect((await db.select().from(appPayments).where(eq(appPayments.id, o.paymentId!)))[0]!.status).toBe("refunded");
    expect((await db.select().from(appRefunds).where(eq(appRefunds.paymentId, o.paymentId!)))[0]).toMatchObject({ stage: "approved", amount: o.total });
    expect((await db.select().from(appNotifications).where(eq(appNotifications.userId, o.ownerId))).some((n) => n.title.includes("refunded"))).toBe(true);
  });

  it("the desk refunds one eSIM of two, and Airalo's low-data notice reaches the traveller", async () => {
    const f = await traveller();
    const { out } = await pay(f.token, { kind: "esim", count: 2, packageId: "uki-mobile-30days-5gb", where: "GB", travellerIds: [f.me, f.hessa] }, f.cardId);
    if (out.outcome !== "paid") throw new Error("not paid");
    const { esims } = EsimsResponse.parse((await get(esimsGet, f.token, {}, `?order=${out.order.id}`)).json);
    await deskRefundEsim(esims[1]!.id, { name: "Faisal" }, "WRONG_PURCHASE");
    expect(mockEsimCalls.refunds).toBe(1);
    const now = EsimsResponse.parse((await get(esimsGet, f.token, {}, `?order=${out.order.id}`)).json).esims;
    expect(now.map((e) => e.status).sort()).toEqual(["ready", "refunded"]);
    const o = (await db.select().from(appOrders).where(eq(appOrders.id, out.order.id)))[0]!;
    expect(o.status).toBe("confirmed");
    expect((await db.select().from(appPayments).where(eq(appPayments.id, o.paymentId!)))[0]!.status).toBe("partially_refunded");

    const hook = await callP(webhookPost, {}, { method: "POST", raw: JSON.stringify({ level: "90%", package_name: "uki-mobile-30days-5gb", remaining_percentage: 10, iccid: esims[0]!.iccid }) });
    expect(hook.status).toBe(200);
    const notes = await db.select().from(appNotifications).where(eq(appNotifications.userId, o.ownerId));
    expect(notes.some((n) => n.body.includes("10% left"))).toBe(true);
  });
});
