import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, sql as q } from "drizzle-orm";
import {
  BookThingResponse, ItineraryResponse, RideThingResponse, MessagesResponse, ThingsResponse, TripIdeasResponse, filterActivities, kindOf, localClock, moodOf, nextPrayer, openState, parseHours,
  popularityOf, prayerTimes, todayIdeas, type Activity,
} from "@mada/shared";
import { db, schema, sql } from "@/db";
import { appPeople, appRequests, appStays, appTrips, appUsers } from "@/db/app-schema";
import { appActivities, appActivityCities, appGeocodes, appTripIdeas, appWhatsOn } from "@/db/app-schema-activities";
import { runIngest } from "@/lib/app/places/ingest";
import { gatherCity, refreshCity, refreshDue, storeCity } from "@/lib/app/activities/ingest";
import { addressOf, overpassQuery, pageviewWindow, parseOverpass, parseWikidata, radiusKmFor } from "@/lib/app/activities/opendata";
import { parseOpenMeteo } from "@/lib/app/activities/weather";
import { parseTicketmaster, ticketmasterUrl } from "@/lib/app/activities/ticketmaster";
import { pendingThings, thingsFor } from "@/lib/app/activities/things";
import { activitySell, hotelbedsActivities, meetingPointOf, parseHotelbedsAvailability, parseHotelbedsDetail } from "@/lib/app/suppliers/hotelbeds/activities";
import { parseGyg } from "@/lib/app/suppliers/live/getyourguide";
import { parseViator } from "@/lib/app/suppliers/live/viator";
import { pricingRules } from "@/lib/app/suppliers/hotelbeds/money";
import type { DeskActor } from "@/lib/app/desk/core";
import { bookOnHotelbeds, listWhatsOn, saveWhatsOn, setWhatsOnActive } from "@/lib/app/desk/whats-on";
import { deskInbox } from "@/lib/app/desk/inbox";
import { GET as thingsGet } from "@/app/api/app/v1/places/[id]/things/route";
import { POST as bookPost } from "@/app/api/app/v1/things/book/route";
import { POST as ridePost } from "@/app/api/app/v1/things/ride/route";
import { GET as tripThingsGet } from "@/app/api/app/v1/trips/[id]/things/route";
import { GET as ideasGet, POST as ideasPost } from "@/app/api/app/v1/trips/[id]/ideas/route";
import { DELETE as ideaDelete } from "@/app/api/app/v1/trips/[id]/ideas/[ideaId]/route";
import { GET as itineraryGet } from "@/app/api/app/v1/trips/[id]/itinerary/route";
import { GET as messagesGet } from "@/app/api/app/v1/requests/[id]/messages/route";
import { GET as cronGet } from "@/app/api/app/v1/cron/activities/route";
import { callP, signIn } from "./wallet-helpers";

/* Things to do: open-data parsing (Overpass, Wikidata, pageviews, Commons) from fixtures, ranking and the city load,
   opening hours, prayer times and weather rules, the Hotelbeds/GYG/Viator/Ticketmaster parsers, the routes (city,
   trip, Book with Mada, Add to my plan), the cron, and the desk's What's on and "Book on Hotelbeds". */

const FIX = join(__dirname, "fixtures/activities");
const fx = (name: string) => JSON.parse(readFileSync(join(FIX, name), "utf8")) as unknown;
const ALULA = 108841;
const RIYADH = 108410;
const ISTANBUL = 745044;

/** A fetch that answers from the fixtures, by URL. Anything unexpected fails loudly. */
const calls: string[] = [];
const fakeFetch = async (url: string): Promise<Response> => {
  calls.push(url);
  const body = url.includes("interpreter") ? fx("overpass-alula.json")
    : url.includes("wikidata.org") ? fx("wikidata.json")
      : url.includes("pageviews") ? (url.includes("Hegra") ? fx("pageviews.json") : { items: [{ views: 120 }] })
        : url.includes("commons.wikimedia.org") ? fx("commons.json")
          : url.includes("open-meteo") ? fx("open-meteo-riyadh.json")
            : null;
  if (!body) return new Response("not found", { status: 404 });
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};

let token = "";
let userId = "";
let other = "";

beforeAll(async () => {
  await runIngest({ dir: join(__dirname, "fixtures/places"), sql });
  const a = await signIn();
  token = a.token;
  userId = a.user.id;
  other = (await signIn()).token;
});
afterEach(() => { calls.length = 0; });

describe("open data parsing", () => {
  it("builds the Overpass query around the centre, notable parks and mosques only", () => {
    const ql = overpassQuery(26.60853, 37.92316, 6);
    expect(ql).toContain("(around:6000,26.60853,37.92316)");
    expect(ql).toMatch(/\["amenity"="place_of_worship"\]\["religion"="muslim"\]\["name"\]\["wikidata"\]/);
    expect(ql).toContain("out center tags");
    expect(radiusKmFor(4_000_000)).toBe(22);
    expect(radiusKmFor(30_000)).toBe(6);
  });

  it("reads Overpass: one per Wikidata item, the richer record, centres for ways, no unnamed or memorials", () => {
    const c = parseOverpass(fx("overpass-alula.json"));
    const ids = c.map((x) => x.id);
    expect(ids).toContain("osm:r900101"); // Hegra as the relation, not the bare node
    expect(ids).not.toContain("osm:n900102");
    expect(ids).not.toContain("osm:n900108"); // a memorial plaque
    expect(c.some((x) => x.name === "")).toBe(false);
    const hegra = c.find((x) => x.id === "osm:r900101")!;
    expect(hegra).toMatchObject({ kind: "historic", nameAr: "الحِجر", hours: "Mo-Su 08:00-17:00", wikipediaTitle: "Hegra (Mada'in Salih)", lat: 26.7915 });
    expect(c.find((x) => x.id === "osm:w900109")).toMatchObject({ kind: "mosque", indoor: true });
    expect(c.find((x) => x.id === "osm:w900110")).toMatchObject({ kind: "museum", family: true, website: "https://example.org/museum" });
    expect(c.find((x) => x.id === "osm:n900103")).toMatchObject({ free: true });
  });

  it("reads Wikidata: names, descriptions, sitelinks (not Commons), the image", () => {
    const w = parseWikidata(fx("wikidata.json"));
    expect(w.get("Q900001")).toMatchObject({ labelAr: "الحجر", descEn: "archaeological site in Saudi Arabia", image: "Hegra tomb example.jpg", sitelinks: 4, enwiki: "Hegra (Mada'in Salih)" });
    expect(w.get("Q900005")?.sitelinks).toBe(1);
  });

  it("asks pageviews for the two full months before now", () => {
    expect(pageviewWindow(new Date("2026-10-11T00:00:00Z"))).toEqual({ start: "2026080100", end: "2026093000" });
  });

  it("maps OSM tags to kinds", () => {
    expect(kindOf({ tourism: "museum" })).toBe("museum");
    expect(kindOf({ amenity: "place_of_worship", religion: "christian" })).toBeNull();
    expect(kindOf({ historic: "castle" })).toBe("historic");
    expect(kindOf({ historic: "memorial" })).toBeNull();
    expect(kindOf({ leisure: "park" })).toBe("park");
  });
});

describe("loading a city", () => {
  it("gathers, ranks and stores AlUla from the fixtures", async () => {
    const now = new Date("2026-10-11T09:00:00Z");
    const g = await gatherCity({ id: ALULA, name: "AlUla", lat: 26.60853, lon: 37.92316, population: 32413 }, fakeFetch, now);
    expect(g.status).toBe("ok");
    expect(calls.some((u) => u.includes("interpreter"))).toBe(true);
    expect(calls.filter((u) => u.includes("pageviews")).length).toBeGreaterThan(0);
    const names = g.rows.map((r) => r.name);
    expect(names[0]).toBe("Hegra"); // most read about, most wikis, a photo
    expect(names).toContain("Maraya"); // Arabic-only OSM name → Wikidata's English label
    expect(names).not.toContain("Bench with a view"); // an "attraction" with nothing behind it
    const hegra = g.rows[0]!;
    expect(hegra.popularity).toBe(100);
    expect(hegra.pageviews).toBe(35000);
    expect((hegra.image as { licence: string; author: string }).licence).toBe("CC BY-SA 4.0");
    expect((hegra.image as { author: string }).author).toBe("A. Photographer");
    const stored = await storeCity(ALULA, g, now);
    expect(stored.stored).toBe(g.rows.length);
    const [c] = await db.select().from(appActivityCities).where(eq(appActivityCities.placeId, ALULA));
    expect(c).toMatchObject({ status: "ok", count: g.rows.length });
    expect(c!.expiresAt!.getTime() - now.getTime()).toBe(30 * 86_400_000);
  });

  it("keeps the old list when a refresh comes back much thinner, and retries tomorrow", async () => {
    const before = (await db.select({ n: q<number>`count(*)::int` }).from(appActivities).where(eq(appActivities.placeId, ALULA)))[0]!.n;
    const now = new Date("2026-11-20T09:00:00Z");
    const r = await storeCity(ALULA, { rows: [], status: "none", problem: "Overpass did not answer" }, now);
    expect(r.kept).toBe(true);
    const after = (await db.select({ n: q<number>`count(*)::int` }).from(appActivities).where(eq(appActivities.placeId, ALULA)))[0]!.n;
    expect(after).toBe(before);
    const [c] = await db.select().from(appActivityCities).where(eq(appActivityCities.placeId, ALULA));
    expect(c!.expiresAt!.getTime() - now.getTime()).toBe(86_400_000);
  });

  it("an Overpass outage stores nothing new", async () => {
    const g = await gatherCity({ id: ALULA, name: "AlUla", lat: 26.6, lon: 37.9, population: 30000 }, async () => new Response("no", { status: 504 }));
    expect(g).toMatchObject({ status: "none", rows: [] });
  });

  it("the scheduled refresh walks due cities once each", async () => {
    await db.update(appActivityCities).set({ expiresAt: new Date("2026-01-01T00:00:00Z"), refreshingAt: null }).where(eq(appActivityCities.placeId, ALULA));
    const done = await refreshDue({ limit: 1, fetch: fakeFetch, now: new Date("2026-10-11T09:00:00Z") });
    expect(done.map((d) => d.placeId)).toContain(ALULA);
    expect(await refreshCity(999_999_999, fakeFetch)).toMatchObject({ status: "missing" });
  });

  it("the cron needs its secret", async () => {
    const r1 = await callP(cronGet, {});
    expect(r1.status).toBe(401);
    process.env.CRON_SECRET = "cron-secret-for-tests-0123456789";
    const r2 = await callP(cronGet, {}, { headers: { authorization: "Bearer wrong-secret-for-tests-01234567" } });
    expect(r2.status).toBe(401);
    // Due cities would go to the network: make none due.
    await db.update(appActivityCities).set({ expiresAt: new Date("2099-01-01T00:00:00Z") });
    const r3 = await callP(cronGet, {}, { headers: { authorization: "Bearer cron-secret-for-tests-0123456789" }, query: "?limit=1" });
    expect(r3.status).toBe(200);
    expect(Array.isArray(r3.json.refreshed)).toBe(true);
    delete process.env.CRON_SECRET;
  });
});

describe("rules", () => {
  it("reads opening hours (the common subset) and says when it closes", () => {
    const tue = { weekday: 1, minutes: 10 * 60 };
    expect(openState("Mo-Su 09:00-17:00", tue)).toEqual({ open: true, closesAt: "17:00" });
    expect(openState("Tu-Su 10:00-18:00; Mo off", { weekday: 0, minutes: 11 * 60 })).toEqual({ open: false, closesAt: null });
    expect(openState("Mo-Th,Sa,Su 10:00-17:00; Fr 10:00-20:30", { weekday: 4, minutes: 19 * 60 })).toEqual({ open: true, closesAt: "20:30" });
    expect(openState("24/7", tue)).toEqual({ open: true, closesAt: null });
    expect(openState("Mo-Su 17:00-01:00", { weekday: 2, minutes: 30 })).toEqual({ open: true, closesAt: "01:00" }); // past midnight from Tuesday
    expect(openState("Mo-Su 16:00-24:00", { weekday: 2, minutes: 23 * 60 })).toEqual({ open: true, closesAt: "00:00" });
    expect(openState("Mo-Fr 09:00-17:00; PH off", tue).open).toBe(true);
    expect(openState("Apr-Oct: Mo-Su 09:00-19:00", tue).open).toBeNull(); // seasons: never guess
    expect(openState(null, tue).open).toBeNull();
    expect(parseHours("sunrise-sunset")).toBeNull();
  });

  it("works out prayer times (Umm al-Qura) close to the published ones", () => {
    // Riyadh, 11 Oct 2026: Fajr ≈ 04:28, Dhuhr ≈ 11:39, Asr ≈ 15:02, Maghrib ≈ 17:32, Isha = Maghrib + 90.
    const p = prayerTimes("2026-10-11", 24.68773, 46.72185, 180)!;
    const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const near = (got: number, want: string) => { const [h, m] = want.split(":").map(Number); expect(Math.abs(got - (h! * 60 + m!)), `${hm(got)} vs ${want}`).toBeLessThanOrEqual(4); };
    near(p.fajr, "04:28"); near(p.dhuhr, "11:39"); near(p.asr, "15:02"); near(p.maghrib, "17:32");
    expect(p.isha - p.maghrib).toBe(90);
    expect(nextPrayer("2026-10-11", 12 * 60, 24.68773, 46.72185, 180)?.name).toBe("asr");
    expect(nextPrayer("2026-10-11", 23 * 60, 24.68773, 46.72185, 180)).toBeNull();
  });

  it("reads Open-Meteo (a live recording) and turns a 37° afternoon indoors", () => {
    const w = parseOpenMeteo(fx("open-meteo-riyadh.json"), new Date("2026-10-11T12:30:00Z"))!;
    expect(w).toMatchObject({ tempC: 37, maxC: 38, minC: 27, rainChance: 0, mood: "hot", indoorFirst: true });
    expect(moodOf({ tempC: 18, maxC: 21, rainChance: 80, code: 61 })).toBe("rain");
    expect(moodOf({ tempC: 22, maxC: 25, rainChance: 10, code: 1 })).toBe("fine");
    expect(parseOpenMeteo({}, new Date())).toBeNull();
  });

  it("picks today's ideas for the weather, the hour and the children", () => {
    const base: Omit<Activity, "id" | "kind" | "indoor" | "openNow" | "family" | "popularity"> = {
      placeId: "1", name: "x", nameAr: null, lat: 0, lon: 0, summary: null, summaryAr: null, image: null, photo: null, hours: null, closesAt: null, free: null, website: null, wikipedia: null, distanceKm: null, attributions: [],
    };
    const acts: Activity[] = [
      { ...base, id: "osm:n1", kind: "park", indoor: false, openNow: true, family: true, popularity: 90 },
      { ...base, id: "osm:n2", kind: "museum", indoor: true, openNow: true, family: false, popularity: 70 },
      { ...base, id: "osm:n3", kind: "aquarium", indoor: true, openNow: false, family: true, popularity: 99 },
      { ...base, id: "osm:n4", kind: "viewpoint", indoor: false, openNow: null, family: false, popularity: 50 },
    ];
    const hot = { tempC: 41, maxC: 43, minC: 30, rainChance: 0, code: 0, mood: "hot" as const, indoorFirst: true, at: new Date().toISOString() };
    expect(todayIdeas(acts, { day: "2026-10-11", minutes: 14 * 60, weather: hot, family: false, prayer: null })).toMatchObject({ ids: ["osm:n2"], why: "hot" });
    const evening = todayIdeas(acts, { day: "2026-10-11", minutes: 19 * 60, weather: null, family: false, prayer: { name: "isha", at: "19:02" } })!;
    expect(evening.why).toBe("evening");
    expect(evening.ids).not.toContain("osm:n1"); // no parks after dark
    expect(evening.ids[0]).toBe("osm:n2");
    expect(filterActivities(acts, { family: true }).map((a) => a.id)).toEqual(["osm:n1", "osm:n3"]);
    expect(filterActivities(acts, { open: true }).map((a) => a.id)).toEqual(["osm:n1", "osm:n2"]);
    expect(filterActivities(acts, { kind: "indoor" }).map((a) => a.id)).toEqual(["osm:n2", "osm:n3"]);
    expect(popularityOf([10, 20, 40])).toEqual([25, 50, 100]);
  });
});

describe("partner adapters", () => {
  const rules = pricingRules({ APP_FX_RATES: "EUR=4.10" } as unknown as NodeJS.ProcessEnv);

  it("Hotelbeds availability: cheapest modality, SAR with our margin, photo, duration, children's ages", () => {
    const list = parseHotelbedsAvailability(fx("hotelbeds-availability.json"), { ages: [30, 30], limit: 10 }, rules);
    expect(list.map((e) => e.code)).toEqual(["E-E10-ULHHEGRA", "E-E10-ULHBALLOON"]); // unpriced left out
    const h = list[0]!;
    expect(h).toMatchObject({ id: "hotelbeds:E-E10-ULHHEGRA", supplier: "hotelbeds", modality: "MORNING", durationMin: 180, minAge: 5, family: true, title: "Hegra: the tombs by vintage Land Rover" });
    expect(h.summary).toBe("Saudi Arabia's first UNESCO site with a Rawi storyteller.");
    expect(h.image?.url).toBe("https://media.activitiesbank.com/12345/ENG/L/hegra.jpg");
    // 95 EUR × 4.10 × 1.015 buffer × 1.15 margin = 454.6… → SAR 455
    expect(h.priceFrom).toEqual({ amount: 45500, currency: "SAR" });
    expect(list[1]!.durationMin).toBe(1440);
    // A 3-year-old can't go on either: Hegra's modalities start at 5, the balloon at 12.
    expect(parseHotelbedsAvailability(fx("hotelbeds-availability.json"), { ages: [30, 3], limit: 10 }, rules).find((e) => e.code === "E-E10-ULHHEGRA")?.modality ?? null).toBeNull();
    expect(activitySell(100, "EUR", rules)).toBe(Math.ceil((100 * 4.1 * 100 * 1.015 * 1.15) / 100) * 100);
  });

  it("Hotelbeds detail: rate keys sorted by price, with the free-cancellation date", () => {
    const offers = parseHotelbedsDetail(fx("hotelbeds-detail.json"), "E-E10-ULHHEGRA", rules);
    expect(offers.map((o) => o.rateKey)).toEqual(["rk-morning-1", "rk-sunset-1"]);
    expect(offers[0]).toMatchObject({ modality: "MORNING", from: "2026-10-20", net: { amount: 250, currency: "EUR" }, freeCancelUntil: "2026-10-18T00:00:00" });
  });

  it("Hotelbeds client: signed requests to the documented paths, NOT_CONFIGURED without keys", async () => {
    const seen: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
    const answers: Record<string, string> = { availability: "hotelbeds-availability.json", details: "hotelbeds-detail.json", bookings: "hotelbeds-booking.json" };
    const s = hotelbedsActivities({
      credentials: { apiKey: "test-key", secret: "test-secret" }, env: "test", now: () => 1_791_700_000_000, log: () => {},
      fetch: async (url, init) => {
        seen.push({ url, method: init.method, headers: init.headers, body: init.body });
        const k = Object.keys(answers).find((x) => url.includes(x))!;
        return { status: 200, headers: { get: () => null }, text: async () => readFileSync(join(FIX, answers[k]!), "utf8") };
      },
    });
    const list = await s.search({ placeId: String(ALULA), city: "AlUla", countryCode: "SA", lat: 26.6, lon: 37.9, from: "2026-10-20", to: "2026-10-26", ages: [30, 30], language: "en", limit: 5 });
    expect(list.length).toBe(2);
    expect(seen[0]!.url).toBe("https://api.test.hotelbeds.com/activity-api/3.0/activities/availability");
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.headers["Api-key"]).toBe("test-key");
    expect(seen[0]!.headers["X-Signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(seen[0]!.body!)).toMatchObject({ filters: [{ searchFilterItems: [{ type: "gps", latitude: 26.6, longitude: 37.9 }] }], paxes: [{ age: 30 }, { age: 30 }], from: "2026-10-20" });
    const offers = await s.offers!("E-E10-ULHHEGRA", { from: "2026-10-20", to: "2026-10-20", ages: [30, 30, 8], language: "en", modality: "MORNING" });
    expect(seen[1]!.url.endsWith("/activity-api/3.0/activities/details")).toBe(true);
    expect(JSON.parse(seen[1]!.body!)).toMatchObject({ code: "E-E10-ULHHEGRA", modalityCode: "MORNING", paxes: [{ age: 30 }, { age: 30 }, { age: 8 }] });
    const b = await s.book!({ rateKey: offers[0]!.rateKey, from: "2026-10-20", to: "2026-10-20", clientReference: "R-ABC123", holder: { name: "Sara", surname: "Alqahtani", email: "s@example.com", country: "SA" },
      paxes: [{ age: 8, name: "Lina", surname: "Alqahtani", type: "CHILD" }, { age: 30, name: "Sara", surname: "Alqahtani", type: "ADULT" }], language: "en" });
    expect(b).toEqual({ reference: "102-3456789", status: "CONFIRMED", total: { amount: 250, currency: "EUR" } });
    expect(seen[2]!.method).toBe("PUT");
    expect(JSON.parse(seen[2]!.body!).activities[0].paxes[0].type).toBe("ADULT"); // adults first
    const none = hotelbedsActivities({ credentials: null, log: () => {} });
    await expect(none.search({ placeId: "1", city: "x", countryCode: "SA", lat: 0, lon: 0, from: "2026-10-20", to: "2026-10-20", ages: [], language: "en", limit: 1 })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("GetYourGuide and Viator answers (assumed shapes) become experiences", () => {
    const g = parseGyg({ data: { tours: [{ tour_id: 12345, title: "Bosphorus cruise", abstract: "On the water", pictures: [{ url: "https://cdn.getyourguide.com/img/tour/abc/[format_id].jpg" }], price: { values: { amount: 40 } }, duration: 2, duration_unit: "hour", overall_rating: 4.6, number_of_ratings: 900 }, { title: "no id" }] } }, 5);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ id: "getyourguide:12345", durationMin: 120, rating: 4.6, image: { url: "https://cdn.getyourguide.com/img/tour/abc/21.jpg" } });
    const v = parseViator({ products: { results: [{ productCode: "5513P12", title: "Burj Khalifa", images: [{ variants: [{ url: "https://media.tacdn.com/a.jpg", width: 720 }] }], reviews: { combinedAverageRating: 4.5, totalReviews: 15000 }, duration: { fixedDurationInMinutes: 90 }, pricing: { summary: { fromPrice: 53 }, currency: "USD" }, flags: ["FREE_CANCELLATION"] }] } }, 5);
    expect(v[0]).toMatchObject({ id: "viator:5513P12", durationMin: 90, freeCancel: true, reviews: 15000 });
  });

  it("Ticketmaster: one per show, 16:9 photo first, dates and venue, families flagged", () => {
    const e = parseTicketmaster(fx("ticketmaster.json"), "2643743");
    expect(e.map((x) => x.title)).toEqual(["Coldplay: Music of the Spheres", "Frozen the Musical"]);
    expect(e[0]).toMatchObject({ id: "tm:vvG1HZ9pXs1Ab", source: "ticketmaster", time: "19:30", venue: "Wembley Stadium", image: { url: "https://s1.ticketm.net/dam/a/1d1/large.jpg", credit: "Ticketmaster" }, family: false });
    expect(e[1]).toMatchObject({ startsOn: "2026-10-12", endsOn: "2026-12-30", family: true, image: null });
    expect(ticketmasterUrl("k", 51.5, -0.12, "2026-10-11", "2026-10-25")).toContain("latlong=51.5000%2C-0.1200");
  });
});

describe("GET /places/:id/things", () => {
  const get = (id: string, query = "", tok = token) => callP(thingsGet, { id }, { token: tok, query });

  it("answers a guest too, and needs a known city and sane filters", async () => {
    expect((await get(String(ALULA), "", "")).status).toBe(200);
    expect((await get("nowhere-at-all")).status).toBe(404);
    expect((await get(String(ALULA), "?near=far")).status).toBe(400);
    expect((await get(String(ALULA), "?day=2026-13-40")).status).toBe(400);
  });

  it("serves what we loaded, with hours against the city's clock, weather, events and experiences (mock)", async () => {
    const r = await get(String(ALULA));
    expect(r.status).toBe(200);
    const t = ThingsResponse.parse(r.json);
    expect(t.status).toBe("ready");
    expect(t.place).toMatchObject({ id: String(ALULA), countryCode: "SA" });
    expect(t.activities[0]!.name).toBe("Hegra");
    expect(t.activities[0]!.attributions.map((a) => a.source)).toEqual(expect.arrayContaining(["openstreetmap", "wikidata", "wikimedia"]));
    const clock = localClock("Asia/Riyadh");
    const hegra = t.activities.find((a) => a.id === "osm:r900101")!;
    expect(hegra.openNow).toBe(clock.minutes >= 8 * 60 && clock.minutes < 17 * 60);
    expect(t.weather?.mood).toBe("hot"); // mock weather: the Gulf
    expect(t.experiences.length).toBeGreaterThan(0);
    expect(t.experiences[0]!.supplier).toBe("hotelbeds");
    expect(t.events.some((e) => e.source === "desk")).toBe(true);
    expect(t.attributions.map((a) => a.source)).toEqual(expect.arrayContaining(["openstreetmap", "wikidata", "wikipedia", "geonames"]));
    expect(t.today?.prayer === null || /^\d\d:\d\d$/.test(t.today!.prayer.at)).toBe(true);
  });

  it("filters: family, indoor, near a point (sorted by distance), a day ahead has no 'open now'", async () => {
    const fam = ThingsResponse.parse((await get(String(ALULA), "?family=1")).json);
    expect(fam.activities.every((a) => a.family)).toBe(true);
    const inside = ThingsResponse.parse((await get(String(ALULA), "?kind=indoor")).json);
    expect(inside.activities.every((a) => a.indoor)).toBe(true);
    const near = ThingsResponse.parse((await get(String(ALULA), "?near=26.6893,37.9888")).json);
    expect(near.activities[0]!.name).toBe("Elephant Rock");
    expect(near.activities[0]!.distanceKm).toBe(0);
    expect(near.near).toMatchObject({ label: "you" });
    const later = ThingsResponse.parse((await get(String(ALULA), "?day=2027-01-15")).json);
    expect(later.activities.every((a) => a.openNow === null)).toBe(true);
    expect(later.weather).toBeNull();
    expect(later.today).toBeNull();
  });

  it("a city we haven't loaded: the hand-made list in mock mode, or none", async () => {
    const ist = ThingsResponse.parse((await get(String(ISTANBUL))).json);
    expect(ist.status).toBe("ready");
    expect(ist.activities.map((a) => a.name)).toContain("Hagia Sophia");
    const tb = ThingsResponse.parse((await get("611717")).json); // Tbilisi
    expect(tb.status).toBe("none");
    expect(tb.activities).toEqual([]);
  });

  it("in live open-data mode, the first visit gathers in the background", async () => {
    process.env.SUPPLIER_MODE_OPEN_DATA = "live";
    const t = await thingsFor(String(RIYADH), {}, { fetch: fakeFetch });
    expect(t.status).toBe("gathering");
    await Promise.all([...pendingThings]);
    process.env.SUPPLIER_MODE_OPEN_DATA = "mock";
    const [c] = await db.select().from(appActivityCities).where(eq(appActivityCities.placeId, RIYADH));
    expect(c!.status).toBe("ok"); // the fixture answered (AlUla's places, but it proves the path)
  });
});

describe("Book with Mada", () => {
  const book = (b: unknown, tok = token) => callP(bookPost, {}, { token: tok, method: "POST", body: b });
  let requestId = "";

  it("makes a desk request with the supplier's code, the day and everyone's ages", async () => {
    const things = ThingsResponse.parse((await callP(thingsGet, { id: String(ALULA) }, { token })).json);
    const e = things.experiences[0]!;
    const r = await book({ ref: { kind: "experience", id: e.id }, placeId: String(ALULA), day: "2026-10-20", travellers: 3, ages: [8], clientId: "book-test-0001" });
    expect(r.status).toBe(201);
    const v = BookThingResponse.parse(r.json);
    requestId = v.request.id;
    expect(v.request).toMatchObject({ kind: "todo", status: "sent" });
    expect(v.request.title).toBe(`Book ${e.title}`);
    expect(v.message).toContain("2 adults and children aged 8");
    const [row] = await db.select().from(appRequests).where(eq(appRequests.id, requestId));
    expect(row!.kind).toBe("activity");
    expect((row!.details as { activity: Record<string, unknown> }).activity).toMatchObject({ supplier: "hotelbeds", code: e.code, modality: e.modality, day: "2026-10-20", ages: [8, 30, 30], travellers: 3 });
    const thread = MessagesResponse.parse((await callP(messagesGet, { id: requestId }, { token })).json);
    expect(thread.messages[0]!.text).toBe(v.message);
    const audit = await db.execute<{ action: string }>(q`SELECT action FROM app_audit WHERE entity_id = ${requestId}`);
    expect(audit.map((x) => x.action)).toContain("request.created");
  });

  it("is idempotent by clientId, and works for an open-data place and a desk event", async () => {
    const again = await book({ ref: { kind: "experience", id: "hotelbeds:whatever" }, placeId: String(ALULA), clientId: "book-test-0001" });
    expect(again.json.request.id).toBe(requestId);
    const place = await book({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), clientId: "book-test-0002" });
    expect(place.status).toBe(201);
    const [row] = await db.select().from(appRequests).where(eq(appRequests.id, place.json.request.id));
    expect((row!.details as { activity: { link: string; supplier: string } }).activity).toMatchObject({ supplier: "openstreetmap", link: "https://www.openstreetmap.org/relation/900101" });
  });

  it("refuses unknown things, someone else's trip, and bad input", async () => {
    expect((await book({ ref: { kind: "activity", id: "osm:n1" }, placeId: String(ALULA), clientId: "book-test-0003" })).status).toBe(404);
    expect((await book({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA) })).status).toBe(400);
    expect((await book({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), clientId: "book-test-0004" }, "")).status).toBe(401);
    const [t] = await db.insert(appTrips).values({ ownerId: userId, city: "AlUla", startDate: "2026-10-18", endDate: "2026-10-22", status: "booked" }).returning();
    expect((await book({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), tripId: t!.id, clientId: "book-test-0005" }, other)).status).toBe(404);
  });

  it("shows in the desk inbox as an Activity, and books on Hotelbeds in one step (mock)", async () => {
    const { items } = await deskInbox(new Date());
    const it = items.find((i) => i.id === requestId);
    expect(it).toMatchObject({ kind: "request", tag: "Activity" });
    const actor = await deskActor(["desk.view", "desk.act"]);
    const note = await bookOnHotelbeds(actor, requestId);
    expect(note.reference).toMatch(/^MOCK-[0-9A-F]{8}$/);
    await expect(bookOnHotelbeds(actor, requestId)).rejects.toThrow(/Already booked/);
    const [row] = await db.select().from(appRequests).where(eq(appRequests.id, requestId));
    expect((row!.details as { desk: { hotelbeds: { reference: string } } }).desk.hotelbeds.reference).toBe(note.reference);
    const viewer = await deskActor(["desk.view"]);
    await expect(bookOnHotelbeds(viewer, requestId)).rejects.toThrow(/access/);
  });
});

async function deskActor(perms: string[]): Promise<DeskActor> {
  const n = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const [role] = await db.insert(schema.roles).values({ key: `things_${n}`, name: `Things ${n}`, nameAr: "مكتب", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name: "Desk Things", email: `things${n}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name: "Desk Things", permissions: new Set(perms) };
}

describe("inside a trip", () => {
  let tripId = "";

  beforeAll(async () => {
    const [u] = await db.select().from(appUsers).where(eq(appUsers.id, userId));
    const [kid] = await db.insert(appPeople).values({ ownerId: u!.id, isSelf: false, givenNames: "Lina", surname: "Test", relation: "child", dateOfBirth: "2019-03-02" }).returning();
    const [self] = await db.select().from(appPeople).where(and(eq(appPeople.ownerId, u!.id), eq(appPeople.isSelf, true)));
    const [t] = await db.insert(appTrips).values({ ownerId: userId, city: "AlUla", country: "SA", startDate: "2026-10-18", endDate: "2026-10-22", travellerIds: [self!.id, kid!.id], status: "booked" }).returning();
    tripId = t!.id;
    await db.insert(appStays).values({ tripId, name: "Desert Rock Resort", address: "Desert Rock, AlUla", checkIn: "2026-10-18", nights: 4, rooms: 1, price: 400000, status: "booked" });
    // The hotel's point, as Nominatim would have answered (cached for good).
    await db.insert(appGeocodes).values({ query: "desert rock, alula, alula", lat: 26.6893, lon: 37.9888 }).onConflictDoNothing();
  });

  it("measures from the hotel and filters for the children's ages", async () => {
    const r = await callP(tripThingsGet, { id: tripId }, { token, query: "?day=2026-10-20" });
    expect(r.status).toBe(200);
    const t = ThingsResponse.parse(r.json);
    expect(t.near).toMatchObject({ label: "hotel", lat: 26.6893 });
    expect(t.activities[0]!.name).toBe("Elephant Rock");
    expect(t.ages).toEqual([7]);
    expect(t.day).toBe("2026-10-20");
    expect((await callP(tripThingsGet, { id: tripId }, { token, query: "?day=2027-01-01" })).status).toBe(400);
    expect((await callP(tripThingsGet, { id: tripId }, { token: other })).status).toBe(404);
  });

  it("Add to my plan: on the itinerary on its day, moved, then taken off; owner only", async () => {
    const add = (b: unknown, tok = token) => callP(ideasPost, { id: tripId }, { token: tok, method: "POST", body: b });
    const r = await add({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), day: "2026-10-20" });
    expect(r.status).toBe(201);
    const ideaId = r.json.idea.id as string;
    expect((await add({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), day: "2026-10-20" })).status).toBe(200);
    expect((await add({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), day: "2026-10-21" })).json.idea.day).toBe("2026-10-21");
    expect((await add({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), day: "2027-01-01" })).status).toBe(400);
    expect((await add({ ref: { kind: "activity", id: "osm:n404" }, placeId: String(ALULA), day: null })).status).toBe(404);
    expect((await add({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), day: null }, other)).status).toBe(404);
    const list = TripIdeasResponse.parse((await callP(ideasGet, { id: tripId }, { token })).json);
    expect(list.ideas.map((i) => i.title)).toEqual(["Hegra"]);
    const it = ItineraryResponse.parse((await callP(itineraryGet, { id: tripId }, { token })).json);
    const day = it.days.find((d) => d.date === "2026-10-21")!;
    expect(day.items.some((i) => i.id === `plan-${ideaId}` && i.kind === "idea" && i.title === "Hegra")).toBe(true);
    expect(it.events.some((e) => e.title === "Hegra")).toBe(false); // ideas stay out of the calendar
    expect((await callP(ideaDelete, { id: tripId, ideaId }, { token: other, method: "DELETE" })).status).toBe(404);
    expect((await callP(ideaDelete, { id: tripId, ideaId }, { token, method: "DELETE" })).status).toBe(200);
    expect((await callP(ideaDelete, { id: tripId, ideaId }, { token, method: "DELETE" })).status).toBe(404);
    expect((await db.select().from(appTripIdeas).where(eq(appTripIdeas.tripId, tripId))).length).toBe(0);
  });
});

describe("getting there", () => {
  const ride = (b: unknown, tok = token) => callP(ridePost, {}, { token: tok, method: "POST", body: b });
  let tripId = "";

  beforeAll(async () => {
    const [self] = await db.select().from(appPeople).where(and(eq(appPeople.ownerId, userId), eq(appPeople.isSelf, true)));
    const [t] = await db.insert(appTrips).values({ ownerId: userId, city: "AlUla", country: "SA", startDate: "2026-10-18", endDate: "2026-10-22", travellerIds: [self!.id], status: "booked" }).returning();
    tripId = t!.id;
    await db.insert(appStays).values({ tripId, name: "Shaden Resort", address: "Shaden, AlUla", checkIn: "2026-10-18", nights: 4, rooms: 1, price: 300000, status: "booked" });
  });

  it("reads street addresses from OSM tags and meeting points from Hotelbeds content", () => {
    expect(addressOf({ "addr:street": "Great Russell St", "addr:housenumber": "44", "addr:postcode": "WC1B 3DG", "addr:city": "London" })).toBe("Great Russell St 44, WC1B 3DG London");
    expect(addressOf({ "addr:full": "King Saud Rd, Riyadh" })).toBe("King Saud Rd, Riyadh");
    expect(addressOf({ "addr:city": "London" })).toBeNull();
    const meet = meetingPointOf({ content: { location: { startingPoints: [{ type: "MEETING_POINT", meetingPoint: { address: "Kabatas pier", city: "Istanbul", description: "<p>Look for the <b>navy</b> jackets</p>", geolocation: { latitude: 41.03, longitude: 28.99 } } }] } } } as never);
    expect(meet).toEqual({ kind: "meet", address: "Kabatas pier, Istanbul", note: "Look for the navy jackets", lat: 41.03, lon: 28.99 });
    expect(meetingPointOf({ content: { location: { startingPoints: [{ type: "PICKUP", meetingPoint: { geolocation: { latitude: 0, longitude: 0 } } }] } } } as never)).toMatchObject({ kind: "pickup", lat: null, address: null });
    expect(meetingPointOf({ content: {} } as never)).toBeNull();
    const listed = parseHotelbedsAvailability({ activities: [{ code: "E-1", content: { name: "Cruise", location: { startingPoints: [{ meetingPoint: { address: "Pier 3", geolocation: { latitude: 41, longitude: 29 } } }] } }, currency: "EUR", amountsFrom: [{ paxType: "ADULT", amount: 40 }] }] }, { ages: [], limit: 5 }, pricingRules());
    expect(listed[0]!.meetingPoint).toMatchObject({ address: "Pier 3", lat: 41 });
  });

  it("asks the desk for a car from the hotel, with where to and when", async () => {
    const r = await ride({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), tripId, day: "2026-10-20", time: "16:30", pickup: "hotel", clientId: "ride-test-0001" });
    expect(r.status).toBe(201);
    const v = RideThingResponse.parse(r.json);
    expect(v.request).toMatchObject({ kind: "car", status: "sent" });
    expect(v.request.title).toBe("A car to Hegra");
    expect(v.message).toContain("Shaden Resort");
    expect(v.message).toContain("16:30");
    const [row] = await db.select().from(appRequests).where(eq(appRequests.id, v.request.id));
    expect(row!.tripId).toBe(tripId);
    expect((row!.details as { ride: Record<string, unknown> }).ride).toMatchObject({ to: "Hegra", pickup: "hotel", from: "Shaden Resort", hotel: "Shaden Resort", day: "2026-10-20", time: "16:30", travellers: 1 });
    expect(typeof (row!.details as { ride: { lat: unknown } }).ride.lat).toBe("number");
    const thread = MessagesResponse.parse((await callP(messagesGet, { id: v.request.id }, { token })).json);
    expect(thread.messages[0]!.text).toBe(v.message);
    const audit = await db.execute<{ action: string }>(q`SELECT action FROM app_audit WHERE entity_id = ${v.request.id}`);
    expect(audit.map((x) => x.action)).toContain("request.created");
    const again = await ride({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), tripId, day: "2026-10-21", time: "09:00", pickup: "hotel", clientId: "ride-test-0001" });
    expect(again.json.request.id).toBe(v.request.id);
  });

  it("picks up from somewhere else without a trip, and refuses what it can't do", async () => {
    const r = await ride({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), day: "2026-10-20", time: "08:00", pickup: "other", pickupText: "AlUla airport", travellers: 3, clientId: "ride-test-0002" });
    expect(r.status).toBe(201);
    expect(r.json.message).toContain("AlUla airport");
    expect(r.json.message).toContain("3 of us");
    // From the hotel with no trip, or with nowhere said; a day outside the trip; bad time; unknown place; not signed in; someone else's trip.
    expect((await ride({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), day: "2026-10-20", time: "08:00", pickup: "hotel", clientId: "ride-test-0003" })).status).toBe(400);
    expect((await ride({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), day: "2026-10-20", time: "08:00", pickup: "other", clientId: "ride-test-0004" })).status).toBe(400);
    expect((await ride({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), tripId, day: "2027-01-01", time: "08:00", pickup: "hotel", clientId: "ride-test-0005" })).status).toBe(400);
    expect((await ride({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), tripId, day: "2026-10-20", time: "25:00", pickup: "hotel", clientId: "ride-test-0006" })).status).toBe(400);
    expect((await ride({ ref: { kind: "activity", id: "osm:n1" }, placeId: String(ALULA), tripId, day: "2026-10-20", time: "08:00", pickup: "hotel", clientId: "ride-test-0007" })).status).toBe(404);
    expect((await ride({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), tripId, day: "2026-10-20", time: "08:00", pickup: "hotel", clientId: "ride-test-0008" }, "")).status).toBe(401);
    expect((await ride({ ref: { kind: "activity", id: "osm:r900101" }, placeId: String(ALULA), tripId, day: "2026-10-20", time: "08:00", pickup: "hotel", clientId: "ride-test-0009" }, other)).status).toBe(404);
  });

  it("shows in the desk inbox with the request", async () => {
    const { items } = await deskInbox(new Date());
    const [row] = await db.select().from(appRequests).where(q`${appRequests.details}->>'clientId' = 'ride-test-0001'`);
    expect(items.some((i) => i.id === row!.id)).toBe(true);
  });
});

describe("the desk's What's on", () => {
  it("adds, validates, shows in the app in both languages, hides", async () => {
    const lead = await deskActor(["desk.view", "desk.act"]);
    const viewer = await deskActor(["desk.view"]);
    const today = new Date().toISOString().slice(0, 10);
    const input = { placeId: String(RIYADH), title: "Riyadh Season: Boulevard World", titleAr: "موسم الرياض: بوليفارد وورلد", startsOn: today, endsOn: today, imageUrl: "https://example.org/b.jpg", imageCredit: "Riyadh Season", family: true };
    await expect(saveWhatsOn(viewer, null, input)).rejects.toThrow(/access/);
    await expect(saveWhatsOn(lead, null, { ...input, imageCredit: null })).rejects.toThrow(/whose photo/);
    await expect(saveWhatsOn(lead, null, { ...input, endsOn: "2020-01-01" })).rejects.toThrow(/Ends before/);
    await expect(saveWhatsOn(lead, null, { ...input, placeId: "999999999" })).rejects.toThrow(/city/);
    const id = await saveWhatsOn(lead, null, input);
    expect((await listWhatsOn()).some((r) => r.w.id === id)).toBe(true);
    const en = ThingsResponse.parse((await callP(thingsGet, { id: String(RIYADH) }, { token })).json);
    expect(en.events.find((e) => e.id === `desk:${id}`)).toMatchObject({ title: "Riyadh Season: Boulevard World", image: { credit: "Riyadh Season" }, family: true });
    const ar = await thingsFor(String(RIYADH), {}, { locale: "ar" });
    expect(ar.events.find((e) => e.id === `desk:${id}`)?.title).toBe("موسم الرياض: بوليفارد وورلد");
    await setWhatsOnActive(lead, id, false);
    const hidden = ThingsResponse.parse((await callP(thingsGet, { id: String(RIYADH) }, { token })).json);
    expect(hidden.events.some((e) => e.id === `desk:${id}`)).toBe(false);
    const ops = await db.execute<{ action: string }>(q`SELECT action FROM audit_events WHERE entity_type = 'desk' AND entity_id = ${id}`);
    expect(ops.map((o) => o.action)).toEqual(expect.arrayContaining(["desk.whatson.added", "desk.whatson.hidden"]));
    await db.delete(appWhatsOn).where(eq(appWhatsOn.id, id));
  });
});

describe("things that aren't things to do (LIVE-AUDIT P1-16)", () => {
  it("leaves out aircraft on display, closed palaces and government sites; keeps museums and heritage", async () => {
    const { isUnfitThing } = await import("@mada/shared");
    for (const name of ["F-15 Eagle", "Boeing 707", "C-130 Hercules", "Lockheed L-1011 TriStar", "Douglas DC-4"]) expect(isUnfitThing({ name })).toBe(true);
    expect(isUnfitThing({ name: "Yamamah Palace", summary: "official residence of the King and seat of the royal court" })).toBe(true);
    expect(isUnfitThing({ name: "Ministry of Interior", summary: "government building in Riyadh" })).toBe(true);
    expect(isUnfitThing({ name: "Jet", tags: { historic: "aircraft" } })).toBe(true);
    expect(isUnfitThing({ name: "Murabba Palace", summary: "historic palace, now a museum" })).toBe(false);
    expect(isUnfitThing({ name: "Royal Saudi Air Force Museum" })).toBe(false);
    expect(isUnfitThing({ name: "Masmak Fort", summary: "clay and mudbrick fort" })).toBe(false);
    expect(isUnfitThing({ name: "Kingdom Centre", summary: "skyscraper in Riyadh" })).toBe(false);
  });
});

