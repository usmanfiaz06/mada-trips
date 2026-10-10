import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { eq, sql as q } from "drizzle-orm";
import { MessagesResponse, PlaceResponse, PlaceSearchResponse, PlanPlaceResponse, PopularPlacesResponse, bannedIn, normPlace, planMessage } from "@mada/shared";
import { db, sql } from "@/db";
import { appRequests } from "@/db/app-schema";
import { appPlaceGuides, appPlacePlans, appPlaces } from "@/db/app-schema-places";
import { runIngest } from "@/lib/app/places/ingest";
import { pendingRefreshes } from "@/lib/app/places/guide";
import { splitSections, trimExtract } from "@/lib/app/places/wiki";
import { destinationOf } from "@/lib/app/desk/adapters";
import { GET as searchGet } from "@/app/api/app/v1/places/search/route";
import { GET as popularGet } from "@/app/api/app/v1/places/popular/route";
import { GET as placeGet } from "@/app/api/app/v1/places/[id]/route";
import { POST as planPost } from "@/app/api/app/v1/places/[id]/plan/route";
import { GET as messagesGet } from "@/app/api/app/v1/requests/[id]/messages/route";
import { GET as requestsGet } from "@/app/api/app/v1/requests/route";
import { POST as peoplePost } from "@/app/api/app/v1/people/route";
import { callP, signIn } from "./wallet-helpers";

/* Places: ingestion from a small slice of the real GeoNames and OurAirports files, search ranking (prefix, typos,
   Arabic, accents, airport names and codes), the city guide from mocked Wikipedia/Wikivoyage/Commons, its 30-day
   cache and background refresh, "Plan it with Mada", and Popular. */

const FIXTURE = join(__dirname, "fixtures/places");
const TBILISI = "611717";
const ROME = "3169070";

let token = "";
const search = async (term: string, tok = token) => callP(searchGet, {}, { token: tok, query: `?q=${encodeURIComponent(term)}` });
const names = async (term: string) => PlaceSearchResponse.parse((await search(term)).json).results.map((r) => `${r.name}, ${r.countryCode}`);

beforeAll(async () => {
  await runIngest({ dir: FIXTURE, sql });
  token = (await signIn()).token;
});

describe("ingestion", () => {
  it("parses the fixture without a database (dry run)", async () => {
    const r = await runIngest({ dir: FIXTURE, dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(r.places).toBe(32);
    expect(r.airports).toBeGreaterThanOrEqual(25);
    // Atatürk (ISL) has no scheduled flights any more: left out.
    expect(r.arabic).toBeGreaterThan(20);
    expect(r.wikipedia).toBeGreaterThan(25);
    expect(r.curated).toBe(13);
  });

  it("is idempotent and keeps what guides taught us", async () => {
    const before = (await db.select({ n: q<number>`count(*)::int` }).from(appPlaces))[0]!.n;
    await db.update(appPlaces).set({ curation: "guide" }).where(eq(appPlaces.id, Number(ROME)));
    await runIngest({ dir: FIXTURE, sql });
    const after = (await db.select({ n: q<number>`count(*)::int` }).from(appPlaces))[0]!.n;
    expect(after).toBe(before);
    const [rome] = await db.select().from(appPlaces).where(eq(appPlaces.id, Number(ROME)));
    expect(rome!.curation).toBe("guide");
    expect(rome!.airports[0]!.iata).toBe("FCO"); // the hub first, though Ciampino is nearer
    const [ist] = await db.select().from(appPlaces).where(eq(appPlaces.id, 745044));
    expect(ist!.airports.map((a) => a.iata)).toContain("IST");
    expect(ist!.airports.map((a) => a.iata)).not.toContain("ISL");
    expect(ist!.wikipediaTitle).toBe("Istanbul"); // not "Constantinople"
    const [alula] = await db.select().from(appPlaces).where(eq(appPlaces.id, 108841));
    expect(alula).toMatchObject({ name: "AlUla", nameAr: "العلا", served: true, curation: "curated", iata: "ULH" });
  });
});

describe("GET /places/search", () => {
  it("needs a signed-in traveller and a query", async () => {
    expect((await search("tbilisi", "")).status).toBe(401);
    expect((await search("   ")).status).toBe(400);
  });

  it("finds cities by name, prefix and with typos", async () => {
    expect((await names("tbilisi"))[0]).toBe("Tbilisi, GE");
    expect((await names("tbil"))[0]).toBe("Tbilisi, GE");
    expect((await names("tbilsi"))[0]).toBe("Tbilisi, GE");
    expect((await names("Istanbool"))[0]).toBe("Istanbul, TR");
    expect((await names("rome"))[0]).toBe("Rome, IT");
  });

  it("ranks the bigger and the served city first when names collide", async () => {
    const london = await names("london");
    expect(london[0]).toBe("London, GB");
    expect(london).toContain("London, CA");
    const paris = await names("paris");
    expect(paris[0]).toBe("Paris, FR");
    expect((await names("medina"))[0]).toBe("Madinah, SA");
  });

  it("ignores accents and apostrophes", async () => {
    expect((await names("zurich"))[0]).toBe("Zürich, CH");
    expect((await names("sao paulo"))[0]).toBe("São Paulo, BR");
    expect((await names("taif"))[0]).toBe("Ta’if, SA");
    expect((await names("al ula"))[0]).toBe("AlUla, SA");
    expect((await names("alula"))[0]).toBe("AlUla, SA");
  });

  it("finds Arabic names, with or without hamza and diacritics", async () => {
    expect((await names("تبليسي"))[0]).toBe("Tbilisi, GE");
    expect((await names("الرياض"))[0]).toBe("Riyadh, SA");
    expect((await names("مكة"))[0]).toBe("Makkah, SA");
    expect((await names("إسطنبول"))[0]).toBe("Istanbul, TR");
    const r = PlaceSearchResponse.parse((await search("تبليسي")).json).results[0]!;
    expect(r.matched).toEqual({ kind: "arabic", label: "تبليسي" });
  });

  it("finds airports by code and by name", async () => {
    const ist = PlaceSearchResponse.parse((await search("IST")).json).results[0]!;
    expect(ist).toMatchObject({ name: "Istanbul", matched: { kind: "code" } });
    expect(ist.matched!.label).toContain("(IST)");
    expect((await names("saw"))[0]).toBe("Istanbul, TR");
    const lhr = PlaceSearchResponse.parse((await search("Heathrow")).json).results[0]!;
    expect(lhr).toMatchObject({ name: "London", countryCode: "GB", matched: { kind: "airport", label: "Heathrow (LHR)" } });
    expect((await names("tbs"))[0]).toBe("Tbilisi, GE");
  });

  it("finds a capital by its country, and old names", async () => {
    expect((await names("japan"))[0]).toBe("Tokyo, JP");
    expect((await names("tiflis"))[0]).toBe("Tbilisi, GE");
    expect((await names("mecca"))[0]).toBe("Makkah, SA");
  });

  it("answers a true no-match with the closest names", async () => {
    const r = PlaceSearchResponse.parse((await search("sd")).json);
    expect(r.results).toEqual([]);
    expect(r.suggestions.map((s) => s.name)).toEqual(expect.arrayContaining(["Sydney"]));
    expect(r.suggestions.length).toBeLessThanOrEqual(3);
    const none = PlaceSearchResponse.parse((await search("qqqqzzzz")).json);
    expect(none.results).toEqual([]);
  });

  it("returns at most eight, each with what the app shows", async () => {
    const r = PlaceSearchResponse.parse((await search("a")).json);
    expect(r.results.length).toBeLessThanOrEqual(8);
    const tb = PlaceSearchResponse.parse((await search("tbilisi")).json).results[0]!;
    expect(tb).toMatchObject({ id: TBILISI, country: "Georgia", iata: "TBS", curation: "curated", photo: "tbilisi-old-town", timezone: "Asia/Tbilisi" });
  });
});

/* ───────────── the guide ───────────── */

const VOYAGE = `Tbilisi is the capital of Georgia.

== Understand ==
Tbilisi is a city of about a million people on the Mtkvari river. It has been a crossroads of the Caucasus for 1,500 years, and its old town mixes Persian balconies with Orthodox churches. The city is walkable, hilly and full of small bakeries.
Most visitors stay in the old town or in Sololaki.

== Get in ==
=== By plane ===
Tbilisi International Airport (TBS) is 17 km east of the centre. Bus 337 runs to the centre every 30 minutes, and taxis are easy to find at arrivals.

== See ==
* Narikala Fortress, above the old town. The best view of the city.

== Eat ==
Georgian food is generous. Khachapuri, a bread filled with cheese, is everywhere, and every neighbourhood has its own bakery selling it hot from a clay oven in the morning.

== Stay safe ==
Tbilisi is a safe city. Watch for traffic: drivers rarely stop at crossings, so cross with locals where you can.

== Sleep ==
Hotels are everywhere.`;

type Hit = { url: string };
function fakeWeb(opts: { voyage?: "ok" | "429"; extract?: string } = {}) {
  const calls: Hit[] = [];
  const f = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url });
    expect(new Headers(init?.headers).get("User-Agent")).toMatch(/^MadaTrips-Places\/1\.0 \(\+https:\/\/madatrips\.sa; /);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.startsWith("https://en.wikipedia.org/api/rest_v1/page/summary/")) {
      return ok({ type: "standard", title: "Tbilisi", extract: opts.extract ?? "Tbilisi is the capital and largest city of Georgia.", wikibase_item: "Q994", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Tbilisi" } },
        originalimage: { source: "https://upload.wikimedia.org/wikipedia/commons/4/45/View_of_Tbilisi.jpg" }, coordinates: { lat: 41.72, lon: 44.79 } });
    }
    if (url.startsWith("https://commons.wikimedia.org/w/api.php")) {
      expect(url).toContain(encodeURIComponent("File:View_of_Tbilisi.jpg"));
      return ok({ query: { pages: [{ imageinfo: [{ thumburl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/45/View_of_Tbilisi.jpg/1280px-View_of_Tbilisi.jpg", thumbwidth: 1280, thumbheight: 853,
        descriptionurl: "https://commons.wikimedia.org/wiki/File:View_of_Tbilisi.jpg", extmetadata: { Artist: { value: "<a href=\"//commons.wikimedia.org/wiki/User:Someone\">Nino B.</a>" }, LicenseShortName: { value: "CC BY-SA 4.0" }, LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" } } }] }] } });
    }
    if (url.startsWith("https://www.wikidata.org/w/api.php")) return ok({ entities: { Q994: { sitelinks: { enwikivoyage: { title: "Tbilisi" } } } } });
    if (url.startsWith("https://en.wikivoyage.org/w/api.php")) {
      if (opts.voyage === "429") return new Response("You are making too many requests", { status: 429 });
      return ok({ query: { pages: [{ title: "Tbilisi", extract: VOYAGE }] } });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", f);
  return { f, calls };
}

afterEach(() => { vi.unstubAllGlobals(); });

const guide = async (id: string, tok = token) => callP(placeGet, { id }, { token: tok });

describe("GET /places/:id (the city guide)", () => {
  it("assembles a guide from the open sources, with attribution, and caches it", async () => {
    await db.delete(appPlaceGuides);
    const web = fakeWeb();
    const r = await guide(TBILISI);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const g = PlaceResponse.parse(r.json).place;
    expect(g).toMatchObject({ id: TBILISI, name: "Tbilisi", nameAr: "تبليسي", country: "Georgia", countryCode: "GE", timezone: "Asia/Tbilisi", currency: { code: "GEL" }, photo: "tbilisi-old-town" });
    expect(g.summary).toEqual({ text: "Tbilisi is the capital and largest city of Georgia.", url: "https://en.wikipedia.org/wiki/Tbilisi" });
    expect(g.image).toMatchObject({ source: "wikimedia", author: "Nino B.", licence: "CC BY-SA 4.0", width: 1280, pageUrl: "https://commons.wikimedia.org/wiki/File:View_of_Tbilisi.jpg" });
    expect(g.sections.map((s) => s.key)).toEqual(["understand", "getIn", "eat", "staySafe"]); // "See" is only a listing: left out
    expect(g.sections[1]!.text).toContain("Bus 337");
    expect(g.sections[0]!.url).toBe("https://en.wikivoyage.org/wiki/Tbilisi#Understand");
    expect(g.airports[0]).toMatchObject({ iata: "TBS", size: "large" });
    expect(g.attributions.map((a) => a.text)).toEqual(expect.arrayContaining(["From Wikipedia, CC BY-SA", "From Wikivoyage, CC BY-SA", "Photo: Nino B., CC BY-SA 4.0", "Places from GeoNames, CC BY 4.0", "Airports from OurAirports, public domain"]));
    expect(g.fetchedAt).not.toBeNull();
    const n = web.calls.length;
    expect(n).toBe(4);
    // Cached: the next open fetches nothing.
    const again = PlaceResponse.parse((await guide("tbilisi")).json).place;
    expect(again.sections).toHaveLength(4);
    expect(web.calls.length).toBe(n);
  });

  it("serves a stale guide at once and refreshes it in the background", async () => {
    await db.update(appPlaceGuides).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(appPlaceGuides.placeId, Number(TBILISI)));
    const web = fakeWeb({ extract: "Tbilisi, updated." });
    const g = PlaceResponse.parse((await guide(TBILISI)).json).place;
    expect(g.summary!.text).toBe("Tbilisi is the capital and largest city of Georgia."); // the old one, straight away
    await Promise.all([...pendingRefreshes]);
    expect(web.calls.length).toBe(4);
    const [row] = await db.select().from(appPlaceGuides).where(eq(appPlaceGuides.placeId, Number(TBILISI)));
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(row!.refreshingAt).toBeNull();
    expect(PlaceResponse.parse((await guide(TBILISI)).json).place.summary!.text).toBe("Tbilisi, updated.");
  });

  it("leaves out what a source didn't answer and tries again the next day", async () => {
    await db.delete(appPlaceGuides);
    fakeWeb({ voyage: "429" });
    const g = PlaceResponse.parse((await guide(ROME)).json).place;
    expect(g.sections).toEqual([]);
    expect(g.summary).not.toBeNull();
    expect(g.attributions.map((a) => a.source)).not.toContain("wikivoyage");
    const [row] = await db.select().from(appPlaceGuides).where(eq(appPlaceGuides.placeId, Number(ROME)));
    expect(row!.status).toBe("partial");
    expect(row!.expiresAt.getTime()).toBeLessThan(Date.now() + 2 * 86_400_000);
  });

  it("answers with what we hold when every source is down", async () => {
    await db.delete(appPlaceGuides);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    const g = PlaceResponse.parse((await guide("2643743")).json).place;
    expect(g).toMatchObject({ name: "London", country: "United Kingdom", summary: null, sections: [], image: null, fetchedAt: null, served: true, bookingKey: "london" });
    expect(g.airports.map((a) => a.iata)).toEqual(["LHR", "LGW", "LCY"]);
  });

  it("is 404 for a city we don't know, and 401 without a session", async () => {
    fakeWeb();
    expect((await guide("999999999")).status).toBe(404);
    expect((await guide("sd")).status).toBe(404);
    expect((await guide(TBILISI, "")).status).toBe(401);
    // A name works as well as an id ("Mecca" is another name for Makkah).
    expect(PlaceResponse.parse((await guide("mecca")).json).place.name).toBe("Makkah");
  });

  it("trims Wikivoyage at a sentence and never rewords it", () => {
    const long = `${"This sentence is about the city and nothing else. ".repeat(20)}`;
    const t = trimExtract(long);
    expect(t.trimmed).toBe(true);
    expect(t.text.endsWith(".")).toBe(true);
    expect(long.startsWith(t.text)).toBe(true);
    expect(splitSections("== Understand ==\nShort.", "X")).toEqual([]);
  });
});

/* ───────────── plan it with Mada ───────────── */

describe("POST /places/:id/plan", () => {
  const plan = (id: string, b: unknown, tok = token) => callP(planPost, { id }, { method: "POST", token: tok, body: b });

  it("sends a destination request to the desk, with their words as the first message", async () => {
    const r = await plan(TBILISI, { travellers: 4, month: "2027-05", clientId: "plan-tbs-0001" });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const { request, message } = PlanPlaceResponse.parse(r.json);
    expect(message).toBe("Tbilisi, 4 of us, sometime in May");
    expect(request).toMatchObject({ title: "A trip to Tbilisi", status: "sent", kind: "general", agent: { name: "Faisal" } });
    const [row] = await db.select().from(appRequests).where(eq(appRequests.id, request.id));
    expect(row!.kind).toBe("destination");
    expect(destinationOf(row!.details)).toMatchObject({ id: TBILISI, name: "Tbilisi", country: "Georgia", airports: ["TBS"], message });
    const thread = MessagesResponse.parse((await callP(messagesGet, { id: request.id }, { token })).json);
    expect(thread.messages[0]).toMatchObject({ from: "me", text: message });
    const all = (await callP(requestsGet, {}, { token })).json.requests as { id: string }[];
    expect(all.map((x) => x.id)).toContain(request.id);
    expect((await db.select().from(appPlacePlans).where(eq(appPlacePlans.requestId, request.id)))).toHaveLength(1);
    // The same tap twice is one request.
    const again = PlanPlaceResponse.parse((await plan(TBILISI, { travellers: 4, month: "2027-05", clientId: "plan-tbs-0001" })).json);
    expect(again.request.id).toBe(request.id);
    expect(bannedIn(request.title)).toEqual([]);
  });

  it("takes dates, people from the household and their own message", async () => {
    const { token: tok } = await signIn();
    const hessa = (await callP(peoplePost, {}, { method: "POST", token: tok, body: { givenNames: "Hessa", surname: "Alharbi", relation: "spouse", dateOfBirth: "1988-07-24" } })).json.person.id as string;
    const r = PlanPlaceResponse.parse((await plan("rome", { travellerIds: [hessa], depart: "2027-04-10", return: "2027-04-17" }, tok)).json);
    expect(r.message).toBe("Rome, just me, 10 Apr to 17 Apr");
    expect(r.request.travellerIds).toEqual([hessa]);
    const own = PlanPlaceResponse.parse((await plan("rome", { message: "Rome for our anniversary, two of us in spring" }, tok)).json);
    expect(own.message).toBe("Rome for our anniversary, two of us in spring");
  });

  it("refuses other people's travellers, bad dates, unknown cities and no session", async () => {
    const other = await signIn();
    const theirs = (await callP(peoplePost, {}, { method: "POST", token: other.token, body: { givenNames: "Sara", surname: "Alharbi", relation: "child", dateOfBirth: "2013-05-12" } })).json.person.id as string;
    expect((await plan(TBILISI, { travellerIds: [theirs] })).status).toBe(404);
    expect((await plan(TBILISI, { depart: "2027-05-10", return: "2027-05-01" })).status).toBe(400);
    expect((await plan(TBILISI, { month: "2027-13" })).status).toBe(400);
    expect((await plan("999999999", {})).status).toBe(404);
    expect((await plan(TBILISI, {}, "")).status).toBe(401);
  });
});

describe("GET /places/popular", () => {
  it("lists our cities in our order, not the one you're in, then the cities people ask for", async () => {
    const r = PopularPlacesResponse.parse((await callP(popularGet, {}, { token, query: "?from=RUH" })).json);
    expect(r.places[0]!.name).toBe("Istanbul");
    expect(r.places.map((p) => p.name)).not.toContain("Riyadh");
    expect(r.places.map((p) => p.name)).toContain("Rome"); // asked for above, and not one of ours
    expect(r.places.findIndex((p) => p.name === "Rome")).toBeGreaterThan(r.places.findIndex((p) => p.name === "Tbilisi"));
    expect((await callP(popularGet, {}, { token, query: "?from=riyadh" })).status).toBe(400);
    expect((await callP(popularGet, {}, { query: "?from=RUH" })).status).toBe(401);
  });
});

describe("shared helpers", () => {
  it("normalises names the same way everywhere", () => {
    expect(normPlace("İstanbul")).toBe("istanbul");
    expect(normPlace("Ta’if")).toBe("taif");
    expect(normPlace("Zürich")).toBe("zurich");
    expect(normPlace("مكّة المكرّمة")).toBe("مكه المكرمه");
    expect(normPlace("أبها")).toBe(normPlace("ابها"));
    expect(planMessage({ city: "Tbilisi", travellers: 4, month: "2027-05" })).toBe("Tbilisi, 4 of us, sometime in May");
    expect(planMessage({ city: "Baku" })).toBe("Baku, dates to decide");
  });
});
