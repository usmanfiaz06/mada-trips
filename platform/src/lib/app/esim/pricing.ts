import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { type EsimPackage, type Halalas } from "@mada/shared";
import { ESIM_MARKUP_BPS, EsimPricingRules, esimPricer, esimSellPrice, usdSarOf, type EsimPriceBreakdown } from "@mada/shared/internal";
import { db } from "@/db";
import { appRuntime } from "@/db/app-schema-resilience";
import { appEsimPriceHolds } from "@/db/app-schema-esim";
import { appAuditLog } from "../audit";
import { getRates } from "../fx";

/*
 * The owner's eSIM pricing rules (desk › eSIMs › Pricing), kept in app_runtime under "esim.pricing", and the price
 * holds: what a traveller was shown stays theirs for `holdMinutes`, whatever the supplier's cost does meanwhile.
 * The rules themselves (margin, minimum profit, rounding, the guard) are shared: schemas/esim-pricing.ts.
 */

const KEY = "esim.pricing";

/** The rules as saved, with the defaults for anything not set. Before the first save, APP_ESIM_MARKUP_BPS seeds the margin. */
export async function pricingRules(): Promise<EsimPricingRules> {
  const [row] = await db.select().from(appRuntime).where(eq(appRuntime.key, KEY)).catch(() => [] as (typeof appRuntime.$inferSelect)[]);
  const parsed = row ? EsimPricingRules.safeParse(row.value) : null;
  if (parsed?.success) return parsed.data;
  const bps = Number(process.env.APP_ESIM_MARKUP_BPS);
  return EsimPricingRules.parse({ marginPct: Number.isFinite(bps) && bps >= 0 && bps <= 30_000 ? bps / 100 : ESIM_MARKUP_BPS / 100 });
}

/** Save the rules (desk, admin only), with who changed what in the audit trail. */
export async function savePricingRules(next: EsimPricingRules, actor: { name: string; opsUserId: string }, what: string): Promise<EsimPricingRules> {
  const value = EsimPricingRules.parse({ ...next, updatedAt: new Date().toISOString(), updatedBy: actor.name });
  await db.transaction(async (tx) => {
    await tx.insert(appRuntime).values({ key: KEY, value, updatedAt: new Date() }).onConflictDoUpdate({ target: appRuntime.key, set: { value, updatedAt: new Date() } });
    await appAuditLog(tx, { actorKind: "agent", actorId: actor.opsUserId, action: "esim.pricing", entityType: "app_runtime", entityId: KEY, summary: `${actor.name} changed eSIM pricing: ${what}`.slice(0, 300), data: { rules: value } });
  });
  return value;
}

/** SAR per dollar today, from the FX table (pegged at 3.75; the table says which day's). */
export async function usdSar(): Promise<number> {
  return usdSarOf(await getRates().catch(() => null));
}

export type EsimPricing = { rules: EsimPricingRules; usdSar: number; price: (p: EsimPackage) => Halalas; breakdown: (p: EsimPackage) => EsimPriceBreakdown };

export async function esimPricing(): Promise<EsimPricing> {
  const [rules, rate] = await Promise.all([pricingRules(), usdSar()]);
  return { rules, usdSar: rate, price: esimPricer(rules, rate), breakdown: (p) => esimSellPrice(p, rules, rate) };
}

/** Plans the traveller can see: everything the owner hasn't hidden. */
export const visible = (rules: EsimPricingRules, list: EsimPackage[]) => (rules.hidden.length ? list.filter((p) => !rules.hidden.includes(p.id)) : list);

/** Keep these prices for the traveller (a hold already running keeps its own, lower, price and end). */
export async function holdPrices(ownerId: string, prices: { packageId: string; price: Halalas }[], minutes: number): Promise<void> {
  if (!prices.length) return;
  const expiresAt = new Date(Date.now() + minutes * 60_000);
  await db.insert(appEsimPriceHolds).values(prices.map((p) => ({ ownerId, packageId: p.packageId, price: p.price, expiresAt })))
    .onConflictDoUpdate({
      target: [appEsimPriceHolds.ownerId, appEsimPriceHolds.packageId],
      set: {
        price: sql`CASE WHEN ${appEsimPriceHolds.expiresAt} > now() THEN LEAST(${appEsimPriceHolds.price}, excluded.price) ELSE excluded.price END`,
        expiresAt: sql`CASE WHEN ${appEsimPriceHolds.expiresAt} > now() THEN ${appEsimPriceHolds.expiresAt} ELSE excluded.expires_at END`,
      },
    });
}

/** The price this traveller was shown for a package, while the hold lasts. */
export async function heldPrice(ownerId: string, packageId: string): Promise<Halalas | null> {
  const [h] = await db.select({ price: appEsimPriceHolds.price }).from(appEsimPriceHolds)
    .where(and(eq(appEsimPriceHolds.ownerId, ownerId), eq(appEsimPriceHolds.packageId, packageId), gt(appEsimPriceHolds.expiresAt, new Date())));
  return h?.price ?? null;
}

/* ───────────── the desk's edits (esim-actions.ts), kept pure so the tests can read them ───────────── */

const num = (v: string | null | undefined): number | null => { if (v === null || v === undefined || v.trim() === "") return null; const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : null; };
export type RuleEdit =
  | { kind: "global"; fields: Record<string, string> }
  | { kind: "place"; code: string; marginPct: string; minProfitSar: string }
  | { kind: "plan"; packageId: string; marginPct: string; minProfitSar: string; fixedSar: string }
  | { kind: "hide"; packageId: string; hidden: boolean }
  | { kind: "recommend"; code: string; packageId: string; on: boolean };

/** The rules after one desk edit, and a sentence for the audit. Invalid values throw (zod). */
export function editRules(r: EsimPricingRules, e: RuleEdit): { rules: EsimPricingRules; what: string } {
  if (e.kind === "global") {
    const f = e.fields;
    const next = EsimPricingRules.parse({
      ...r, marginPct: num(f.marginPct) ?? r.marginPct, minProfitSar: num(f.minProfitSar) ?? r.minProfitSar, paymentFeePct: num(f.paymentFeePct) ?? r.paymentFeePct,
      paymentFeeFixedSar: num(f.paymentFeeFixedSar) ?? r.paymentFeeFixedSar, rounding: f.rounding || r.rounding, matchRetail: f.matchRetail === "on" || f.matchRetail === "yes",
      holdMinutes: num(f.holdMinutes) ?? r.holdMinutes, lowBalanceUsd: num(f.lowBalanceUsd) ?? r.lowBalanceUsd, sortingMinutes: num(f.sortingMinutes) ?? r.sortingMinutes,
    });
    return { rules: next, what: `margin ${next.marginPct}%, min profit SAR ${next.minProfitSar}, fee ${next.paymentFeePct}% + SAR ${next.paymentFeeFixedSar}, rounding ${next.rounding}, match retail ${next.matchRetail ? "on" : "off"}, hold ${next.holdMinutes} min, low balance $${next.lowBalanceUsd}, promise ${next.sortingMinutes} min` };
  }
  if (e.kind === "place") {
    const where = { ...r.where };
    const o = { marginPct: num(e.marginPct), minProfitSar: num(e.minProfitSar), fixedSar: null };
    if (o.marginPct === null && o.minProfitSar === null) delete where[e.code]; else where[e.code] = o;
    return { rules: EsimPricingRules.parse({ ...r, where }), what: where[e.code] ? `${e.code}: margin ${o.marginPct ?? "global"}%, min profit ${o.minProfitSar ?? "global"}` : `${e.code}: back to the global rule` };
  }
  if (e.kind === "plan") {
    const plans = { ...r.plans };
    const o = { marginPct: num(e.marginPct), minProfitSar: num(e.minProfitSar), fixedSar: num(e.fixedSar) };
    if (o.marginPct === null && o.minProfitSar === null && o.fixedSar === null) delete plans[e.packageId]; else plans[e.packageId] = o;
    return { rules: EsimPricingRules.parse({ ...r, plans }), what: plans[e.packageId] ? `${e.packageId}: ${o.fixedSar !== null ? `fixed SAR ${o.fixedSar}` : `margin ${o.marginPct ?? "—"}%, min profit ${o.minProfitSar ?? "—"}`}` : `${e.packageId}: back to the rule` };
  }
  if (e.kind === "hide") {
    const hidden = e.hidden ? [...new Set([...r.hidden, e.packageId])] : r.hidden.filter((x) => x !== e.packageId);
    return { rules: { ...r, hidden }, what: `${e.packageId} ${e.hidden ? "hidden" : "shown"}` };
  }
  const cur = r.recommended[e.code] ?? [];
  if (e.on && !cur.includes(e.packageId) && cur.length >= 3) throw new Error("Three picks per place at most. Take one off first.");
  const list = e.on ? [...new Set([...cur, e.packageId])] : cur.filter((x) => x !== e.packageId);
  const recommended = { ...r.recommended };
  if (list.length) recommended[e.code] = list; else delete recommended[e.code];
  return { rules: { ...r, recommended }, what: `${e.code}: ${e.packageId} ${e.on ? "recommended" : "no longer recommended"}` };
}
