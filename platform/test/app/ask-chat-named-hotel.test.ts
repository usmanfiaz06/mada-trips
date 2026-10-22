import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import type { Person } from "@mada/shared";
import { db } from "@/db";
import { appHotelbedsHotels } from "@/db/app-schema-hotelbeds";
import { GET as peopleGet } from "@/app/api/app/v1/people/route";
import { runTool, type ToolCtx } from "@/lib/app/ask-chat/tools";
import { bestNamed, nameQuery, nameScore } from "@/lib/app/booking/named-hotel";
import { clearSearchCache } from "@/lib/app/booking/search";
import { HotelbedsHotels } from "@/lib/app/suppliers/hotelbeds/hotels";
import { resetMockHotelbeds } from "@/lib/app/suppliers/hotelbeds/mock";
import { call } from "./helpers";
import { signIn } from "./wallet-helpers";

/*
 * A hotel by name in Ask (staging: "Four season london, rates for one week anytime in November" came back with the
 * generic London list). Only the named hotel is searched; no rooms or no such hotel is said plainly, never filled
 * with other hotels.
 */

const LONDON = [
  { code: 990_001, name: "FOUR SEASONS HOTEL LONDON AT PARK LANE", latitude: 51.5035, longitude: -0.1517 },
  { code: 990_002, name: "Four Seasons Hotel London at Ten Trinity Square", latitude: 51.5096, longitude: -0.0776 },
  { code: 990_003, name: "Park Plaza Westminster Bridge", latitude: 51.5009, longitude: -0.1166 },
  { code: 990_004, name: "Four Points by Sheraton London", latitude: 51.47, longitude: -0.45 },
];
// The fixtures' Istanbul hotel, stored with its name so the content lookup finds it (the fixtures answer with rooms).
const ISTANBUL = [{ code: 99_701, name: "GALATA TOWER SUITES", latitude: 41.0256, longitude: 28.9744 }];
const CODES = [...LONDON, ...ISTANBUL].map((h) => h.code);

let ctx: ToolCtx;
beforeAll(async () => {
  const me = await signIn();
  const people = (await call(peopleGet, { method: "GET", token: me.token })).json.people as Person[];
  ctx = { ownerId: me.user.id, people, today: "2026-10-22", lang: "en", ipHash: null, demo: new Set() };
  await db.delete(appHotelbedsHotels).where(inArray(appHotelbedsHotels.code, CODES));
  await db.insert(appHotelbedsHotels).values([...LONDON, ...ISTANBUL].map((h) => ({ ...h, images: [], facilities: [] })));
});
afterAll(async () => { await db.delete(appHotelbedsHotels).where(inArray(appHotelbedsHotels.code, CODES)); });
beforeEach(() => { process.env.SUPPLIER_MODE_HOTELS = "hotelbeds-mock"; clearSearchCache(); resetMockHotelbeds(); });
afterEach(() => { delete process.env.SUPPLIER_MODE_HOTELS; vi.restoreAllMocks(); });

const stays = (a: Record<string, unknown>) => runTool("search_stays", { traveller_ids: [], wishes: null, hotel_name: null, ...a }, ctx);

describe("matching a hotel's name", () => {
  it("tolerates case, accents, a missing plural and the city's own name", () => {
    expect(nameQuery("four season london", "london")).toEqual(["four", "season"]);
    expect(nameScore(nameQuery("four season london", "london"), "Four Seasons Hotel London at Park Lane")).toBeGreaterThan(0);
    expect(nameScore(nameQuery("Hotel Plaza Athenee", "paris"), "Hôtel Plaza Athénée")).toBeGreaterThan(0);
    expect(nameScore(nameQuery("four season", "london"), "Four Points by Sheraton London")).toBe(0);
    // Two Four Seasons in London: both, the closer name first.
    expect(bestNamed(nameQuery("Four Seasons", "london"), LONDON).map((h) => h.code)).toEqual([990_001, 990_002]);
    expect(nameQuery("a hotel in London", "london")).toEqual([]);
  });
});

describe("search_stays with hotel_name", () => {
  it("asks for the named hotels' codes only, and says plainly when they have no rooms, with no other hotel in their place", async () => {
    // The real adapter, with availability answered here (no network): another London hotel has rooms, the named ones none.
    process.env.SUPPLIER_MODE_HOTELS = "hotelbeds";
    const other = {
      code: 990_003, name: "PARK PLAZA WESTMINSTER BRIDGE", categoryCode: "4EST", categoryName: "4 STARS", zoneName: "Westminster", destinationName: "London", latitude: "51.5009", longitude: "-0.1166", currency: "GBP",
      rooms: [{ code: "DBL.ST", name: "DOUBLE STANDARD", rates: [{ rateKey: "20261115|20261122|W|1|990003|DBL.ST|RATE|RO||1~1~0||N@1", rateClass: "NOR", rateType: "BOOKABLE", net: "900.00", paymentType: "AT_WEB", boardCode: "RO", boardName: "ROOM ONLY", rooms: 1, adults: 1, children: 0, cancellationPolicies: [{ amount: "900.00", from: "2026-11-12T23:59:00+00:00" }] }] }],
    };
    const spy = vi.spyOn(HotelbedsHotels.prototype, "availability").mockResolvedValue({ hotels: { checkIn: "2026-11-15", checkOut: "2026-11-22", total: 1, hotels: [other] } } as never);
    const out = await stays({ destination: "london", check_in: "2026-11-15", nights: 7, hotel_name: "four season london" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toMatchObject({ hotelCodes: [990_001, 990_002] });
    expect(spy.mock.calls[0]![0]).not.toHaveProperty("geolocation");
    expect(out.text).toMatch(/^Four Seasons Hotel London At Park Lane; Four Seasons Hotel London at Ten Trinity Square: no rooms we can book online for 15–22 Nov/);
    expect(out.text).toMatch(/create_request/);
    expect(out.cards).toBeUndefined();
    expect(out.text).not.toMatch(/Park Plaza|Sheraton|hotelbeds/i);
  });

  it("shows the named hotel's rates when it has rooms, and only that hotel", async () => {
    const spy = vi.spyOn(HotelbedsHotels.prototype, "availability");
    const out = await stays({ destination: "istanbul", check_in: "2026-11-15", nights: 7, hotel_name: "Galata Tower Suites" });
    expect(spy.mock.calls[0]![0]).toMatchObject({ hotelCodes: [99_701] });
    expect(out.text).toMatch(/^The hotel they named \("Galata Tower Suites"\)/);
    const card = out.cards?.[0];
    expect(card?.type).toBe("stays");
    const names = card?.type === "stays" ? card.options.map((o) => o.name) : [];
    expect(names).toEqual(["GALATA TOWER SUITES"]);
  });

  it("a name we hold no hotel under: we can't find it online, offer the team, never that it doesn't exist, and no search", async () => {
    const spy = vi.spyOn(HotelbedsHotels.prototype, "availability");
    const out = await stays({ destination: "london", check_in: "2026-11-15", nights: 7, hotel_name: "The Lanesborough" });
    expect(spy).not.toHaveBeenCalled();
    expect(out.text).toMatch(/"The Lanesborough" is not among the hotels we can book online in London/);
    expect(out.text).toMatch(/create_request kind stay/);
    expect(out.text).toMatch(/never that it doesn't exist/);
    expect(out.cards).toBeUndefined();
  });

  it("the catalogue matches by its own names", async () => {
    delete process.env.SUPPLIER_MODE_HOTELS;
    const found = await stays({ destination: "istanbul", check_in: "2026-11-15", nights: 3, hotel_name: "bereketzade" });
    expect(found.cards?.[0]?.type === "stays" && found.cards[0].options.map((o) => o.name)).toEqual(["Bereketzade Hotel"]);
    const none = await stays({ destination: "istanbul", check_in: "2026-11-15", nights: 3, hotel_name: "Ciragan Palace Kempinski" });
    expect(none.text).toMatch(/not among the hotels we can book online in Istanbul/);
  });
});
