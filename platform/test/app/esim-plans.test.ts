import { describe, expect, it } from "vitest";
import { ESIM_PRICING_DEFAULTS, esimPricer, esimSellPrice, recommendEsimPlan, suggestEsimPlans, undominatedPlans, type EsimPackage } from "@mada/shared";

/*
 * The plans a traveller is offered: never a smaller plan at the same or a higher price than a bigger one that lasts as
 * long, and the recommended one is the cheapest that covers the trip. Shapes and costs as eSIM Access sells Türkiye
 * (Vodafone), priced by the owner's default rules (min profit SAR 10, rounded to …9).
 */

const TR = { kind: "local" as const, code: "TR", name: "Turkey", countries: ["TR"] };
const pkg = (id: string, gb: number | null, days: number, netUsd: number, extra: Partial<EsimPackage> = {}): EsimPackage => ({
  id, coverage: TR, gb, days, netUsd, operator: "Vodafone", apn: { type: "automatic", value: null }, roaming: true, topup: true, retailUsd: null, ...extra,
});

// Costs that, under the default rules, put 5 GB and 10 GB (30 days) both at SAR 29, and 3 GB at 15 or 30 days at SAR 19.
const LIVE_TR: EsimPackage[] = [
  pkg("TR_0.1_7", 0.1, 7, 0.2), pkg("TR_0.5_7", 0.5, 7, 0.45), pkg("TR_1_7", 1, 7, 0.6),
  pkg("TR_3_15", 3, 15, 1.1), pkg("TR_3_30", 3, 30, 1.3),
  pkg("TR_5_30", 5, 30, 2.5), pkg("TR_10_30", 10, 30, 3.4),
  pkg("TR_20_30", 20, 30, 5.6), pkg("TR_50_30", 50, 30, 13.5), pkg("TR_50_180", 50, 180, 15.9),
  pkg("TR_1_Daily", 1, 1, 0.6, { daily: true }),
];
const price = esimPricer(ESIM_PRICING_DEFAULTS, 3.75);

describe("eSIM plans: no plan a bigger one beats", () => {
  it("the costs above give the prices seen live", () => {
    const sar = (id: string) => price(LIVE_TR.find((p) => p.id === id)!) / 100;
    expect([sar("TR_3_15"), sar("TR_3_30"), sar("TR_5_30"), sar("TR_10_30"), sar("TR_20_30")]).toEqual([19, 19, 29, 29, 39]);
  });

  it("drops a plan with no more data, no more days and no lower price than another", () => {
    const kept = undominatedPlans(LIVE_TR.filter((p) => !p.daily), price).map((p) => p.id);
    expect(kept).not.toContain("TR_5_30"); // 10 GB · 30 days is the same SAR 29
    expect(kept).not.toContain("TR_3_15"); // 3 GB · 30 days is the same SAR 19
    expect(kept).not.toContain("TR_0.1_7");
    expect(kept).toEqual(expect.arrayContaining(["TR_3_30", "TR_10_30", "TR_20_30", "TR_50_30", "TR_50_180"]));
  });

  it("keeps a bigger plan that costs more, and a longer one that costs more", () => {
    const flat = (id: string, gb: number, days: number, sar: number) => ({ p: pkg(id, gb, days, 1), sar });
    const list = [flat("a", 5, 30, 29), flat("b", 10, 30, 39), flat("c", 5, 60, 35)];
    const kept = undominatedPlans(list.map((x) => x.p), (p) => list.find((x) => x.p === p)!.sar * 100).map((p) => p.id);
    expect(kept).toEqual(["a", "b", "c"]);
  });

  it("of two plans the same to the traveller, keeps the one that costs Mada less", () => {
    const a = pkg("TR_3_30", 3, 30, 1.3);
    const b = pkg("TR_3_30_Premium", 3, 30, 1.5);
    expect(undominatedPlans([b, a], () => 1900).map((p) => p.id)).toEqual(["TR_3_30"]);
  });

  it("only compares plans of the same coverage", () => {
    const eu = { kind: "regional" as const, code: "EU-42", name: "Europe", countries: ["TR", "FR"] };
    const local = pkg("TR_5_30", 5, 30, 2.1);
    const region = pkg("EU_10_30", 10, 30, 2.1, { coverage: eu });
    expect(undominatedPlans([local, region], () => 2900)).toHaveLength(2);
  });

  it("a 7-day Türkiye trip: never 5 GB recommended next to 10 GB at the same price", () => {
    const s = suggestEsimPlans(LIVE_TR, { countries: ["TR"], days: 7, price });
    const shown = s.plans.map((p) => [p.size, p.id, p.price.amount]);
    expect(shown).toEqual([["light", "TR_3_30", 1900], ["regular", "TR_10_30", 2900], ["heavy", "TR_20_30", 3900]]);
    expect(s.recommended).toBe("TR_10_30");
    // Nothing shown is beaten by another shown plan.
    for (const p of s.plans) {
      expect(s.plans.some((q) => q !== p && (q.gb ?? Infinity) >= (p.gb ?? Infinity) && q.days >= p.days && q.price.amount <= p.price.amount)).toBe(false);
    }
  });

  it("the owner's picks lose a pick another pick beats, and the cheapest that covers the trip is recommended", () => {
    const s = suggestEsimPlans(LIVE_TR, { countries: ["TR"], days: 7, price, picks: ["TR_3_30", "TR_5_30", "TR_10_30"] });
    expect(s.plans.map((p) => [p.size, p.id])).toEqual([["light", "TR_3_30"], ["regular", "TR_10_30"]]);
    expect(s.recommended).toBe("TR_10_30");
  });

  it("recommends the cheapest plan that lasts the trip with a day's data for each day", () => {
    const at = (id: string, gb: number, days: number, sar: number, fits = true) => ({ id, coverage: TR, gb, days, price: { amount: sar * 100, currency: "SAR" as const }, size: "regular" as const, fits, operator: "", topup: true });
    // 10 days needs about 7 GB: 5 GB is too little; 10 GB for 15 days is cheaper than 20 GB for 30.
    expect(recommendEsimPlan([at("a", 5, 30, 19), at("b", 10, 15, 25), at("c", 20, 30, 39)], 10)?.id).toBe("b");
    // Nothing has the data: the biggest that lasts.
    expect(recommendEsimPlan([at("a", 1, 30, 19), at("b", 3, 30, 29)], 10)?.id).toBe("b");
    // Nothing lasts: the longest.
    expect(recommendEsimPlan([at("a", 10, 15, 19, false), at("b", 10, 30, 29, false)], 45)?.id).toBe("b");
  });

  it("the guard and minimum profit still hold for every plan offered", () => {
    const s = suggestEsimPlans(LIVE_TR, { countries: ["TR"], days: 7, price });
    for (const p of [...s.plans, ...s.more]) {
      const src = LIVE_TR.find((x) => x.id === p.id)!;
      const b = esimSellPrice(src.daily ? { ...src, netUsd: src.netUsd * 7 } : src, ESIM_PRICING_DEFAULTS, 3.75);
      expect(p.price.amount).toBe(b.sell);
      expect(b.sell).toBeGreaterThanOrEqual(b.floor);
      expect(b.margin).toBeGreaterThanOrEqual(ESIM_PRICING_DEFAULTS.minProfitSar * 100 - 1);
    }
  });
});
