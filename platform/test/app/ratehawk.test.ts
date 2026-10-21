import { afterEach, describe, expect, it, vi } from "vitest";
import { HotelOffer, StayFacts } from "@mada/shared";
import { bookingSuppliers } from "@/lib/app/booking/common";
import { mergeHotelOffers, rateHawkSource, sameHotel, withSecondHotelSource } from "@/lib/app/suppliers/ratehawk";
import { clearMockRateHawk, mockRateHawk } from "@/lib/app/suppliers/ratehawk/mock";
import { cheapestRate, decodeRh, offerOf } from "@/lib/app/suppliers/ratehawk/parse";
import { clearRateHawkCache, serpBody } from "@/lib/app/suppliers/ratehawk/ratehawk";
import type { BookingHotelOffer, BookingHotelSupplier } from "@/lib/app/suppliers/booking-types";
import { resetBreakers } from "@/lib/app/resilience/breaker";

/* RateHawk as a second hotel source: the switch, fixtures through the real parser, booking, and the merge by hotel. */

const search = { city: "Istanbul", checkIn: "2027-03-09", nights: 6, adults: 2, rooms: 1 };

afterEach(() => {
  for (const k of ["SUPPLIER_MODE_RATEHAWK", "RATEHAWK_KEY_ID", "RATEHAWK_API_KEY"]) delete process.env[k];
  vi.unstubAllGlobals();
  clearMockRateHawk();
  clearRateHawkCache();
  resetBreakers();
});

describe("switch", () => {
  it("leaves stays alone unless RateHawk is on", async () => {
    expect(rateHawkSource()).toBeNull();
    expect((await bookingSuppliers.hotels().search(search)).every((o) => o.supplier !== "ratehawk")).toBe(true);
    process.env.SUPPLIER_MODE_RATEHAWK = "mock";
    expect(rateHawkSource()).toBe(mockRateHawk);
    delete process.env.SUPPLIER_MODE_RATEHAWK;
    process.env.RATEHAWK_KEY_ID = "1"; process.env.RATEHAWK_API_KEY = "k";
    expect(rateHawkSource()?.name).toBe("ratehawk");
    expect(rateHawkSource()).not.toBe(mockRateHawk);
  });
});

describe("mock RateHawk", () => {
  it("answers fixture hotels as valid offers with facts, cheapest first", async () => {
    const offers = await mockRateHawk.search(search);
    expect(offers.map((o) => o.name)).toEqual(["Galata Backpackers Hostel", "Sultanahmet Garden Hotel", "Bereketzade Hotel", "Pera Palace Hotel"]);
    for (const o of offers) { HotelOffer.parse(o); StayFacts.parse(o.meta!.facts); }
    const b = offers.find((o) => o.name === "Bereketzade Hotel")!;
    expect(b).toMatchObject({ supplier: "ratehawk", nights: 6, freeCancelUntil: "2027-03-02", meta: { facts: { stars: 4, board: "BB", refundable: true, lat: 41.02633, amenities: expect.arrayContaining(["wifi", "familyRooms", "connecting"]) } } });
    expect(offers[0]!.meta!.facts!.shared).toBe(true);
    expect(await mockRateHawk.search({ ...search, city: "Reykjavik" })).toEqual([]);
  });
  it("prices for a new party, and books, reads and cancels on our reference", async () => {
    const [, sultan] = await mockRateHawk.search(search);
    const priced = await mockRateHawk.price(sultan!.id);
    expect(priced.total).toEqual(sultan!.total);
    expect(decodeRh(priced.id)).toMatchObject({ party: 2 });
    const four = await mockRateHawk.price(priced.id.replace(/\.(\d+)$/, ".4"));
    expect(four.total.amount).toBeGreaterThan(sultan!.total.amount);
    await expect(mockRateHawk.book({ offerId: sultan!.id, reference: "o1", guests: [[{ firstName: "Sara", lastName: "Alharbi" }]], email: "s@example.com", phone: "+966500000001" })).rejects.toMatchObject({ code: "VALIDATION" });
    const b = await mockRateHawk.book({ offerId: priced.id, reference: "o1", guests: [[{ firstName: "Sara", lastName: "Alharbi" }]], email: "s@example.com", phone: "+966500000001" });
    expect(b).toMatchObject({ reference: "o1", status: "confirmed" });
    expect((await mockRateHawk.book({ offerId: priced.id, reference: "o1", guests: [], email: "", phone: "" })).orderId).toBe(b.orderId);
    expect(await mockRateHawk.cancel("o1")).toEqual({ cancelled: true });
    expect((await mockRateHawk.status("o1")).status).toBe("cancelled");
  });
});

describe("merged by hotel identity", () => {
  it("knows the same hotel by name and place, not by name alone", () => {
    const at = (name: string, lat: number | null, lng: number | null, supplier = "hotelbeds", amount = 100_000) => ({
      id: `${supplier}.${name}`, supplier, name, total: { amount, currency: "SAR" }, meta: { facts: lat === null ? null : { lat, lng } },
    }) as unknown as BookingHotelOffer;
    expect(sameHotel(at("Garden hotel in Sultanahmet", 41.0058, 28.9794), at("Sultanahmet Garden Hotel", 41.00552, 28.97818))).toBe(true);
    expect(sameHotel(at("Hilton Istanbul Bosphorus", 41.0442, 29.0004), at("Hilton Istanbul Bomonti", 41.0597, 28.9809))).toBe(false);
    expect(sameHotel(at("Rove Downtown", 25.19, 55.27), at("Rove Downtown", 25.23, 55.30))).toBe(false);
    expect(sameHotel(at("Rove Downtown", null, null), at("Rove Downtown", 25.19, 55.27))).toBe(true);
    expect(sameHotel(at("Rove Downtown", null, null), at("Rove Downtown Dubai", 25.19, 55.27))).toBe(false);
    const merged = mergeHotelOffers([at("Bereketzade Hotel", 41.0262, 28.9733, "hotelbeds", 600_000)], [at("Bereketzade Hotel", 41.02633, 28.97342, "ratehawk", 550_000), at("Pera Palace Hotel", 41.03, 28.97, "ratehawk")]);
    expect(merged.map((o) => o.id)).toEqual(["ratehawk.Bereketzade Hotel", "ratehawk.Pera Palace Hotel"]);
  });
  it("searches both, keeps the cheaper per hotel, routes price back, and survives a failure", async () => {
    process.env.SUPPLIER_MODE_RATEHAWK = "mock";
    const stays = await bookingSuppliers.hotels().search(search);
    const names = stays.map((o) => o.name);
    // Bereketzade and the Sultanahmet garden hotel are in both: each once, at the cheaper of the two prices.
    const both = [...(await bookingSuppliers.hotels().search(search)), ...(await mockRateHawk.search(search))];
    for (const re of [/bereketzade/i, /sultanahmet/i]) {
      const shown = stays.filter((o) => re.test(o.name));
      expect(shown).toHaveLength(1);
      expect(shown[0]!.total.amount).toBe(Math.min(...both.filter((o) => re.test(o.name)).map((o) => o.total.amount)));
    }
    expect(names).toContain("Bosphorus view rooms");
    expect(names).toContain("Pera Palace Hotel");
    const rh = stays.find((o) => o.supplier === "ratehawk")!;
    expect((await bookingSuppliers.hotels().price(rh.id)).supplier).toBe("ratehawk");
    const first: BookingHotelSupplier = { name: "hotelbeds", search: async () => { throw new Error("hotelbeds answered 503"); }, price: vi.fn() };
    expect((await withSecondHotelSource(first, mockRateHawk).search(search)).every((o) => o.supplier === "ratehawk")).toBe(true);
  });
});

describe("ETG wire format", () => {
  it("asks for Saudi residents' prices in SAR, one guests entry per room", () => {
    expect(serpBody({ regionId: 2734, city: "Istanbul", checkIn: "2027-03-09", nights: 6, adults: 3, childAges: [7], rooms: 2 }, "en"))
      .toEqual({ checkin: "2027-03-09", checkout: "2027-03-15", residency: "sa", language: "en", guests: [{ adults: 2, children: [7] }, { adults: 1, children: [] }], region_id: 2734, currency: "SAR" });
  });
  it("takes the cheapest deposit rate and reads a non-refundable one", () => {
    const h = { id: "x", rates: [
      { room_name: "A", meal: "nomeal", payment_options: { payment_types: [{ type: "deposit", amount: "900", currency_code: "SAR", cancellation_penalties: { free_cancellation_before: null } }] } },
      { room_name: "B", meal: "breakfast", payment_options: { payment_types: [{ type: "hotel", amount: "100", currency_code: "SAR" }, { type: "deposit", amount: "700", currency_code: "SAR" }] } },
    ] };
    const best = cheapestRate(h)!;
    expect(best.rate.room_name).toBe("B");
    const o = offerOf(h, h.rates[0]!, h.rates[0]!.payment_options.payment_types[0]!, null, { regionId: 1, city: "Riyadh", checkIn: "2027-01-01", nights: 2, adults: 2, childAges: [], rooms: 1 })!;
    expect(o).toMatchObject({ cancellation: "Not refundable.", freeCancelUntil: null, meta: { facts: { refundable: false, board: "RO", content: false } } });
  });
  it("calls ETG with Basic auth and reads its envelope", async () => {
    process.env.RATEHAWK_KEY_ID = "123"; process.env.RATEHAWK_API_KEY = "secret";
    const f = vi.fn(async (url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("123:secret").toString("base64")}`);
      if (url.endsWith("/search/multicomplete/")) return new Response(JSON.stringify({ status: "ok", error: null, data: { regions: [{ id: 2734, type: "City" }] } }));
      if (url.endsWith("/search/serp/region/")) return new Response(JSON.stringify({ status: "ok", error: null, data: { hotels: [{ id: "pera_palace_hotel", rates: [{ room_name: "King", meal: "breakfast", payment_options: { payment_types: [{ type: "deposit", amount: "1000.00", currency_code: "SAR" }] } }] }] } }));
      return new Response(JSON.stringify({ status: "ok", error: null, data: { id: "pera_palace_hotel", name: "Pera Palace Hotel", latitude: 41.03, longitude: 28.97, star_rating: 5 } }));
    });
    vi.stubGlobal("fetch", f);
    const offers = await rateHawkSource()!.search(search);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ name: "Pera Palace Hotel", supplier: "ratehawk", meta: { facts: { stars: 5 } } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "error", error: "no_available_rates", data: null }), { status: 200 })));
    await expect(rateHawkSource()!.price(offers[0]!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
