/*
 * Refunds, the parts the server, the app and its mock agree on (APP-FINANCE.md "Auto-approval" and "Mada Wallet"):
 * when the rules approve a refund without a person, the working days a card refund takes, and how one Mada Wallet
 * movement reads.
 */

/** A card refund shows in the bank within this many working days of being sent (the one range we promise). */
export const REFUND_BANK_WORKING_DAYS = 10;

const RIYADH_MS = 3 * 3_600_000;
/** Friday and Saturday are the weekend in Saudi Arabia. */
const weekend = (ms: number) => { const d = new Date(ms + RIYADH_MS).getUTCDay(); return d === 5 || d === 6; };

/** `n` working days (Sunday to Thursday, Riyadh) after `from`. */
export function addWorkingDays(from: Date, n: number): Date {
  let ms = from.getTime();
  for (let left = n; left > 0;) { ms += 86_400_000; if (!weekend(ms)) left -= 1; }
  return new Date(ms);
}

/** Whole working days from `fromIso` to `now`. */
export function workingDaysSince(fromIso: string, now: number): number {
  let n = 0;
  for (let ms = Date.parse(fromIso) + 86_400_000; ms <= now; ms += 86_400_000) if (!weekend(ms)) n += 1;
  return n;
}

/** A card refund sent more than 10 working days ago and still not settled: the traveller may tell us it isn't there. */
export function refundBankLate(r: { stage: string; destination: string; sentAt: string | null }, now: number): boolean {
  return r.stage === 'sent' && r.destination !== 'credit' && !!r.sentAt && workingDaysSince(r.sentAt, now) > REFUND_BANK_WORKING_DAYS;
}

/* ───────── auto-approval ───────── */

/**
 * How the rules settled the amount: `free` (inside the free-cancellation window, or the supplier's simulation shows no
 * fee), `supplier_confirmed` (the airline cancelled, or the supplier already confirmed the cancellation and the refund),
 * or null (a fee applies, or a person has to ask).
 */
export type RefundClear = 'free' | 'supplier_confirmed' | null;

export type AutoApproveInput = {
  clear: RefundClear;
  destination: 'original' | 'credit' | 'instalments';
  /** Halalas. */
  amount: number;
  /** Halalas: APP_REFUND_AUTO_MAX, by default the agent's single-refund limit. */
  max: number;
  /** An open fraud or abuse flag on the account (today: an unlifted desk block). */
  flagged: boolean;
};
export type AutoApproveDecision =
  | { ok: true; rule: string }
  | { ok: false; why: 'not_clear' | 'destination' | 'over_max' | 'flagged' | 'nothing' };

/** Approve without a person only when every condition holds; `rule` is what the audit log and the desk's Auto tag show. */
export function autoApproveRefund(i: AutoApproveInput): AutoApproveDecision {
  if (i.amount <= 0) return { ok: false, why: 'nothing' };
  if (!i.clear) return { ok: false, why: 'not_clear' };
  if (i.destination === 'instalments') return { ok: false, why: 'destination' };
  if (i.amount > i.max) return { ok: false, why: 'over_max' };
  if (i.flagged) return { ok: false, why: 'flagged' };
  const sar = (h: number) => `SAR ${(h / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return {
    ok: true,
    rule: `${i.clear === 'free' ? 'No fee under the rules' : 'Supplier confirmed the cancellation'}, to ${i.destination === 'credit' ? 'Mada Wallet' : 'the card'}, ${sar(i.amount)} within ${sar(i.max)}, no open flag`,
  };
}

/**
 * APP_REFUND_AUTO_MAX in SAR ("500", "750.50"); unset or unreadable falls back to `fallback` (halalas, the agent's
 * single-refund limit). "0" turns auto-approval off.
 */
export function refundAutoMax(env: string | undefined, fallback: number): number {
  const v = env?.trim();
  if (!v || !/^\d+(\.\d{1,2})?$/.test(v)) return fallback;
  return Math.round(Number(v) * 100);
}

/* ───────── Mada Wallet movements ───────── */

/** One movement as the Wallet reads it: "Refund · Garden hotel, Istanbul", "Used · Istanbul, 9–15 Mar". */
export function walletLine(kind: string, note: string | null): { what: 'refund' | 'spend' | 'goodwill' | 'adjustment' | 'expiry'; detail: string | null } {
  const what = (['refund', 'spend', 'goodwill', 'adjustment', 'expiry'] as const).find((k) => k === kind) ?? 'adjustment';
  // Older lines carried their own label ("Refund · …", "Refund to Mada credit"): keep only what comes after it.
  const detail = note?.replace(/^(Refund|Used)( to Mada credit| as credit)?\s*(·\s*)?/i, '').trim() || null;
  return { what, detail };
}
