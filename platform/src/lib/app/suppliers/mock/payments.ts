import type { PaymentSupplier } from "../types";
import { authorizeResult, captureResult, mockRef, refundResult, voidResult, type MockFlag } from "./stateless-card";

/*
 * Mock MyFatoorah. Authorise → capture → void/refund, idempotent by key. Magic tokens (FLOWS.md §2):
 *   tok_decline  → declined ("Your bank said no.")
 *   tok_3ds      → requires_action with a redirect (the bank asks for a code)
 *   tok_fail_capture → authorises, then capture fails (tickets fail to issue → void)
 * Anything else authorises. Stateless (stateless-card.ts): the reference carries what the mock needs later.
 */

const flagFor = (token: string): MockFlag => (token === "tok_decline" ? "d" : token === "tok_3ds" ? "s" : token === "tok_fail_capture" ? "x" : "a");

export const mockPayments: PaymentSupplier = {
  name: "mock-myfatoorah",
  async authorize(input) {
    const flag = flagFor(input.token);
    return authorizeResult(mockRef(input.idempotencyKey, input.amount, flag), flag);
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
};
