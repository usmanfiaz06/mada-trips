import { AppError } from "../../http";
import { requireEnv } from "../live/not-configured";
import { markedUp, plainHalalas } from "../sell";
import { classOf, hireDays } from "./classes";
import { CAR_MARKUP_ENV } from "./mock";
import type { CarBooking, CarHireSearch, CarHireSupplier, CarOffer } from "./types";

/*
 * CarTrawler OTA (OpenTravel Alliance 2008A vehicle messages, as JSON): OTA_VehAvailRateRQ (search), OTA_VehResRQ
 * (book), OTA_VehCancelRQ (cancel), OTA_VehRetResRQ (status). Every request carries our client ID in POS.
 *   CARTRAWLER_CLIENT_ID   the client ID CarTrawler issues (RequestorID ID, ID_Context "CARTRAWLER")
 *   CARTRAWLER_ENV         test | live (test: CarTrawler's external test host; nothing is really booked)
 *   CARTRAWLER_BASE_URL    overrides the host if CarTrawler gives us another one
 * Confirmed from the OTA standard: the message names and their elements. Assumed until CarTrawler issues access: the
 * hosts below, JSON with "@" attributes, and the TPA_Extensions they use for deposit and cross-border. The parser is
 * tolerant: a car it can't read is left out, never shown half-filled.
 */

const HOSTS = { test: "https://external-dev.cartrawler.com/cartrawlerota/json", live: "https://otageo.cartrawler.com/cartrawlerota/json" };
const base = () => process.env.CARTRAWLER_BASE_URL || HOSTS[process.env.CARTRAWLER_ENV === "live" ? "live" : "test"];

const pos = (clientId: string) => ({ Source: { "@ERSP_UserID": "MP", "@ISOCurrency": "SAR", RequestorID: { "@Type": "16", "@ID": clientId, "@ID_Context": "CARTRAWLER" } } });
const location = (p: CarHireSearch["pickup"]["place"]) => (p.iata ? { "@CodeContext": "IATA", "@LocationCode": p.iata } : { "@CodeContext": "CARTRAWLER", "@Latitude": p.lat, "@Longitude": p.lng });

export function availRequest(q: CarHireSearch, clientId: string) {
  return {
    "@Version": "1.005", "@Target": process.env.CARTRAWLER_ENV === "live" ? "Production" : "Test", "@PrimaryLangID": q.language === "ar" ? "AR" : "EN",
    POS: pos(clientId),
    VehAvailRQCore: {
      "@Status": "Available",
      VehRentalCore: { "@PickUpDateTime": `${q.pickup.at}:00`, "@ReturnDateTime": `${q.dropoff.at}:00`, PickUpLocation: location(q.pickup.place), ReturnLocation: location(q.dropoff.place) },
      DriverType: { "@Age": q.driverAge },
    },
    VehAvailRQInfo: { Customer: { Primary: { CitizenCountryName: { "@Code": q.residence } } } },
  };
}

type Attr = Record<string, unknown>;
const arr = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const unb64 = <T>(s: string): T | null => { try { return JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as T; } catch { return null; } };

/** What an offer id carries: CarTrawler's reference for the rate, and the search to price it again. */
type Key = { r: { type: string; id: string; context: string; dateTime?: string | null; url?: string | null }; q: CarHireSearch };

export function parseAvail(data: unknown, q: CarHireSearch): CarOffer[] {
  const core = (data as { VehAvailRSCore?: { VehVendorAvails?: Attr } })?.VehAvailRSCore;
  const out: CarOffer[] = [];
  const days = hireDays(q.pickup.at, q.dropoff.at);
  for (const vv of arr((core?.VehVendorAvails as { VehVendorAvail?: Attr[] } | undefined)?.VehVendorAvail)) {
    const vendor = vv.Vendor as Attr | undefined;
    const vendorName = str(vendor?.["@CompanyShortName"]) ?? str(vendor?.["#text"]);
    const desk = vv.Info as Attr | undefined;
    for (const va of arr((vv.VehAvails as { VehAvail?: Attr[] } | undefined)?.VehAvail)) {
      const c = va.VehAvailCore as Attr | undefined;
      if (!c || (str(c["@Status"]) ?? "Available") !== "Available") continue;
      const v = (c.Vehicle ?? {}) as Attr;
      const total = (c.TotalCharge ?? {}) as Attr;
      const ref = (c.Reference ?? {}) as Attr;
      const amount = num(total["@RateTotalAmount"]) ?? num(total["@EstimatedTotalAmount"]);
      const currency = str(total["@CurrencyCode"]);
      const name = str((v.VehMakeModel as Attr | undefined)?.["@Name"]);
      const refId = str(ref["@ID"]);
      if (!vendorName || amount === null || !currency || !name || !refId) continue;
      const acriss = str((v.VehMakeModel as Attr | undefined)?.["@Code"]) ?? str(v["@Code"]);
      const tpa = (c.TPA_Extensions ?? {}) as Attr;
      const deposit = num((tpa.Deposit as Attr | undefined)?.["@Amount"]);
      const coverages = arr(((va.VehAvailInfo as Attr | undefined)?.PricedCoverages as { PricedCoverage?: Attr[] } | undefined)?.PricedCoverage);
      const included = coverages.filter((p) => (p.Charge as Attr | undefined)?.["@IncludedInRate"] === "true" || (p.Charge as Attr | undefined)?.["@IncludedInRate"] === true)
        .map((p) => str((p.Coverage as Attr | undefined)?.["@CoverageType"]) ?? "").filter(Boolean);
      const excess = coverages.map((p) => num(((p.Coverage as Attr | undefined)?.Details as Attr | undefined)?.["@Amount"] ?? (p.Deductible as Attr | undefined)?.["@Amount"])).find((x) => x !== null) ?? null;
      const rate = (c.RentalRate ?? {}) as Attr;
      const dist = (rate.RateDistance ?? {}) as Attr;
      const unlimited = dist["@Unlimited"] === "true" || dist["@Unlimited"] === true;
      const kmPerDay = num(dist["@Quantity"]);
      const sell = markedUp(amount, currency, CAR_MARKUP_ENV, 1000);
      const xb = str(tpa["@CrossBorder"] ?? (tpa.CrossBorder as Attr | undefined)?.["@Allowed"]);
      out.push({
        id: `cartrawler.${b64({ r: { type: str(ref["@Type"]) ?? "16", id: refId, context: str(ref["@ID_Context"]) ?? "CARTRAWLER", dateTime: str(ref["@DateTime"]), url: str(ref["@URL"]) }, q } satisfies Key)}`,
        supplier: "cartrawler",
        vendor: { name: vendorName, logo: str(vendor?.["@LogoURL"]) },
        vehicle: {
          class: classOf(acriss), acriss, name: /similar/i.test(name) ? name : `${name} or similar`, seats: num(v["@PassengerQuantity"]), bags: num(v["@BaggageQuantity"]),
          doors: num(v["@DoorCount"]), transmission: str(v["@TransmissionType"])?.toLowerCase() === "manual" ? "manual" : "automatic",
          aircon: v["@AirConditionInd"] !== "false" && v["@AirConditionInd"] !== false, image: str(v.PictureURL)?.startsWith("https://") ? str(v.PictureURL) : null,
        },
        total: { amount: sell, currency: "SAR" }, perDay: { amount: Math.ceil(sell / days / 100) * 100, currency: "SAR" }, days, net: { amount, currency },
        deposit: deposit !== null ? { amount: plainHalalas(deposit, currency), currency: "SAR" } : null,
        insurance: { included, excess: excess !== null ? { amount: plainHalalas(excess, currency), currency: "SAR" } : null, extra: null },
        mileage: unlimited || kmPerDay === null ? "unlimited" : { kmPerDay },
        fuelPolicy: /full/i.test(str(tpa["@FuelPolicy"]) ?? "") ? "full_to_full" : /same/i.test(str(tpa["@FuelPolicy"]) ?? "") ? "same_to_same" : /pre/i.test(str(tpa["@FuelPolicy"]) ?? "") ? "prepaid" : "other",
        pickupDesk: { name: str((desk?.LocationDetails as Attr | undefined)?.["@Name"]) ?? `${vendorName}, ${q.pickup.place.label}`, inTerminal: /terminal/i.test(str((desk?.LocationDetails as Attr | undefined)?.["@AtAirport"]) ?? "") || (desk?.LocationDetails as Attr | undefined)?.["@AtAirport"] === "true" },
        crossBorder: xb === "true" ? "allowed" : xb === "false" ? "not_allowed" : "unknown",
        freeCancelUntil: str(tpa["@FreeCancellationUntil"]),
        expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
      });
    }
  }
  return out.sort((a, b) => a.total.amount - b.total.amount);
}

async function post(type: string, body: unknown): Promise<Attr> {
  const res = await fetch(`${base()}?type=${type}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(18_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`cartrawler answered ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text) as Attr;
  const errs = arr((json.Errors as { Error?: Attr[] } | undefined)?.Error);
  if (errs.length) throw new AppError("VALIDATION", { message: str(errs[0]!["@ShortText"]) ?? str(errs[0]!["#text"]) ?? "CarTrawler refused the request." });
  return json;
}

const keyOf = (offerId: string) => {
  const k = offerId.startsWith("cartrawler.") ? unb64<Key>(offerId.slice(11)) : null;
  if (!k?.r?.id) throw new AppError("NOT_FOUND");
  return k;
};

function bookingOf(rs: Attr, reference: string, offer: CarOffer | null, driver: CarBooking["driver"]): CarBooking {
  const core = ((rs.VehResRSCore ?? rs.VehRetResRSCore ?? rs.VehCancelRSCore) ?? {}) as Attr;
  const res = (core.VehReservation ?? {}) as Attr;
  const conf = arr(((res.VehSegmentCore as Attr | undefined)?.ConfID) as Attr | Attr[] | undefined).find((c) => str(c["@ID"]));
  const status = str(res["@ReservationStatus"] ?? core["@CancelStatus"])?.toLowerCase() ?? "";
  return {
    id: str(conf?.["@ID"]) ?? "", reference, offer, driver,
    status: /cancel/.test(status) ? "cancelled" : /pend|request/.test(status) ? "pending" : "confirmed",
    voucherUrl: str(((res.VehSegmentInfo as Attr | undefined)?.TPA_Extensions as Attr | undefined)?.["@VoucherURL"]),
  };
}

export const carTrawler: CarHireSupplier = {
  name: "cartrawler",
  async search(q) {
    const { CARTRAWLER_CLIENT_ID: id } = requireEnv("car hire (CarTrawler)", ["CARTRAWLER_CLIENT_ID"]);
    return parseAvail(await post("OTA_VehAvailRateRQ", availRequest(q, id)), q);
  },
  async quote(offerId) {
    const k = keyOf(offerId);
    const again = await this.search(k.q);
    const same = again.find((o) => keyOf(o.id).r.id === k.r.id);
    if (!same) throw new AppError("NOT_FOUND", { message: "That car isn't available any more." });
    return same;
  },
  async book({ offerId, driver, reference, flightNumber }) {
    const { CARTRAWLER_CLIENT_ID: id } = requireEnv("car hire (CarTrawler)", ["CARTRAWLER_CLIENT_ID"]);
    const k = keyOf(offerId);
    const offer = await this.quote(offerId);
    const rs = await post("OTA_VehResRQ", {
      "@Version": "1.005", "@Target": process.env.CARTRAWLER_ENV === "live" ? "Production" : "Test", POS: pos(id),
      VehResRQCore: {
        "@Status": "All",
        VehRentalCore: { "@PickUpDateTime": `${k.q.pickup.at}:00`, "@ReturnDateTime": `${k.q.dropoff.at}:00`, PickUpLocation: location(k.q.pickup.place), ReturnLocation: location(k.q.dropoff.place) },
        Customer: { Primary: { PersonName: { GivenName: driver.givenNames, Surname: driver.surname }, Telephone: { "@PhoneNumber": driver.phone }, Email: driver.email, CitizenCountryName: { "@Code": driver.licenceCountry } } },
        DriverType: { "@Age": driver.age },
      },
      VehResRQInfo: {
        ...(flightNumber ? { ArrivalDetails: { "@TransportationCode": "14", "@Number": flightNumber } } : {}),
        Reference: { "@Type": k.r.type, "@ID": k.r.id, "@ID_Context": k.r.context, ...(k.r.dateTime ? { "@DateTime": k.r.dateTime } : {}), ...(k.r.url ? { "@URL": k.r.url } : {}) },
        // Our order id: CarTrawler keeps it, and status looks it up, so a lost answer never books twice.
        TPA_Extensions: { ConsumerReference: { "@ID": reference } },
      },
    });
    const b = bookingOf(rs, reference, offer, { givenNames: driver.givenNames, surname: driver.surname });
    if (!b.id) throw new Error("cartrawler answered a booking without a confirmation number");
    return b;
  },
  async cancel(bookingId, reference) {
    const { CARTRAWLER_CLIENT_ID: id } = requireEnv("car hire (CarTrawler)", ["CARTRAWLER_CLIENT_ID"]);
    const rs = await post("OTA_VehCancelRQ", { "@Version": "1.005", POS: pos(id), VehCancelRQCore: { "@CancelType": "Book", UniqueID: { "@Type": "14", "@ID": bookingId } }, VehCancelRQInfo: { TPA_Extensions: { ConsumerReference: { "@ID": reference } } } });
    const core = (rs.VehCancelRSCore ?? {}) as Attr;
    const fee = num(((core.CancelRules as Attr | undefined)?.CancelRule as Attr | undefined)?.["@Amount"]);
    const cur = str(((core.CancelRules as Attr | undefined)?.CancelRule as Attr | undefined)?.["@CurrencyCode"]) ?? "SAR";
    return { cancelled: /cancel/i.test(str(core["@CancelStatus"]) ?? ""), fee: fee ? { amount: plainHalalas(fee, cur), currency: "SAR" } : null };
  },
  async status(bookingId, reference) {
    const { CARTRAWLER_CLIENT_ID: id } = requireEnv("car hire (CarTrawler)", ["CARTRAWLER_CLIENT_ID"]);
    const rs = await post("OTA_VehRetResRQ", { "@Version": "1.005", POS: pos(id), VehRetResRQCore: { UniqueID: { "@Type": "14", "@ID": bookingId } } });
    const b = bookingOf(rs, reference, null, { givenNames: "", surname: "" });
    return { ...b, id: b.id || bookingId };
  },
};
