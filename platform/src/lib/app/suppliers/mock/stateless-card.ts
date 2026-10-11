import { createHash } from "node:crypto";
import type { PaymentResult } from "../types";

/*
 * The mock card gateway's memory lives in the provider reference itself, not in the server. On Vercel every request
 * may run in a different instance, so a Map in globalThis is empty by the time the desk captures (LIVE-AUDIT P0-4).
 *
 * A reference reads mf_<id>_<amount>_<flag>:
 *   id      a hash of the idempotency key, so a retried authorise gives the same reference
 *   amount  halalas authorised (refunds are checked against it)
 *   flag    a = authorised · s = the bank asks for a code (3-D Secure) · d = declined · x = capture will fail
 *
 * What changes afterwards (captured, voided, refunded, 3-D Secure tries) is kept by the caller in app_payments and
 * app_orders, which is where the real gateway's answer is written too. The callers only capture an authorised
 * payment and only void an authorised one, so the mock doesn't need to remember those states to answer honestly.
 */

export type MockFlag = "a" | "s" | "d" | "x";

const hash = (s: string) => createHash("sha256").update(s).digest("base64url").replace(/[-_]/g, "").slice(0, 12).toLowerCase();

export function mockRef(idempotencyKey: string, amount: number, flag: MockFlag): string {
  return `mf_${hash(idempotencyKey)}_${Math.max(0, Math.round(amount))}_${flag}`;
}

export function readRef(ref: string): { amount: number; flag: MockFlag } | null {
  const m = /^mf_([a-z0-9]+)_(\d+)_([asdx])$/.exec(ref);
  if (!m) return null;
  return { amount: Number(m[2]), flag: m[3] as MockFlag };
}

export function authorizeResult(ref: string, flag: MockFlag): PaymentResult {
  if (flag === "d") return { status: "declined", providerRef: ref, declineReason: "do_not_honor" };
  if (flag === "s") return { status: "requires_action", providerRef: ref, redirectUrl: `https://mock.myfatoorah.invalid/3ds/${ref}` };
  return { status: "authorized", providerRef: ref };
}

/** Capture: fails for a declined card, a 'fail capture' card, or a reference this mock never issued. */
export function captureResult(ref: string): PaymentResult {
  const r = readRef(ref);
  if (!r || r.flag === "d" || r.flag === "x") return { status: "failed", providerRef: ref };
  return { status: "captured", providerRef: ref };
}

export function voidResult(ref: string): PaymentResult {
  const r = readRef(ref);
  if (!r || r.flag === "d") return { status: "failed", providerRef: ref };
  return { status: "voided", providerRef: ref };
}

/** Refund: never more than was authorised. The running total across refunds is the caller's (app_refunds). */
export function refundResult(ref: string, amount: number, key: string): PaymentResult {
  const r = readRef(ref);
  if (!r || r.flag === "d" || r.flag === "x" || amount <= 0 || amount > r.amount) return { status: "failed", providerRef: ref };
  return { status: amount === r.amount ? "refunded" : "partially_refunded", providerRef: `${ref}_rf${hash(key).slice(0, 8)}` };
}
