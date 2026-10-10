import type { PaymentResult, PaymentSupplier } from "../types";

/*
 * Mock MyFatoorah. Authorise → capture → void/refund, idempotent by key. Magic tokens (FLOWS.md §2):
 *   tok_decline  → declined ("Your bank said no.")
 *   tok_3ds      → requires_action with a redirect (the bank asks for a code)
 *   tok_fail_capture → authorises, then capture fails (tickets fail to issue → void)
 * Anything else authorises.
 */

type Rec = { ref: string; amount: number; captured: number; refunded: number; status: PaymentResult["status"]; token: string };
const g = globalThis as unknown as { __madaMockPay?: { byRef: Map<string, Rec>; byKey: Map<string, PaymentResult> } };
const store = (g.__madaMockPay ??= { byRef: new Map(), byKey: new Map() });
let seq = 0;

export const mockPayments: PaymentSupplier = {
  name: "mock-myfatoorah",
  async authorize(input) {
    const prior = store.byKey.get(input.idempotencyKey);
    if (prior) return prior;
    const ref = `mf_mock_${Date.now().toString(36)}_${(seq += 1)}`;
    let res: PaymentResult;
    if (input.token === "tok_decline") res = { status: "declined", providerRef: ref, declineReason: "do_not_honor" };
    else if (input.token === "tok_3ds") res = { status: "requires_action", providerRef: ref, redirectUrl: `https://mock.myfatoorah.invalid/3ds/${ref}` };
    else res = { status: "authorized", providerRef: ref };
    store.byRef.set(ref, { ref, amount: input.amount, captured: 0, refunded: 0, status: res.status, token: input.token });
    store.byKey.set(input.idempotencyKey, res);
    return res;
  },
  async capture(ref, amount) {
    const r = store.byRef.get(ref);
    if (!r || r.status !== "authorized") return { status: "failed", providerRef: ref };
    if (r.token === "tok_fail_capture") return { status: "failed", providerRef: ref };
    r.captured = amount ?? r.amount;
    r.status = "captured";
    return { status: "captured", providerRef: ref };
  },
  async void(ref) {
    const r = store.byRef.get(ref);
    if (!r || r.status !== "authorized") return { status: "failed", providerRef: ref };
    r.status = "voided";
    return { status: "voided", providerRef: ref };
  },
  async refund(ref, amount, key) {
    const prior = store.byKey.get(key);
    if (prior) return prior;
    const r = store.byRef.get(ref);
    if (!r || r.captured - r.refunded < amount) return { status: "failed", providerRef: ref };
    r.refunded += amount;
    r.status = r.refunded === r.captured ? "refunded" : "partially_refunded";
    const res = { status: r.status, providerRef: `${ref}_rf${r.refunded}` };
    store.byKey.set(key, res);
    return res;
  },
};
