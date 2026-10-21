import { jwtVerify } from "jose";
import { AppError } from "../../http";
import { instalmentPlan, withinLimits } from "./instalments";
import type { PayLaterPayment, PayLaterProvider, PayLaterSupplier } from "./types";

/*
 * Mock Tabby and Tamara: a checkout page that doesn't exist (mock-checkout URLs), payments in memory. A buyer phone
 * ending 0000, or an amount outside the limits, is rejected up front. mockPayLaterDecide() plays the traveller on the
 * provider's page (approve or decline). Webhooks are signed as the real ones are, with fixed mock secrets:
 * Tabby's header X-Mada-Webhook: mock-tabby-webhook, Tamara's JWT with mock-tamara-notification-token.
 */

export const MOCK_TABBY_WEBHOOK = "mock-tabby-webhook";
export const MOCK_TAMARA_TOKEN = "mock-tamara-notification-token";

const g = globalThis as unknown as { __madaMockPayLater?: Map<string, PayLaterPayment> };
const store: Map<string, PayLaterPayment> = (g.__madaMockPayLater ??= new Map());
export const clearMockPayLater = () => store.clear();

/** The traveller on the provider's page: Tabby authorises at once; Tamara approves and waits for our authorise. */
export function mockPayLaterDecide(id: string, approve: boolean) {
  const p = store.get(id);
  if (!p) throw new AppError("NOT_FOUND");
  store.set(id, { ...p, status: approve ? (p.provider === "tabby" ? "authorized" : "approved") : "rejected" });
}

const get = (id: string) => { const p = store.get(id); if (!p) throw new AppError("NOT_FOUND"); return p; };
const put = (p: PayLaterPayment) => { store.set(p.id, p); return p; };

export function mockPayLater(provider: PayLaterProvider): PayLaterSupplier {
  return {
    provider,
    name: `mock-${provider}`,
    eligible: (amount) => withinLimits(provider, amount),
    instalments: (amount, today) => instalmentPlan(provider, amount, today),
    async createCheckout(input) {
      const plan = instalmentPlan(provider, input.amount, new Date().toISOString().slice(0, 10));
      if (input.buyer.phone.endsWith("0000") || !withinLimits(provider, input.amount)) {
        return { provider, id: "", reference: input.reference, status: "rejected", checkoutUrl: null, rejectedReason: "not_available", instalments: plan };
      }
      const had = [...store.values()].find((p) => p.provider === provider && p.reference === input.reference && p.status === "created");
      const id = had?.id ?? `mock-${provider}-${store.size + 1}`;
      if (!had) put({ provider, id, reference: input.reference, status: "created", amount: input.amount, captured: 0, refunded: 0 });
      return { provider, id, reference: input.reference, status: "created", checkoutUrl: `https://mock-checkout.madatrips.sa/${provider}/${id}`, rejectedReason: null, instalments: plan };
    },
    async payment(id) { return get(id); },
    async authorise(id) {
      const p = get(id);
      if (p.status !== "approved" && p.status !== "authorized") throw new AppError("VALIDATION", { message: "Not approved yet." });
      return put({ ...p, status: "authorized" });
    },
    async capture(id, amount) {
      const p = get(id);
      if (p.status === "captured") return p; // a retry
      if (p.status !== "authorized") throw new AppError("VALIDATION", { message: "Only an authorised payment can be captured." });
      return put({ ...p, status: "captured", captured: Math.min(amount, p.amount) });
    },
    async refund(id, amount) {
      const p = get(id);
      if (p.status !== "captured") throw new AppError("VALIDATION", { message: "Only a captured payment can be refunded." });
      const refunded = Math.min(p.captured, p.refunded + amount);
      return put({ ...p, refunded, status: refunded >= p.captured ? "refunded" : "captured" });
    },
    async cancel(id) {
      const p = get(id);
      if (p.status === "captured" || p.status === "refunded") throw new AppError("VALIDATION", { message: "Captured: refund it instead." });
      return put({ ...p, status: "cancelled" });
    },
    async verifyWebhook(raw, headers, url) {
      if (provider === "tabby") {
        if (headers.get("x-mada-webhook") !== MOCK_TABBY_WEBHOOK) return null;
      } else {
        const token = new URL(url).searchParams.get("tamaraToken") ?? headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        try { await jwtVerify(token, new TextEncoder().encode(MOCK_TAMARA_TOKEN), { algorithms: ["HS256"] }); } catch { return null; }
      }
      let id: string | undefined;
      try { const b = JSON.parse(raw) as { id?: string; order_id?: string }; id = provider === "tabby" ? b.id : b.order_id; } catch { return null; }
      const p = id ? store.get(id) : undefined;
      return p ? { provider, id: p.id, reference: p.reference, status: p.status } : null;
    },
  };
}
