import type { PaymentResult } from "../types";
import type { BookingPaymentSupplier } from "../booking-types";

/*
 * Mock MyFatoorah for booking (M2): authorise → (3-D Secure) → capture on issue, void on failure, refund. Idempotent by
 * key. Card numbers never reach us: the app tokenises with the provider's SDK and we only ever see its token.
 * Tokens the mock understands (the app's mock tokeniser makes them):
 *   …_3ds         the bank asks for a code first; 123456 passes, three wrong codes and the bank stops it
 *   tok_decline   declined ("Your bank said no.")
 *   …_failcapture authorises, then capture fails (tickets fail to issue → void)
 * Anything else authorises.
 */

type Rec = { ref: string; amount: number; captured: number; refunded: number; status: PaymentResult["status"]; token: string; tries: number };
const g = globalThis as unknown as { __madaMockMf?: { byRef: Map<string, Rec>; byKey: Map<string, PaymentResult> } };
const store = (g.__madaMockMf ??= { byRef: new Map(), byKey: new Map() });
let seq = 0;

export const MOCK_3DS_CODE = "123456";

export const mockMyFatoorah: BookingPaymentSupplier = {
  name: "mock-myfatoorah",
  async authorize(input) {
    const prior = store.byKey.get(input.idempotencyKey);
    if (prior) return prior;
    seq += 1;
    const ref = `mf_${Date.now().toString(36)}_${seq}`;
    let res: PaymentResult;
    if (input.token === "tok_decline" || input.token.endsWith("_decline")) res = { status: "declined", providerRef: ref, declineReason: "do_not_honor" };
    else if (input.token.endsWith("_3ds")) res = { status: "requires_action", providerRef: ref, redirectUrl: `https://mock.myfatoorah.invalid/3ds/${ref}` };
    else res = { status: "authorized", providerRef: ref };
    store.byRef.set(ref, { ref, amount: input.amount, captured: 0, refunded: 0, status: res.status, token: input.token, tries: 0 });
    store.byKey.set(input.idempotencyKey, res);
    return res;
  },
  async completeAction(ref, code) {
    const r = store.byRef.get(ref);
    if (!r || r.status !== "requires_action") return { status: "failed", providerRef: ref, triesLeft: 0 };
    if (code === MOCK_3DS_CODE) { r.status = "authorized"; return { status: "authorized", providerRef: ref }; }
    r.tries += 1;
    if (r.tries >= 3) { r.status = "declined"; return { status: "declined", providerRef: ref, triesLeft: 0, declineReason: "3ds_failed" }; }
    return { status: "requires_action", providerRef: ref, triesLeft: 3 - r.tries };
  },
  async capture(ref, amount) {
    const r = store.byRef.get(ref);
    if (!r || r.status !== "authorized" || r.token.includes("failcapture")) return { status: "failed", providerRef: ref };
    r.captured = amount ?? r.amount;
    r.status = "captured";
    return { status: "captured", providerRef: ref };
  },
  async void(ref) {
    const r = store.byRef.get(ref);
    if (!r || (r.status !== "authorized" && r.status !== "requires_action")) return { status: "failed", providerRef: ref };
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
