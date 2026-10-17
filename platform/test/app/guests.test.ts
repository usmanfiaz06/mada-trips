import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { DiscoverResponse, FlightSearchResponse, OfferResponse, PlanResponse, StaySearchResponse, addDays, languageOfText, todayIn } from "@mada/shared";
import { db } from "@/db";
import { appOffers } from "@/db/app-schema-booking";
import { GUEST_LIMITS } from "@/lib/app/guest";
import { POST as askParse } from "@/app/api/app/v1/ask/parse/route";
import { POST as searchFlights } from "@/app/api/app/v1/search/flights/route";
import { POST as searchStays } from "@/app/api/app/v1/search/stays/route";
import { POST as searchEntry } from "@/app/api/app/v1/search/entry/route";
import { GET as offerGet } from "@/app/api/app/v1/offers/[id]/route";
import { GET as planGet } from "@/app/api/app/v1/plans/[id]/route";
import { GET as discoverGet } from "@/app/api/app/v1/discover/route";
import { GET as tripsGet } from "@/app/api/app/v1/trips/route";
import { GET as ordersGet } from "@/app/api/app/v1/orders/route";
import { POST as previewPost } from "@/app/api/app/v1/orders/preview/route";
import { GET as peopleGet } from "@/app/api/app/v1/people/route";
import { GET as circlesGet } from "@/app/api/app/v1/circles/route";
import { GET as messageTr } from "@/app/api/app/v1/messages/[id]/translation/route";
import { GET as hotelTr } from "@/app/api/app/v1/hotels/[code]/translation/route";
import { callP, signIn } from "./wallet-helpers";
import { freshIp } from "./helpers";

/* Looking around without an account (lib/app/guest.ts): searches, prices, offers, plans and Discover answer a guest;
   everything personal stays behind sign-in; the guest's offer becomes the account's when they sign in to book it. */

const DEPART = addDays(todayIn(), 40);
const me = randomUUID();
const kid = randomUUID();
const guests = [{ id: me, dateOfBirth: null, isSelf: true }, { id: kid, dateOfBirth: addDays(todayIn(), -365 * 8), isSelf: false }];
const asGuest = (ip = freshIp()) => ({ "x-forwarded-for": ip, "accept-language": "ar-SA,ar;q=0.9" });

describe("guests", () => {
  it("search flights and stays with real prices, no token, nothing personal kept", async () => {
    const f = await callP(searchFlights, {}, { method: "POST", headers: asGuest(), body: { from: "RUH", destination: "istanbul", depart: DEPART, return: addDays(DEPART, 5), travellerIds: [me, kid], guests } });
    expect(f.status, JSON.stringify(f.json)).toBe(200);
    const flights = FlightSearchResponse.parse(f.json);
    expect(flights.options.length).toBeGreaterThan(0);
    // The child flies on a child fare: priced for the people said, not two adults.
    expect(flights.options[0]!.children).toBe(1);
    const [row] = await db.select().from(appOffers).where(eq(appOffers.id, flights.options[0]!.id));
    expect(row!.ownerId).toBeNull();

    const s = await callP(searchStays, {}, { method: "POST", headers: asGuest(), body: { destination: "istanbul", checkIn: DEPART, nights: 3, travellerIds: [me, kid], guests } });
    expect(s.status, JSON.stringify(s.json)).toBe(200);
    expect(StaySearchResponse.parse(s.json).options.length).toBeGreaterThan(0);

    const e = await callP(searchEntry, {}, { method: "POST", headers: asGuest(), body: { destination: "istanbul", travellerIds: [me], depart: DEPART, return: null, guests } });
    expect(e.status, JSON.stringify(e.json)).toBe(200);

    const o = await callP(offerGet, { id: flights.options[0]!.id }, { headers: asGuest() });
    expect(o.status).toBe(200);
    expect(OfferResponse.parse(o.json).flight?.id).toBe(flights.options[0]!.id);
  });

  it("Ask, a shared plan and Discover open for a guest", async () => {
    const a = await callP(askParse, {}, { method: "POST", headers: asGuest(), body: { text: "Dubai next month, me and my wife" } });
    expect(a.status, JSON.stringify(a.json)).toBe(200);
    expect(a.json.intent.kind).toBe("flight");
    const p = await callP(planGet, { id: "alula2" }, { headers: asGuest(), query: "?travellers=3" });
    expect(p.status, JSON.stringify(p.json)).toBe(200);
    expect(PlanResponse.parse(p.json).plan.travellers).toBe(3);
    const d = await callP(discoverGet, {}, { headers: asGuest(), query: "?city=Istanbul" });
    expect(d.status, JSON.stringify(d.json)).toBe(200);
    expect(DiscoverResponse.parse(d.json).city).toBe("Istanbul");
    const home = await callP(discoverGet, {}, { headers: asGuest() });
    expect(DiscoverResponse.parse(home.json).city).toBeTruthy();
  });

  it("everything personal still needs an account", async () => {
    for (const [h, method] of [[tripsGet, "GET"], [ordersGet, "GET"], [peopleGet, "GET"], [circlesGet, "GET"], [previewPost, "POST"]] as const) {
      const r = await callP(h, {}, { method, headers: asGuest(), ...(method === "POST" ? { body: {} } : {}) });
      expect(r.status).toBe(401);
    }
  });

  it("signing in to book takes the guest's offer; nobody else can", async () => {
    const f = FlightSearchResponse.parse((await callP(searchFlights, {}, { method: "POST", headers: asGuest(), body: { from: "RUH", destination: "dubai", depart: DEPART, return: null, travellerIds: [me], guests } })).json);
    const offer = f.options[0]!;
    const a = await signIn();
    const people = (await callP(peopleGet, {}, { token: a.token })).json.people as { id: string; isSelf: boolean }[];
    const self = people.find((p) => p.isSelf)!.id;
    const pv = await callP(previewPost, {}, { method: "POST", token: a.token, body: { draft: { kind: "trip", flightOfferId: offer.id, bundle: false, travellerIds: [self] }, useCredit: true } });
    expect(pv.status, JSON.stringify(pv.json)).toBe(200);
    const [row] = await db.select().from(appOffers).where(eq(appOffers.id, offer.id));
    expect(row!.ownerId).toBe(a.user.id);
    // Now it's someone's: another account and a guest no longer see it.
    const b = await signIn();
    expect((await callP(offerGet, { id: offer.id }, { token: b.token })).status).toBe(404);
    expect((await callP(offerGet, { id: offer.id }, { headers: asGuest() })).status).toBe(404);
  });

  it("a guest network is limited per minute", async () => {
    const ip = freshIp();
    let last = 200;
    for (let i = 0; i <= GUEST_LIMITS.searchesPerMinute; i += 1) {
      last = (await callP(askParse, {}, { method: "POST", headers: asGuest(ip), body: { text: "Riyadh" } })).status;
    }
    expect(last).toBe(429);
  });

  it("Translate: a message only for its own conversation, a hotel's words for anyone, never made up", async () => {
    expect((await callP(messageTr, { id: randomUUID() }, { headers: asGuest(), query: "?to=ar" })).status).toBe(401);
    const a = await signIn();
    expect((await callP(messageTr, { id: randomUUID() }, { token: a.token, query: "?to=ar" })).status).toBe(404);
    // A hotel that isn't in the store: not found; the mock translator never invents a translation (501).
    expect((await callP(hotelTr, { code: "999999991" }, { headers: asGuest(), query: "?to=ar" })).status).toBe(404);
  });

  it("a message's language is read from its letters", () => {
    expect(languageOfText("ابي رحلة لدبي الاسبوع الجاي")).toBe("ar");
    expect(languageOfText("SV 123 بكرة")).toBe("ar");
    expect(languageOfText("Hotel in Dubai for 3 nights")).toBe("en");
    expect(languageOfText("12:30 ✈️")).toBeNull();
  });
});
