import { afterEach, describe, expect, it, vi } from "vitest";
import { Experience } from "@mada/shared";
import { activitySuppliers, rankExperiences, sameExperience } from "@/lib/app/suppliers/activities";
import { parseKlook } from "@/lib/app/suppliers/klook/klook";
import { resetBreakers } from "@/lib/app/resilience/breaker";

/* Klook as another activities supplier: its switch, fixtures, parser, and the ranking across suppliers. */

const q = (city: string, ages = [30, 30]) => ({ placeId: "1", city, countryCode: "JP", lat: 35.68, lon: 139.76, from: "2027-04-01", to: "2027-04-07", ages, language: "en" as const, limit: 10 });

afterEach(() => {
  for (const k of ["SUPPLIER_MODE_KLOOK", "KLOOK_API_KEY", "SUPPLIER_MODE_ACTIVITIES"]) delete process.env[k];
  vi.unstubAllGlobals();
  resetBreakers();
});

describe("switch", () => {
  it("joins only when its own switch is on", () => {
    expect(activitySuppliers().map((s) => s.name)).toEqual(["hotelbeds"]);
    process.env.SUPPLIER_MODE_KLOOK = "mock";
    expect(activitySuppliers().map((s) => s.name)).toEqual(["hotelbeds", "klook"]);
    delete process.env.SUPPLIER_MODE_KLOOK;
    process.env.KLOOK_API_KEY = "k";
    expect(activitySuppliers().map((s) => s.name)).toEqual(["hotelbeds", "klook"]);
  });
});

describe("mock Klook", () => {
  it("answers Asian cities from fixtures, valid experiences in SAR", async () => {
    process.env.SUPPLIER_MODE_KLOOK = "mock";
    const klook = activitySuppliers().find((s) => s.name === "klook")!;
    const tokyo = await klook.search(q("Tokyo"));
    expect(tokyo).toHaveLength(3);
    for (const e of tokyo) Experience.parse(e);
    expect(tokyo[0]).toMatchObject({ id: "klook:1416", supplier: "klook", priceFrom: { currency: "SAR" }, image: { credit: "Klook" } });
    // USD 18.50 at the buffered rate + 15%, rounded up to a riyal.
    expect(tokyo[0]!.priceFrom.amount % 100).toBe(0);
    expect(tokyo[0]!.priceFrom.amount).toBeGreaterThan(7000);
    expect(await klook.search(q("Reykjavik"))).toEqual([]);
    expect((await klook.search(q("Tokyo", [2]))).map((e) => e.code)).not.toContain("2337");
  });
});

describe("parser", () => {
  it("drops what it can't read", () => {
    const got = parseKlook({ result: { activities: [{ activity_id: 1, title: "A", from_price: "10", currency: "USD" }, { activity_id: "x y", title: "B", from_price: "10" }, { activity_id: 3, title: "C", from_price: "0" }, { activity_id: 4, title: "D", from_price: "5", currency: "ZZZ" }] } }, 10);
    expect(got.map((e) => e.code)).toEqual(["1"]);
  });
  it("searches with the key", async () => {
    process.env.KLOOK_API_KEY = "secret";
    const f = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain("city=Tokyo");
      expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("secret");
      return new Response(JSON.stringify({ result: { activities: [{ activity_id: 9, title: "Sumo morning practice", from_price: 40, currency: "USD", review_score: 4.9, review_count: 300 }] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    const klook = activitySuppliers().find((s) => s.name === "klook")!;
    expect((await klook.search(q("Tokyo"))).map((e) => e.id)).toEqual(["klook:9"]);
  });
});

describe("ranked together", () => {
  it("keeps the cheaper of the same product and puts the trusted favourite first", async () => {
    process.env.SUPPLIER_MODE_KLOOK = "mock";
    const [hb, kl] = activitySuppliers();
    const dubai = { ...q("Dubai"), placeId: "292223" };
    const all = [...(await hb!.search(dubai)), ...(await kl!.search(dubai))];
    expect(sameExperience("Burj Khalifa: At the Top, levels 124 and 125", "Burj Khalifa At the Top tickets: levels 124 and 125")).toBe(true);
    expect(sameExperience("Desert safari with dinner", "Dubai Frame admission ticket")).toBe(false);
    const ranked = rankExperiences(all);
    const burj = ranked.filter((e) => /Burj/.test(e.title));
    expect(burj).toHaveLength(1);
    expect(burj[0]!.priceFrom.amount).toBe(Math.min(...all.filter((e) => /Burj/.test(e.title)).map((e) => e.priceFrom.amount)));
    expect(ranked.map((e) => e.supplier)).toContain("klook");
    // Thousands of 4.6 reviews beat a handful of 5.0s.
    const few = { ...ranked[0]!, id: "klook:1", supplier: "klook" as const, title: "Unknown gem", rating: 5, reviews: 3 };
    expect(rankExperiences([few, ranked[0]!])[0]!.id).toBe(ranked[0]!.id);
  });
});
