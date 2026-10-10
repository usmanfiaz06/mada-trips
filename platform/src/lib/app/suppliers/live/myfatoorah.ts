import { halalasToSar } from "@mada/shared";
import type { PaymentResult } from "../types";
import type { BookingPaymentSupplier } from "../booking-types";
import { postJson, requireEnv } from "./not-configured";

/*
 * MyFatoorah (API v2), authorise-and-capture. The app tokenises the card in MyFatoorah's embedded session on the phone
 * (the number never reaches Mada) and sends us the SessionId as the token; we execute the payment without capturing,
 * capture when tickets are issued and release the hold when they aren't.
 *   MYFATOORAH_API_KEY   the merchant API token (Bearer)
 *   MYFATOORAH_BASE_URL  https://api-sa.myfatoorah.com (live, Saudi) or https://apitest.myfatoorah.com (sandbox)
 * Built against the published v2 endpoints; not yet run against the sandbox (no merchant account yet).
 */

const env = () => requireEnv("payments (MyFatoorah)", ["MYFATOORAH_API_KEY", "MYFATOORAH_BASE_URL"]);
const call = (path: string, body: unknown) => {
  const e = env();
  return postJson(`${e.MYFATOORAH_BASE_URL!.replace(/\/$/, "")}${path}`, body, { Authorization: `Bearer ${e.MYFATOORAH_API_KEY}` }, 20_000) as Promise<{ IsSuccess?: boolean; Data?: Record<string, unknown> } | null>;
};

export const liveMyFatoorah: BookingPaymentSupplier = {
  name: "myfatoorah",
  async authorize(input): Promise<PaymentResult> {
    const r = await call("/v2/ExecutePayment", {
      SessionId: input.token, InvoiceValue: halalasToSar(input.amount), DisplayCurrencyIso: "SAR",
      CustomerReference: input.idempotencyKey, UserDefinedField: input.description.slice(0, 100),
      ProcessingDetails: { AutoCapture: false },
    });
    const url = r?.Data?.PaymentURL as string | undefined;
    const ref = String(r?.Data?.InvoiceId ?? "");
    if (!r?.IsSuccess || !ref) return { status: "declined", providerRef: ref || input.idempotencyKey, declineReason: "gateway_refused" };
    // With 3-D Secure the bank's page comes first; the webhook confirms the authorisation afterwards.
    return url ? { status: "requires_action", providerRef: ref, redirectUrl: url } : { status: "authorized", providerRef: ref };
  },
  async completeAction(providerRef) {
    // The bank's page talks to MyFatoorah directly; we only ask how it ended.
    const r = await call("/v2/GetPaymentStatus", { Key: providerRef, KeyType: "InvoiceId" });
    const status = String(r?.Data?.InvoiceStatus ?? "");
    return { status: /authori[sz]ed|paid/i.test(status) ? "authorized" : "requires_action", providerRef };
  },
  async capture(providerRef, amount) {
    const r = await call("/v2/UpdatePaymentStatus", { Operation: "capture", Key: providerRef, KeyType: "InvoiceId", ...(amount ? { Amount: halalasToSar(amount) } : {}) });
    return { status: r?.IsSuccess ? "captured" : "failed", providerRef };
  },
  async void(providerRef) {
    const r = await call("/v2/UpdatePaymentStatus", { Operation: "release", Key: providerRef, KeyType: "InvoiceId" });
    return { status: r?.IsSuccess ? "voided" : "failed", providerRef };
  },
  async refund(providerRef, amount, idempotencyKey) {
    const r = await call("/v2/MakeRefund", { Key: providerRef, KeyType: "InvoiceId", RefundChargeOnCustomer: false, ServiceChargeOnCustomer: false, Amount: halalasToSar(amount), Comment: idempotencyKey });
    return { status: r?.IsSuccess ? "refunded" : "failed", providerRef: String(r?.Data?.RefundReference ?? providerRef) };
  },
};
