import type { InstalmentPlan, PayLaterProvider } from "./types";

/*
 * The instalment line for the pay sheet. Both providers split interest-free into equal monthly payments, the first
 * at checkout: Tabby in 4, Tamara in 4 (or 3 with TAMARA_INSTALMENTS=3). Halalas that don't divide go on the first.
 * Limits (SAR, per order): PAYLATER_MIN_SAR (default 100) and TABBY_MAX_SAR / TAMARA_MAX_SAR (default 5,000): the
 * provider decides the real limit per traveller at checkout; these only stop offering what can't pass.
 */

const addMonths = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  const want = d.getUTCMonth() + n;
  d.setUTCMonth(want);
  // 31 Jan + 1 month is the last day of February, not 3 March.
  if (d.getUTCMonth() !== ((want % 12) + 12) % 12) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};

export const instalmentCount = (p: PayLaterProvider) => (p === "tamara" && process.env.TAMARA_INSTALMENTS === "3" ? 3 : 4);

export function instalmentPlan(provider: PayLaterProvider, amount: number, today: string): InstalmentPlan {
  const count = instalmentCount(provider);
  const each = Math.floor(amount / count);
  const schedule = Array.from({ length: count }, (_, i) => ({ due: addMonths(today, i), amount: i === 0 ? amount - each * (count - 1) : each }));
  return { provider, count, schedule, fee: 0, firstToday: true };
}

const sarEnv = (name: string, d: number) => { const v = Number(process.env[name]); return (Number.isFinite(v) && v > 0 ? v : d) * 100; };
export const payLaterLimits = (p: PayLaterProvider) => ({ min: sarEnv("PAYLATER_MIN_SAR", 100), max: sarEnv(p === "tabby" ? "TABBY_MAX_SAR" : "TAMARA_MAX_SAR", 5000) });
export const withinLimits = (p: PayLaterProvider, amount: number) => { const l = payLaterLimits(p); return amount >= l.min && amount <= l.max; };

/** Halalas as the providers write money: "1250.00". */
export const sarString = (h: number) => (h / 100).toFixed(2);
export const halalasOf = (v: unknown) => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
