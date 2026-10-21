import { timingSafeEqual } from "node:crypto";
import { AppError } from "../../http";
import { requireEnv } from "../live/not-configured";
import { halalasOf, instalmentPlan, sarString, withinLimits } from "./instalments";
import type { PayLaterCheckoutInput, PayLaterEvent, PayLaterPayment, PayLaterStatus, PayLaterSupplier } from "./types";

/*
 * Tabby API v2 (docs.tabby.ai): Bearer TABBY_SECRET_KEY, merchant TABBY_MERCHANT_CODE.
 *   POST /api/v2/checkout                    a session: status created (with the installments web_url) or rejected
 *   GET  /api/v2/payments/{id}               the payment: CREATED, AUTHORIZED, CLOSED, REJECTED, EXPIRED
 *   POST /api/v2/payments/{id}/captures      { amount, reference_id }
 *   POST /api/v2/payments/{id}/refunds       { amount, reference_id, reason }
 *   POST /api/v2/payments/{id}/close         before capture: nothing is charged
 * Webhooks are registered with a header Tabby echoes on every call (title X-Mada-Webhook, value TABBY_WEBHOOK_SECRET).
 * A webhook is never trusted on its own: we read the payment back from Tabby before acting on it.
 */

const HOST = "https://api.tabby.ai";
const auth = () => requireEnv("pay later (Tabby)", ["TABBY_SECRET_KEY", "TABBY_MERCHANT_CODE"]);

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { TABBY_SECRET_KEY: key } = auth();
  const res = await fetch(`${HOST}${path}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(12_000) });
  const text = await res.text();
  if (res.status >= 500) throw new Error(`tabby answered ${res.status}`);
  if (res.status === 404) throw new AppError("NOT_FOUND");
  if (!res.ok) throw new AppError("VALIDATION", { message: `Tabby refused: ${text.slice(0, 160)}` });
  return (text ? JSON.parse(text) : {}) as T;
}

export function tabbyCheckoutBody(input: PayLaterCheckoutInput, merchantCode: string) {
  return {
    payment: {
      amount: sarString(input.amount), currency: "SAR", description: input.description.slice(0, 200),
      buyer: { name: `${input.buyer.firstName} ${input.buyer.lastName}`.trim(), email: input.buyer.email, phone: input.buyer.phone, ...(input.buyer.dateOfBirth ? { dob: input.buyer.dateOfBirth } : {}) },
      shipping_address: { city: input.city, address: input.city, zip: "00000" },
      order: { reference_id: input.reference, items: input.items.map((i) => ({ reference_id: i.reference, title: i.title.slice(0, 120), quantity: i.quantity, unit_price: sarString(i.unitPrice), category: i.category })) },
    },
    lang: input.language === "ar" ? "ar" : "en",
    merchant_code: merchantCode,
    merchant_urls: input.urls,
  };
}

type TPayment = { id?: string; status?: string; amount?: string; order?: { reference_id?: string }; captures?: { amount?: string }[]; refunds?: { amount?: string }[] };
const STATUS: Record<string, PayLaterStatus> = { CREATED: "created", AUTHORIZED: "authorized", CLOSED: "captured", REJECTED: "rejected", EXPIRED: "expired" };

export function tabbyPayment(p: TPayment): PayLaterPayment {
  if (!p?.id) throw new Error("tabby answered a payment without an id");
  const captured = (p.captures ?? []).reduce((s, c) => s + halalasOf(c.amount), 0);
  const refunded = (p.refunds ?? []).reduce((s, r) => s + halalasOf(r.amount), 0);
  const amount = halalasOf(p.amount);
  let status = STATUS[(p.status ?? "").toUpperCase()] ?? "created";
  // CLOSED means finished: captured, or closed before capture (cancelled), or refunded in full.
  if (status === "captured") status = refunded && refunded >= captured ? "refunded" : captured ? "captured" : "cancelled";
  return { provider: "tabby", id: p.id, reference: p.order?.reference_id ?? null, status, amount, captured, refunded };
}

export const tabby: PayLaterSupplier = {
  provider: "tabby",
  name: "tabby",
  eligible: (amount) => withinLimits("tabby", amount),
  instalments: (amount, today) => instalmentPlan("tabby", amount, today),
  async createCheckout(input) {
    const { TABBY_MERCHANT_CODE: merchant } = auth();
    const r = await call<{ id?: string; status?: string; payment?: { id?: string }; configuration?: { available_products?: { installments?: { web_url?: string }[] }; products?: { installments?: { rejection_reason?: string | null } } } }>("POST", "/api/v2/checkout", tabbyCheckoutBody(input, merchant));
    const url = r.configuration?.available_products?.installments?.[0]?.web_url ?? null;
    const rejected = r.status !== "created" || !url;
    return {
      provider: "tabby", id: r.payment?.id ?? r.id ?? "", reference: input.reference, status: rejected ? "rejected" : "created", checkoutUrl: rejected ? null : url,
      rejectedReason: rejected ? r.configuration?.products?.installments?.rejection_reason ?? r.status ?? "rejected" : null,
      instalments: instalmentPlan("tabby", input.amount, new Date().toISOString().slice(0, 10)),
    };
  },
  async payment(id) { return tabbyPayment(await call("GET", `/api/v2/payments/${encodeURIComponent(id)}`)); },
  async authorise(id) { return this.payment(id); },
  async capture(id, amount, reference) {
    return tabbyPayment(await call("POST", `/api/v2/payments/${encodeURIComponent(id)}/captures`, { amount: sarString(amount), reference_id: reference }));
  },
  async refund(id, amount, reference, reason) {
    return tabbyPayment(await call("POST", `/api/v2/payments/${encodeURIComponent(id)}/refunds`, { amount: sarString(amount), reference_id: reference, reason: reason?.slice(0, 200) }));
  },
  async cancel(id) { return tabbyPayment(await call("POST", `/api/v2/payments/${encodeURIComponent(id)}/close`)); },
  async verifyWebhook(raw, headers) {
    const secret = process.env.TABBY_WEBHOOK_SECRET;
    const got = headers.get("x-mada-webhook") ?? "";
    if (!secret || got.length !== secret.length || !timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return null;
    let id: string | undefined;
    try { id = (JSON.parse(raw) as { id?: string }).id; } catch { return null; }
    if (!id) return null;
    const p = await this.payment(id);
    return { provider: "tabby", id: p.id, reference: p.reference, status: p.status } satisfies PayLaterEvent;
  },
};
