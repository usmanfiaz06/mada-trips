import "server-only";
import { keyedMode } from "../../config";
import { AppError } from "../../http";
import { guarded } from "../../resilience/breaker";
import { mockPayLater } from "./mock";
import { tabby } from "./tabby";
import { tamara } from "./tamara";
import type { PayLaterEvent, PayLaterProvider, PayLaterSupplier } from "./types";

export type * from "./types";
export { instalmentPlan, payLaterLimits } from "./instalments";

/*
 * Pay later (CONNECT.md §29). Each provider has its own switch: SUPPLIER_MODE_TABBY / TABBY_SECRET_KEY +
 * TABBY_MERCHANT_CODE (+ TABBY_WEBHOOK_SECRET for the webhook), SUPPLIER_MODE_TAMARA / TAMARA_API_TOKEN +
 * TAMARA_NOTIFICATION_TOKEN. Live behind its own breaker; mock in memory; off: not offered.
 */
const mocks = { tabby: mockPayLater("tabby"), tamara: mockPayLater("tamara") };

export function payLater(provider: PayLaterProvider): PayLaterSupplier | null {
  const m = keyedMode(provider);
  if (m === "off") return null;
  if (m === "mock") return mocks[provider];
  return guarded(provider, provider === "tabby" ? tabby : tamara);
}

/** The providers the pay sheet may offer for this amount, with the instalment line for each. */
export function payLaterOptions(amount: number, today: string) {
  return (["tabby", "tamara"] as const).map((p) => payLater(p)).filter((s): s is PayLaterSupplier => !!s && s.eligible(amount)).map((s) => s.instalments(amount, today));
}

/**
 * A webhook from Tabby or Tamara: verified (header secret / JWT) and read back from the provider. Tamara's approved
 * order is authorised here, as Tamara requires, so it doesn't expire. UNAUTHORIZED when it isn't genuine.
 */
export async function handlePayLaterWebhook(provider: PayLaterProvider, raw: string, headers: Headers, url: string): Promise<PayLaterEvent> {
  const s = payLater(provider);
  if (!s) throw new AppError("NOT_CONFIGURED");
  const ev = await s.verifyWebhook(raw, headers, url);
  if (!ev) throw new AppError("UNAUTHORIZED");
  if (provider === "tamara" && ev.status === "approved") {
    const p = await s.authorise(ev.id);
    return { ...ev, status: p.status };
  }
  // The order flow takes it from here (the pay sheet hook-up, CONNECT.md §29): authorized → confirm the booking,
  // then capture; rejected/expired → the traveller picks another way to pay.
  console.info(`[pay-later] ${provider} ${ev.id} for ${ev.reference ?? "?"}: ${ev.status}`);
  return ev;
}
