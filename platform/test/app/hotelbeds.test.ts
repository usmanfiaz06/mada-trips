import { createHash } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { CancelSupplierVoucherResponse, CreateOrderResponse, PreviewResponse, StaySearchResponse, SupplierVoucherResponse, SupplierVouchersResponse, TransferOptionsResponse, ChooseTransferResponse, addDays, todayIn, type OrderDraft } from "@mada/shared";
import { db } from "@/db";
import { appOffers, appOrders } from "@/db/app-schema-booking";
import { appSupplierBookings } from "@/db/app-schema-hotelbeds";
import { appHotelbedsHotels } from "@/db/app-schema-hotelbeds";
import { HotelbedsClient, HotelbedsError, hotelbedsSignature, type FetchLike } from "@/lib/app/suppliers/hotelbeds/client";
import { HotelbedsHotels, SEARCH_BUDGET, availabilityBody, decodeOfferId, encodeOfferId, occupanciesOf, offerOf, offersFromAvailability, splitParty, stayRule, type HbAvailabilityResponse } from "@/lib/app/suppliers/hotelbeds/hotels";
import { availabilityPath, quotesFrom, type HbTransferAvailability } from "@/lib/app/suppliers/hotelbeds/transfers";
import { costHalalas, feeHalalas, pricingRules, sellHalalas, UnknownCurrency } from "@/lib/app/suppliers/hotelbeds/money";
import { fixtureFetch, mockHotelbedsHotels, mockHotelbedsState, resetMockHotelbeds, setHotelbedsTestFetch } from "@/lib/app/suppliers/hotelbeds/mock";
import { guardFor, hotelbedsBookingAllowed, staysMode } from "@/lib/app/suppliers/hotelbeds/app";
import { bookStayOnHotelbeds, bookTransferOnHotelbeds, cancelSupplierBooking } from "@/lib/app/suppliers/hotelbeds/bookings";
import { payableThrough, voucherHtml } from "@/lib/app/suppliers/hotelbeds/voucher";
import { refreshHotelContent } from "@/lib/app/suppliers/hotelbeds/content";
import { resetBreakers } from "@/lib/app/resilience/breaker";
import { clearSearchCache } from "@/lib/app/booking/search";
import { clearTransferCache } from "@/lib/app/transfers/service";
import { POST as searchStays } from "@/app/api/app/v1/search/stays/route";
import { POST as previewPost } from "@/app/api/app/v1/orders/preview/route";
import { GET as roomsGet } from "@/app/api/app/v1/offers/[id]/rooms/route";
import { POST as ordersPost } from "@/app/api/app/v1/orders/route";
import { POST as peoplePost, GET as peopleGet } from "@/app/api/app/v1/people/route";
import { POST as cardsPost } from "@/app/api/app/v1/cards/route";
import { POST as demoPost } from "@/app/api/app/v1/trips/demo/route";
import { GET as transfersGet, POST as transfersPost } from "@/app/api/app/v1/trips/[id]/transfers/route";
import { GET as tripVouchersGet } from "@/app/api/app/v1/trips/[id]/vouchers/route";
import { GET as voucherGet } from "@/app/api/app/v1/vouchers/[id]/route";
import { POST as voucherCancel } from "@/app/api/app/v1/vouchers/[id]/cancel/route";
import { GET as hotelGet } from "@/app/api/app/v1/hotels/[code]/route";
import { callP, signIn } from "./wallet-helpers";

/*
 * Hotelbeds (docs/app/HOTELBEDS.md): the signed client, the hotels and transfers adapters against recorded-shape
 * fixtures (no network), our pricing and cancellation rules, the breaker, the beta booking policy, the desk's one-click
 * booking, vouchers, and the airport pickup endpoints.
 */

const post = (h: Parameters<typeof callP>[0], token: string, body: unknown, params: Record<string, string> = {}, query = "") => callP(h, params, { method: "POST", token, body, query });
const get = (h: Parameters<typeof callP>[0], token: string, params: Record<string, string> = {}, query = "") => callP(h, params, { method: "GET", token, query });

const ENV0 = { ...process.env };
afterEach(() => {
  for (const k of ["APP_STAYS_MODE", "APP_ENV", "VERCEL_ENV", "HOTELBEDS_ENV", "SUPPLIER_MODE_HOTELS", "SUPPLIER_MODE_TRANSFERS", "APP_FX_RATES", "APP_STAY_MARKUP_BPS", "APP_CANCEL_BUFFER_DAYS", "HOTELBEDS_MAX_RESULTS", "APP_ALLOW_MOCKS"]) {
    if (ENV0[k] === undefined) delete process.env[k]; else process.env[k] = ENV0[k];
  }
  setHotelbedsTestFetch(null);
  resetBreakers();
});

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
function scripted(answers: ({ status: number; body?: unknown; headers?: Record<string, string> } | "hang")[]) {
  const calls: Call[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    if (a === "hang") return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    return { status: a.status, headers: { get: (n: string) => a.headers?.[n.toLowerCase()] ?? null }, text: async () => (a.body === undefined ? "" : JSON.stringify(a.body)) };
  };
  return { f, calls };
}
const client = (f: FetchLike, more: Partial<ConstructorParameters<typeof HotelbedsClient>[0]> = {}) =>
  new HotelbedsClient({ product: "hotels", credentials: { apiKey: "abc123key", secret: "s3cr3t" }, env: "test", fetch: f, log: () => {}, sleep: async () => {}, ...more });

/* ───────────── the client ───────────── */

describe("Hotelbeds client: signing, hosts, retries, errors", () => {
  it("signs with SHA-256 hex of key + secret + unix seconds, and sends Accept JSON and gzip", async () => {
    const at = 1_760_000_000;
    expect(hotelbedsSignature("abc123key", "s3cr3t", at)).toBe(createHash("sha256").update(`abc123keys3cr3t${at}`).digest("hex"));
    const { f, calls } = scripted([{ status: 200, body: { ok: true } }]);
    await client(f, { now: () => at * 1000 + 999 }).request({ method: "GET", path: "/hotel-api/1.0/status" });
    const h = calls[0]!.headers;
    expect(h["Api-key"]).toBe("abc123key");
    expect(h["X-Signature"]).toBe(hotelbedsSignature("abc123key", "s3cr3t", at));
    expect(h.Accept).toBe("application/json");
    expect(h["Accept-Encoding"]).toBe("gzip");
    expect(calls[0]!.url).toBe("https://api.test.hotelbeds.com/hotel-api/1.0/status");
    expect(client(f, { env: "live" }).url("/x")).toBe("https://api.hotelbeds.com/x");
  });

  it("refuses without keys and never calls out", async () => {
    const { f, calls } = scripted([{ status: 200, body: {} }]);
    const c = new HotelbedsClient({ product: "transfers", credentials: null, fetch: f, log: () => {} });
    await expect(c.request({ method: "GET", path: "/x" })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(calls).toHaveLength(0);
  });

  it("gives a traveller's search two short tries, not three long ones", async () => {
    const a = scripted([{ status: 503, body: { error: { code: "SYSTEM_ERROR" } } }]);
    const hb = new HotelbedsHotels(client(a.f, { retries: 2 }));
    await expect(hb.search({ city: "Istanbul", checkIn: "2026-11-04", nights: 3, adults: 2, rooms: 1 } as never)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(a.calls).toHaveLength(1 + SEARCH_BUDGET.retries);
    expect(SEARCH_BUDGET.timeoutMs).toBeLessThanOrEqual(8_000);
  });

  it("retries a safe call after a 5xx, never a booking", async () => {
    const a = scripted([{ status: 503, body: { error: { code: "SYSTEM_ERROR", message: "busy" } } }, { status: 200, body: { hotels: { total: 0 } } }]);
    await client(a.f).request({ method: "POST", path: "/hotel-api/1.0/hotels", body: {}, safe: true });
    expect(a.calls).toHaveLength(2);
    const b = scripted([{ status: 503, body: { error: { code: "SYSTEM_ERROR" } } }, { status: 200, body: {} }]);
    await expect(client(b.f).request({ method: "POST", path: "/hotel-api/1.0/bookings", body: {}, safe: false })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(b.calls).toHaveLength(1);
  });

  it("turns 429 and the evaluation quota into RATE_LIMITED, honouring Retry-After", async () => {
    const sleeps: number[] = [];
    const a = scripted([{ status: 429, headers: { "retry-after": "2" }, body: { message: "Too many requests" } }]);
    const e = await client(a.f, { retries: 1, sleep: async (ms) => { sleeps.push(ms); } }).request({ method: "GET", path: "/x" }).catch((x) => x);
    expect(e).toBeInstanceOf(HotelbedsError);
    expect(e).toMatchObject({ code: "RATE_LIMITED" });
    expect(sleeps).toEqual([2000]);
    const q = scripted([{ status: 403, body: { error: { message: "Quota exceeded" } } }]);
    await expect(client(q.f, { retries: 0 }).request({ method: "GET", path: "/x" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const auth = scripted([{ status: 401, body: { error: { code: "AUTHENTICATION" } } }]);
    await expect(client(auth.f).request({ method: "GET", path: "/x" })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    const sold = scripted([{ status: 400, body: { error: { code: "INSUFFICIENT_ALLOTMENT", message: "Insufficient allotment" } } }]);
    await expect(client(sold.f).request({ method: "POST", path: "/hotel-api/1.0/bookings", safe: false })).rejects.toMatchObject({ code: "PRICE_CHANGED" });
  });

  it("times out a call that hangs", async () => {
    const a = scripted(["hang"]);
    const t0 = Date.now();
    await expect(client(a.f, { timeoutMs: 60, retries: 0 }).request({ method: "GET", path: "/slow" })).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("logs request ids and timings, never the key, the secret or the signature", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((m: unknown) => { lines.push(String(m)); });
    const { f } = scripted([{ status: 200, body: { auditData: { token: "TOK1" } } }]);
    await new HotelbedsClient({ product: "hotels", credentials: { apiKey: "abc123key", secret: "s3cr3t" }, fetch: f }).request({ method: "GET", path: "/x" });
    spy.mockRestore();
    expect(lines.join("\n")).toMatch(/\[hotelbeds\] hotels GET \/x → 200 .*token TOK1/);
    expect(lines.join("\n")).not.toMatch(/abc123key|s3cr3t|[0-9a-f]{64}/);
  });

  it("opens the circuit after repeated outages and then fails fast without calling", async () => {
    const a = scripted([{ status: 502, body: {} }]);
    const c = client(a.f, { retries: 0, guard: guardFor("hotels") });
    for (let i = 0; i < 5; i++) await c.request({ method: "GET", path: "/x" }).catch(() => null);
    const before = a.calls.length;
    await expect(c.request({ method: "GET", path: "/x" })).rejects.toMatchObject({ code: "SUPPLIER_DOWN" });
    expect(a.calls.length).toBe(before);
  });
});

/* ───────────── mapping, money, rules ───────────── */

const CHECK_IN = addDays(todayIn(), 60);
const CHECK_OUT = addDays(CHECK_IN, 6);

async function fixtureAvailability(rooms: { adults: number; childAges: number[] }[] = [{ adults: 2, childAges: [] }]): Promise<HbAvailabilityResponse> {
  return mockHotelbedsHotels(undefined, fixtureFetch()).availability({ checkIn: CHECK_IN, checkOut: CHECK_OUT, rooms, geolocation: { latitude: 41.0256, longitude: 28.9744, radius: 8, unit: "km" } });
}

describe("Hotelbeds hotels: requests and mapping", () => {
  it("groups identical rooms, carries children's ages, and asks for many hotels with our filters", () => {
    expect(occupanciesOf([{ adults: 2, childAges: [] }, { adults: 2, childAges: [] }])).toEqual([{ rooms: 2, adults: 2, children: 0 }]);
    expect(occupanciesOf([{ adults: 2, childAges: [10] }, { adults: 1, childAges: [4] }])).toEqual([
      { rooms: 1, adults: 2, children: 1, paxes: [{ type: "CH", age: 10 }] }, { rooms: 1, adults: 1, children: 1, paxes: [{ type: "CH", age: 4 }] },
    ]);
    expect(splitParty(3, [8], 2)).toEqual([{ adults: 2, childAges: [] }, { adults: 1, childAges: [8] }]);
    const b = availabilityBody({ checkIn: CHECK_IN, checkOut: CHECK_OUT, rooms: [{ adults: 2, childAges: [] }], destination: "IST", boards: ["BB"], maxRate: 900, minCategory: 3, maxCategory: 5 });
    expect(b).toMatchObject({ stay: { checkIn: CHECK_IN, checkOut: CHECK_OUT }, destination: { code: "IST" }, boards: { board: ["BB"], included: true }, filter: { maxRate: 900, minCategory: 3, maxCategory: 5, paymentType: "AT_WEB", maxHotels: 2000 } });
    expect(() => availabilityBody({ checkIn: CHECK_IN, checkOut: CHECK_OUT, rooms: [] })).toThrow(HotelbedsError);
  });

  it("sells AT_WEB, non-opaque rates in riyals with FX and markup, never below the hotel's mandatory price", async () => {
    process.env.APP_FX_RATES = "EUR=4.00";
    const offers = offersFromAvailability(await fixtureAvailability(), { nights: 6, party: 2, rooms: 1, checkIn: CHECK_IN, rules: { ...pricingRules(), fxBufferBps: 0, stayMarkupBps: 1000 } });
    expect(offers.map((o) => o.supplier)).toEqual(Array(offers.length).fill("hotelbeds"));
    const byName = Object.fromEntries(offers.map((o) => [o.name, o]));
    // Taksim, net EUR 398.20 → 1,592.80 SAR cost → +10% → 1,752.08 → rounded up to SAR 1,753.
    expect(byName["TAKSIM CITY ROOMS"]!.total.amount).toBe(175_300);
    // Bosphorus: the AT_HOTEL rate is never sold; net 880 × 4 × 1.1 = 3,872 but the hotel's own price 1,049 × 4 = 4,196 stands.
    expect(byName["BOSPHORUS VIEW HOTEL"]!.total.amount).toBe(419_600);
    // Ranked by fit (stars, value, where it is); exactly one "Best for you" (3 stars and up) and one "Lowest price".
    const scores = offers.map((o) => o.meta!.score!);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(offers.filter((o) => o.meta!.badge === "best")).toHaveLength(1);
    expect(offers.filter((o) => o.meta!.badge === "lowest")).toHaveLength(1);
    const cheapest = [...offers].sort((a, b) => a.total.amount - b.total.amount)[0]!;
    expect(cheapest).toMatchObject({ name: "TAKSIM CITY ROOMS", label: "lowest", meta: { badge: "lowest" } });
    expect(offers.find((o) => o.meta!.badge === "best")!.meta!.facts!.stars).toBeGreaterThanOrEqual(3);
    // The card's facts in structure: the app writes them in the traveller's language.
    expect(byName["GALATA TOWER SUITES"]!.meta!.facts).toMatchObject({ board: "RO", refundable: false, room: "Double standard" });
    // Galata's cheapest is its non-refundable room-only rate.
    expect(byName["GALATA TOWER SUITES"]).toMatchObject({ note: "Double standard. Room only.", cancellation: "Not refundable once booked.", freeCancelUntil: null });
    // Its breakfast rate carries a city tax payable at the hotel: said in riyals.
    const res = await fixtureAvailability();
    const g = res.hotels!.hotels!.find((h) => h.code === 99701)!;
    const bb = offerOf(g, g.rooms[0]!, g.rooms[0]!.rates[0]!, { nights: 6, party: 2, rooms: 1, checkIn: CHECK_IN, rules: { ...pricingRules(), fxBufferBps: 0 } });
    expect(bb.note).toBe("Double standard. Breakfast included. Local tax of SAR 36 is paid at the hotel.");
    expect(byName["GALATA TOWER SUITES"]!.meta).toMatchObject({ hotelCode: 99701, room: "DOUBLE STANDARD", board: "ROOM ONLY" });
    const id = byName["SULTANAHMET GARDEN HOTEL"]!.id;
    expect(decodeOfferId(id)).toMatchObject({ recheck: true, party: 2 });
    expect(decodeOfferId(encodeOfferId("a|b", "BOOKABLE", 3))).toEqual({ rateKey: "a|b", recheck: false, party: 3 });
  });

  it("states the hotel's cancellation deadline in the hotel's time, with each step, and non-refundable when it has passed", () => {
    const rate = { net: "600", rateClass: "NOR", cancellationPolicies: [{ amount: "120", from: "2027-03-02T23:59:00+03:00" }, { amount: "600", from: "2027-03-07T23:59:00+03:00" }] };
    const r = stayRule(rate, 300_000, new Date("2027-01-10T00:00:00Z"));
    expect(r).toMatchObject({ freeCancelUntil: "2027-03-02", refundable: true, deadline: "2027-03-02T23:59:00+03:00", cancelFee: 300_000 });
    expect(r.cancellation).toBe("Free to cancel until 2 Mar, 23:59 hotel time. After that, SAR 600. From 7 Mar, 23:59: SAR 3,000.");
    process.env.APP_CANCEL_BUFFER_DAYS = "2";
    expect(stayRule(rate, 300_000, new Date("2027-01-10T00:00:00Z")).freeCancelUntil).toBe("2027-02-28");
    const late = stayRule(rate, 300_000, new Date("2027-03-05T00:00:00Z"));
    expect(late).toMatchObject({ refundable: false, freeCancelUntil: null, cancellation: "Not refundable once booked." });
    expect(stayRule({ net: "600", rateClass: "NRF", cancellationPolicies: [] }, 1000).refundable).toBe(false);
  });

  it("converts currencies with our rates, refuses one it doesn't know, and keeps fees in proportion", () => {
    const rules = { ...pricingRules({ APP_FX_RATES: "EUR=4.10,TRY=0.12" } as unknown as NodeJS.ProcessEnv), fxBufferBps: 100 };
    expect(costHalalas(100, "EUR", rules)).toBe(41_410);
    expect(costHalalas(100, "SAR", rules)).toBe(10_000);
    expect(costHalalas(1000, "TRY", rules)).toBe(12_120);
    expect(() => costHalalas(5, "XYZ", rules)).toThrow(UnknownCurrency);
    expect(sellHalalas(10, "USD", "transfer", { rules: { ...rules, transferMarkupBps: 1500 } }) % 100).toBe(0);
    expect(feeHalalas(50, 100, 30_000)).toBe(15_000);
    expect(feeHalalas(500, 100, 30_000)).toBe(30_000);
  });
});

describe("Hotelbeds transfers: requests and mapping", () => {
  it("builds the availability path and keeps one option per vehicle that fits everyone", async () => {
    expect(availabilityPath({ from: { type: "IATA", code: "IST" }, to: { type: "ATLAS", code: "99701" }, outbound: "2027-03-09T13:55", adults: 2, children: 1, infants: 0 }))
      .toBe("/transfer-api/1.0/availability/en/from/IATA/IST/to/ATLAS/99701/2027-03-09T13%3A55%3A00/2/1/0");
    const res = await (await fixtureFetch()("https://api.test.hotelbeds.com/transfer-api/1.0/availability/en/from/IATA/IST/to/ATLAS/99701/2027-03-09T13:55:00/4/0/0", { method: "GET", headers: { "Api-key": "k", "X-Signature": "0".repeat(64) } })).text();
    const quotes = quotesFrom(JSON.parse(res) as HbTransferAvailability, 4, { now: new Date("2027-01-01T00:00:00Z") });
    // The car takes 3: not for four people.
    expect(quotes.map((q) => `${q.kind}:${q.vehicle}`)).toEqual(["shared:Shuttle", "private:Minivan"]);
    expect(quotes[1]).toMatchObject({ maxPax: 7, minutes: 50, refundable: true, freeCancelUntil: "2027-03-08", currency: "EUR" });
    expect(quotes[1]!.pickupNote).toMatch(/meeting point 4/);
  });
});

/* ───────────── the app: stays, the beta policy, the desk, vouchers ───────────── */

let me: { token: string; userId: string; selfId: string; cardId: string };

async function traveller() {
  const s = await signIn();
  const people = (await get(peopleGet, s.token)).json.people as { id: string; isSelf: boolean }[];
  await post(peoplePost, s.token, { givenNames: "Hessa", surname: "Alharbi", relation: "spouse", dateOfBirth: "1988-07-24" });
  const card = await post(cardsPost, s.token, { token: "tok_mock_visa41", brand: "visa", last4: "4241", exp: "08/28", makeDefault: true });
  const cardId = (card.json.cards as { id: string; last4: string }[]).find((c) => c.last4 === "4241")!.id;
  return { token: s.token, userId: s.user.id, selfId: people.find((p) => p.isSelf)!.id, cardId };
}

async function hotelbedsStays(token: string, travellerIds: string[]) {
  const r = await post(searchStays, token, { destination: "istanbul", checkIn: CHECK_IN, nights: 6, travellerIds });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return StaySearchResponse.parse(r.json);
}

async function bookStay(token: string, stayOfferId: string, travellerIds: string[], cardId: string) {
  const draft: OrderDraft = { kind: "stay", stayOfferId, travellerIds };
  const pv = await post(previewPost, token, { draft, useCredit: false });
  expect(pv.status, JSON.stringify(pv.json)).toBe(200);
  const preview = PreviewResponse.parse(pv.json).preview;
  const r = await post(ordersPost, token, { draft, useCredit: false, payment: { method: "card", cardId }, plan: "full", expectedTotal: preview.total.amount, idempotencyKey: `hb-${Math.random().toString(36).slice(2, 12)}` });
  expect([200, 201], JSON.stringify(r.json)).toContain(r.status);
  return { preview, out: CreateOrderResponse.parse(r.json) };
}

describe("stays from Hotelbeds in the app", () => {
  beforeAll(async () => { me = await traveller(); });

  it("searches Hotelbeds (fixtures), shows the hotel and only asks checkrates for a RECHECK rate", async () => {
    process.env.SUPPLIER_MODE_HOTELS = "hotelbeds-mock";
    clearSearchCache(); resetMockHotelbeds();
    const people = (await get(peopleGet, me.token)).json.people as { id: string }[];
    const s = await hotelbedsStays(me.token, people.map((p) => p.id));
    expect(s.outcome).toBe("ok");
    expect(s.options[0]!.hotel).toMatchObject({ supplier: "hotelbeds" });
    expect(s.options.map((o) => o.hotel?.code)).toContain(99703);
    expect(s.options.filter((o) => o.badge === "best")).toHaveLength(1);
    // Every option is stored (in one insert) under the id the app sees, with the option itself as the payload.
    const rows = await db.select().from(appOffers).where(inArray(appOffers.id, s.options.map((o) => o.id)));
    expect(rows).toHaveLength(s.options.length);
    for (const o of s.options) expect(rows.find((r) => r.id === o.id)).toMatchObject({ kind: "stay", supplier: "hotelbeds", total: o.total.amount, payload: { id: o.id, name: o.name } });
    const bookable = s.options.find((o) => o.name === "TAKSIM CITY ROOMS")!;
    const recheck = s.options.find((o) => o.name === "SULTANAHMET GARDEN HOTEL")!;
    // A BOOKABLE rate: rate comments from the Content API, no checkrates.
    const p1 = PreviewResponse.parse((await post(previewPost, me.token, { draft: { kind: "stay", stayOfferId: bookable.id, travellerIds: people.map((p) => p.id) }, useCredit: false })).json).preview;
    expect(p1.rule).toMatch(/hotel time/);
    expect(p1.rule).toMatch(/From the hotel: Check-in from 14:00/);
    expect(mockHotelbedsState().calls.filter((c) => c.path.endsWith("/checkrates"))).toHaveLength(0);
    // A RECHECK rate: checkrates before the traveller pays, and its rate comments are shown.
    const p2 = PreviewResponse.parse((await post(previewPost, me.token, { draft: { kind: "stay", stayOfferId: recheck.id, travellerIds: people.map((p) => p.id) }, useCredit: false })).json).preview;
    expect(mockHotelbedsState().calls.filter((c) => c.path.endsWith("/checkrates"))).toHaveLength(1);
    expect(p2.rule).toMatch(/From the hotel: Check-in hour 14:00/);
    // The order sheet repeats the stay's facts so the app says them plainly (free until, tax at the hotel, the hotel's notes).
    expect(p1.stay).toMatchObject({ name: "TAKSIM CITY ROOMS", checkIn: bookable.checkIn, essentials: expect.stringMatching(/Check-in from 14:00/) });
    // Hotel details: every room of the hotel for the same stay, each an offer the order sheet takes.
    const rooms = await roomsGet(new Request(`http://t/api/app/v1/offers/${bookable.id}/rooms`, { headers: { authorization: `Bearer ${me.token}` } }), { params: Promise.resolve({ id: bookable.id }) });
    const r = (await rooms.json()) as { options: { id: string; name: string; total: { amount: number } }[] };
    expect(rooms.status).toBe(200);
    expect(r.options[0]!.id).toBe(bookable.id);
    expect(r.options.every((o) => o.name === "TAKSIM CITY ROOMS")).toBe(true);
    // Shown once more: no second checkrates while the offer is held.
    await post(previewPost, me.token, { draft: { kind: "stay", stayOfferId: recheck.id, travellerIds: people.map((p) => p.id) }, useCredit: false });
    expect(mockHotelbedsState().calls.filter((c) => c.path.endsWith("/checkrates"))).toHaveLength(1);
  });

  it("request mode (the beta default outside staging): the order waits for the desk, which books in one click", async () => {
    process.env.SUPPLIER_MODE_HOTELS = "hotelbeds-mock";
    expect(staysMode()).toBe("request");
    clearSearchCache();
    const people = (await get(peopleGet, me.token)).json.people as { id: string }[];
    const ids = people.map((p) => p.id);
    const s = await hotelbedsStays(me.token, ids);
    const pick = s.options.find((o) => o.name === "GALATA TOWER SUITES")!;
    const { out } = await bookStay(me.token, pick.id, ids, me.cardId);
    expect(out.outcome).toBe("created");
    const orderId = (out as { order: { id: string } }).order.id;
    expect(await db.select().from(appSupplierBookings).where(eq(appSupplierBookings.sourceId, orderId))).toHaveLength(0);
    const desk = { name: "Faisal" };
    const row = await bookStayOnHotelbeds(orderId, desk);
    expect(row).toMatchObject({ status: "confirmed", product: "stay", mode: "mock" });
    expect(row.supplierRef).toMatch(/^1-\d+$/);
    expect(row.clientReference).toBe(orderId.replace(/-/g, "").slice(0, 20));
    const [o] = await db.select().from(appOrders).where(eq(appOrders.id, orderId));
    expect(o!.supplierRef).toBe(row.supplierRef);
    // A second click finds the first booking: nothing is booked twice.
    const again = await bookStayOnHotelbeds(orderId, desk);
    expect(again.id).toBe(row.id);
    expect([...mockHotelbedsState().bookings.values()].filter((b) => (b.body.clientReference as string) === row.clientReference)).toHaveLength(1);
    // Names and the room go to Hotelbeds as booked.
    const body = [...mockHotelbedsState().bookings.values()].find((b) => b.body.clientReference === row.clientReference)!.body as { holder: { name: string }; rooms: { paxes: { type: string }[] }[]; remark: string };
    expect(body.holder.name.length).toBeGreaterThan(0);
    expect(body.rooms[0]!.paxes.length).toBe(ids.length);

    // The voucher (cert. §4): reference, holder, room, board, essential info, the payment statement, no price.
    const v = await get(voucherGet, me.token, { id: row.id });
    expect(v.status, JSON.stringify(v.json)).toBe(200);
    const voucher = SupplierVoucherResponse.parse(v.json).voucher;
    expect(voucher).toMatchObject({ kind: "stay", reference: row.supplierRef, checkIn: CHECK_IN, checkOut: CHECK_OUT, room: "Double Standard", board: "Bed And Breakfast", canCancel: true });
    expect(voucher.payableThrough).toBe(payableThrough("HOTELBEDS PROFESSIONAL SERVICES, S.L.U", "ESB38877676", row.supplierRef!));
    expect(voucher.remarks).toMatch(/Check-in hour 14:00/);
    const html = await get(voucherGet, me.token, { id: row.id }, "?format=html&lang=ar");
    expect(html.headers.get("content-type")).toMatch(/text\/html/);
    const page = html.bytes.toString();
    expect(page).toMatch(/dir="rtl"/);
    expect(page).toContain("acting as agent for the service operating company");
    expect(page).not.toMatch(/SAR\s?\d/);
    expect(voucherHtml(voucher, "en")).toContain(row.supplierRef!);
    // Someone else's voucher doesn't exist for them.
    const other = await traveller();
    expect((await get(voucherGet, other.token, { id: row.id })).status).toBe(404);
    expect((await get(voucherGet, "", { id: row.id })).status).toBe(401);

    // Cancel from the voucher: Hotelbeds' simulation first (the fee), then for real.
    const sim = CancelSupplierVoucherResponse.parse((await post(voucherCancel, me.token, { confirm: false }, { id: row.id })).json);
    expect(sim.simulated).toBe(true);
    expect(sim.supplierFee.amount).toBeGreaterThan(0);
    expect(sim.voucher.status).toBe("confirmed");
    const done = await post(voucherCancel, me.token, { confirm: true }, { id: row.id });
    expect(done.status).toBe(201);
    expect(CancelSupplierVoucherResponse.parse(done.json).voucher.status).toBe("cancelled");
    expect((await post(voucherCancel, me.token, { confirm: true }, { id: row.id })).status).toBe(400);
  });

  it("live mode on staging books on Hotelbeds as soon as the card is authorised", async () => {
    process.env.SUPPLIER_MODE_HOTELS = "hotelbeds-mock";
    process.env.APP_ENV = "staging";
    expect(staysMode()).toBe("live");
    clearSearchCache();
    const ids = [me.selfId];
    const s = await hotelbedsStays(me.token, ids);
    const { out } = await bookStay(me.token, s.options.find((o) => o.name === "TAKSIM CITY ROOMS")!.id, ids, me.cardId);
    const orderId = (out as { order: { id: string } }).order.id;
    const [row] = await db.select().from(appSupplierBookings).where(eq(appSupplierBookings.sourceId, orderId));
    expect(row).toMatchObject({ status: "confirmed", bookedBy: "Mada (automatic)" });
  });

  it("never books the test environment for a real traveller in production, and defaults stays to request there", () => {
    process.env.VERCEL_ENV = "production";
    process.env.APP_ALLOW_MOCKS = "yes";
    process.env.SUPPLIER_MODE_HOTELS = "hotelbeds";
    process.env.HOTELBEDS_ENV = "test";
    expect(hotelbedsBookingAllowed("hotels").ok).toBe(false);
    process.env.APP_STAYS_MODE = "live";
    expect(staysMode()).toBe("request");
    process.env.HOTELBEDS_ENV = "live";
    expect(hotelbedsBookingAllowed("hotels").ok).toBe(true);
    expect(staysMode()).toBe("live");
    delete process.env.APP_STAYS_MODE;
    expect(staysMode()).toBe("request");
  });

  it("a staging copy on its own Vercel production target is not production: test keys book, stays default to live", () => {
    process.env.VERCEL_ENV = "production";
    process.env.APP_ENV = "staging";
    process.env.SUPPLIER_MODE_HOTELS = "hotelbeds";
    process.env.HOTELBEDS_ENV = "test";
    expect(hotelbedsBookingAllowed("hotels").ok).toBe(true);
    expect(staysMode()).toBe("live");
    process.env.APP_STAYS_MODE = "live";
    expect(staysMode()).toBe("live");
  });

  it("answers a Hotelbeds outage with SUPPLIER_DOWN, not a hang", async () => {
    process.env.SUPPLIER_MODE_HOTELS = "hotelbeds-mock";
    clearSearchCache();
    setHotelbedsTestFetch(async () => ({ status: 503, headers: { get: () => null }, text: async () => "{}" }));
    const r = await post(searchStays, me.token, { destination: "istanbul", checkIn: addDays(CHECK_IN, 1), nights: 3, travellerIds: [me.selfId] });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("SUPPLIER_DOWN");
  });

  it("keeps hotel content in our store and serves it without calling Hotelbeds", async () => {
    await db.delete(appHotelbedsHotels).where(eq(appHotelbedsHotels.code, 99701));
    const run = await refreshHotelContent({ api: mockHotelbedsHotels(undefined, fixtureFetch()) });
    expect(run.missing).toBeGreaterThanOrEqual(1);
    resetMockHotelbeds();
    const h = await get(hotelGet, me.token, { code: "99701" });
    expect(h.status).toBe(200);
    expect(h.json.hotel).toMatchObject({ name: "Galata Tower Suites", category: "4 stars", source: "HBX Group" });
    expect(h.json.hotel.images[0]).toMatch(/^https:\/\/photos\.hotelbeds\.com\/giata\/xl\//);
    expect(h.json.hotel.facilities).toContainEqual({ name: "Wi-fi", paid: false });
    expect(mockHotelbedsState().calls).toHaveLength(0);
    expect((await get(hotelGet, me.token, { code: "123" })).status).toBe(404);
  });
});

describe("airport pickups on a trip", () => {
  let tripId: string;
  let owner: Awaited<ReturnType<typeof traveller>>;
  beforeAll(async () => {
    owner = await traveller();
    const r = await callP(demoPost, {}, { method: "POST", token: owner.token });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    tripId = r.json.tripId;
  });

  it("lists Hotelbeds pickups for the landing, sends the pick to the desk with its rate, and the desk books it", async () => {
    clearTransferCache(); resetMockHotelbeds();
    expect((await get(transfersGet, "", { id: tripId })).status).toBe(401);
    const stranger = await traveller();
    expect((await get(transfersGet, stranger.token, { id: tripId })).status).toBe(404);
    const r = await get(transfersGet, owner.token, { id: tripId });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const list = TransferOptionsResponse.parse(r.json);
    expect(list).toMatchObject({ outcome: "ok", airport: "IST" });
    expect(list.options.length).toBeGreaterThan(0);
    expect(list.options.every((o) => o.total.amount > 0 && o.total.amount % 100 === 0)).toBe(true);
    const pick = list.options.find((o) => o.kind === "private")!;
    // Someone else can't pick from this trip's options.
    expect((await post(transfersPost, stranger.token, { optionId: pick.id, clientKey: "pick-stranger-1" }, { id: tripId })).status).toBe(404);
    const chosen = await post(transfersPost, owner.token, { optionId: pick.id, clientKey: "pick-owner-001" }, { id: tripId });
    expect(chosen.status, JSON.stringify(chosen.json)).toBe(201);
    const req = ChooseTransferResponse.parse(chosen.json).request;
    expect(req).toMatchObject({ kind: "car", status: "sent" });
    // The same tap sent twice: the same request.
    const twice = await post(transfersPost, owner.token, { optionId: pick.id, clientKey: "pick-owner-001" }, { id: tripId });
    expect(ChooseTransferResponse.parse(twice.json).request.id).toBe(req.id);
    expect(TransferOptionsResponse.parse((await get(transfersGet, owner.token, { id: tripId })).json)).toMatchObject({ outcome: "requested", request: { id: req.id } });

    const booked = await bookTransferOnHotelbeds(req.id, { name: "Faisal" });
    expect(booked).toMatchObject({ status: "confirmed", product: "transfer" });
    expect(booked.supplierRef).toMatch(/^102-/);
    const vouchers = SupplierVouchersResponse.parse((await get(tripVouchersGet, owner.token, { id: tripId })).json).vouchers;
    expect(vouchers.find((v) => v.id === booked.id)).toMatchObject({ kind: "transfer", reference: booked.supplierRef });
    const sim = await cancelSupplierBooking(booked.id, { name: "Faisal" }, { confirm: false });
    expect(sim).toMatchObject({ simulated: true, amount: 0 });
  });

  it("says when Hotelbeds isn't answering", async () => {
    clearTransferCache();
    const r0 = await post(transfersPost, owner.token, { optionId: "00000000-0000-4000-8000-000000000000", clientKey: "pick-none-01" }, { id: tripId });
    expect(r0.status).toBe(404);
    const fresh = await traveller();
    const d = await callP(demoPost, {}, { method: "POST", token: fresh.token });
    setHotelbedsTestFetch(async () => ({ status: 500, headers: { get: () => null }, text: async () => "{}" }));
    const r = await get(transfersGet, fresh.token, { id: d.json.tripId });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe("SUPPLIER_DOWN");
  });
});
