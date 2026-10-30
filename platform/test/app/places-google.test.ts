import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSseFrames, type AskChatEvent, type ChatCard } from "@mada/shared";
import { POST as chatPost } from "@/app/api/app/v1/ask/chat/route";
import { POST as addItem } from "@/app/api/app/v1/trips/[id]/plan/items/route";
import { setChatApi } from "@/lib/app/ask-chat/engine";
import { EVAL_CASES } from "@/lib/app/ask-chat/evals";
import { activeTools, compactPromptFor, leanToolsFor } from "@/lib/app/ask-chat/prompt";
import { runTool, type ToolCtx } from "@/lib/app/ask-chat/tools";
import { proxiedImage, clearImageCache } from "@/lib/app/image-proxy";
import { resetBreakers } from "@/lib/app/resilience/breaker";
import { imageProxyPath, scrubResponse } from "@/lib/app/shield";
import { DETAILS_FIELD_MASK, SEARCH_FIELD_MASK, googlePlaces, searchBody } from "@/lib/app/suppliers/places/google";
import { chatPlace, clearPlacesCache, photoUrl, placeDetails, placesMode, searchPlaces, setPlacesSupplier } from "@/lib/app/suppliers/places";
import { openState, todayHours } from "@/lib/app/suppliers/places/hours";
import { readPlan } from "@/lib/app/plans/plans";
import { fakeApi } from "./ask-chat-fake";
import { freshIp } from "./helpers";
import { callP, signIn } from "./wallet-helpers";
import { scanJson } from "../../../tools/leak-scan/denylist.mjs";

/*
 * Places in Ask from Google Places API (New) (docs/app/CONNECT.md §32), with no network: the adapter's requests and
 * field masks, the cache, the breaker, the mock, open now from the weekly hours, the two tools and their cards, the
 * tools gone without a key, the photo route that never lets the key out, and a place added to a plan.
 */

const KEY = "AIza-test-places-key-never-shown-0123456789";
const SEARCH_MASK = "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.primaryTypeDisplayName,places.regularOpeningHours.periods,places.regularOpeningHours.weekdayDescriptions,places.utcOffsetMinutes,places.photos";

type Call = { url: string; init: RequestInit };
/** A fake Google: records every call and answers by URL. */
function fakeGoogle(answer: (url: string, init: RequestInit) => Response) {
  const calls: Call[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), init: init ?? {} }); return answer(String(url), init ?? {}); }) as typeof fetch;
  return { calls, f };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
const headerOf = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

// Istanbul (UTC+3): every day 11:00 to 03:00 the next day.
const PERIODS = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, hour: 11, minute: 0 }, close: { day: (day + 1) % 7, hour: 3, minute: 0 } }));
const G_PLACE = {
  id: "ChIJabc123def456ghi789", displayName: { text: "Dürümzade", languageCode: "tr" }, formattedAddress: "Hamalbaşı Cd. 26/B, Beyoğlu, İstanbul",
  location: { latitude: 41.0336, longitude: 28.9768 }, rating: 4.6, userRatingCount: 18420, priceLevel: "PRICE_LEVEL_INEXPENSIVE",
  primaryTypeDisplayName: { text: "Shawarma restaurant" }, utcOffsetMinutes: 180,
  regularOpeningHours: { periods: PERIODS, weekdayDescriptions: ["Monday: 11:00 AM – 3:00 AM", "Tuesday: 11:00 AM – 3:00 AM", "Wednesday: 11:00 AM – 3:00 AM", "Thursday: 11:00 AM – 3:00 AM", "Friday: 11:00 AM – 3:00 AM", "Saturday: 11:00 AM – 3:00 AM", "Sunday: 11:00 AM – 3:00 AM"] },
  internationalPhoneNumber: "+90 212 249 0147", websiteUri: "https://durumzade.example", googleMapsUri: "https://maps.google.com/?cid=1",
  photos: [{ name: "places/ChIJabc123def456ghi789/photos/AXCi2Q7", widthPx: 4000, authorAttributions: [{ displayName: "Ayşe K.", uri: "https://maps.google.com/maps/contrib/1" }] }, { name: "places/ChIJabc123def456ghi789/photos/B2", authorAttributions: [] }],
  reviews: [{ text: "never kept" }],
};

const ctx = (over: Partial<ToolCtx> = {}): ToolCtx => ({ ownerId: "00000000-0000-4000-8000-00000000abcd", people: [], today: "2026-10-28", lang: "en", ipHash: null, demo: new Set(), ...over });

beforeEach(() => { clearPlacesCache(); resetBreakers(); clearImageCache(); });
afterEach(() => {
  setPlacesSupplier(null); setChatApi(null);
  for (const k of ["SUPPLIER_MODE_PLACES", "GOOGLE_PLACES_API_KEY", "ASK_CHAT", "ANTHROPIC_API_KEY"]) delete process.env[k];
});

describe("the Google Places adapter", () => {
  it("searches with the key in a header, a tight field mask, the language, at most 5 and a circle around the hotel", async () => {
    process.env.GOOGLE_PLACES_API_KEY = KEY;
    const g = fakeGoogle(() => json({ places: [G_PLACE] }));
    const out = await googlePlaces(g.f).search({ query: "shawarma in Istanbul", near: { lat: 41.03, lng: 28.98, radiusM: 2000 }, openNow: true, lang: "ar", max: 9 });
    const c = g.calls[0]!;
    expect(c.url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(c.url).not.toContain(KEY);
    expect(c.init.method).toBe("POST");
    expect(headerOf(c, "X-Goog-Api-Key")).toBe(KEY);
    expect(headerOf(c, "X-Goog-FieldMask")).toBe(SEARCH_MASK);
    expect(SEARCH_FIELD_MASK).toBe(SEARCH_MASK);
    // Only what the cards show: no reviews, no Atmosphere fields, no live "open now" to go stale in the cache.
    expect(SEARCH_FIELD_MASK).not.toMatch(/reviews|serves|currentOpeningHours|\*/);
    expect(JSON.parse(String(c.init.body))).toEqual({ textQuery: "shawarma in Istanbul", languageCode: "ar", pageSize: 5, openNow: true, locationBias: { circle: { center: { latitude: 41.03, longitude: 28.98 }, radius: 2000 } } });
    expect(out[0]).toMatchObject({ id: G_PLACE.id, name: "Dürümzade", type: "Shawarma restaurant", rating: 4.6, ratings: 18420, price: 1, lat: 41.0336, utcOffsetMinutes: 180 });
    expect(out[0]!.photos).toEqual([{ name: G_PLACE.photos[0]!.name, authors: [{ name: "Ayşe K.", uri: "https://maps.google.com/maps/contrib/1" }] }, { name: "places/ChIJabc123def456ghi789/photos/B2", authors: [] }]);
    expect(JSON.stringify(out)).not.toContain("never kept");
    expect(searchBody({ query: "x", near: null, openNow: false, lang: "en", max: 3 })).toEqual({ textQuery: "x", languageCode: "en", pageSize: 3 });
  });

  it("reads details with their own mask, and photos through skipHttpRedirect; a bad id is never put in a URL", async () => {
    process.env.GOOGLE_PLACES_API_KEY = KEY;
    const g = fakeGoogle((url) => (url.includes("/media?") ? json({ name: "x", photoUri: "https://lh3.googleusercontent.com/p/abc=s640" }) : json(G_PLACE)));
    const s = googlePlaces(g.f);
    const d = await s.details(G_PLACE.id, "en");
    expect(g.calls[0]!.url).toBe(`https://places.googleapis.com/v1/places/${G_PLACE.id}?languageCode=en`);
    expect(headerOf(g.calls[0]!, "X-Goog-FieldMask")).toBe(DETAILS_FIELD_MASK);
    expect(DETAILS_FIELD_MASK.split(",")).toEqual(expect.arrayContaining(["internationalPhoneNumber", "websiteUri", "googleMapsUri", "regularOpeningHours.weekdayDescriptions"]));
    expect(d).toMatchObject({ phone: "+90 212 249 0147", website: "https://durumzade.example", mapsUrl: "https://maps.google.com/?cid=1" });
    expect(await s.photoUri(G_PLACE.photos[0]!.name, 640)).toBe("https://lh3.googleusercontent.com/p/abc=s640");
    expect(g.calls[1]!.url).toBe(`https://places.googleapis.com/v1/${G_PLACE.photos[0]!.name}/media?maxWidthPx=640&skipHttpRedirect=true`);
    expect(headerOf(g.calls[1]!, "X-Goog-Api-Key")).toBe(KEY);
    expect(await s.details("../../evil?x=1", "en")).toBeNull();
    expect(await s.photoUri("https://evil.example/x", 640)).toBeNull();
    expect(g.calls).toHaveLength(2);
  });

  it("a 5xx or 429 is an outage; any other 4xx is an answer (nothing found)", async () => {
    process.env.GOOGLE_PLACES_API_KEY = KEY;
    await expect(googlePlaces(fakeGoogle(() => json({}, 503)).f).search({ query: "x", near: null, openNow: false, lang: "en", max: 5 })).rejects.toMatchObject({ code: "SUPPLIER_UNAVAILABLE" });
    await expect(googlePlaces(fakeGoogle(() => json({}, 429)).f).search({ query: "x", near: null, openNow: false, lang: "en", max: 5 })).rejects.toMatchObject({ code: "SUPPLIER_UNAVAILABLE" });
    expect(await googlePlaces(fakeGoogle(() => json({ error: { message: "API key not valid" } }, 400)).f).search({ query: "x", near: null, openNow: false, lang: "en", max: 5 })).toEqual([]);
    expect(await googlePlaces(fakeGoogle(() => json({}, 404)).f).details(G_PLACE.id, "en")).toBeNull();
  });

  it("caches a search for an hour and details for a day, by language", async () => {
    process.env.GOOGLE_PLACES_API_KEY = KEY;
    const g = fakeGoogle((url) => (url.endsWith(":searchText") ? json({ places: [G_PLACE] }) : json(G_PLACE)));
    setPlacesSupplier(googlePlaces(g.f));
    const q = { query: "Shawarma  in Istanbul", near: null, openNow: false, lang: "en" as const, max: 5 };
    await searchPlaces(q);
    await searchPlaces({ ...q, query: "shawarma in istanbul" });
    expect(g.calls).toHaveLength(1);
    await searchPlaces({ ...q, lang: "ar" });
    expect(g.calls).toHaveLength(2);
    await placeDetails(G_PLACE.id, "en");
    await placeDetails(G_PLACE.id, "en");
    expect(g.calls).toHaveLength(3);
  });

  it("goes through the places breaker: five outages open it and the sixth call never reaches Google", async () => {
    process.env.GOOGLE_PLACES_API_KEY = KEY;
    const g = fakeGoogle(() => json({}, 500));
    setPlacesSupplier(googlePlaces(g.f));
    for (let i = 0; i < 5; i++) await expect(searchPlaces({ query: `q${i}`, near: null, openNow: false, lang: "en", max: 5 })).rejects.toBeTruthy();
    await expect(searchPlaces({ query: "q6", near: null, openNow: false, lang: "en", max: 5 })).rejects.toMatchObject({ code: "SUPPLIER_DOWN" });
    expect(g.calls).toHaveLength(5);
  });

  it("is on with the key, mock only when asked for, and off otherwise", () => {
    expect(placesMode()).toBe("off");
    process.env.SUPPLIER_MODE_PLACES = "mock";
    expect(placesMode()).toBe("mock");
    process.env.SUPPLIER_MODE_PLACES = "google";
    expect(placesMode()).toBe("off");
    process.env.GOOGLE_PLACES_API_KEY = KEY;
    expect(placesMode()).toBe("google");
    process.env.SUPPLIER_MODE_PLACES = "off";
    expect(placesMode()).toBe("off");
  });

  it("mock mode answers from its own sample places, nearest first", async () => {
    process.env.SUPPLIER_MODE_PLACES = "mock";
    const r = await searchPlaces({ query: "shawarma in Istanbul", near: { lat: 41.0352, lng: 28.9862, radiusM: 2000 }, openNow: false, lang: "en", max: 5 });
    expect(r.map((p) => p.id)).toEqual(["mock-ist-shawarma-02", "mock-ist-durum-01", "mock-ist-doner-03"]);
    expect((await searchPlaces({ query: "مندي في دبي", near: null, openNow: false, lang: "ar", max: 5 })).every((p) => p.id.startsWith("mock-dxb-mandi"))).toBe(true);
  });
});

describe("open now, from the weekly hours at this moment", () => {
  // 2026-10-28 is a Wednesday.
  const at = (iso: string) => new Date(iso);
  it("open late into the night, closed in the morning, open around the clock", () => {
    expect(openState(PERIODS, 180, at("2026-10-28T19:00:00Z"))).toEqual({ now: true, closes: "03:00", opens: null }); // 22:00 local
    expect(openState(PERIODS, 180, at("2026-10-28T23:30:00Z"))).toEqual({ now: true, closes: "03:00", opens: null }); // 02:30 Thu, from Wed's period
    expect(openState(PERIODS, 180, at("2026-10-29T03:00:00Z"))).toEqual({ now: false, closes: null, opens: "11:00" }); // 06:00
    // Saturday night into Sunday wraps the week.
    expect(openState(PERIODS, 180, at("2026-10-31T23:30:00Z"))).toEqual({ now: true, closes: "03:00", opens: null }); // Sun 02:30, from Sat's period
  });
  it("the same hours read in another offset; none without hours or an offset", () => {
    expect(openState([{ open: { day: 0, hour: 0, minute: 0 }, close: null }], 240)).toEqual({ now: true, closes: null, opens: null });
    expect(openState(null, 180)).toBeNull();
    expect(openState(PERIODS, null)).toBeNull();
    expect(todayHours(G_PLACE.regularOpeningHours.weekdayDescriptions, 180, at("2026-10-28T19:00:00Z"))).toBe("11:00 AM – 3:00 AM");
    expect(todayHours(["الاثنين: ١١:٠٠ص–٣:٠٠ص", "", "", "", "", "", "الأحد: مغلق"], 180, at("2026-11-01T10:00:00Z"))).toBe("مغلق");
  });
  it("never cached: the same record is open at night and closed in the morning", () => {
    const rec = { ...chatPlaceInput(), periods: PERIODS };
    expect(chatPlace(rec, { now: at("2026-10-28T19:00:00Z") }).open?.now).toBe(true);
    expect(chatPlace(rec, { now: at("2026-10-29T03:00:00Z") }).open?.now).toBe(false);
  });
});

function chatPlaceInput() {
  return { id: "ChIJx1234567890", name: "X", type: null, address: null, lat: 41, lng: 29, rating: null, ratings: null, price: null, periods: null, week: null, utcOffsetMinutes: 180, phone: null, website: null, mapsUrl: null, photos: [] };
}

describe("Ask's places tools", () => {
  it("are not listed to the model without the key, and are with it (last, after every other tool)", () => {
    expect(activeTools().map((t) => t.name)).not.toContain("find_places");
    expect(leanToolsFor("food")).not.toContain("find_places");
    process.env.GOOGLE_PLACES_API_KEY = KEY;
    const names = activeTools().map((t) => t.name);
    expect(names.slice(-2)).toEqual(["find_places", "place_details"]);
    expect(leanToolsFor("food")).toContain("find_places");
    // Details only once a search has run in the thread.
    expect(leanToolsFor("food")).not.toContain("place_details");
    expect(leanToolsFor("food", ["find_places"])).toContain("place_details");
    expect(compactPromptFor(leanToolsFor("food"))).toContain("find_places, then place_details");
    expect(compactPromptFor(leanToolsFor("esim"))).not.toContain("find_places");
  });

  it("find_places: one short line a place for the model, the places card for the app", async () => {
    process.env.SUPPLIER_MODE_PLACES = "mock";
    const r = await runTool("find_places", { query: "shawarma", city: "Istanbul", near: null, open_now: false, trip_id: null }, ctx());
    expect(r.isError).toBeFalsy();
    const lines = r.text.split("\n");
    expect(lines[0]).toMatch(/^Places from Google for "shawarma" in Istanbul, local time \d\d:\d\d:$/);
    expect(lines[1]).toMatch(/^1\. id=mock-ist-\S+ · .+ · \d\.\d★ \([\d,]+\) · (low prices|mid-range) · (open now, closes \d\d:\d\d|closed now(, opens \d\d:\d\d)?) · /);
    expect(r.text).toContain("Hours, ratings, open now and addresses only as written here");
    expect(r.text.length).toBeLessThan(900);
    const card = r.cards![0] as Extract<ChatCard, { type: "places" }>;
    expect(card.type).toBe("places");
    expect(card.places.length).toBeGreaterThan(0);
    expect(card.places.length).toBeLessThanOrEqual(5);
    expect(card.places[0]!.photo).toEqual({ url: expect.stringMatching(/^https:\/\/places\.googleapis\.com\/v1\/places\/mock-ist-[\w-]+\/photos\/p1\/media\?maxWidthPx=640$/), credit: [{ name: "A Mada traveller", url: null }] });
    expect(card.places[0]!.week).toBeUndefined();
  });

  it("near the hotel without a trip there: searches the city and says so", async () => {
    process.env.SUPPLIER_MODE_PLACES = "mock";
    const r = await runTool("find_places", { query: "mandi", city: "Dubai", near: "hotel", open_now: false, trip_id: null }, ctx({ lang: "ar" }));
    expect(r.text).toMatch(/^No trip of theirs to Dubai that we know: searched Dubai, not near a hotel/);
    expect((r.cards![0] as Extract<ChatCard, { type: "places" }>).places.every((p) => p.distanceM === null)).toBe(true);
  });

  it("open now drops a place closed at this moment, and nothing found is said plainly", async () => {
    process.env.SUPPLIER_MODE_PLACES = "mock";
    const r = await runTool("find_places", { query: "pharmacy", city: "Istanbul", near: null, open_now: true, trip_id: null }, ctx());
    expect((r.cards![0] as Extract<ChatCard, { type: "places" }>).places.every((p) => p.open?.now)).toBe(true);
    const none = await runTool("find_places", { query: "ice rink", city: "Istanbul", near: null, open_now: false, trip_id: null }, ctx());
    expect(none.text).toMatch(/^No places from Google for "ice rink"/);
    expect(none.cards).toBeUndefined();
  });

  it("place_details: the week's hours, the buttons on the card, no phone number in what the model reads", async () => {
    process.env.SUPPLIER_MODE_PLACES = "mock";
    const r = await runTool("place_details", { place_id: "mock-ist-durum-01", trip_id: null }, ctx());
    expect(r.text).toContain("Dürümzade Beyoğlu (id=mock-ist-durum-01) · Shawarma restaurant · 4.6★ from 18,420 reviews · low prices");
    expect(r.text).toContain("Week: Monday: 11:00 AM – 3:00 AM;");
    expect(r.text).toContain("On the card: Directions, Call, Add to plan.");
    expect(r.text).not.toContain("+90");
    const card = r.cards![0] as Extract<ChatCard, { type: "place" }>;
    expect(card.place).toMatchObject({ id: "mock-ist-durum-01", phone: "+90 212 249 0147", week: expect.arrayContaining(["Monday: 11:00 AM – 3:00 AM"]) });
    expect((await runTool("place_details", { place_id: "nope", trip_id: null }, ctx())).isError).toBe(true);
  });

  it("with places off the tools answer plainly (never 'we don't do that'), and Google down is the same", async () => {
    const r = await runTool("find_places", { query: "shawarma", city: "Istanbul", near: null, open_now: false, trip_id: null }, ctx());
    expect(r.text).toMatch(/^Google's places didn't answer just now\. Suggest well-known places/);
    process.env.GOOGLE_PLACES_API_KEY = KEY;
    setPlacesSupplier(googlePlaces(fakeGoogle(() => json({}, 503)).f));
    expect((await runTool("find_places", { query: "shawarma", city: "Istanbul", near: null, open_now: false, trip_id: null }, ctx())).text).toMatch(/^Google's places didn't answer/);
  });

  it("the eval set has the two places conversations", () => {
    expect(EVAL_CASES.find((c) => c.id === "places-shawarma")!.turns[0]!.user).toBe("Good shawarma near our hotel in Istanbul, open now");
    expect(EVAL_CASES.find((c) => c.id === "places-mandi-ar")!.turns[0]!.toolsAnyOf).toEqual(["find_places"]);
  });
});

describe("photos and privacy", () => {
  it("the route fetches the photo with the key on the server only; the app's link, the answer and its headers never carry it", async () => {
    process.env.GOOGLE_PLACES_API_KEY = KEY;
    const g = fakeGoogle((url) => (url.includes("/media?") ? json({ photoUri: "https://lh3.googleusercontent.com/p/abc=s640" }) : json({})));
    setPlacesSupplier(googlePlaces(g.f));
    const url = photoUrl(G_PLACE.photos[0]!.name);
    expect(url).not.toContain(KEY);
    const link = scrubResponse({ photo: { url } }, "https://api.madatrips.sa") as { photo: { url: string } };
    expect(link.photo.url).toMatch(/^https:\/\/api\.madatrips\.sa\/api\/app\/v1\/img\/m_[\w-]+$/);
    const token = imageProxyPath(url).slice("/img/".length);
    expect(link.photo.url.endsWith(token)).toBe(true);
    const img: string[] = [];
    const res = await proxiedImage(token, async (u, init) => {
      img.push(u);
      expect(JSON.stringify(init.headers ?? {})).not.toContain(KEY);
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    });
    expect(res.status).toBe(200);
    expect(img).toEqual(["https://lh3.googleusercontent.com/p/abc=s640"]);
    expect(headerOf(g.calls[0]!, "X-Goog-Api-Key")).toBe(KEY);
    expect([...res.headers.values()].join(" ")).not.toContain(KEY);
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400, s-maxage=86400");
    // An image address off Google's image hosts is never fetched.
    clearImageCache();
    const odd = await proxiedImage(token, async () => { throw new Error("must not fetch"); }, Date.now(), async () => "https://evil.example/x.jpg");
    expect(odd.status).toBe(404);
  });

  it("a whole chat turn: cards with our image links and Google's credit, nothing of the key, the mask or a partner", async () => {
    process.env.SUPPLIER_MODE_PLACES = "mock";
    process.env.ASK_CHAT = "on";
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    const me = await signIn();
    setChatApi(fakeApi((p, n) => (n === 0
      ? { blocks: [{ type: "tool_use", name: "find_places", input: { query: "shawarma", city: "Istanbul", near: null, open_now: false, trip_id: null } }] }
      : { blocks: [{ type: "text", text: "Two good ones close by. <next>Directions | Add to my plan</next>" }] })));
    const req = new Request("http://localhost/api/app/v1/ask/chat", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${me.token}`, "x-forwarded-for": freshIp(), "user-agent": "vitest" },
      body: JSON.stringify({ text: "Good shawarma in Istanbul" }),
    });
    const events = readSseFrames(await (await chatPost(req)).text()).events as AskChatEvent[];
    const card = events.flatMap((e) => (e.type === "cards" ? e.cards : [])).find((c) => c.type === "places") as Extract<ChatCard, { type: "places" }>;
    expect(card.places[0]!.photo!.url).toMatch(/\/api\/app\/v1\/img\/m_[\w-]+$/);
    const all = JSON.stringify(events);
    expect(all).not.toMatch(/googleapis|X-Goog|FieldMask|AIza/);
    expect(scanJson(events)).toEqual([]);
  });
});

describe("Add to plan", () => {
  it("puts the place on the chosen day with its name, where it is and Google's place id", async () => {
    const me = await signIn();
    const ROAD = { trip_id: null, template_id: null, origin: "RUH", return_to: null, start: "2026-12-10", days: 3, traveller_ids: [], pace: "normal", must: [], travel_mode: "fly", stops: [{ place: "Istanbul", nights: 3 }] };
    const made = await runTool("create_plan", ROAD, ctx({ ownerId: me.user.id }));
    const tripId = (made.cards!.find((c) => c.type === "plan") as Extract<ChatCard, { type: "plan" }>).tripId;
    const before = await readPlan(me.user.id, tripId);
    const r = await callP(addItem, { id: tripId }, { method: "POST", token: me.token, body: { version: before.version, day: 1, item: { kind: "meal", title: "Dürümzade Beyoğlu", place: { name: "Dürümzade Beyoğlu", kind: "place", lat: 41.0336, lng: 28.9768, gid: "ChIJabc123def456ghi789" } } } });
    expect(r.status).toBe(201);
    const item = r.json.plan.items.find((i: { title: string }) => i.title === "Dürümzade Beyoğlu");
    expect(item).toMatchObject({ day: 1, kind: "meal", place: { name: "Dürümzade Beyoğlu", kind: "place", lat: 41.0336, lng: 28.9768, gid: "ChIJabc123def456ghi789", code: null } });
    // A Google place is kept as given: "Dubai Mall" never turns into the city of Dubai.
    const again = await readPlan(me.user.id, tripId);
    const r2 = await callP(addItem, { id: tripId }, { method: "POST", token: me.token, body: { version: again.version, day: 0, item: { kind: "activity", title: "The Dubai Mall", place: { name: "The Dubai Mall", kind: "place", lat: 25.1985, lng: 55.2796, gid: "ChIJmall0000000001" } } } });
    expect(r2.json.plan.items.find((i: { title: string }) => i.title === "The Dubai Mall").place).toMatchObject({ name: "The Dubai Mall", kind: "place", code: null, gid: "ChIJmall0000000001" });
  });
});
