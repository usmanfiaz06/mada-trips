import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { handlePayLaterWebhook, instalmentPlan, payLater, payLaterOptions, type PayLaterCheckoutInput } from "@/lib/app/suppliers/pay-later";
import { MOCK_TABBY_WEBHOOK, MOCK_TAMARA_TOKEN, clearMockPayLater, mockPayLaterDecide } from "@/lib/app/suppliers/pay-later/mock";
import { tabbyCheckoutBody, tabbyPayment } from "@/lib/app/suppliers/pay-later/tabby";
import { tamaraCheckoutBody, tamaraOrder } from "@/lib/app/suppliers/pay-later/tamara";
import { POST as tabbyHook } from "@/app/api/app/v1/payments/tabby/webhook/route";
import { POST as tamaraHook } from "@/app/api/app/v1/payments/tamara/webhook/route";
import { resetBreakers } from "@/lib/app/resilience/breaker";

/* Tabby and Tamara (pay later): switches, instalment lines, the checkout → approve → capture → refund path, webhooks. */

const input = (over: Partial<PayLaterCheckoutInput> = {}): PayLaterCheckoutInput => ({
  reference: "order-pl-1", amount: 120_001, description: "Riyadh to Istanbul, 9–15 Mar",
  buyer: { firstName: "Sara", lastName: "Alharbi", email: "s@example.com", phone: "+966500000123" },
  items: [{ reference: "flight-1", title: "SV263 RUH→IST, 2 travellers", quantity: 1, unitPrice: 120_001, category: "flight" }],
  city: "Riyadh", urls: { success: "https://madatrips.sa/pay/ok", cancel: "https://madatrips.sa/pay/cancel", failure: "https://madatrips.sa/pay/fail" }, ...over,
});
const hook = (handler: (r: Request) => Promise<Response>, url: string, body: unknown, headers: Record<string, string>) =>
  handler(new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })).then(async (r) => ({ status: r.status, json: await r.json() as { ok?: boolean; status?: string; error?: { code: string } } }));
const tamaraJwt = (secret: string) => new SignJWT({ iss: "Tamara" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().sign(new TextEncoder().encode(secret));

afterEach(() => {
  for (const k of ["SUPPLIER_MODE_TABBY", "SUPPLIER_MODE_TAMARA", "TABBY_SECRET_KEY", "TABBY_MERCHANT_CODE", "TABBY_WEBHOOK_SECRET", "TAMARA_API_TOKEN", "TAMARA_NOTIFICATION_TOKEN", "VERCEL_ENV", "TAMARA_INSTALMENTS"]) delete process.env[k];
  vi.unstubAllGlobals();
  clearMockPayLater();
  resetBreakers();
});

describe("instalment line", () => {
  it("splits into equal monthly payments, the odd halalas first, month ends kept", () => {
    const p = instalmentPlan("tabby", 120_001, "2027-01-31");
    expect(p.schedule).toEqual([{ due: "2027-01-31", amount: 30_001 }, { due: "2027-02-28", amount: 30_000 }, { due: "2027-03-31", amount: 30_000 }, { due: "2027-04-30", amount: 30_000 }]);
    expect(p).toMatchObject({ count: 4, fee: 0, firstToday: true });
    process.env.TAMARA_INSTALMENTS = "3";
    expect(instalmentPlan("tamara", 90_000, "2027-01-10").schedule.map((s) => s.amount)).toEqual([30_000, 30_000, 30_000]);
  });
  it("offers each provider that's on, within its limits", () => {
    expect(payLaterOptions(120_000, "2027-01-10").map((p) => p.provider)).toEqual(["tabby", "tamara"]);
    expect(payLaterOptions(5_000, "2027-01-10")).toEqual([]);
    expect(payLaterOptions(900_000, "2027-01-10")).toEqual([]);
    process.env.VERCEL_ENV = "production";
    expect(payLater("tabby")).toBeNull();
    process.env.TABBY_SECRET_KEY = "sk"; process.env.TABBY_MERCHANT_CODE = "MADA";
    expect(payLater("tabby")?.name).toBe("tabby");
    expect(payLater("tamara")).toBeNull();
  });
});

describe("mock path", () => {
  it("Tabby: checkout, traveller approves, webhook, capture, partial and full refund", async () => {
    const t = payLater("tabby")!;
    const s = await t.createCheckout(input());
    expect(s).toMatchObject({ status: "created", checkoutUrl: expect.stringContaining("/tabby/") });
    expect((await t.createCheckout(input())).id).toBe(s.id);
    mockPayLaterDecide(s.id, true);
    const bad = await hook(tabbyHook, "http://localhost/api/app/v1/payments/tabby/webhook", { id: s.id }, { "x-mada-webhook": "wrong" });
    expect(bad.status).toBe(401);
    const ok = await hook(tabbyHook, "http://localhost/api/app/v1/payments/tabby/webhook", { id: s.id }, { "x-mada-webhook": MOCK_TABBY_WEBHOOK });
    expect(ok).toMatchObject({ status: 200, json: { ok: true, status: "authorized" } });
    expect((await t.capture(s.id, 120_001, "order-pl-1")).status).toBe("captured");
    expect((await t.refund(s.id, 20_001, "r1")).status).toBe("captured");
    expect(await t.refund(s.id, 100_000, "r2")).toMatchObject({ status: "refunded", refunded: 120_001 });
  });
  it("Tamara: the approved webhook authorises the order; cancel before capture", async () => {
    const t = payLater("tamara")!;
    const s = await t.createCheckout(input({ reference: "order-pl-2" }));
    mockPayLaterDecide(s.id, true);
    expect((await t.payment(s.id)).status).toBe("approved");
    const token = await tamaraJwt(MOCK_TAMARA_TOKEN);
    const ok = await hook(tamaraHook, `http://localhost/api/app/v1/payments/tamara/webhook?tamaraToken=${token}`, { order_id: s.id, order_status: "approved" }, {});
    expect(ok.json.status).toBe("authorized");
    const forged = await hook(tamaraHook, "http://localhost/api/app/v1/payments/tamara/webhook", { order_id: s.id }, { authorization: `Bearer ${await tamaraJwt("not-the-secret")}` });
    expect(forged.status).toBe(401);
    expect((await t.cancel(s.id)).status).toBe("cancelled");
  });
  it("rejects up front what the provider would", async () => {
    expect(await payLater("tabby")!.createCheckout(input({ buyer: { ...input().buyer, phone: "+966500000000" } }))).toMatchObject({ status: "rejected", checkoutUrl: null });
    await expect(handlePayLaterWebhook("tabby", "{}", new Headers({ "x-mada-webhook": MOCK_TABBY_WEBHOOK }), "http://x/")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("Tabby and Tamara wire formats", () => {
  it("Tabby checkout and payment", () => {
    const b = tabbyCheckoutBody(input(), "MADA");
    expect(b).toMatchObject({ merchant_code: "MADA", lang: "en", payment: { amount: "1200.01", currency: "SAR", order: { reference_id: "order-pl-1", items: [{ unit_price: "1200.01", category: "flight" }] } } });
    expect(tabbyPayment({ id: "p1", status: "AUTHORIZED", amount: "1200.01", order: { reference_id: "o" } })).toEqual({ provider: "tabby", id: "p1", reference: "o", status: "authorized", amount: 120_001, captured: 0, refunded: 0 });
    expect(tabbyPayment({ id: "p1", status: "CLOSED", amount: "10.00", captures: [{ amount: "10.00" }] }).status).toBe("captured");
    expect(tabbyPayment({ id: "p1", status: "CLOSED", amount: "10.00" }).status).toBe("cancelled");
    expect(tabbyPayment({ id: "p1", status: "CLOSED", amount: "10.00", captures: [{ amount: "10.00" }], refunds: [{ amount: "10.00" }] }).status).toBe("refunded");
  });
  it("Tamara checkout and order", () => {
    const b = tamaraCheckoutBody(input());
    expect(b).toMatchObject({ order_reference_id: "order-pl-1", total_amount: { amount: 1200.01, currency: "SAR" }, country_code: "SA", payment_type: "PAY_BY_INSTALMENTS", instalments: 4 });
    expect(tamaraOrder({ order_id: "t1", order_reference_id: "o", status: "fully_captured", total_amount: { amount: 100 }, captured_amount: { amount: 100 } })).toMatchObject({ status: "captured", captured: 10_000 });
  });
  it("live Tabby: checkout through fetch, then the webhook is read back from Tabby", async () => {
    process.env.TABBY_SECRET_KEY = "sk_test"; process.env.TABBY_MERCHANT_CODE = "MADA"; process.env.TABBY_WEBHOOK_SECRET = "whsec-123";
    const f = vi.fn(async (url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test");
      if (url.endsWith("/api/v2/checkout")) return new Response(JSON.stringify({ id: "s1", status: "created", payment: { id: "pay1" }, configuration: { available_products: { installments: [{ web_url: "https://checkout.tabby.ai/x" }] } } }), { status: 200 });
      return new Response(JSON.stringify({ id: "pay1", status: "AUTHORIZED", amount: "1200.01", order: { reference_id: "order-pl-1" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    expect(await payLater("tabby")!.createCheckout(input())).toMatchObject({ id: "pay1", status: "created", checkoutUrl: "https://checkout.tabby.ai/x" });
    const ev = await handlePayLaterWebhook("tabby", JSON.stringify({ id: "pay1", status: "authorized" }), new Headers({ "x-mada-webhook": "whsec-123" }), "http://x/");
    expect(ev).toEqual({ provider: "tabby", id: "pay1", reference: "order-pl-1", status: "authorized" });
    expect(f.mock.calls.at(-1)![0]).toContain("/api/v2/payments/pay1");
  });
});
