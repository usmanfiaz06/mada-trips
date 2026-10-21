import { afterEach, describe, expect, it, vi } from "vitest";
import { carHire, type CarHireSearch } from "@/lib/app/suppliers/car-hire";
import { availRequest, parseAvail } from "@/lib/app/suppliers/car-hire/cartrawler";
import { classOf, hireDays } from "@/lib/app/suppliers/car-hire/classes";
import { clearMockCarBookings } from "@/lib/app/suppliers/car-hire/mock";
import { resetBreakers } from "@/lib/app/resilience/breaker";

/* Car hire (CarTrawler behind `carHire`): the switch, the fixtures, book/cancel/status, and the OTA parser. */

const RUH = { iata: "RUH", label: "King Khalid International", countryCode: "SA" };
const DMM = { iata: "DMM", label: "King Fahd International", countryCode: "SA" };
const q = (over: Partial<CarHireSearch> = {}): CarHireSearch => ({ pickup: { place: RUH, at: "2027-02-10T10:00" }, dropoff: { place: RUH, at: "2027-02-14T10:00" }, driverAge: 35, residence: "SA", ...over });
const driver = { givenNames: "Faisal", surname: "Alharbi", email: "f@example.com", phone: "+966500000001", age: 35, licenceCountry: "SA" };

afterEach(() => {
  for (const k of ["SUPPLIER_MODE_CAR_HIRE", "CARTRAWLER_CLIENT_ID", "VERCEL_ENV", "APP_CAR_MARKUP_BPS"]) delete process.env[k];
  vi.unstubAllGlobals();
  clearMockCarBookings();
  resetBreakers();
});

describe("switch", () => {
  it("mock in development, CarTrawler with the client id, NOT_CONFIGURED when off", () => {
    expect(carHire().name).toBe("mock");
    process.env.CARTRAWLER_CLIENT_ID = "123456";
    expect(carHire().name).toBe("cartrawler");
    delete process.env.CARTRAWLER_CLIENT_ID;
    process.env.VERCEL_ENV = "production";
    expect(() => carHire()).toThrow(expect.objectContaining({ code: "NOT_CONFIGURED" }));
  });
});

describe("mock car hire", () => {
  it("lists the cars at the airport, cheapest first, with deposit, insurance and class", async () => {
    const cars = await carHire().search(q());
    expect(cars.map((c) => c.vendor.name)).toEqual(["Yelo", "Budget", "Theeb", "Hertz", "Sixt"]);
    const yelo = cars[0]!;
    expect(yelo).toMatchObject({ days: 4, vehicle: { class: "economy", seats: 5, transmission: "automatic" }, deposit: { amount: 100000, currency: "SAR" }, mileage: "unlimited", crossBorder: "not_allowed" });
    // 4 × SAR 115 = 460 net, +10% → SAR 506.
    expect(yelo.total).toEqual({ amount: 50600, currency: "SAR" });
    expect(yelo.insurance.excess).toEqual({ amount: 250000, currency: "SAR" });
    expect(yelo.insurance.extra!.total.amount).toBeGreaterThan(0);
    expect(cars.find((c) => c.vendor.name === "Theeb")!.vehicle.class).toBe("suv");
    expect(cars.find((c) => c.vendor.name === "Hertz")!.vehicle.class).toBe("van");
  });
  it("charges one-way and young drivers, and has nothing under 21", async () => {
    const base = (await carHire().search(q()))[0]!.total.amount;
    const oneWay = (await carHire().search(q({ dropoff: { place: DMM, at: "2027-02-14T10:00" } })))[0]!.total.amount;
    const young = (await carHire().search(q({ driverAge: 22 })))[0]!.total.amount;
    expect(oneWay).toBeGreaterThan(base);
    expect(young).toBeGreaterThan(base);
    expect(await carHire().search(q({ driverAge: 19 }))).toEqual([]);
  });
  it("quotes, books once per reference, reads status and cancels", async () => {
    const [car] = await carHire().search(q());
    expect((await carHire().quote(car!.id)).total).toEqual(car!.total);
    const b = await carHire().book({ offerId: car!.id, driver, reference: "order-1", extraCover: true });
    expect(b).toMatchObject({ status: "confirmed", reference: "order-1" });
    expect(b.offer!.total.amount).toBe(car!.total.amount + car!.insurance.extra!.total.amount);
    expect((await carHire().book({ offerId: car!.id, driver, reference: "order-1" })).id).toBe(b.id);
    expect((await carHire().status(b.id, "order-1")).status).toBe("confirmed");
    expect(await carHire().cancel(b.id, "order-1")).toEqual({ cancelled: true, fee: null });
    expect((await carHire().status(b.id, "order-1")).status).toBe("cancelled");
    await expect(carHire().book({ offerId: car!.id, driver: { ...driver, givenNames: "Sold", surname: "Out" }, reference: "order-2" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(carHire().quote("mock.nonsense")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("CarTrawler OTA", () => {
  it("reads ACRISS codes and rental days", () => {
    expect(["ECAR", "IFAR", "PVAR", "LDAR", "XXAR"].map(classOf)).toEqual(["economy", "suv", "van", "luxury", "special"]);
    expect(hireDays("2027-02-10T10:00", "2027-02-14T10:00")).toBe(4);
    expect(hireDays("2027-02-10T10:00", "2027-02-14T10:30")).toBe(4);
    expect(hireDays("2027-02-10T10:00", "2027-02-14T12:00")).toBe(5);
  });
  it("builds OTA_VehAvailRateRQ with our client id", () => {
    const r = availRequest(q(), "999");
    expect(r.POS.Source.RequestorID).toEqual({ "@Type": "16", "@ID": "999", "@ID_Context": "CARTRAWLER" });
    expect(r.VehAvailRQCore.VehRentalCore).toMatchObject({ "@PickUpDateTime": "2027-02-10T10:00:00", PickUpLocation: { "@LocationCode": "RUH" } });
  });
  it("parses an availability answer, leaving out cars it can't read", () => {
    const rs = { VehAvailRSCore: { VehVendorAvails: { VehVendorAvail: [{
      Vendor: { "@CompanyShortName": "Budget" }, Info: { LocationDetails: { "@Name": "Budget RUH T5", "@AtAirport": "true" } },
      VehAvails: { VehAvail: [
        { VehAvailCore: { "@Status": "Available", Vehicle: { "@PassengerQuantity": "5", "@BaggageQuantity": "3", "@TransmissionType": "Automatic", "@AirConditionInd": "true", VehMakeModel: { "@Name": "Toyota Camry", "@Code": "IDAR" } },
          RentalRate: { RateDistance: { "@Unlimited": "true" } }, TotalCharge: { "@RateTotalAmount": "700.00", "@CurrencyCode": "SAR" }, Reference: { "@Type": "16", "@ID": "REF1", "@ID_Context": "CARTRAWLER" },
          TPA_Extensions: { Deposit: { "@Amount": "1500" }, "@CrossBorder": "true", "@FuelPolicy": "FullToFull" } },
          VehAvailInfo: { PricedCoverages: { PricedCoverage: [{ Coverage: { "@CoverageType": "CDW", Details: { "@Amount": "3000" } }, Charge: { "@IncludedInRate": "true" } }] } } },
        { VehAvailCore: { "@Status": "Available", Vehicle: {}, TotalCharge: {} } },
      ] } }] } } };
    const [o, ...rest] = parseAvail(rs, q());
    expect(rest).toEqual([]);
    expect(o).toMatchObject({ supplier: "cartrawler", vendor: { name: "Budget" }, vehicle: { class: "intermediate", name: "Toyota Camry or similar", seats: 5 }, total: { amount: 77000 }, deposit: { amount: 150000 },
      insurance: { included: ["CDW"], excess: { amount: 300000 } }, crossBorder: "allowed", fuelPolicy: "full_to_full", pickupDesk: { name: "Budget RUH T5", inTerminal: true } });
    expect(o!.id.startsWith("cartrawler.")).toBe(true);
  });
  it("searches through fetch with the client id, and a refusal is VALIDATION", async () => {
    process.env.CARTRAWLER_CLIENT_ID = "777";
    const f = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toContain("OTA_VehAvailRateRQ");
      expect(String(init.body)).toContain("\"777\"");
      return new Response(JSON.stringify({ Errors: { Error: [{ "@ShortText": "Location not served" }] } }), { status: 200 });
    });
    vi.stubGlobal("fetch", f);
    await expect(carHire().search(q())).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
