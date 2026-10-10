import { describe, expect, it } from "vitest";
import { and, eq, sql as rawSql } from "drizzle-orm";
import {
  AskParseResponse, CreateOrderResponse, EntryCheckResponse, FlightSearchResponse, MessagesResponse, OrderResponse, OrdersResponse, PlanResponse, PlansResponse,
  PreviewResponse, RequestResponse, RequestsResponse, StaySearchResponse, addDays, bannedIn, todayIn, type OrderDraft,
} from "@mada/shared";
import { db } from "@/db";
import { appCreditLedger, appPayments, appPickups, appSegments, appStays, appTrips } from "@/db/app-schema";
import { appOrders, appTripBookings } from "@/db/app-schema-booking";
import { advance, ownOrder } from "@/lib/app/booking/orders";
import { confirmOrder, issueTickets, lockPrice, acceptOrder, failTicketing, priceChanged, startIssuing } from "@/lib/app/booking/desk";
import { progressRequests, threadOf } from "@/lib/app/booking/requests";
import { signWebhook } from "@/lib/app/booking/payments";
import { clearSearchCache } from "@/lib/app/booking/search";
import { POST as askParse } from "@/app/api/app/v1/ask/parse/route";
import { POST as searchFlights } from "@/app/api/app/v1/search/flights/route";
import { POST as searchStays } from "@/app/api/app/v1/search/stays/route";
import { POST as searchEntry } from "@/app/api/app/v1/search/entry/route";
import { GET as offerGet } from "@/app/api/app/v1/offers/[id]/route";
import { POST as offerPrice } from "@/app/api/app/v1/offers/[id]/price/route";
import { GET as plansGet } from "@/app/api/app/v1/plans/route";
import { GET as planGet } from "@/app/api/app/v1/plans/[id]/route";
import { GET as requestsGet, POST as requestsPost } from "@/app/api/app/v1/requests/route";
import { GET as requestGet } from "@/app/api/app/v1/requests/[id]/route";
import { GET as messagesGet, POST as messagesPost } from "@/app/api/app/v1/requests/[id]/messages/route";
import { GET as quoteGet } from "@/app/api/app/v1/quotes/[id]/route";
import { POST as acceptOffer } from "@/app/api/app/v1/quotes/[id]/accept-offer/route";
import { POST as previewPost } from "@/app/api/app/v1/orders/preview/route";
import { GET as ordersGet, POST as ordersPost } from "@/app/api/app/v1/orders/route";
import { GET as orderGet } from "@/app/api/app/v1/orders/[id]/route";
import { POST as order3ds } from "@/app/api/app/v1/orders/[id]/3ds/route";
import { POST as orderAnswer } from "@/app/api/app/v1/orders/[id]/answer/route";
import { POST as webhook } from "@/app/api/app/v1/payments/webhook/route";
import { GET as peopleGet, POST as peoplePost } from "@/app/api/app/v1/people/route";
import { POST as cardsPost } from "@/app/api/app/v1/cards/route";
import { callP, signIn } from "./wallet-helpers";

/* Booking (M2), end to end against the Core API on a real Postgres: Ask, search, entry checks, plans, requests and
   quotes, the order sheet, payments (3-D Secure, declines, Tabby), the desk's lifecycle, the trip it writes, webhooks. */

const TODAY = todayIn();
const EID_OUT = "2027-03-09";
const EID_BACK = "2027-03-15";
const post = (h: Parameters<typeof callP>[0], token: string, body: unknown, query = "", params: Record<string, string> = {}) => callP(h, params, { method: "POST", token, body, query });
const get = (h: Parameters<typeof callP>[0], token: string, params: Record<string, string> = {}, query = "") => callP(h, params, { method: "GET", token, query });

/** Omar's family: Hessa (spouse), Sara (13), Ahmed (10) with Saudi passports, Lina the helper (Philippine passport). */
async function family() {
  const { token } = await signIn();
  const add = async (givenNames: string, relation: string, dob: string, passport?: { number: string; nationality: string; expiry: string }) =>
    (await post(peoplePost, token, { givenNames, surname: givenNames === "Lina" ? "Reyes" : "Alharbi", relation, dateOfBirth: dob, ...(passport ? { passport: { ...passport, issuingCountry: passport.nationality, source: "scan" } } : {}) })).json.person.id as string;
  const hessa = await add("Hessa", "spouse", "1988-07-24", { number: "A11493107", nationality: "SAU", expiry: "2029-01-15" });
  const sara = await add("Sara", "child", "2013-05-12", { number: "A23111196", nationality: "SAU", expiry: "2027-08-14" });
  const ahmed = await add("Ahmed", "child", "2016-09-03", { number: "A23111197", nationality: "SAU", expiry: "2030-03-21" });
  const lina = await add("Lina", "helper", "1991-04-18", { number: "P71000032", nationality: "PHL", expiry: "2028-11-02" });
  const people = (await get(peopleGet, token)).json.people as { id: string; isSelf: boolean }[];
  const me = people.find((p) => p.isSelf)!.id;
  return { token, me, hessa, sara, ahmed, lina, four: [me, hessa, sara, ahmed] };
}

async function addCard(token: string, token_ = "tok_mock_visa41", last4 = "4241") {
  const r = await post(cardsPost, token, { token: token_, brand: "visa", last4, exp: "08/28", makeDefault: true });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return (r.json.cards as { id: string; last4: string }[]).find((c) => c.last4 === last4)!.id;
}

async function istanbul(token: string, travellerIds: string[], query = "", extra: Record<string, unknown> = {}) {
  const r = await post(searchFlights, token, { from: "RUH", destination: "istanbul", depart: EID_OUT, return: EID_BACK, travellerIds, cabin: "economy", ...extra }, query);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return FlightSearchResponse.parse(r.json);
}

async function previewOf(token: string, draft: OrderDraft, more: Record<string, unknown> = {}) {
  const r = await post(previewPost, token, { draft, useCredit: true, ...more });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return PreviewResponse.parse(r.json).preview;
}

async function book(token: string, draft: OrderDraft, payment: unknown, opts: { query?: string; plan?: string; promo?: string; expected?: number; key?: string } = {}) {
  const p = await previewOf(token, draft, opts.promo ? { promo: opts.promo } : {});
  const r = await post(ordersPost, token, { draft, useCredit: true, promo: opts.promo, payment, plan: opts.plan ?? "full", expectedTotal: opts.expected ?? p.total.amount, idempotencyKey: opts.key ?? `k-${Math.random().toString(36).slice(2)}` }, opts.query ?? "");
  expect([200, 201], JSON.stringify(r.json)).toContain(r.status);
  return { preview: p, out: CreateOrderResponse.parse(r.json) };
}

/** Lets the mock desk's clock run: each call is a poll some seconds later. */
async function runDesk(orderId: string, ownerToken: string, seconds = 30) {
  const owner = (await db.select({ o: appOrders.ownerId }).from(appOrders).where(eq(appOrders.id, orderId)))[0]!.o;
  let o = await ownOrder(owner, orderId);
  for (let s = 2; s <= seconds; s += 2) o = await advance(o, new Date(Date.now() + s * 1000));
  void ownerToken;
  return o;
}

describe("Ask: what people type", () => {
  it("reads the place, the dates, who and the cabin, without the model (mock mode)", async () => {
    const f = await family();
    const r = await post(askParse, f.token, { text: "One way business to Istanbul on 20 Jun for the family" });
    expect(r.status).toBe(200);
    const { intent } = AskParseResponse.parse(r.json);
    expect(intent).toMatchObject({ kind: "flight", destination: "istanbul", tripType: "oneway", cabin: "business", source: "rules" });
    expect(intent.depart).toBe(`${Number(TODAY.slice(0, 4)) + (TODAY.slice(5) > "06-20" ? 1 : 0)}-06-20`);
    expect(intent.travellerIds?.sort()).toEqual(f.four.sort());
    const eid = AskParseResponse.parse((await post(askParse, f.token, { text: "Istanbul for Eid, Hessa and me" })).json).intent;
    expect(eid).toMatchObject({ depart: EID_OUT, return: EID_BACK });
    expect(eid.travellerIds?.sort()).toEqual([f.me, f.hessa].sort());
    const umrah = AskParseResponse.parse((await post(askParse, f.token, { text: "Umrah in Ramadan. Hessa needs a wheelchair" })).json).intent;
    expect(umrah.kind).toBe("umrah");
    expect(umrah.answers.when).toEqual(["In Ramadan"]);
    expect(umrah.needs[f.hessa]).toEqual(["wheelchairSeat"]);
    expect(AskParseResponse.parse((await post(askParse, f.token, { text: "Flights to Dubai next weekend" })).json).intent).toMatchObject({ destination: "dubai", ask: "who" });
    expect(AskParseResponse.parse((await post(askParse, f.token, { text: "something nice" })).json).intent.kind).toBe("general");
    expect(AskParseResponse.parse((await post(askParse, f.token, { text: "Flights to Muscat in March" })).json).intent).toMatchObject({ destination: "other", destinationName: "Muscat", monthOnly: { month: 3 } });
  });

  it("needs a session and a sentence", async () => {
    expect((await callP(askParse, {}, { method: "POST", body: { text: "Istanbul" } })).status).toBe(401);
    const { token } = await signIn();
    expect((await post(askParse, token, { text: "" })).status).toBe(400);
  });
});

describe("search", () => {
  it("returns the three Istanbul options with fare rules, a hold, and the bundle", async () => {
    const f = await family();
    const s = await istanbul(f.token, f.four);
    expect(s.outcome).toBe("ok");
    expect(s.checked).toBe(14);
    expect(s.options.map((o) => [o.carrier, o.label, o.out.flightNumber])).toEqual([["SV", "best", "SV263"], ["XY", "lowest", "XY125"], ["TK", "earliest", "TK141"]]);
    const sv = s.options[0]!;
    expect(sv).toMatchObject({ airline: "Saudia", brand: "#0b6b52", bags: "2 × 23 kg", refundable: true, pricePerPerson: { amount: 216_000 } });
    expect(sv.total.amount).toBe(864_000);
    expect(sv.back?.flightNumber).toBe("SV264");
    expect(Date.parse(sv.expiresAt) - Date.now()).toBeGreaterThan(19 * 60_000);
    expect(s.bundle).toMatchObject({ nights: 6, stay: { amount: 588_000 }, pickup: { amount: 44_000 } });
    const offer = await get(offerGet, f.token, { id: sv.id });
    expect(offer.json).toMatchObject({ kind: "flight", expired: false });
    // Another traveller can't see it.
    const other = await signIn();
    expect((await get(offerGet, other.token, { id: sv.id })).status).toBe(404);
  });

  it("prices cabins, one way and babies", async () => {
    const f = await family();
    const s = await istanbul(f.token, [f.me], "", { return: null, cabin: "business", infants: 1 });
    const sv = s.options[0]!;
    expect(sv.pricePerPerson.amount).toBe(Math.round(2160 * 3.2 * 0.55) * 100);
    expect(sv.infantPrice.amount).toBe(Math.round(Math.round(2160 * 3.2 * 0.55) * 0.1) * 100);
    expect(sv.back).toBeNull();
    expect(s.bundle).toBeNull();
  });

  it("no flights, an airline not answering, and a city Mada searches by hand", async () => {
    clearSearchCache();
    const f = await family();
    const none = await istanbul(f.token, f.four, "?demo=noResults");
    expect(none).toMatchObject({ outcome: "none", options: [] });
    const flex = await istanbul(f.token, f.four, "?demo=noResults", { flexibleDays: 2 });
    expect(flex.outcome).toBe("ok");
    expect(flex.depart).toBe(addDays(EID_OUT, 1));
    const down = await istanbul(f.token, f.four, "?demo=supplierDown");
    expect(down.outcome).toBe("partial");
    expect(down.unavailable).toEqual([{ carrier: "SV", airline: "Saudia" }]);
    expect(down.options.map((o) => o.carrier)).toEqual(["XY", "TK"]);
    const tbs = await post(searchFlights, f.token, { from: "RUH", destination: "tbilisi", depart: EID_OUT, return: EID_BACK, travellerIds: [f.me] });
    expect(tbs.json.outcome).toBe("by_hand");
    expect((await post(searchFlights, f.token, { from: "RUH", destination: "atlantis", depart: EID_OUT, return: null, travellerIds: [f.me] })).status).toBe(400);
    expect((await post(searchFlights, f.token, { from: "RUH", destination: "dubai", depart: "2020-01-01", return: null, travellerIds: [f.me] })).status).toBe(400);
  });

  it("only books people from your own household", async () => {
    const a = await family();
    const b = await signIn();
    expect((await post(searchFlights, b.token, { from: "RUH", destination: "dubai", depart: EID_OUT, return: null, travellerIds: [a.hessa] })).status).toBe(404);
  });

  it("stays in Istanbul priced for the party, and the by-hand path elsewhere", async () => {
    const f = await family();
    const r = await post(searchStays, f.token, { destination: "istanbul", checkIn: EID_OUT, nights: 6, travellerIds: f.four });
    const s = StaySearchResponse.parse(r.json);
    expect(s.options.map((o) => o.name)).toEqual(["Rooms near Galata Tower", "Garden hotel in Sultanahmet", "Bosphorus view rooms"]);
    expect(s.options[0]).toMatchObject({ total: { amount: 588_000 }, roomsLabel: "2 connecting rooms", rating: "9.1" });
    const two = StaySearchResponse.parse((await post(searchStays, f.token, { destination: "istanbul", checkIn: EID_OUT, nights: 6, travellerIds: [f.me, f.hessa] })).json);
    expect(two.options[0]!.total.amount).toBe(Math.round(980 * 6 * 0.55) * 100);
    expect((await post(searchStays, f.token, { destination: "baku", checkIn: EID_OUT, nights: 3, travellerIds: [f.me] })).json.outcome).toBe("by_hand");
    expect((await post(searchStays, f.token, { destination: "istanbul", checkIn: EID_OUT, nights: 3, travellerIds: [f.me] }, "?demo=noResults")).json.outcome).toBe("none");
  });
});

describe("entry checks", () => {
  it("Türkiye: passports, the helper's visa, iqama and exit and re-entry; answers clear them", async () => {
    const f = await family();
    const body = { destination: "istanbul", travellerIds: [...f.four, f.lina], depart: EID_OUT, return: EID_BACK };
    const r = EntryCheckResponse.parse((await post(searchEntry, f.token, body)).json);
    expect(r.countryName).toBe("Türkiye");
    expect(r.nationalities).toEqual(["Saudi", "Philippine"]);
    const keys = r.checks.filter((c) => c.blocking).map((c) => `${c.name}:${c.key}`);
    expect(keys).toEqual(["Lina:visa", "Lina:iqama", "Lina:reentry"]);
    const visa = r.checks.find((c) => c.key === "visa")!;
    expect(visa.text).toContain("Türkiye e-Visa");
    for (const c of r.checks) expect(bannedIn(`${c.title ?? ""} ${c.text}`)).toEqual([]);
    const answered = EntryCheckResponse.parse((await post(searchEntry, f.token, { ...body, answers: { [visa.answerKey!]: "asked", [`${f.lina}:reentry`]: "has", [`${f.lina}:iqama`]: "2028-03-15" } })).json);
    expect(answered.blocking).toBe(0);
    // The passport-problem switch: Ahmed's passport (the youngest) ends too soon for Türkiye's 150 days.
    const short = EntryCheckResponse.parse((await post(searchEntry, f.token, { ...body, travellerIds: f.four }, "?demo=passportProblem")).json);
    const pp = short.checks.find((c) => c.key === "passport")!;
    expect(pp).toMatchObject({ name: "Ahmed", blocking: true, removable: true });
    expect(pp.text).toContain("2 Jul 2027");
    const uk = EntryCheckResponse.parse((await post(searchEntry, f.token, { destination: "london", travellerIds: [f.me], depart: EID_OUT, return: EID_BACK })).json);
    expect(uk.checks[0]).toMatchObject({ key: "eta", info: true, service: "uk_eta" });
    const dom = EntryCheckResponse.parse((await post(searchEntry, f.token, { destination: "jeddah", travellerIds: [f.me, f.lina], depart: EID_OUT, return: null })).json);
    expect(dom.domestic).toBe(true);
  });
});

describe("plans", () => {
  it("lists the curated plans priced for the household and shows one day by day", async () => {
    const f = await family();
    const list = PlansResponse.parse((await get(plansGet, f.token)).json).plans;
    expect(list.map((p) => p.id)).toEqual(["alula2", "istanbul3"]);
    expect(list[0]).toMatchObject({ travellers: 4, total: { amount: (1380 * 2 + 1650 + 870) * 100 }, stops: 9 });
    const one = PlanResponse.parse((await get(planGet, f.token, { id: "alula2" })).json).plan;
    expect(one.plan[0]!.stops[0]!.title).toBe("Riyadh → AlUla");
    expect((await get(planGet, f.token, { id: "nope" })).status).toBe(404);
  });
});

describe("requests and quotes", () => {
  it("Umrah: per-person needs, a quote with a breakdown, the thread, an offer switched in, paid", async () => {
    const f = await family();
    const r = await post(requestsPost, f.token, {
      kind: "umrah", query: "Umrah in Ramadan", answers: { when: ["In Ramadan"], stay: ["Steps from the Haram"], who: ["yes"], needs: ["yes"] },
      travellerIds: [f.me, f.hessa, f.ahmed], needs: { [f.hessa]: ["wheelchairSeat"] }, note: "Hessa walks slowly", clientId: "client-umrah-1",
    });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const req = RequestResponse.parse(r.json).request;
    expect(req).toMatchObject({ kind: "umrah", status: "sent", title: "Umrah", agent: { name: "Faisal" } });
    expect(req.summary).toContain("Hessa: wheelchair to the seat");
    // Sent twice from an offline queue: one request.
    expect(RequestResponse.parse((await post(requestsPost, f.token, { kind: "umrah", travellerIds: [f.me], clientId: "client-umrah-1" })).json).request.id).toBe(req.id);
    const ownerId = (await db.execute<{ owner_id: string }>(rawSql`SELECT owner_id FROM app_requests WHERE id = ${req.id}`))[0]!.owner_id;
    await progressRequests(ownerId, Date.now() + 5_000);
    expect(RequestResponse.parse((await get(requestGet, f.token, { id: req.id })).json).request.status).toBe("reviewing");
    await progressRequests(ownerId, Date.now() + 10_000);
    const quoted = RequestResponse.parse((await get(requestGet, f.token, { id: req.id })).json).request;
    expect(quoted.status).toBe("quoted");
    const q = quoted.quote!;
    // Omar 2300 + 450; Hessa 2300 + 450 + 300 wheelchair; Ahmed (10) 1650 + 450.
    expect(q.total.amount).toBe((2750 + 3050 + 2100) * 100);
    expect(q.breakdown.map((b) => b.name)).toEqual(["You", "Hessa", "Ahmed"]);
    expect(q.needLines.join(" ")).toContain("Wheelchair to the seat for Hessa");
    expect(bannedIn(q.text)).toEqual([]);
    expect((await get(quoteGet, f.token, { id: q.id })).json.quote.id).toBe(q.id);

    // The thread: a reply, the agent answers, an offer.
    await post(messagesPost, f.token, { text: "Can we stay closer to the Haram?" }, "", { id: req.id });
    const thread = await threadOf(ownerId, req.id, Date.now() + 2000);
    const offer = thread.messages.find((m) => m.offer)!;
    expect(offer.offer).toMatchObject({ label: "Room at the King Abdulaziz Gate", perPerson: { amount: 38_000 } });
    const sw = await post(acceptOffer, f.token, { messageId: offer.id }, "", { id: q.id });
    expect(sw.status, JSON.stringify(sw.json)).toBe(200);
    expect(sw.json.request.quote.total.amount).toBe(q.total.amount + 3 * 38_000);
    expect((await post(acceptOffer, f.token, { messageId: offer.id }, "", { id: q.id })).status).toBe(400);
    const msgs = MessagesResponse.parse((await get(messagesGet, f.token, { id: req.id })).json).messages;
    expect(msgs.at(-1)!.text).toContain("King Abdulaziz Gate");

    // Pay the quote: charged now, the request is paid.
    const cardId = await addCard(f.token);
    const { out } = await book(f.token, { kind: "quote", requestId: req.id }, { method: "card", cardId });
    expect(out.outcome).toBe("paid");
    expect(RequestResponse.parse((await get(requestGet, f.token, { id: req.id })).json).request.status).toBe("paid");
    const list = RequestsResponse.parse((await get(requestsGet, f.token)).json).requests;
    expect(list.map((x) => x.id)).toContain(req.id);
    // Private.
    const other = await signIn();
    expect((await get(requestGet, other.token, { id: req.id })).status).toBe(404);
    expect((await get(messagesGet, other.token, { id: req.id })).status).toBe(404);
    expect((await get(quoteGet, other.token, { id: q.id })).status).toBe(404);
  });

  it("services from the entry check and flights searched by hand get a price from the desk", async () => {
    const f = await family();
    const eta = RequestResponse.parse((await post(requestsPost, f.token, { kind: "visa", travellerIds: f.four, service: "uk_eta", serviceFor: { personId: null, need: null, destination: "london" } })).json).request;
    expect(eta.title).toBe("UK ETA for everyone");
    const tbs = RequestResponse.parse((await post(requestsPost, f.token, { kind: "flight", travellerIds: [f.me, f.hessa], search: { destination: "tbilisi", destinationName: null, from: "RUH", depart: EID_OUT, return: EID_BACK, cabin: "economy", carrier: null } })).json).request;
    expect(tbs.title).toBe("Flights to Tbilisi · 9–15 Mar");
    const ownerId = (await db.execute<{ owner_id: string }>(rawSql`SELECT owner_id FROM app_requests WHERE id = ${eta.id}`))[0]!.owner_id;
    await progressRequests(ownerId, Date.now() + 10_000);
    await progressRequests(ownerId, Date.now() + 10_000);
    const all = RequestsResponse.parse((await get(requestsGet, f.token)).json).requests;
    expect(all.find((x) => x.id === eta.id)!.quote!.total.amount).toBe(4 * 60 * 100);
    expect(all.find((x) => x.id === tbs.id)!.quote!.total.amount).toBe(2 * 1380 * 100);
  });

  it("refuses requests for someone else's household", async () => {
    const a = await family();
    const b = await signIn();
    expect((await post(requestsPost, b.token, { kind: "visa", travellerIds: [a.sara] })).status).toBe(404);
  });
});

describe("the order sheet", () => {
  it("lines, the bundle, the all-in total, promo codes, credit, instalments and the rule from the dates", async () => {
    const f = await family();
    const s = await istanbul(f.token, f.four);
    const draft: OrderDraft = { kind: "trip", flightOfferId: s.options[0]!.id, bundle: true, travellerIds: f.four };
    const p = await previewOf(f.token, draft);
    expect(p.lines.map((l) => [l.key, l.text, l.amount])).toEqual([
      ["flight", "4 travellers · Saudia, direct", 864_000], ["stay", "Connecting rooms near Galata Tower · 6 nights", 588_000], ["pickup", "Airport pickup both ways", 44_000],
    ]);
    expect(p.total.amount).toBe(1_496_000);
    expect(p.rule).toBe("If you cancel, the flights come back minus SAR 400 per person. Rooms and pickups are free to cancel until 2 Mar.");
    expect(p.instalments).toEqual({ tabby: { amount: 374_000, currency: "SAR" }, tamara: { amount: 498_667, currency: "SAR" } });
    expect(p.missingPassports).toEqual([f.me]);
    expect(Date.parse(p.holdExpiresAt!)).toBeGreaterThan(Date.now());
    const eid = await previewOf(f.token, draft, { promo: "eid10" });
    expect(eid.promo).toMatchObject({ code: "EID10", status: "applied", discount: { amount: 30_000 } });
    expect(eid.total.amount).toBe(1_496_000 - 30_000);
    expect((await previewOf(f.token, draft, { promo: "RAMADAN" })).promo).toMatchObject({ status: "ended", message: "That code ended on 30 March." });
    expect((await previewOf(f.token, draft, { promo: "NOPE" })).promo?.status).toBe("unknown");
    // Fewer travellers: the price follows.
    const two = await previewOf(f.token, { ...draft, travellerIds: [f.me, f.hessa] });
    expect(two.lines[0]!.amount).toBe(432_000);
    expect(two.lines[1]!.text).toBe("A room near Galata Tower · 6 nights");
    // Credit is used first.
    const ownerId = (await db.execute<{ owner_id: string }>(rawSql`SELECT owner_id FROM app_offers WHERE id = ${s.options[0]!.id}`))[0]!.owner_id;
    await db.insert(appCreditLedger).values({ userId: ownerId, amount: 40_000, kind: "goodwill" });
    const withCredit = await previewOf(f.token, draft);
    expect(withCredit.credit).toEqual({ balance: { amount: 40_000, currency: "SAR" }, used: { amount: 40_000, currency: "SAR" } });
    expect(withCredit.total.amount).toBe(1_456_000);
  });
});

describe("orders and the desk", () => {
  it("authorises, the desk holds, locks, issues, captures; the trip is written for Trips", async () => {
    const f = await family();
    const cardId = await addCard(f.token);
    const s = await istanbul(f.token, f.four);
    const draft: OrderDraft = { kind: "trip", flightOfferId: s.options[0]!.id, bundle: true, travellerIds: f.four };
    const key = "slide-1-abcdefgh";
    const { out } = await book(f.token, draft, { method: "card", cardId }, { key });
    expect(out.outcome).toBe("created");
    if (out.outcome !== "created") return;
    expect(out.order).toMatchObject({ status: "pending_agent", step: 0, place: "Istanbul", flightNumber: "SV263", seats: ["14A", "14B", "14C", "14D"], agent: { name: "Faisal" }, confirmedBy: null, paymentLabel: "Visa ending 41" });
    // The same slide again: the same order, not a second booking.
    const again = await post(ordersPost, f.token, { draft, useCredit: true, payment: { method: "card", cardId }, plan: "full", expectedTotal: out.order.total.amount, idempotencyKey: key });
    expect(again.json.order.id).toBe(out.order.id);
    const [pay] = await db.select().from(appPayments).where(eq(appPayments.idempotencyKey, `order:${(await ownOrderOwner(out.order.id))}:${key}`));
    expect(pay!.status).toBe("authorized");

    const o = await runDesk(out.order.id, f.token);
    expect(o.status).toBe("confirmed");
    const view = OrderResponse.parse((await get(orderGet, f.token, { id: out.order.id })).json).order;
    expect(view).toMatchObject({ status: "confirmed", step: 3, confirmedBy: { name: "Faisal" } });
    expect(view.ref).toMatch(/^[A-Z2-9]{6}$/);
    const [captured] = await db.select().from(appPayments).where(eq(appPayments.id, pay!.id));
    expect(captured!.status).toBe("captured");
    const [trip] = await db.select().from(appTrips).where(eq(appTrips.id, view.tripId!));
    expect(trip).toMatchObject({ city: "Istanbul", country: "Türkiye", startDate: EID_OUT, endDate: EID_BACK, status: "booked", bookingRef: view.ref, confirmedByName: "Faisal" });
    const segs = await db.select().from(appSegments).where(eq(appSegments.tripId, trip!.id));
    expect(segs.map((x) => [x.direction, x.flightNumber, x.fromAirport, x.toAirport]).sort()).toEqual([["back", "SV264", "IST", "RUH"], ["out", "SV263", "RUH", "IST"]]);
    expect(segs.find((x) => x.direction === "out")!.seats).toEqual(["14A", "14B", "14C", "14D"]);
    const [stay] = await db.select().from(appStays).where(eq(appStays.tripId, trip!.id));
    expect(stay).toMatchObject({ name: "Rooms near Galata Tower", nights: 6, rooms: 2, price: 588_000 });
    const pickups = await db.select().from(appPickups).where(eq(appPickups.tripId, trip!.id));
    expect(pickups.map((x) => x.direction).sort()).toEqual(["from_airport", "to_airport"]);
    const [tb] = await db.select().from(appTripBookings).where(eq(appTripBookings.tripId, trip!.id));
    expect(tb!.paid).toMatchObject({ charged: 1_496_000, card: "Visa ending 41" });
    const active = OrdersResponse.parse((await get(ordersGet, f.token)).json).orders;
    expect(active.map((x) => x.id)).toContain(out.order.id);
    // Private.
    const other = await signIn();
    expect((await get(orderGet, other.token, { id: out.order.id })).status).toBe(404);
  });

  it("a retry with the same Idempotency-Key header is answered once: one order, one charge", async () => {
    const f = await family();
    const cardId = await addCard(f.token);
    const s = await istanbul(f.token, f.four);
    const draft: OrderDraft = { kind: "trip", flightOfferId: s.options[0]!.id, bundle: false, travellerIds: f.four };
    const p = await previewOf(f.token, draft);
    const body = { draft, useCredit: true, payment: { method: "card", cardId }, plan: "full", expectedTotal: p.total.amount, idempotencyKey: "slide-hdr-abcdefgh" };
    const send = () => callP(ordersPost, {}, { method: "POST", token: f.token, body, headers: { "idempotency-key": "slide-hdr-abcdefgh" } });
    const first = await send();
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    const second = await send();
    expect(second.status).toBe(201);
    expect(second.json.order.id).toBe(first.json.order.id);
    const owner = await ownOrderOwner(first.json.order.id);
    const pays = await db.select().from(appPayments).where(eq(appPayments.ownerId, owner));
    expect(pays.length).toBe(1);
    // The same key with a different body is refused, not booked.
    const changed = await callP(ordersPost, {}, { method: "POST", token: f.token, body: { ...body, plan: "tabby" }, headers: { "idempotency-key": "slide-hdr-abcdefgh" } });
    expect(changed.json.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("a new card asks the bank for a code: wrong codes count down, 123456 passes", async () => {
    const f = await family();
    const s = await istanbul(f.token, [f.me, f.hessa]);
    const { out } = await book(f.token, { kind: "trip", flightOfferId: s.options[1]!.id, bundle: false, travellerIds: [f.me, f.hessa] }, { method: "new_card", token: "tok_mock_new42", brand: "visa", last4: "4242" });
    expect(out.outcome).toBe("requires_action");
    if (out.outcome !== "requires_action") return;
    expect(out.order.action).toMatchObject({ kind: "otp", triesLeft: 3, label: "Visa ending 42" });
    const wrong = OrderResponse.parse((await post(order3ds, f.token, { code: "000000" }, "", { id: out.order.id })).json).order;
    expect(wrong.action?.triesLeft).toBe(2);
    const ok = OrderResponse.parse((await post(order3ds, f.token, { code: "123456" }, "", { id: out.order.id })).json).order;
    expect(ok.status).toBe("pending_agent");
  });

  it("three wrong codes and the bank stops it; credit held for it comes back", async () => {
    const f = await family();
    const ownerId = await ownerOfToken(f.token, f.me);
    await db.insert(appCreditLedger).values({ userId: ownerId, amount: 10_000, kind: "goodwill" });
    const s = await istanbul(f.token, [f.me]);
    const { out } = await book(f.token, { kind: "trip", flightOfferId: s.options[0]!.id, bundle: false, travellerIds: [f.me] }, { method: "new_card", token: "tok_mock_new43", brand: "visa", last4: "4243" });
    if (out.outcome !== "requires_action") throw new Error(out.outcome);
    for (const c of ["111111", "222222"]) await post(order3ds, f.token, { code: c }, "", { id: out.order.id });
    const stopped = OrderResponse.parse((await post(order3ds, f.token, { code: "333333" }, "", { id: out.order.id })).json).order;
    expect(stopped.status).toBe("declined");
    const [bal] = await db.execute<{ s: string }>(rawSql`SELECT SUM(amount) AS s FROM app_credit_ledger WHERE user_id = ${ownerId}`);
    expect(Number(bal!.s)).toBe(10_000);
  });

  it("declines, a price that rose, a hold that ended, and a passport that blocks", async () => {
    const f = await family();
    const cardId = await addCard(f.token);
    const s = await istanbul(f.token, f.four);
    const draft: OrderDraft = { kind: "trip", flightOfferId: s.options[0]!.id, bundle: false, travellerIds: f.four };
    const declined = await book(f.token, draft, { method: "card", cardId }, { query: "?demo=decline" });
    expect(declined.out).toMatchObject({ outcome: "declined" });
    const rose = await book(f.token, draft, { method: "card", cardId }, { query: "?demo=priceUp" });
    expect(rose.out.outcome).toBe("price_changed");
    if (rose.out.outcome !== "price_changed") return;
    expect(rose.out.changedBy.amount).toBe(14_000);
    const accepted = await book(f.token, draft, { method: "card", cardId }, { query: "?demo=priceUp", expected: rose.out.preview.total.amount });
    expect(accepted.out.outcome).toBe("created");
    // The hold ends: re-price first.
    const s2 = await istanbul(f.token, f.four);
    await db.execute(rawSql`UPDATE app_offers SET expires_at = now() - interval '1 minute' WHERE id = ${s2.options[2]!.id}`);
    const ended = await book(f.token, { ...draft, flightOfferId: s2.options[2]!.id }, { method: "card", cardId });
    expect(ended.out.outcome).toBe("hold_ended");
    const re = await post(offerPrice, f.token, {}, "", { id: s2.options[2]!.id });
    expect(re.json).toMatchObject({ expired: false, changedBy: 0 });
    const blocked = await book(f.token, draft, { method: "card", cardId }, { query: "?demo=passportProblem" });
    expect(blocked.out.outcome).toBe("blocked");
  });

  it("the fare goes while booking, Faisal asks a question, tickets fail and Mada tries by phone", async () => {
    const f = await family();
    const cardId = await addCard(f.token);
    const s = await istanbul(f.token, f.four);
    const draft: OrderDraft = { kind: "trip", flightOfferId: s.options[0]!.id, bundle: false, travellerIds: f.four };
    const { out } = await book(f.token, draft, { method: "card", cardId }, { query: "?demo=fareGone,agentQuestion,ticketingFails" });
    if (out.outcome !== "created") throw new Error(out.outcome);
    let o = await runDesk(out.order.id, f.token, 4);
    expect(o.status).toBe("fare_changed");
    let v = OrderResponse.parse((await get(orderGet, f.token, { id: o.id })).json).order;
    expect(v.fareChange).toMatchObject({ perPerson: { amount: 12_000 }, total: { amount: 48_000 }, newTotal: { amount: 864_000 + 48_000 } });
    v = OrderResponse.parse((await post(orderAnswer, f.token, { answer: "accept_fare" }, "", { id: o.id })).json).order;
    expect(v.extra.amount).toBe(48_000);
    o = await runDesk(o.id, f.token, 6);
    expect(o.status).toBe("needs_answer");
    v = OrderResponse.parse((await get(orderGet, f.token, { id: o.id })).json).order;
    expect(v.question?.text).toContain("Hessa’s passport has more than one given name");
    await post(orderAnswer, f.token, { answer: "yes" }, "", { id: o.id });
    o = await runDesk(o.id, f.token, 8);
    expect(o.status).toBe("ticketing_failed");
    const payments = await db.select().from(appPayments).where(eq(appPayments.ownerId, o.ownerId));
    expect(payments.filter((p) => p.status === "voided").length).toBe(2);
    await post(orderAnswer, f.token, { answer: "retry_by_phone" }, "", { id: o.id });
    o = await runDesk(o.id, f.token, 10);
    expect(o.status).toBe("confirmed");
    expect(o.extra).toBe(48_000);
  });

  it("Tabby, credit that covers it all, packages and stays", async () => {
    const f = await family();
    const s = await istanbul(f.token, f.four);
    const tabby = await book(f.token, { kind: "trip", flightOfferId: s.options[0]!.id, bundle: true, travellerIds: f.four }, { method: "card", cardId: await addCard(f.token) }, { plan: "tabby" });
    if (tabby.out.outcome !== "created") throw new Error(tabby.out.outcome);
    expect(tabby.out.order).toMatchObject({ plan: "tabby", paymentLabel: "Tabby" });
    const ownerId = await ownerOfToken(f.token, f.me);
    await db.insert(appCreditLedger).values({ userId: ownerId, amount: 100_000, kind: "goodwill" });
    const esim = await book(f.token, { kind: "esim", count: 2 }, { method: "credit" });
    expect(esim.out.outcome).toBe("paid");
    if (esim.out.outcome === "paid") expect(esim.out.order).toMatchObject({ status: "confirmed", total: { amount: 0 }, creditUsed: { amount: 7_800 } });
    const pkg = await book(f.token, { kind: "package", planId: "alula2", travellerIds: f.four }, { method: "applepay", token: "applepay_mock_token_1" });
    if (pkg.out.outcome !== "created") throw new Error(pkg.out.outcome);
    expect(pkg.out.order.lines.map((l) => l.key)).toEqual(["flight", "stay", "tours"]);
    expect((await runDesk(pkg.out.order.id, f.token)).status).toBe("confirmed");
    const st = StaySearchResponse.parse((await post(searchStays, f.token, { destination: "istanbul", checkIn: EID_OUT, nights: 6, travellerIds: [f.me, f.hessa] })).json);
    const stay = await book(f.token, { kind: "stay", stayOfferId: st.options[1]!.id, travellerIds: [f.me, f.hessa] }, { method: "applepay", token: "applepay_mock_token_2" });
    if (stay.out.outcome !== "created") throw new Error(stay.out.outcome);
    const done = await runDesk(stay.out.order.id, f.token);
    expect(done.status).toBe("confirmed");
    const [trip] = await db.select().from(appTrips).where(eq(appTrips.id, done.tripId!));
    expect(trip).toMatchObject({ startDate: EID_OUT, endDate: EID_BACK });
  });

  it("the desk's functions refuse a stale click", async () => {
    const f = await family();
    const s = await istanbul(f.token, [f.me]);
    const { out } = await book(f.token, { kind: "trip", flightOfferId: s.options[0]!.id, bundle: false, travellerIds: [f.me] }, { method: "applepay", token: "applepay_mock_token_3" });
    if (out.outcome !== "created") throw new Error(out.outcome);
    const agent = { name: "Noura" };
    await expect(lockPrice(out.order.id, agent)).rejects.toThrow();
    await acceptOrder(out.order.id, agent);
    await priceChanged(out.order.id, agent, 5_000);
    await expect(startIssuing(out.order.id, agent)).rejects.toThrow();
    await post(orderAnswer, f.token, { answer: "stop" }, "", { id: out.order.id });
    const v = OrderResponse.parse((await get(orderGet, f.token, { id: out.order.id })).json).order;
    expect(v.status).toBe("cancelled");
    await expect(confirmOrder(out.order.id, agent)).rejects.toThrow();
    await expect(issueTickets(out.order.id, agent)).rejects.toThrow();
    await expect(failTicketing(out.order.id, agent)).rejects.toThrow();
  });
});

describe("payment webhooks", () => {
  it("checks the signature and applies each event once", async () => {
    const f = await family();
    const s = await istanbul(f.token, [f.me]);
    const { out } = await book(f.token, { kind: "trip", flightOfferId: s.options[0]!.id, bundle: false, travellerIds: [f.me] }, { method: "new_card", token: "tok_mock_wh", brand: "visa", last4: "4111" });
    if (out.outcome !== "requires_action") throw new Error(out.outcome);
    const [o] = await db.select().from(appOrders).where(eq(appOrders.id, out.order.id));
    const [p] = await db.select().from(appPayments).where(eq(appPayments.id, o!.paymentId!));
    const raw = JSON.stringify({ eventId: `evt-${o!.id}`, type: "payment.authorized", providerRef: p!.providerRef });
    const send = (sig: string) => webhook(new Request("http://localhost/api/app/v1/payments/webhook", { method: "POST", headers: { "content-type": "application/json", "x-mf-signature": sig }, body: raw }));
    expect((await send("00".repeat(32))).status).toBe(401);
    const first = await send(signWebhook(raw));
    expect(await first.json()).toMatchObject({ ok: true, duplicate: false, result: "applied" });
    const second = await send(signWebhook(raw));
    expect(await second.json()).toMatchObject({ ok: true, duplicate: true });
    const [after] = await db.select().from(appOrders).where(and(eq(appOrders.id, o!.id)));
    expect(after!.status).toBe("pending_agent");
  });
});

async function ownOrderOwner(orderId: string) {
  return (await db.select({ o: appOrders.ownerId }).from(appOrders).where(eq(appOrders.id, orderId)))[0]!.o;
}
async function ownerOfToken(_token: string, personId: string) {
  return (await db.execute<{ owner_id: string }>(rawSql`SELECT owner_id FROM app_people WHERE id = ${personId}`))[0]!.owner_id;
}
