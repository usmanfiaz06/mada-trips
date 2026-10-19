import { afterAll, afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { rankStays } from "@mada/shared";
import { db } from "@/db";
import { appHotelbedsHotels } from "@/db/app-schema-hotelbeds";
import { HotelbedsClient } from "@/lib/app/suppliers/hotelbeds/client";
import { HotelbedsHotels, bestImage, bestRate, offersFromAvailability, photoUrl, type HbAvailabilityResponse, type HbHotel, type HotelFacts } from "@/lib/app/suppliers/hotelbeds/hotels";
import { dbFacts, factsOfRow } from "@/lib/app/suppliers/hotelbeds/app";
import { fillContentNow, forgetContentAsks } from "@/lib/app/suppliers/hotelbeds/content";
import { fixtureFetch } from "@/lib/app/suppliers/hotelbeds/mock";
import { pricingRules } from "@/lib/app/suppliers/hotelbeds/money";

/*
 * The London case from staging (10–13 Dec, 1 adult, Hotelbeds test): a dorm bed in a hostel was "Our pick", and the
 * hotels without stored content all showed the same stock room photo. Shaped on that answer: hostels and dorm beds,
 * a hotel whose cheapest room shares a bathroom, real hotels from 2 to 5 stars around the centre.
 */

const CI = "2026-12-10", CO = "2026-12-13";
type R = { code: string; name: string; net: number; board?: string; nrf?: boolean };
function hotel(code: number, name: string, categoryCode: string, lat: number, lng: number, rooms: R[], categoryName?: string): HbHotel {
  return {
    code, name, categoryCode, categoryName: categoryName ?? `${categoryCode[0]} STARS`, zoneName: "Central London", destinationName: "London", latitude: String(lat), longitude: String(lng), currency: "GBP",
    rooms: rooms.map((r) => ({
      code: r.code, name: r.name,
      rates: [{
        rateKey: `20261210|20261213|W|1|${code}|${r.code}|RATE|${r.board ?? "RO"}||1~1~0||N@${code}${r.code}`, rateClass: r.nrf ? "NRF" : "NOR", rateType: "BOOKABLE", net: r.net.toFixed(2), paymentType: "AT_WEB",
        boardCode: r.board ?? "RO", boardName: r.board === "BB" ? "BED AND BREAKFAST" : "ROOM ONLY", rooms: 1, adults: 1, children: 0,
        cancellationPolicies: r.nrf ? [{ amount: r.net.toFixed(2), from: "2026-10-01T00:00:00+01:00" }] : [{ amount: r.net.toFixed(2), from: "2026-12-07T23:59:00+00:00" }],
      }],
    })),
  };
}

export const LONDON: HbAvailabilityResponse = {
  hotels: {
    checkIn: CI, checkOut: CO, total: 9,
    hotels: [
      hotel(1001, "ST CHRISTOPHER'S LONDON BRIDGE THE INN", "3EST", 51.5023, -0.0915, [{ code: "ROO.MX", name: "8-BED MIXED WITH EXTERNAL SHARED BATHROOM", net: 75 }]),
      hotel(1002, "GENERATOR LONDON", "HSR2", 51.5262, -0.1225, [{ code: "BED.ST", name: "BED IN 8-BED DORMITORY", net: 60 }, { code: "TWN.ST", name: "PRIVATE TWIN", net: 190 }], "HOSTEL"),
      hotel(1003, "STRAND PALACE", "4EST", 51.5104, -0.1205, [{ code: "DBL.ST", name: "DOUBLE STANDARD", net: 520 }, { code: "DBL.ST", name: "DOUBLE STANDARD", net: 590, board: "BB" }]),
      hotel(1004, "PREMIER INN LONDON COUNTY HALL", "3EST", 51.5014, -0.1171, [{ code: "DBL.ST", name: "DOUBLE ROOM", net: 420 }]),
      hotel(1005, "POINT A HOTEL LONDON KINGS CROSS", "3EST", 51.5308, -0.1238, [{ code: "DBL.ST", name: "DOUBLE ROOM", net: 300, nrf: true }]),
      hotel(1006, "HILTON LONDON BANKSIDE", "5EST", 51.505, -0.1, [{ code: "DBL.KG", name: "KING GUEST ROOM", net: 980, board: "BB" }]),
      hotel(1007, "KINGS CROSS INN HOTEL", "2EST", 51.5302, -0.1215, [{ code: "DBL.SH", name: "DOUBLE WITH SHARED BATHROOM", net: 180 }, { code: "DBL.EN", name: "DOUBLE ENSUITE", net: 240 }]),
      hotel(1008, "THE RESIDENT COVENT GARDEN", "4EST", 51.5121, -0.1235, [{ code: "DBL.ST", name: "DOUBLE ROOM", net: 610 }]),
      hotel(1009, "CLINK78", "HS", 51.5293, -0.1183, [{ code: "ROO.FE", name: "4-BED FEMALE ONLY", net: 70 }], "HOSTEL"),
    ],
  },
};

const img = (code: number) => `https://photos.hotelbeds.com/giata/bigger/${String(code).slice(0, 2)}/${code}/${code}a_hb_a_001.jpg`;
const facts = new Map<number, HotelFacts>([1003, 1004, 1006, 1008].map((code) => [code, { code, name: "", address: null, imageUrl: img(code), phone: null, latitude: null, longitude: null }]));
const opts = { nights: 3, party: 1, rooms: 1, checkIn: CI, facts, city: "london", limit: 200, rules: { ...pricingRules(), fxBufferBps: 0 }, now: new Date("2026-10-19T09:00:00Z") };

describe("London, 10–13 Dec, 1 adult: no dorm bed is ever a pick", () => {
  it("marks dorm beds, shared bathrooms and hostels as shared, and sells a private room where the hotel has one", () => {
    const offers = offersFromAvailability(LONDON, opts);
    const by = Object.fromEntries(offers.map((o) => [o.meta!.hotelCode!, o]));
    expect(by[1001]!.meta!.facts!.shared).toBe(true);
    expect(by[1002]!.meta!.facts!.shared).toBe(true);
    expect(by[1009]!.meta!.facts!.shared).toBe(true);
    // Kings Cross Inn: the ensuite double, not the cheaper one down the hall.
    expect(by[1007]!.meta!.facts).toMatchObject({ room: "Double ensuite", shared: false });
    expect(bestRate(LONDON.hotels!.hotels![6]!, 1)!.room.code).toBe("DBL.EN");
    expect(by[1003]!.meta!.facts!.shared).toBe(false);
  });

  it("puts every shared room after the private ones, with no badge, and picks a 3-star-and-up private room", () => {
    const offers = offersFromAvailability(LONDON, opts);
    const firstShared = offers.findIndex((o) => o.meta!.facts!.shared);
    expect(offers.slice(firstShared).every((o) => o.meta!.facts!.shared)).toBe(true);
    expect(offers.filter((o) => o.meta!.facts!.shared).every((o) => o.meta!.badge === null)).toBe(true);
    const best = offers.find((o) => o.meta!.badge === "best")!;
    expect(best.meta!.facts).toMatchObject({ shared: false });
    expect(best.meta!.facts!.stars).toBeGreaterThanOrEqual(3);
    expect(offers.find((o) => o.meta!.badge === "lowest")!.meta!.facts!.shared).toBe(false);
  });

  it("the search service's ranking for one adult (solo): the new top 3", () => {
    const offers = offersFromAvailability(LONDON, opts);
    const ranked = rankStays(offers.map((h) => ({ h, name: h.name, total: h.total, facts: h.meta?.facts ?? null })), { shape: "solo", city: "london", radiusKm: 8 });
    const top3 = ranked.slice(0, 3).map((r) => `${r.name} (${r.facts?.stars}★, ${r.facts?.room}, SAR ${r.total.amount / 100}, score ${r.score}${r.badge ? `, ${r.badge}` : ""})`);
    console.log(`London top 3 (solo):\n  ${top3.join("\n  ")}`);
    expect(ranked.slice(0, 3).some((r) => r.facts?.shared)).toBe(false);
    expect(ranked.find((r) => r.badge === "best")!.name).not.toMatch(/CHRISTOPHER|GENERATOR|CLINK/);
    // A family of four (2 rooms) is never split into dorm beds either: shared rooms carry no badge whatever the shape.
    const fam = rankStays(offers.map((h) => ({ h, name: h.name, total: h.total, facts: h.meta?.facts ?? null })), { shape: "family", city: "london", radiusKm: 8 });
    expect(fam.filter((r) => r.badge).every((r) => !r.facts?.shared)).toBe(true);
  });
});

describe("hotel photos", () => {
  it("leads with the hotel itself (GEN), then a room (HAB), then common areas, by visualOrder", () => {
    expect(bestImage([{ path: "a/r.jpg", type: "HAB", visualOrder: 1 }, { path: "a/g2.jpg", type: "GEN", visualOrder: 4 }, { path: "a/g1.jpg", type: "GEN", visualOrder: 2 }])!.path).toBe("a/g1.jpg");
    expect(bestImage([{ path: "a/pool.jpg", type: "PIS" }, { path: "a/lobby.jpg", type: "COM" }])!.path).toBe("a/lobby.jpg");
    expect(bestImage([{ path: "", type: "GEN" }, { path: "a/doc.pdf", type: "GEN" }])).toBeNull();
    expect(bestImage([])).toBeNull();
    expect(photoUrl("/99/99701/x.jpg")).toBe("https://photos.hotelbeds.com/giata/bigger/99/99701/x.jpg");
    expect(photoUrl("99/99701/x.jpg", "xl")).toBe("https://photos.hotelbeds.com/giata/xl/99/99701/x.jpg");
  });

  it("a stored hotel's facts use its best photo at the card size; a hotel without photos has none (the app shows its tile)", () => {
    const row = { code: 5, name: "X", address: "1 Strand", city: "LONDON", phone: null, latitude: 51.5, longitude: -0.12, facilities: [], description: null, category: "4EST" };
    expect(factsOfRow({ ...row, images: [{ path: "00/5/room.jpg", type: "HAB" }, { path: "00/5/front.jpg", type: "GEN" }] }).imageUrl).toBe("https://photos.hotelbeds.com/giata/bigger/00/5/front.jpg");
    expect(factsOfRow({ ...row, images: [] }).imageUrl).toBeNull();
    expect(factsOfRow({ ...row, images: [], category: "HS" }).hostel).toBe(true);
  });
});

/* ───────────── the content store ───────────── */

const STORED = Array.from({ length: 260 }, (_, i) => 880_000 + i);
const FIXTURE = [99701, 99702, 99703, 99704];
afterEach(() => forgetContentAsks());
afterAll(async () => { await db.delete(appHotelbedsHotels).where(inArray(appHotelbedsHotels.code, [...STORED, ...FIXTURE])); });

describe("hotel content for every hotel shown", () => {
  it("looks up stored facts for every hotel in the answer, not just the first 200 codes", async () => {
    await db.delete(appHotelbedsHotels).where(inArray(appHotelbedsHotels.code, STORED));
    await db.insert(appHotelbedsHotels).values(STORED.map((code) => ({ code, name: `Hotel ${code}`, images: [{ path: `88/${code}/${code}a_hb_a_001.jpg`, type: "GEN" }], facilities: [] })));
    const f = await dbFacts(STORED);
    expect(f.size).toBe(STORED.length);
    expect(f.get(880_250)!.imageUrl).toBe("https://photos.hotelbeds.com/giata/bigger/88/880250/880250a_hb_a_001.jpg");
  });

  it("fetches hotels the store doesn't hold yet by code, stores them, and doesn't ask again for the same hotel", async () => {
    await db.delete(appHotelbedsHotels).where(inArray(appHotelbedsHotels.code, FIXTURE));
    const api = new HotelbedsHotels(new HotelbedsClient({ product: "hotels", credentials: { apiKey: "abc123key", secret: "s3cr3t" }, env: "test", fetch: fixtureFetch(), log: () => {}, sleep: async () => {} }));
    expect(await fillContentNow(FIXTURE, { api })).toBe(4);
    const f = await dbFacts(FIXTURE);
    expect(f.get(99701)!.imageUrl).toBe("https://photos.hotelbeds.com/giata/bigger/99/99701/99701a_hb_a_001.jpg");
    // Hotelbeds holds no photos for Taksim City Rooms: stored without one, so the app says so instead of a stock photo.
    expect(f.get(99704)!.imageUrl).toBeNull();
    expect(await fillContentNow(FIXTURE, { api })).toBe(0);
  });
});
