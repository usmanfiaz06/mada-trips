import type { BookingPaymentSupplier } from "../booking-types";
import { authorizeResult, captureResult, mockRef, readRef, refundResult, voidResult, type MockFlag } from "./stateless-card";

/*
 * Mock MyFatoorah for booking (M2): authorise → (3-D Secure) → capture on issue, void on failure, refund. Idempotent by
 * key. Card numbers never reach us: the app tokenises with the provider's SDK and we only ever see its token.
 * Tokens the mock understands (the app's mock tokeniser makes them):
 *   …_3ds         the bank asks for a code first; 123456 passes, three wrong codes and the bank stops it
 *                 (the tries are counted on the order: booking/orders.ts submitOtp)
 *   tok_decline   declined ("Your bank said no.")
 *   …_failcapture authorises, then capture fails (tickets fail to issue → void)
 * Anything else authorises.
 *
 * Stateless: everything the mock needs later is in the provider reference (stateless-card.ts), so authorise on one
 * serverless instance and capture on another works (LIVE-AUDIT P0-4).
 */

export const MOCK_3DS_CODE = "123456";

const flagFor = (token: string): MockFlag =>
  token === "tok_decline" || token.endsWith("_decline") ? "d" : token.endsWith("_3ds") ? "s" : token.includes("failcapture") ? "x" : "a";

export const mockMyFatoorah: BookingPaymentSupplier = {
  name: "mock-myfatoorah",
  async authorize(input) {
    const flag = flagFor(input.token);
    return authorizeResult(mockRef(input.idempotencyKey, input.amount, flag), flag);
  },
  async completeAction(ref, code) {
    const r = readRef(ref);
    if (!r || r.flag !== "s") return { status: "failed", providerRef: ref, triesLeft: 0 };
    if (code === MOCK_3DS_CODE) return { status: "authorized", providerRef: ref };
    return { status: "requires_action", providerRef: ref };
  },
  async resendCode(ref) {
    // The mock bank's code never changes (MOCK_3DS_CODE); a new one is "sent" for any payment still waiting on it.
    return { sent: readRef(ref)?.flag === "s" };
  },
  async capture(ref) {
    return captureResult(ref);
  },
  async void(ref) {
    return voidResult(ref);
  },
  async refund(ref, amount, key) {
    return refundResult(ref, amount, key);
  },
  async refundStatus(_ref, refundRef) {
    // Stateless like the rest: a refund this mock made has gone to the card. Test references can ask for the other answers.
    if (refundRef.includes("pending")) return { status: "pending" as const };
    if (refundRef.includes("fail")) return { status: "failed" as const };
    return { status: "refunded" as const, reference: refundRef };
  },
};
