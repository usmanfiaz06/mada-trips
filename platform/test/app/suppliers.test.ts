import { afterEach, describe, expect, it } from "vitest";
import { FlightOffer, HotelOffer } from "@mada/shared";
import { suppliers, outbox } from "@/lib/app/suppliers";
import { decryptField, encryptField } from "@/lib/app/crypto";
import { supplierMode } from "@/lib/app/config";

describe("supplier selection", () => {
  afterEach(() => { delete process.env.SUPPLIER_MODE_SMS; delete process.env.VERCEL_ENV; delete process.env.APP_ALLOW_MOCKS; });
  it("is per supplier", () => {
    expect(suppliers.sms().name).toBe("mock-sms");
    process.env.SUPPLIER_MODE_SMS = "live";
    expect(suppliers.sms().name).toBe("unifonic");
    expect(suppliers.flights().name).toBe("mock-flights");
  });
  it("refuses mocks on a production deployment unless allowed", () => {
    process.env.VERCEL_ENV = "production";
    expect(() => supplierMode("sms")).toThrow(/mock mode on a production/);
    process.env.APP_ALLOW_MOCKS = "yes";
    expect(supplierMode("sms")).toBe("mock");
  });
  it("live adapters without credentials answer NOT_CONFIGURED", async () => {
    process.env.SUPPLIER_MODE_SMS = "live";
    await expect(suppliers.sms().send("+966500004127", "x")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});

describe("mock flights", () => {
  it("returns the prototype's three Istanbul options", async () => {
    const offers = await suppliers.flights().search({ from: "RUH", to: "IST", depart: "2027-03-09", return: "2027-03-15", adults: 4 });
    expect(offers.map((o) => FlightOffer.parse(o))).toHaveLength(3);
    const best = offers[0]!;
    expect(best).toMatchObject({ label: "best", reason: "Direct. Lands before check-in.", total: { amount: 864000, currency: "SAR" }, pricePerPerson: { amount: 216000 } });
    expect(best.out[0]).toMatchObject({ flightNumber: "SV263", from: "RUH", to: "IST", departLocal: "2027-03-09T09:40", arriveLocal: "2027-03-09T13:55", departTz: "Asia/Riyadh", arriveTz: "Europe/Istanbul" });
    expect(best.back[0]).toMatchObject({ flightNumber: "SV264", from: "IST", to: "RUH" });
    expect(offers.map((o) => o.out[0]!.flightNumber)).toEqual(["SV263", "XY125", "TK141"]);
  });
  it("covers the edge cases", async () => {
    expect(await suppliers.flights().search({ from: "RUH", to: "XXX", depart: "2027-03-09", return: null, adults: 1 })).toEqual([]);
    await expect(suppliers.flights().search({ from: "RUH", to: "ERR", depart: "2027-03-09", return: null, adults: 1 })).rejects.toThrow(/not answering/);
    const up = await suppliers.flights().price("mock-sv263-2027-03-09-2027-03-15-4-up", 4);
    expect(up.total.amount).toBe(878000); // SAR 8,780: "the price went up SAR 140"
    const hold = await suppliers.flights().hold("mock-sv263-2027-03-09-2027-03-15-4", [{ givenNames: "Omar", surname: "Alharbi" }]);
    expect(hold.pnr).toBe("X7K2QD");
    const jed = await suppliers.flights().search({ from: "RUH", to: "JED", depart: "2027-03-09", return: null, adults: 1 });
    expect(jed.length).toBeGreaterThan(0);
  });
});

describe("other mocks", () => {
  it("hotels: rooms near Galata Tower", async () => {
    const h = await suppliers.hotels().search({ city: "Istanbul", checkIn: "2027-03-09", nights: 6, adults: 4, rooms: 1 });
    expect(h.map((x) => HotelOffer.parse(x).name)).toEqual(["Rooms near Galata Tower", "Garden hotel in Sultanahmet", "Bosphorus view rooms"]);
    expect(h[0]!.total.amount).toBe(588000);
    expect(h[0]!.freeCancelUntil).toBe("2027-03-03");
  });
  it("payments: authorise, capture, refund, decline, idempotency", async () => {
    const pay = suppliers.payments();
    const a = await pay.authorize({ amount: 864000, method: "card", token: "tok_visa", idempotencyKey: "k1", description: "Istanbul" });
    expect(a.status).toBe("authorized");
    expect(await pay.authorize({ amount: 864000, method: "card", token: "tok_visa", idempotencyKey: "k1", description: "Istanbul" })).toEqual(a);
    expect((await pay.capture(a.providerRef)).status).toBe("captured");
    expect((await pay.refund(a.providerRef, 64000, "r1")).status).toBe("partially_refunded");
    expect((await pay.authorize({ amount: 100, method: "card", token: "tok_decline", idempotencyKey: "k2", description: "x" })).status).toBe("declined");
    const f = await pay.authorize({ amount: 100, method: "card", token: "tok_fail_capture", idempotencyKey: "k3", description: "x" });
    expect((await pay.capture(f.providerRef)).status).toBe("failed");
    expect((await pay.void(f.providerRef)).status).toBe("voided");
  });
  it("flight status: SV263 at gate B12", async () => {
    expect(await suppliers.flightStatus().lookup("SV 263", "2027-03-09")).toMatchObject({ from: "RUH", to: "IST", gate: "B12", terminal: "Terminal 3" });
    expect(await suppliers.flightStatus().lookup("nonsense", "2027-03-09")).toBeNull();
  });
  it("messaging and the concierge stand-in", async () => {
    await suppliers.whatsapp().sendTemplate("+966500004127", "booking_confirmed", ["Istanbul", "X7K2QD"]);
    expect(outbox[0]).toMatchObject({ channel: "whatsapp" });
    const i = await suppliers.ai().parseIntent("Istanbul for Eid, 4 of us", { today: "2026-10-10", home: "RUH" });
    expect(i).toMatchObject({ kind: "flight", to: "IST", from: "RUH", depart: "2027-03-09", travellers: 4, ask: null });
    expect((await suppliers.ai().parseIntent("somewhere warm", { today: "2026-10-10", home: "RUH" })).kind).toBe("general");
  });
});

describe("field encryption", () => {
  afterEach(() => { delete process.env.APP_DATA_KEYS_OLD; });
  it("round-trips, detects tampering and survives key rotation", () => {
    const ct = encryptField("A08493141", "aad");
    expect(decryptField(ct, "aad")).toBe("A08493141");
    const parts = ct.split(".");
    parts[4] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptField(parts.join("."), "aad")).toThrow();
    expect(encryptField("A08493141", "aad")).not.toBe(ct); // random IV

    const oldKey = process.env.APP_DATA_KEY!;
    process.env.APP_DATA_KEY = Buffer.alloc(32, 9).toString("base64");
    process.env.APP_DATA_KEYS_OLD = oldKey;
    try {
      expect(decryptField(ct, "aad")).toBe("A08493141");
    } finally {
      process.env.APP_DATA_KEY = oldKey;
    }
  });
});
