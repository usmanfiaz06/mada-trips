import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appPayments, appPeople, appTrips, appUsers } from "@/db/app-schema";
import { appOrders, appTripBookings } from "@/db/app-schema-booking";
import { encryptField, passportAad } from "@/lib/app/crypto";
import { resetBreakers } from "@/lib/app/resilience/breaker";
import { baggageOf, decodeOffer, resetTboAir, rulesOf, tboAir, tokenUntil, type TboResult } from "@/lib/app/suppliers/live/tbo-air";
import type { FlightPassenger } from "@/lib/app/suppliers/flight-ticketing";
import { bookingSuppliers } from "@/lib/app/booking/common";
import { clearSearchCache, flightOptionOf, searchFlights } from "@/lib/app/booking/search";
import { acceptFare, acceptOrder } from "@/lib/app/booking/desk";
import { checkWithSupplier, flightBookingOf, holdWithSupplier, passengersFor, ticketWithSupplier } from "@/lib/app/booking/supplier-flights";
import { flightsMode } from "@/lib/app/switches";
import { fakeTbo, results, TBO_ENV } from "./fixtures/tbo-air";

/*
 * TBO Air against a fake TBO (fixtures/tbo-air.ts, TBO's response shapes): the day's token reused, search mapped with
 * child and infant fares, fare rules into our sheet, the price check before paying, hold and ticket never twice, the
 * outcomes the desk sees (price rose, sold out, tickets didn't issue), cancel. Never calls TBO.
 */

const DEPART = "2026-12-14";
const FAMILY = { from: "RUH", to: "IST", depart: DEPART, return: null, adults: 2, children: 2, infants: 1, cabin: "economy" as const };
const saved: Record<string, string | undefined> = {};

beforeAll(() => { for (const k of [...Object.keys(TBO_ENV), "TBO_ENV", "APP_FLIGHTS_MODE"]) saved[k] = process.env[k]; });
beforeEach(async () => { Object.assign(process.env, TBO_ENV); resetBreakers(); await resetTboAir(); });
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const pax = (o: Partial<FlightPassenger> & Pick<FlightPassenger, "givenNames" | "type">): FlightPassenger => ({
  personId: randomUUID(), surname: "ALHARBI", dateOfBirth: o.type === "adult" ? "1988-04-02" : o.type === "child" ? "2018-06-01" : "2025-08-01", sex: "M", nationality: "SA",
  passportNumber: "A11493107", passportExpiry: "2031-01-01", passportCountry: "SA", lead: false, phone: "+966551234567", email: "omar@example.com", ...o,
});
const PEOPLE = [
  pax({ givenNames: "OMAR", type: "adult", lead: true }), pax({ givenNames: "NOURA", type: "adult", sex: "F" }),
  pax({ givenNames: "SARA", type: "child", sex: "F", meal: "CHML" }), pax({ givenNames: "FAHAD", type: "child", meal: "CHML" }), pax({ givenNames: "LEEN", type: "infant", sex: "F" }),
];

describe("TBO Air: the token", () => {
  it("authenticates once a day and reuses the token for every call", async () => {
    const s = fakeTbo();
    await tboAir.search(FAMILY);
    await tboAir.search({ ...FAMILY, depart: "2026-12-15" });
    expect(s.logins).toBe(1);
    const auth = s.calls.find((c) => c.method === "Authenticate")!.body;
    expect(auth).toMatchObject({ ClientId: "ApiIntegrationNew", UserName: "mada-test", EndUserIp: "203.0.113.7" });
    expect(s.calls.filter((c) => c.method === "Search").every((c) => c.body.TokenId === "tok-1-0000-0000-000000000000" && c.body.EndUserIp === "203.0.113.7")).toBe(true);
  });

  it("logs in again once when TBO says the session expired, and repeats the call", async () => {
    const s = fakeTbo();
    await tboAir.search(FAMILY);
    s.sessionExpiresOnce = true;
    const offers = await tboAir.search(FAMILY);
    expect(offers.length).toBeGreaterThan(0);
    expect(s.logins).toBe(2);
  });

  it("refused credentials are NOT_CONFIGURED (ours to fix), not an outage", async () => {
    const s = fakeTbo();
    s.badLogin = true;
    await expect(tboAir.search(FAMILY)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("without keys it answers NOT_CONFIGURED and never calls out", async () => {
    const s = fakeTbo();
    delete process.env.TBO_PASSWORD;
    await expect(tboAir.search(FAMILY)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(s.calls).toHaveLength(0);
  });

  it("a token lasts until just before midnight in India", () => {
    const noonRiyadh = Date.parse("2026-10-19T09:00:00Z");
    expect(new Date(tokenUntil(noonRiyadh)).toISOString()).toBe("2026-10-19T18:20:00.000Z");
  });
});

describe("TBO Air: search", () => {
  it("maps RUH→IST for a family of five with child and infant fares from TBO's breakdown", async () => {
    const s = fakeTbo();
    const offers = await tboAir.search(FAMILY);
    expect(s.calls.find((c) => c.method === "Search")!.body).toMatchObject({ AdultCount: 2, ChildCount: 2, InfantCount: 1, JourneyType: 1, Segments: [{ Origin: "RUH", Destination: "IST", FlightCabinClass: 2 }] });
    const sv = offers.find((o) => o.out[0]!.carrier === "SV")!;
    const xy = offers.find((o) => o.out[0]!.carrier === "XY")!;
    expect(sv.out[0]).toMatchObject({ flightNumber: "SV263", from: "RUH", to: "IST", departLocal: `${DEPART}T09:40`, arriveLocal: `${DEPART}T13:55`, departTz: "Asia/Riyadh", arriveTz: "Europe/Istanbul", durationMin: 255 });
    // Adults SAR 2,050 each, children 1,675, the baby 180, plus SAR 40 of charges shared out; rounded up to a riyal each.
    expect(sv.pricePerPerson.amount).toBe(206100);
    expect(sv.childPrice!.amount).toBe(168400);
    expect(sv.infantPrice!.amount).toBe(18100);
    expect(sv.total.amount).toBe(2 * 206100 + 2 * 168400 + 18100);
    expect(sv.baggage).toBe("2 × 23 kg");
    expect(sv.meta?.refundable).toBe(true);
    expect(xy.out[0]).toMatchObject({ flightNumber: "XY125", to: "SAW" });
    expect(xy.baggage).toBe("1 × 20 kg");
    expect(xy.refundRule).toBe("Not refundable");
    expect(xy.seatsLeft).toBe(4);
    expect(xy.total.amount).toBe(2 * 167000 + 2 * 137000 + 14000);
    expect(decodeOffer(sv.id)).toMatchObject({ t: "trace-1", r: ["OB1"], l: [false], q: { adults: 2, children: 2, infants: 1 } });
    expect(decodeOffer(xy.id)).toMatchObject({ r: ["OB2"], l: [true] });
    // The app's option: the same per-type fares, and the total adds up.
    const opt = flightOptionOf(sv, randomUUID(), 4, 1, 2);
    expect(opt.total.amount).toBe(sv.total.amount);
  });

  it("a return covers both ways in one result", async () => {
    fakeTbo();
    const offers = await tboAir.search({ ...FAMILY, return: "2026-12-20" });
    const sv = offers.find((o) => o.out[0]!.carrier === "SV")!;
    expect(sv.back[0]).toMatchObject({ flightNumber: "SV264", from: "IST", to: "RUH", departLocal: "2026-12-20T15:10" });
  });

  it("a route TBO can't answer goes to the desk as a request (by_hand), not an error screen", async () => {
    fakeTbo();
    const ids = [randomUUID(), randomUUID()];
    const ok = await searchFlights(null, { from: "RUH", destination: "istanbul", depart: DEPART, return: null, travellerIds: ids, guests: [] } as never, new Set());
    expect(ok.outcome).toBe("ok");
    expect(ok.options.length).toBeGreaterThan(0);
    clearSearchCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const down = await searchFlights(null, { from: "RUH", destination: "istanbul", depart: "2026-12-16", return: null, travellerIds: ids, guests: [] } as never, new Set());
    expect(down.outcome).toBe("by_hand");
  });

  it("keys alone never switch Ask to live booking: request stays the default until APP_FLIGHTS_MODE=live", () => {
    delete process.env.APP_FLIGHTS_MODE;
    expect(flightsMode()).toBe("request");
    process.env.APP_FLIGHTS_MODE = "live";
    expect(flightsMode()).toBe("live");
    delete process.env.APP_FLIGHTS_MODE;
  });
});

describe("TBO Air: fare rules and the price check", () => {
  it("reads TBO's penalties and rule text into our fare-rules sheet", async () => {
    fakeTbo();
    const [sv] = (await tboAir.search(FAMILY)).filter((o) => o.out[0]!.carrier === "SV");
    const r = await tboAir.fareRules(sv!.id);
    expect(r).toMatchObject({ carrier: "SV", refundable: true, changeFee: 30000, refundFee: 40000, bagKg: 23, bags: "2 × 23 kg", changeAllowed: true, changeRule: "SAR 300 per person", refundRule: "Refund minus SAR 400 per person" });
    expect(r.text).toContain("CHARGE SAR 300.00 FOR REISSUE");
    expect(r.taxPerPerson).toBe(55000);
  });

  it("a non-refundable low-cost fare reads as such, with the change fee from the text", () => {
    const [, xy] = results({ adults: 1, children: 0, infants: 0 }, DEPART, null) as unknown as TboResult[];
    const r = rulesOf([xy!], "TICKET IS NON-REFUNDABLE. DATE CHANGE SAR 250 PER PASSENGER", "XY", { adults: 1, children: 0, infants: 0 });
    expect(r).toMatchObject({ refundable: false, refundFee: null, changeFee: 25000, refundRule: "Not refundable", changeRule: "SAR 250 per person" });
  });

  it("baggage words", () => {
    expect(baggageOf("30 KG").text).toBe("1 × 30 kg");
    expect(baggageOf("20 Kilograms").kg).toBe(20);
    expect(baggageOf("2 PC").text).toBe("2 × 23 kg");
    expect(baggageOf("").text).toBe("Cabin bag only");
  });

  it("price() quotes the fare again: a rise comes back higher (the app's price-rose flow), sold out is NOT_FOUND", async () => {
    const s = fakeTbo();
    const [sv] = (await tboAir.search(FAMILY)).filter((o) => o.out[0]!.carrier === "SV");
    const same = await tboAir.price(sv!.id, 4, 2);
    expect(same.total.amount).toBe(sv!.total.amount);
    expect(same.changeRule).toBe("SAR 300 per person");
    expect(s.calls.filter((c) => c.method === "FareQuote").at(-1)!.body).toMatchObject({ TraceId: "trace-1", ResultIndex: "OB1" });
    s.priceRise = true;
    const up = await tboAir.price(sv!.id, 4, 2);
    expect(up.total.amount).toBeGreaterThan(sv!.total.amount);
    s.priceRise = false;
    s.soldOut = true;
    await expect(tboAir.price(sv!.id, 4, 2)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a stale TraceId searches again and finds the same flights by number and time", async () => {
    const s = fakeTbo();
    const [sv] = (await tboAir.search(FAMILY)).filter((o) => o.out[0]!.carrier === "SV");
    const k = decodeOffer(sv!.id)!;
    const old = `tbo.${Buffer.from(JSON.stringify({ ...k, at: Date.now() - 20 * 60_000 })).toString("base64url")}`;
    await tboAir.price(old, 4, 2);
    expect(s.count("Search")).toBe(2);
    expect(s.calls.filter((c) => c.method === "FareQuote").at(-1)!.body.TraceId).toBe("trace-2");
  });
});

describe("TBO Air: book and ticket, never twice", () => {
  it("full-service: Book holds with the passengers (child meals, per-passenger fares), Ticket by PNR; a retry asks, never re-sends", async () => {
    const s = fakeTbo();
    const [sv] = (await tboAir.search(FAMILY)).filter((o) => o.out[0]!.carrier === "SV");
    const writes: unknown[] = [];
    const persist = async (r: unknown) => { writes.push(JSON.parse(JSON.stringify(r))); };
    const [a, b] = await Promise.all([
      tboAir.book(sv!.id, PEOPLE, { key: "o1", paidTotal: sv!.total.amount, persist }),
      tboAir.book(sv!.id, PEOPLE, { key: "o1", paidTotal: sv!.total.amount, persist }),
    ]);
    expect(s.count("Book")).toBe(1);
    expect(a).toEqual(b);
    expect(a.outcome).toBe("held");
    const ref = (a as { ref: import("@/lib/app/suppliers/flight-ticketing").FlightBookingRef }).ref;
    expect(ref.parts[0]).toMatchObject({ pnr: "X7K2QD", lcc: false, bookSent: true });
    expect(writes.length).toBeGreaterThan(0);
    const sent = s.calls.find((c) => c.method === "Book")!.body as { Passengers: Record<string, unknown>[] };
    expect(sent.Passengers.map((p) => p.PaxType)).toEqual([1, 1, 2, 2, 3]);
    expect(sent.Passengers[0]).toMatchObject({ Title: "Mr", FirstName: "OMAR", LastName: "ALHARBI", Gender: 1, IsLeadPax: true, PassportNo: "A11493107", DateOfBirth: "1988-04-02T00:00:00", Nationality: "SA" });
    expect(sent.Passengers[2]).toMatchObject({ Title: "Miss", Meal: { Code: "CHML" } });
    expect(sent.Passengers[0]!.Fare).toMatchObject({ BaseFare: 1500, Tax: 550 });
    expect(sent.Passengers[4]!.Fare).toMatchObject({ BaseFare: 150, Tax: 30 });

    // Booked again with what the order knows: nothing sent.
    const again = await tboAir.book(sv!.id, PEOPLE, { key: "o1-retry", paidTotal: sv!.total.amount, known: ref });
    expect(again.outcome).toBe("held");
    expect(s.count("Book")).toBe(1);

    const t1 = await tboAir.ticket(ref, PEOPLE, { key: "o1", paidTotal: sv!.total.amount, persist });
    expect(t1.outcome).toBe("ticketed");
    expect(s.count("Ticket")).toBe(1);
    expect(s.calls.find((c) => c.method === "Ticket")!.body).toMatchObject({ PNR: "X7K2QD", BookingId: ref.parts[0]!.bookingId });
    const tickets = (t1 as { tickets: string[] }).tickets;
    expect(tickets).toHaveLength(5);
    expect(tickets.every((n) => /^065\d{10}$/.test(n))).toBe(true);
    // Ticketed again: already done, nothing sent.
    const t2 = await tboAir.ticket(ref, PEOPLE, { key: "o1-b", paidTotal: sv!.total.amount });
    expect(t2.outcome).toBe("ticketed");
    expect(s.count("Ticket")).toBe(1);
  });

  it("low-cost: nothing to hold; Ticket carries the passengers; a lost answer is looked up, not ticketed again", async () => {
    const s = fakeTbo();
    const [xy] = (await tboAir.search(FAMILY)).filter((o) => o.out[0]!.carrier === "XY");
    const held = await tboAir.book(xy!.id, PEOPLE, { key: "o2", paidTotal: xy!.total.amount, ssr: ["CHML", "BSCT"] });
    expect(held.outcome).toBe("ticket_now");
    expect(s.count("Book")).toBe(0);
    const ref = (held as { ref: import("@/lib/app/suppliers/flight-ticketing").FlightBookingRef }).ref;
    // A bassinet and child meals on flynas are the desk's to add (paid or by phone).
    expect(ref.ssrForDesk).toEqual(expect.arrayContaining(["BSCT", "CHML"]));
    s.ticketTimesOut = true;
    const lost = await tboAir.ticket(ref, PEOPLE, { key: "o2", paidTotal: xy!.total.amount });
    expect(lost.outcome).toBe("pending");
    expect(ref.parts[0]!.ticketSent).toBe(true);
    s.ticketTimesOut = false;
    const found = await tboAir.ticket(ref, PEOPLE, { key: "o2-b", paidTotal: xy!.total.amount });
    expect(found.outcome).toBe("ticketed");
    expect(s.count("Ticket")).toBe(1);
    const sent = s.calls.find((c) => c.method === "Ticket")!.body as { Passengers: Record<string, unknown>[] };
    expect(sent.Passengers[0]).toMatchObject({ Baggage: [], MealDynamic: [], SeatDynamic: [] });
  });

  it("a fare above what the card holds is a price change, never booked", async () => {
    const s = fakeTbo();
    const [sv] = (await tboAir.search(FAMILY)).filter((o) => o.out[0]!.carrier === "SV");
    s.priceRise = true;
    const r = await tboAir.book(sv!.id, PEOPLE, { key: "o3", paidTotal: sv!.total.amount });
    expect(r.outcome).toBe("price_changed");
    expect((r as { total: number }).total).toBeGreaterThan(sv!.total.amount);
    expect(s.count("Book")).toBe(0);
  });

  it("missing passport details stop the hold before anything is sent", async () => {
    const s = fakeTbo();
    const [sv] = (await tboAir.search(FAMILY)).filter((o) => o.out[0]!.carrier === "SV");
    const r = await tboAir.book(sv!.id, [PEOPLE[0]!, { ...PEOPLE[1]!, passportNumber: null }], { key: "o4", paidTotal: sv!.total.amount });
    expect(r).toMatchObject({ outcome: "failed" });
    expect((r as { reason: string }).reason).toContain("passport");
    expect(s.count("Book")).toBe(0);
  });

  it("cancel: a hold is released; tickets go as a refund request", async () => {
    const s = fakeTbo();
    const [sv] = (await tboAir.search(FAMILY)).filter((o) => o.out[0]!.carrier === "SV");
    const held = await tboAir.book(sv!.id, PEOPLE, { key: "o5", paidTotal: sv!.total.amount });
    const ref = (held as { ref: import("@/lib/app/suppliers/flight-ticketing").FlightBookingRef }).ref;
    const rel = await tboAir.cancel(structuredClone(ref), "Traveller asked");
    expect(rel.released).toBe(true);
    expect(s.calls.find((c) => c.method === "ReleasePNRRequest")!.body).toMatchObject({ BookingId: ref.parts[0]!.bookingId, Source: 4 });
    const held2 = await tboAir.book(sv!.id, PEOPLE, { key: "o6", paidTotal: sv!.total.amount });
    const ref2 = (held2 as { ref: import("@/lib/app/suppliers/flight-ticketing").FlightBookingRef }).ref;
    await tboAir.ticket(ref2, PEOPLE, { key: "o6", paidTotal: sv!.total.amount });
    const refund = await tboAir.cancel(ref2, "Traveller asked");
    expect(refund.changeRequestIds).toHaveLength(5);
    expect(s.calls.find((c) => c.method === "SendChangeRequest")!.body).toMatchObject({ RequestType: 1, CancellationType: 3 });
  });

  it("test keys never book on a production deployment", async () => {
    fakeTbo();
    const was = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      await expect(tboAir.book("tbo.x", PEOPLE, { key: "p", paidTotal: 1 })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    } finally { if (was === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = was; }
  });
});

/* ───────────── the desk: an order made from a TBO offer ───────────── */

describe("TBO Air on the desk", () => {
  const agent = { name: "Faisal" };

  async function family() {
    const [u] = await db.insert(appUsers).values({ name: "Omar Alharbi", phone: `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, email: "omar@example.com" }).returning();
    const add = async (givenNames: string, relation: string, dateOfBirth: string, sex: "M" | "F", isSelf = false) => {
      const [p] = await db.insert(appPeople).values({ ownerId: u!.id, isSelf, givenNames, surname: "ALHARBI", relation, dateOfBirth, sex, nationality: "SAU" }).returning();
      await db.update(appPeople).set({ passportNumberEnc: encryptField(`A${Math.floor(Math.random() * 1e7)}`, passportAad(p!.id)), passportNumberMasked: "A1•••07", passportExpiry: "2031-01-01", passportIssuingCountry: "SAU" }).where(eq(appPeople.id, p!.id));
      return p!;
    };
    const people = [await add("OMAR", "self", "1988-04-02", "M", true), await add("NOURA", "spouse", "1990-02-11", "F"), await add("SARA", "child", "2018-06-01", "F"), await add("FAHAD", "child", "2020-03-09", "M")];
    const baby = await add("LEEN", "child", "2025-08-01", "F");
    return { user: u!, people, baby };
  }

  async function orderFor(carrier: "SV" | "XY", opts: { token?: string } = {}) {
    const { user, people } = await family();
    const offers = await bookingSuppliers.flights().search(FAMILY);
    const offer = offers.find((o) => o.out[0]!.carrier === carrier)!;
    const option = flightOptionOf(offer, randomUUID(), 4, 1, 2);
    const total = option.total.amount;
    const key = `tbo-test:${randomUUID()}`;
    const auth = await bookingSuppliers.payments().authorize({ amount: total, method: "card", token: opts.token ?? "tok_visa", idempotencyKey: key, description: "test" });
    const [pay] = await db.insert(appPayments).values({ ownerId: user.id, method: "card", status: auth.status, amount: total, label: "Visa ending 41", provider: "mock", providerRef: auth.providerRef, idempotencyKey: key }).returning();
    const [o] = await db.insert(appOrders).values({
      ownerId: user.id, kind: "trip", status: "pending_agent", idempotencyKey: key, draft: {},
      snapshot: { flight: option, flightSupplierId: offer.id, search: { kind: "flight", destination: "istanbul", from: "RUH", depart: DEPART, return: null, travellerIds: people.map((p) => p.id), infants: 1, cabin: "economy" }, place: "Istanbul", applied: { ssr: ["CHML", "BSCT"], remarks: ["SEAT WINDOW"] } },
      lines: [{ key: "flight", icon: "flight", text: "Flights for 5", amount: total }], travellerIds: people.map((p) => p.id),
      subtotal: total, total, paymentLabel: "Visa ending 41", paymentMethod: { kind: "card" }, paymentId: pay!.id,
    }).returning();
    return { order: o!, user, people, total };
  }

  it("reads the household as TBO passengers: types by age, the baby on a lap, passports decrypted, the lead adult", async () => {
    fakeTbo();
    const { order } = await orderFor("SV");
    const list = await passengersFor(order);
    expect(list.map((p) => [p.givenNames, p.type])).toEqual([["OMAR", "adult"], ["NOURA", "adult"], ["SARA", "child"], ["FAHAD", "child"], ["LEEN", "infant"]]);
    expect(list[0]).toMatchObject({ lead: true, nationality: "SA", passportCountry: "SA", seat: "window" });
    expect(list[2]).toMatchObject({ meal: "CHML" });
    expect(list.every((p) => /^A\d+$/.test(p.passportNumber ?? ""))).toBe(true);
  });

  it("Saudia: hold with TBO, ticket now, and the trip carries the PNR, every ticket number and the airline's rules", async () => {
    const s = fakeTbo();
    const { order } = await orderFor("SV");
    await acceptOrder(order.id, agent);
    const held = await holdWithSupplier(order.id, agent);
    expect(held.outcome).toBe("held");
    let [o] = await db.select().from(appOrders).where(eq(appOrders.id, order.id));
    expect(o!.supplierRef).toBe("X7K2QD");
    expect(flightBookingOf(o!)).toMatchObject({ state: "held", parts: [{ pnr: "X7K2QD", lcc: false }] });
    expect(flightBookingOf(o!)!.ssrForDesk).toContain("BSCT");
    expect((o!.snapshot as { flightRules?: { changeFee: number } }).flightRules?.changeFee).toBe(30000);
    // A second click on hold: nothing more sent to TBO.
    await holdWithSupplier(order.id, agent);
    expect(s.count("Book")).toBe(1);

    const done = await ticketWithSupplier(order.id, agent);
    expect(done.outcome).toBe("ticketed");
    [o] = await db.select().from(appOrders).where(eq(appOrders.id, order.id));
    expect(o!.status).toBe("confirmed");
    const [trip] = await db.select().from(appTrips).where(eq(appTrips.id, o!.tripId!));
    expect(trip).toBeTruthy();
    const [tb] = await db.select().from(appTripBookings).where(eq(appTripBookings.orderId, o!.id));
    const d = tb!.details as { tickets?: Record<string, string>; fareRules?: { refundFee: number } };
    expect(Object.values(d.tickets ?? {})).toHaveLength(4);
    expect(Object.values(d.tickets ?? {}).every((n) => /^065\d{10}$/.test(n))).toBe(true);
    expect(d.fareRules?.refundFee).toBe(40000);
    const [pay] = await db.select().from(appPayments).where(eq(appPayments.id, o!.paymentId!));
    expect(pay!.status).toBe("captured");
    // Ticket now again: already ticketed, never a second Ticket.
    await ticketWithSupplier(order.id, agent).catch(() => null);
    expect(s.count("Ticket")).toBe(1);
  });

  it("tickets that don't issue land as the ticketing-failed outcome, the card hold released", async () => {
    const s = fakeTbo();
    const { order } = await orderFor("SV");
    await acceptOrder(order.id, agent);
    await holdWithSupplier(order.id, agent);
    s.ticketFails = true;
    const r = await ticketWithSupplier(order.id, agent);
    expect(r.outcome).toBe("failed");
    const [o] = await db.select().from(appOrders).where(eq(appOrders.id, order.id));
    expect(o!.status).toBe("ticketing_failed");
    const [pay] = await db.select().from(appPayments).where(eq(appPayments.id, o!.paymentId!));
    expect(pay!.status).toBe("voided");
  });

  it("tickets in progress wait; Check with TBO finds them and confirms the trip", async () => {
    const s = fakeTbo();
    const { order } = await orderFor("XY");
    await acceptOrder(order.id, agent);
    expect((await holdWithSupplier(order.id, agent)).outcome).toBe("ticket_now");
    s.ticketInProgress = true;
    expect((await ticketWithSupplier(order.id, agent)).outcome).toBe("pending");
    let [o] = await db.select().from(appOrders).where(eq(appOrders.id, order.id));
    expect(o!.status).toBe("issuing");
    expect(flightBookingOf(o!)?.state).toBe("pending");
    s.ticketInProgress = false;
    const r = await checkWithSupplier(order.id, agent);
    expect(r.outcome).toBe("ticketed");
    [o] = await db.select().from(appOrders).where(eq(appOrders.id, order.id));
    expect(o!.status).toBe("confirmed");
    expect(s.count("Ticket")).toBe(1);
  });

  it("a fare that rose at TBO goes to the traveller as a new price; once accepted, the desk holds again", async () => {
    const s = fakeTbo();
    const { order } = await orderFor("SV");
    await acceptOrder(order.id, agent);
    s.priceRise = true;
    const r = await holdWithSupplier(order.id, agent);
    expect(r.outcome).toBe("price_changed");
    let [o] = await db.select().from(appOrders).where(eq(appOrders.id, order.id));
    expect(o!.status).toBe("fare_changed");
    expect(o!.fareChange!.perPerson).toBeGreaterThan(0);
    await acceptFare(order.id, order.ownerId);
    await acceptOrder(order.id, agent);
    expect((await holdWithSupplier(order.id, agent)).outcome).toBe("held");
    [o] = await db.select().from(appOrders).where(eq(appOrders.id, order.id));
    expect(o!.status).toBe("held");
  });

  it("a fare that rose at the ticket request: the traveller takes it, the desk holds again (nothing re-booked) and tickets accept the change", async () => {
    const s = fakeTbo();
    const { order } = await orderFor("SV");
    await acceptOrder(order.id, agent);
    await holdWithSupplier(order.id, agent);
    s.ticketPriceChanged = true;
    expect((await ticketWithSupplier(order.id, agent)).outcome).toBe("price_changed");
    let [o] = await db.select().from(appOrders).where(eq(appOrders.id, order.id));
    expect(o!.status).toBe("fare_changed");
    await acceptFare(order.id, order.ownerId);
    await acceptOrder(order.id, agent);
    expect((await holdWithSupplier(order.id, agent)).outcome).toBe("held");
    expect(s.count("Book")).toBe(1);
    expect((await ticketWithSupplier(order.id, agent)).outcome).toBe("ticketed");
    expect(s.calls.filter((c) => c.method === "Ticket").at(-1)!.body.IsPriceChangeAccepted).toBe(true);
    [o] = await db.select().from(appOrders).where(eq(appOrders.id, order.id));
    expect(o!.status).toBe("confirmed");
    expect(o!.extra).toBeGreaterThan(0);
  });

  it("sold out at the airline closes the order with the sold-out outcome, nothing charged", async () => {
    const s = fakeTbo();
    const { order } = await orderFor("SV");
    await acceptOrder(order.id, agent);
    s.soldOut = true;
    expect((await holdWithSupplier(order.id, agent)).outcome).toBe("sold_out");
    const [o] = await db.select().from(appOrders).where(eq(appOrders.id, order.id));
    expect(o!.status).toBe("cancelled");
    expect((o!.snapshot as { result?: { reason: string } }).result?.reason).toBe("sold_out");
  });
});
