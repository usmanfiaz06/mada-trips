import { jwtVerify } from "jose";
import { AppError } from "../../http";
import { requireEnv } from "../live/not-configured";
import { halalasOf, instalmentCount, instalmentPlan, withinLimits } from "./instalments";
import type { PayLaterCheckoutInput, PayLaterEvent, PayLaterPayment, PayLaterStatus, PayLaterSupplier } from "./types";

/*
 * Tamara (docs.tamara.co): Bearer TAMARA_API_TOKEN, TAMARA_ENV sandbox | live.
 *   POST /checkout                           { order_reference_id, total_amount, items, consumer, … } → checkout_url, order_id
 *   GET  /orders/{order_id}                  status: new, approved, declined, expired, authorised, fully_captured, …
 *   POST /orders/{order_id}/authorise        after the approved notification (required, or the order expires)
 *   POST /payments/capture                   { order_id, total_amount, shipping_info }
 *   POST /payments/simplified-refund/{id}    { total_amount, comment }
 *   POST /orders/{order_id}/cancel           { total_amount } before capture
 * Notifications carry a JWT (HS256 with TAMARA_NOTIFICATION_TOKEN) as tamaraToken in the query or the Authorization
 * header. As with Tabby we read the order back before acting on it.
 */

const HOSTS = { sandbox: "https://api-sandbox.tamara.co", live: "https://api.tamara.co" };
const host = () => HOSTS[process.env.TAMARA_ENV === "live" ? "live" : "sandbox"];
const money = (h: number) => ({ amount: Math.round(h) / 100, currency: "SAR" });

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { TAMARA_API_TOKEN: token } = requireEnv("pay later (Tamara)", ["TAMARA_API_TOKEN"]);
  const res = await fetch(`${host()}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12_000) });
  const text = await res.text();
  if (res.status >= 500) throw new Error(`tamara answered ${res.status}`);
  if (res.status === 404) throw new AppError("NOT_FOUND");
  if (!res.ok) throw new AppError("VALIDATION", { message: `Tamara refused: ${text.slice(0, 160)}` });
  return (text ? JSON.parse(text) : {}) as T;
}

export function tamaraCheckoutBody(input: PayLaterCheckoutInput) {
  const consumer = { first_name: input.buyer.firstName, last_name: input.buyer.lastName, phone_number: input.buyer.phone, email: input.buyer.email };
  return {
    order_reference_id: input.reference, order_number: input.reference, total_amount: money(input.amount), description: input.description.slice(0, 256),
    country_code: "SA", payment_type: "PAY_BY_INSTALMENTS", instalments: instalmentCount("tamara"), locale: input.language === "ar" ? "ar_SA" : "en_US",
    items: input.items.map((i) => ({ reference_id: i.reference, type: "Digital", name: i.title.slice(0, 120), sku: i.reference, quantity: i.quantity, unit_price: money(i.unitPrice), total_amount: money(i.unitPrice * i.quantity) })),
    consumer,
    shipping_address: { first_name: consumer.first_name, last_name: consumer.last_name, line1: input.city, city: input.city, country_code: "SA", phone_number: consumer.phone_number },
    tax_amount: money(0), shipping_amount: money(0),
    merchant_url: { success: input.urls.success, failure: input.urls.failure, cancel: input.urls.cancel, notification: input.urls.notification ?? input.urls.success },
  };
}

type TOrder = { order_id?: string; order_reference_id?: string; status?: string; total_amount?: { amount?: number }; captured_amount?: { amount?: number }; refunded_amount?: { amount?: number } };
const STATUS: Record<string, PayLaterStatus> = {
  new: "created", approved: "approved", declined: "rejected", expired: "expired", authorised: "authorized", canceled: "cancelled", cancelled: "cancelled",
  partially_captured: "captured", fully_captured: "captured", partially_refunded: "captured", fully_refunded: "refunded", updated: "authorized",
};

export function tamaraOrder(o: TOrder): PayLaterPayment {
  if (!o?.order_id) throw new Error("tamara answered an order without an id");
  return {
    provider: "tamara", id: o.order_id, reference: o.order_reference_id ?? null, status: STATUS[(o.status ?? "").toLowerCase()] ?? "created",
    amount: halalasOf(o.total_amount?.amount), captured: halalasOf(o.captured_amount?.amount), refunded: halalasOf(o.refunded_amount?.amount),
  };
}

export const tamara: PayLaterSupplier = {
  provider: "tamara",
  name: "tamara",
  eligible: (amount) => withinLimits("tamara", amount),
  instalments: (amount, today) => instalmentPlan("tamara", amount, today),
  async createCheckout(input) {
    try {
      const r = await call<{ order_id?: string; checkout_url?: string; status?: string }>("POST", "/checkout", tamaraCheckoutBody(input));
      if (!r.order_id || !r.checkout_url) throw new Error("tamara answered a checkout without a url");
      return { provider: "tamara", id: r.order_id, reference: input.reference, status: "created", checkoutUrl: r.checkout_url, rejectedReason: null, instalments: instalmentPlan("tamara", input.amount, new Date().toISOString().slice(0, 10)) };
    } catch (e) {
      // Tamara says no to a checkout with a 4xx: that's a rejection, not an outage.
      if (e instanceof AppError && e.code === "VALIDATION") return { provider: "tamara", id: "", reference: input.reference, status: "rejected", checkoutUrl: null, rejectedReason: e.message, instalments: instalmentPlan("tamara", input.amount, new Date().toISOString().slice(0, 10)) };
      throw e;
    }
  },
  async payment(id) { return tamaraOrder(await call("GET", `/orders/${encodeURIComponent(id)}`)); },
  async authorise(id) {
    await call("POST", `/orders/${encodeURIComponent(id)}/authorise`);
    return this.payment(id);
  },
  async capture(id, amount) {
    await call("POST", "/payments/capture", { order_id: id, total_amount: money(amount), shipping_info: { shipped_at: new Date().toISOString(), shipping_company: "Mada Trips (e-ticket)" } });
    return this.payment(id);
  },
  async refund(id, amount, reference, reason) {
    await call("POST", `/payments/simplified-refund/${encodeURIComponent(id)}`, { total_amount: money(amount), comment: (reason ?? `Refund ${reference}`).slice(0, 200) });
    return this.payment(id);
  },
  async cancel(id) {
    const p = await this.payment(id);
    await call("POST", `/orders/${encodeURIComponent(id)}/cancel`, { total_amount: money(p.amount) });
    return this.payment(id);
  },
  async verifyWebhook(raw, headers, url) {
    const secret = process.env.TAMARA_NOTIFICATION_TOKEN;
    if (!secret) return null;
    const token = new URL(url).searchParams.get("tamaraToken") ?? headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    try { await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ["HS256"] }); } catch { return null; }
    let id: string | undefined;
    try { id = (JSON.parse(raw) as { order_id?: string }).order_id; } catch { return null; }
    if (!id) return null;
    const p = await this.payment(id);
    return { provider: "tamara", id: p.id, reference: p.reference, status: p.status } satisfies PayLaterEvent;
  },
};
