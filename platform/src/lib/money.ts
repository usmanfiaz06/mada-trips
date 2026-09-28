// All amounts are integers in halalas. These helpers are the only place that converts.

export function toHalalas(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === "") return 0;
  const s = String(input).replace(/[,\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) throw new Error(`Invalid amount: ${input}`);
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const v = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return s.startsWith("-") ? -v : v;
}

export function sar(halalas: number, opts: { sign?: boolean; compact?: boolean; unit?: boolean } = {}): string {
  const neg = halalas < 0;
  const abs = Math.abs(halalas) / 100;
  let body: string;
  if (opts.compact && abs >= 10_000) {
    body = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M` : `${(abs / 1000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  } else {
    body = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const sign = neg ? "−" : opts.sign && halalas > 0 ? "+" : "";
  return `${sign}${body}${opts.unit ? " SAR" : ""}`;
}

export const amountInput = (halalas: number) => (halalas / 100).toFixed(2);

/** Split an amount by basis-point weights so the parts always add up exactly (largest remainder). */
export function splitByBps(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floors = raw.map(Math.floor);
  let rest = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (rest <= 0) break; floors[i] += 1; rest -= 1; }
  return floors;
}

export const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
