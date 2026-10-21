import { afterEach, describe, expect, it, vi } from "vitest";
import { FlightOffer } from "@mada/shared";
import { bookingSuppliers } from "@/lib/app/booking/common";
import { duffelSource, mergeFlightOffers, withSecondSource } from "@/lib/app/suppliers/duffel";
import { decode, offerRequestBody, orderOf } from "@/lib/app/suppliers/duffel/duffel";
import { clearMockDuffel, mockDuffel } from "@/lib/app/suppliers/duffel/mock";
import { isoMinutes, offerOf } from "@/lib/app/suppliers/duffel/parse";
import type { FlightPassenger } from "@/lib/app/suppliers/flight-ticketing";
import type { BookingFlightOffer, BookingFlightSupplier } from "@/lib/app/suppliers/booking-types";
import { resetBreakers } from "@/lib/app/resilience/breaker";

/* Duffel as a second flight source: the switch, the fixtures through the real parser, orders, and the merge with TBO. */

const pax = (over: Partial<FlightPassenger> = {}): FlightPassenger => ({
  personId: "p1", givenNames: "Sara", surname: "Alharbi", type: "adult", dateOfBirth: "1990-05-01", sex: "F", nationality: "SA", passportNumber: "A1234567", passportExpiry: "2031-01-01", passportCountry: "SA", lead: true, phone: "+966500000001", email: "s@example.com", ...over,
});
const search = { from: "RUH", to: "IST", depart: "2027-03-09", return: null, adults: 2, children: 0, infants: 0, cabin: "economy" as const };

afterEach(() => {
  for (const k of ["SUPPLIER_MODE_DUFFEL", "DUFFEL_ACCESS_TOKEN", "APP_DUFFEL_MARKUP_BPS"]) delete process.env[k];
  vi.unstubAllGlobals();
  clearMockDuffel();
  resetBreakers();
});

describe("switch", () => {
  it("leaves flights alone unless Duffel is on", async () => {
    expect(duffelSource()).toBeNull();
    const before = await bookingSuppliers.flights().search(search);
    expect(before.every((o) => o.supplier !== "duffel")).toBe(true);
    process.env.SUPPLIER_MODE_DUFFEL = "mock";
    expect(duffelSource()?.name).toBe("duffel");
    process.env.DUFFEL_ACCESS_TOKEN = "duffel_test_x";
    delete process.env.SUPPLIER_MODE_DUFFEL;
    expect(duffelSource()).not.toBe(mockDuffel);
  });
});

describe("mock Duffel", () => {
  it("answers the fixture routes as valid offers, priced for the party", async () => {
    const offers = await mockDuffel.search(search);
    expect(offers.map((o) => o.out[0]!.flightNumber)).toEqual(["SV263", "TK143"]);
    for (const o of offers) FlightOffer.parse(o);
    const sv = offers[0]!;
    expect(sv).toMatchObject({ supplier: "duffel", out: [{ from: "RUH", to: "IST", departLocal: "2027-03-09T09:40", arriveLocal: "2027-03-09T13:55", durationMin: 255 }], baggage: "2 checked bags", refundRule: "Refund minus USD 107", changeRule: "USD 80 per change" });
    expect(sv.total.amount).toBe(sv.pricePerPerson.amount * 2);
    expect(decode(sv.id)).toMatchObject({ party: { adults: 2, children: 0, infants: 0 } });
    expect(await mockDuffel.search({ ...search, to: "LHR" })).toEqual([]);
  });
  it("prices again, and for a different party finds the same flights", async () => {
    const [sv] = await mockDuffel.search(search);
    expect((await mockDuffel.price(sv!.id, 2)).total).toEqual(sv!.total);
    const three = await mockDuffel.price(sv!.id, 3);
    expect(three.out[0]!.flightNumber).toBe("SV263");
    expect(three.total.amount).toBeGreaterThan(sv!.total.amount);
  });
  it("creates, reads and cancels orders; a known order is never booked twice", async () => {
    const [sv] = await mockDuffel.search({ ...search, adults: 1 });
    const o = await mockDuffel.createOrder({ offerId: sv!.id, passengers: [pax()], type: "instant", reference: "order-d1" });
    expect(o).toMatchObject({ status: "ticketed", reference: "order-d1", bookingReference: expect.stringMatching(/^MK/) });
    expect(o.tickets).toHaveLength(1);
    expect((await mockDuffel.createOrder({ offerId: sv!.id, passengers: [pax()], type: "instant", reference: "order-d1", known: o.id })).id).toBe(o.id);
    expect(await mockDuffel.cancelOrder(o.id)).toMatchObject({ cancelled: true, refund: { currency: "USD" } });
    expect((await mockDuffel.getOrder(o.id)).status).toBe("cancelled");
    const hold = await mockDuffel.createOrder({ offerId: sv!.id, passengers: [pax()], type: "hold", reference: "order-d2" });
    expect(hold).toMatchObject({ status: "held", tickets: [] });
    await expect(mockDuffel.createOrder({ offerId: sv!.id, passengers: [pax({ surname: "Soldout" })], type: "instant", reference: "order-d3" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("merged with the first source", () => {
  const offer = (supplier: string, id: string, flight: string, dep: string, amount: number): BookingFlightOffer => ({
    id, supplier, label: "best", reason: "Direct.", cabin: "economy", seatsLeft: null, baggage: "", changeRule: "", refundRule: "", expiresAt: "2027-01-01T00:00:00.000Z",
    out: [{ carrier: flight.slice(0, 2), carrierName: "", flightNumber: flight, from: "RUH", to: "IST", departLocal: dep, departTz: "Asia/Riyadh", arriveLocal: dep, arriveTz: "Europe/Istanbul", durationMin: 200 }],
    back: [], pricePerPerson: { amount, currency: "SAR" }, total: { amount, currency: "SAR" },
  });
  it("keeps the same flight once, at the lower price, cheapest first", () => {
    const tbo = [offer("tbo", "tbo.a", "SV263", "2027-03-09T09:40", 216000), offer("tbo", "tbo.b", "XY125", "2027-03-09T06:15", 174500)];
    const duf = [offer("duffel", "duffel.x", "SV263", "2027-03-09T09:40", 210000), offer("duffel", "duffel.y", "SV263", "2027-03-09T18:00", 150000)];
    expect(mergeFlightOffers(tbo, duf).map((o) => o.id)).toEqual(["duffel.y", "tbo.b", "duffel.x"]);
  });
  it("searches both, sends Duffel's offers back to Duffel, and survives either failing", async () => {
    const first: BookingFlightSupplier = {
      name: "tbo", search: vi.fn(async () => [offer("tbo", "tbo.a", "SV263", "2027-03-09T09:40", 900000)]),
      price: vi.fn(async () => offer("tbo", "tbo.a", "SV263", "2027-03-09T09:40", 900000)), hold: vi.fn(),
    };
    const merged = withSecondSource(first, mockDuffel);
    const all = await merged.search(search);
    expect(all.find((o) => o.out[0]!.flightNumber === "SV263")!.supplier).toBe("duffel");
    expect(merged.name).toBe("tbo");
    const d = all.find((o) => o.supplier === "duffel")!;
    expect((await merged.price(d.id, 2)).supplier).toBe("duffel");
    await merged.price("tbo.a", 2);
    expect(first.price).toHaveBeenCalledTimes(1);
    const broken = withSecondSource<BookingFlightSupplier>({ ...first, search: async () => { throw new Error("tbo answered 503"); } }, mockDuffel);
    expect((await broken.search(search)).every((o) => o.supplier === "duffel")).toBe(true);
    const lone = withSecondSource(first, { ...mockDuffel, search: async () => { throw new Error("duffel answered 503"); } });
    expect((await lone.search(search)).map((o) => o.id)).toEqual(["tbo.a"]);
  });
  it("the booking supplier merges Duffel into the catalogue when switched on", async () => {
    process.env.SUPPLIER_MODE_DUFFEL = "mock";
    const offers = await bookingSuppliers.flights().search(search);
    expect(offers.some((o) => o.supplier === "duffel")).toBe(true);
    expect(new Set(offers.map((o) => `${o.out[0]!.flightNumber}@${o.out[0]!.departLocal}`)).size).toBe(offers.length);
  });
});

describe("Duffel wire format", () => {
  it("builds an offer request and reads offers and orders", () => {
    const b = offerRequestBody({ from: "RUH", to: "IST", depart: "2027-03-09", return: "2027-03-15", cabin: "premium", adults: 2, children: 1, infants: 1 });
    expect(b.slices).toHaveLength(2);
    expect(b.passengers).toEqual([{ type: "adult" }, { type: "adult" }, { age: 8 }, { type: "infant_without_seat" }]);
    expect(b.cabin_class).toBe("premium_economy");
    expect(isoMinutes("PT4H15M")).toBe(255);
    expect(isoMinutes("P1DT2H")).toBe(1560);
    expect(offerOf({ id: "off_1", total_amount: "100", total_currency: "USD", slices: [{ segments: [{ marketing_carrier: { iata_code: "S" } }] }] }, { adults: 1, children: 0, infants: 0 })).toBeNull();
    expect(orderOf({ id: "ord_1", booking_reference: "ABC123", documents: [{ type: "electronic_ticket", unique_identifier: "0651234567890" }], total_amount: "545.00", total_currency: "USD", payment_status: { awaiting_payment: false }, metadata: { reference: "o1" } }))
      .toEqual({ id: "ord_1", bookingReference: "ABC123", status: "ticketed", tickets: ["0651234567890"], total: { amount: 54500, currency: "USD" }, paymentRequiredBy: null, reference: "o1" });
  });
  it("calls Duffel with the token and version, and maps an expired offer to sold out", async () => {
    process.env.DUFFEL_ACCESS_TOKEN = "duffel_test_abc";
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      expect(h.Authorization).toBe("Bearer duffel_test_abc");
      expect(h["Duffel-Version"]).toBe("v2");
      return new Response(JSON.stringify({ errors: [{ code: "offer_no_longer_available", message: "gone" }] }), { status: 422 });
    });
    vi.stubGlobal("fetch", f);
    await expect(duffelSource()!.price("duffel.off_abc~1-0-0", 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
