import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CreateOrderResponse, PreviewResponse, StaySearchResponse, addDays, todayIn, type ChatCard, type OrderDraft, type Person } from "@mada/shared";
import { db } from "@/db";
import { appTrips } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appSupplierBookings } from "@/db/app-schema-hotelbeds";
import { appPlaceCountries, appPlaces } from "@/db/app-schema-places";
import { POST as searchPost } from "@/app/api/app/v1/search/stays/route";
import { POST as previewPost } from "@/app/api/app/v1/orders/preview/route";
import { POST as ordersPost } from "@/app/api/app/v1/orders/route";
import { GET as peopleGet } from "@/app/api/app/v1/people/route";
import { POST as cardsPost } from "@/app/api/app/v1/cards/route";
import { GET as voucherGet } from "@/app/api/app/v1/vouchers/[id]/route";
import { confirmOrder } from "@/lib/app/booking/desk";
import { runTool, statusFor, type ToolCtx } from "@/lib/app/ask-chat/tools";
import { clearSearchCache, searchStays } from "@/lib/app/booking/search";
import { radiusFor, resolveStayPlace } from "@/lib/app/booking/stay-place";
import { fixtureFetch, resetMockHotelbeds, setHotelbedsTestFetch } from "@/lib/app/suppliers/hotelbeds/mock";
import { resetBreakers } from "@/lib/app/resilience/breaker";
import { callP, signIn } from "./wallet-helpers";
import { scanJson } from "../../../tools/leak-scan/denylist.mjs";

/*
 * Stays anywhere in the world (no destination key): "Hotel in Lahore" is searched instantly, by the place's point and a
 * radius sized to the city (Hotelbeds by geolocation), ranked and refined as usual, booked through the same pay sheet,
 * order and Hotelbeds booking as a key city, and written to a trip named for the place. A place nobody can put on the
 * map, or the offline catalogue, answers plainly with nothing (never a sample hotel). No network: the place comes from
 * our GeoNames table, Hotelbeds from its fixtures.
 */

const LAHORE = { lat: 31.558, lng: 74.35071 };
const CHECK_IN = addDays(todayIn(), 40);
const post = (h: Parameters<typeof callP>[0], token: string, body: unknown) => callP(h, {}, { method: "POST", token, body });

/** Availability bodies as sent to Hotelbeds; a search around Lahore is answered by the fixture's own hotels. */
let bodies: Record<string, unknown>[] = [];
function hotelbedsAnywhere() {
  bodies = [];
  const fx = fixtureFetch();
  setHotelbedsTestFetch(async (url, init) => {
    if (init.method === "POST" && url.endsWith("/hotel-api/1.0/hotels") && init.body) {
      const b = JSON.parse(init.body) as Record<string, unknown>;
      bodies.push(b);
      // The fixture only answers around its own city: Hotelbeds' answer for Lahore, played by those hotels.
      if (b.geolocation) return fx(url, { ...init, body: JSON.stringify({ ...b, geolocation: { latitude: 41.0256, longitude: 28.9744, radius: 8, unit: "km" } }) });
    }
    return fx(url, init);
  });
}

const ENV0 = { ...process.env };
let me: { token: string; userId: string; people: Person[]; cardId: string };
let ctx: ToolCtx;

beforeAll(async () => {
  await db.insert(appPlaceCountries).values({ code: "PK", name: "Pakistan", nameAr: "باكستان" }).onConflictDoNothing();
  await db.insert(appPlaces).values({ id: 1172451, slug: "lahore", name: "Lahore", nameAr: "لاهور", countryCode: "PK", lat: LAHORE.lat, lon: LAHORE.lng, timezone: "Asia/Karachi", population: 6_310_888, featureCode: "PPLA" }).onConflictDoNothing();
  const s = await signIn();
  const people = (await callP(peopleGet, {}, { method: "GET", token: s.token })).json.people as Person[];
  const card = await post(cardsPost, s.token, { token: "tok_mock_visa41", brand: "visa", last4: "4241", exp: "08/28", makeDefault: true });
  const cardId = (card.json.cards as { id: string; last4: string }[]).find((c) => c.last4 === "4241")!.id;
  me = { token: s.token, userId: s.user.id, people, cardId };
  ctx = { ownerId: s.user.id, people, today: todayIn(), lang: "en", ipHash: null, demo: new Set() };
});
beforeEach(() => { clearSearchCache(); resetMockHotelbeds(); resetBreakers(); });
afterEach(() => {
  for (const k of ["SUPPLIER_MODE_HOTELS", "APP_ENV", "APP_STAYS_MODE"]) { if (ENV0[k] === undefined) delete process.env[k]; else process.env[k] = ENV0[k]; }
  setHotelbedsTestFetch(null);
});

const self = () => me.people.find((p) => p.isSelf)!.id;

describe("where a place is", () => {
  it("finds a city in our GeoNames table (the country said picks the right one) and sizes the radius by its people", async () => {
    expect(await resolveStayPlace({ name: "Lahore, Pakistan" })).toEqual({ name: "Lahore", nameAr: "لاهور", country: "Pakistan", ...LAHORE, radiusKm: 20 });
    expect(await resolveStayPlace({ name: "lahore, PK" })).toMatchObject({ name: "Lahore", country: "Pakistan" });
    // A plan's own point wins; the table still names it.
    expect(await resolveStayPlace({ name: "Lahore", lat: 31.5, lng: 74.3 })).toMatchObject({ name: "Lahore", lat: 31.5, lng: 74.3, radiusKm: 20 });
    // Nowhere we know, and the open geocoder is off in tests: nothing, never a guessed point.
    expect(await resolveStayPlace({ name: "Qwertyville, Nowhere" })).toBeNull();
    expect([radiusFor(9_000_000), radiusFor(2_000_000), radiusFor(400_000), radiusFor(30_000)]).toEqual([20, 12, 8, 5]);
  });
});

describe("stays anywhere in the world", () => {
  it("searches Hotelbeds around the place (geolocation and radius), ranked, with the partner kept out", async () => {
    process.env.SUPPLIER_MODE_HOTELS = "hotelbeds-mock";
    hotelbedsAnywhere();
    const r = await post(searchPost, me.token, { destination: "other", place: { name: "Lahore, Pakistan" }, checkIn: CHECK_IN, nights: 2, travellerIds: [self()] });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const s = StaySearchResponse.parse(r.json);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ geolocation: { latitude: LAHORE.lat, longitude: LAHORE.lng, radius: 20, unit: "km" }, stay: { checkIn: CHECK_IN, checkOut: addDays(CHECK_IN, 2) } });
    expect(bodies[0]).not.toHaveProperty("destination");
    expect(s).toMatchObject({ outcome: "ok", destination: "other", destinationName: "Lahore", place: { name: "Lahore", nameAr: "لاهور", country: "Pakistan", ...LAHORE } });
    expect(s.options.length).toBeGreaterThan(1);
    expect(s.options.filter((o) => o.badge === "best")).toHaveLength(1);
    expect(s.options.filter((o) => o.badge === "lowest")).toHaveLength(1);
    expect(s.options.every((o) => typeof o.score === "number" && o.fit)).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/hotelbeds|"rateKey"|"net"/i);
    expect(scanJson(s)).toEqual([]);
  });

  it("search_stays takes a place in words: card, Arabic name, status line, and wishes still refine", async () => {
    process.env.SUPPLIER_MODE_HOTELS = "hotelbeds-mock";
    hotelbedsAnywhere();
    const out = await runTool("search_stays", { destination: null, place: "Lahore, Pakistan", check_in: CHECK_IN, nights: 2, traveller_ids: [], wishes: "free cancellation", hotel_name: null }, ctx);
    expect(out.isError).toBeFalsy();
    expect(out.text).toMatch(/^Stays in Lahore, Pakistan, 2 nights/);
    expect(out.text).toMatch(/wishes: /);
    const card = out.cards![0] as Extract<ChatCard, { type: "stays" }>;
    expect(card.search).toMatchObject({ destination: "other", destinationName: "Lahore", destinationNameAr: "لاهور" });
    expect(card.options.length).toBeGreaterThan(0);
    expect(statusFor("search_stays", { destination: null, place: "Lahore, Pakistan" }, "ar")).toBe("نشوف السكن في لاهور");
    expect(statusFor("search_stays", { destination: null, place: "Lahore, Pakistan" }, "en")).toBe("Checking places to stay in Lahore");
    // A place that is one of our keys reads as that key.
    const dubai = await runTool("search_stays", { destination: null, place: "Istanbul, Turkey", check_in: CHECK_IN, nights: 2, traveller_ids: [], wishes: null, hotel_name: null }, ctx);
    expect((dubai.cards![0] as Extract<ChatCard, { type: "stays" }>).search.destination).toBe("istanbul");
  });

  it("a place nobody can put on the map: asked plainly, no search, no hotels", async () => {
    process.env.SUPPLIER_MODE_HOTELS = "hotelbeds-mock";
    hotelbedsAnywhere();
    const out = await runTool("search_stays", { destination: null, place: "Qwertyville, Nowhere", check_in: CHECK_IN, nights: 2, traveller_ids: [], wishes: null, hotel_name: null }, ctx);
    expect(out.text).toMatch(/couldn't place it on the map/);
    expect(out.text).toMatch(/never say it isn't sold/);
    expect(out.cards).toBeUndefined();
    expect(bodies).toHaveLength(0);
    const r = await searchStays(me.userId, { destination: "other", place: { name: "Qwertyville" }, checkIn: CHECK_IN, nights: 2, travellerIds: [self()] }, new Set());
    expect(r).toMatchObject({ outcome: "none", options: [], place: null });
  });

  it("offline (the catalogue): nothing instant there, said plainly, never a sample hotel", async () => {
    delete process.env.SUPPLIER_MODE_HOTELS;
    const r = await searchStays(me.userId, { destination: "other", place: { name: "Lahore, Pakistan" }, checkIn: CHECK_IN, nights: 2, travellerIds: [self()] }, new Set());
    expect(r).toMatchObject({ outcome: "none", options: [], destination: "other", destinationName: "Lahore" });
    const out = await runTool("search_stays", { destination: null, place: "Lahore, Pakistan", check_in: CHECK_IN, nights: 2, traveller_ids: [], wishes: null, hotel_name: null }, ctx);
    expect(out.text).toMatch(/^No rooms we can book instantly in Lahore/);
    expect(out.text).toMatch(/never that the place isn't sold/);
    expect(out.cards).toBeUndefined();
  });

  it("books a stay found anywhere through the same pay sheet, order and Hotelbeds booking; the trip is named for the place", async () => {
    process.env.SUPPLIER_MODE_HOTELS = "hotelbeds-mock";
    process.env.APP_ENV = "staging";
    hotelbedsAnywhere();
    const ids = [self()];
    const s = StaySearchResponse.parse((await post(searchPost, me.token, { destination: "other", place: { name: "Lahore, Pakistan" }, checkIn: CHECK_IN, nights: 2, travellerIds: ids })).json);
    expect(s.outcome, JSON.stringify(s)).toBe("ok");
    const pick = s.options.find((o) => o.name === "TAKSIM CITY ROOMS") ?? s.options[0]!;
    const draft: OrderDraft = { kind: "stay", stayOfferId: pick.id, travellerIds: ids };
    const pv = await post(previewPost, me.token, { draft, useCredit: false });
    expect(pv.status, JSON.stringify(pv.json)).toBe(200);
    const preview = PreviewResponse.parse(pv.json).preview;
    expect(preview.title).toBe(pick.name);
    expect(JSON.stringify(preview)).not.toMatch(/undefined/);
    const r = await post(ordersPost, me.token, { draft, useCredit: false, payment: { method: "card", cardId: me.cardId }, plan: "full", expectedTotal: preview.total.amount, idempotencyKey: `any-${Math.random().toString(36).slice(2, 12)}` });
    expect([200, 201], JSON.stringify(r.json)).toContain(r.status);
    const order = (CreateOrderResponse.parse(r.json) as { order: { id: string; place: string } }).order;
    expect(order.place).toBe("Lahore");
    const [booking] = await db.select().from(appSupplierBookings).where(eq(appSupplierBookings.sourceId, order.id));
    expect(booking).toMatchObject({ status: "confirmed" });
    // The voucher, as the traveller opens it.
    const v = await callP(voucherGet, { id: booking!.id }, { method: "GET", token: me.token });
    expect(v.status, JSON.stringify(v.json)).toBe(200);
    expect(JSON.stringify(v.json)).not.toMatch(/undefined/);
    // The desk confirms it (as for any stay): the trip is written, named for the place.
    await confirmOrder(order.id, { name: "Faisal" });
    const [row] = await db.select().from(appOrders).where(eq(appOrders.id, order.id));
    expect(row!.tripId).toBeTruthy();
    const [trip] = await db.select().from(appTrips).where(eq(appTrips.id, row!.tripId!));
    expect(trip).toMatchObject({ city: "Lahore", country: "Pakistan", startDate: CHECK_IN, endDate: addDays(CHECK_IN, 2) });
  });
});

describe("a plan's night in a place without a key", () => {
  it("find_for_item searches stays there instead of handing it to the team", async () => {
    process.env.SUPPLIER_MODE_HOTELS = "hotelbeds-mock";
    hotelbedsAnywhere();
    const made = await runTool("create_plan", {
      trip_id: null, template_id: null, origin: "RUH", return_to: null, start: CHECK_IN, days: 4, traveller_ids: [], pace: "normal", must: [], travel_mode: "mixed",
      stops: [{ place: "Lahore", nights: 3 }],
    }, ctx);
    const plan = made.cards![0] as Extract<ChatCard, { type: "plan" }>;
    const gist = (await runTool("get_plan", { plan_id: plan.planId }, ctx)).text;
    const stay = /\[([0-9a-f]{8})\] stay Lahore/.exec(gist)![1]!;
    const out = await runTool("find_for_item", { plan_id: plan.planId, item: stay }, ctx);
    expect(out.text).not.toMatch(/Not sold live|create_request kind stay/);
    expect(out.text).toMatch(/^Stays in Lahore, Pakistan, 3 nights/);
    expect((out.cards![0] as Extract<ChatCard, { type: "stays" }>).search.destinationName).toBe("Lahore");
    expect(bodies[0]).toMatchObject({ geolocation: { radius: 20, unit: "km" } });
  });
});
