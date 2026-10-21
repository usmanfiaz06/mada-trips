import { AppError } from "../../http";
import { markedUp, plainHalalas } from "../sell";
import { classOf, hireDays } from "./classes";
import fixtures from "./fixtures.json";
import type { CarBooking, CarHireSearch, CarHireSupplier, CarOffer } from "./types";

/*
 * Mock car hire from fixtures: the cars at the pickup airport, priced per started day with the margin, a young-driver
 * fee at 21–24, nothing under 21, a one-way fee between two airports. Bookings live in memory; a driver named "Sold Out"
 * gets a refusal, for the "car gone" path.
 */

type Car = (typeof fixtures.cars)[number];
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const unb64 = <T>(s: string): T | null => { try { return JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as T; } catch { return null; } };
type Key = { c: string; q: CarHireSearch };

export const CAR_MARKUP_ENV = "APP_CAR_MARKUP_BPS";

function offerOf(car: Car, q: CarHireSearch): CarOffer {
  const days = hireDays(q.pickup.at, q.dropoff.at);
  const oneWay = (q.pickup.place.iata ?? "") !== (q.dropoff.place.iata ?? "") ? 250 : 0;
  const young = q.driverAge < 25 ? 40 * days : 0;
  const net = car.perDay * days + oneWay + young;
  const total = markedUp(net, car.currency, CAR_MARKUP_ENV, 1000);
  const cancelBy = new Date(Date.parse(`${q.pickup.at}Z`) - car.freeCancelHours * 3_600_000).toISOString().slice(0, 16);
  return {
    id: `mock.${b64({ c: car.code, q } satisfies Key)}`, supplier: "mock",
    vendor: { name: car.vendor, logo: null },
    vehicle: { class: classOf(car.acriss), acriss: car.acriss, name: car.name, seats: car.seats, bags: car.bags, doors: car.doors, transmission: car.transmission as "automatic", aircon: true, image: null },
    total: { amount: total, currency: "SAR" }, perDay: { amount: Math.ceil(total / days / 100) * 100, currency: "SAR" }, days,
    net: { amount: net, currency: car.currency },
    deposit: { amount: plainHalalas(car.deposit, car.currency), currency: "SAR" },
    insurance: {
      included: ["Collision damage waiver (CDW)", "Theft protection", "Third-party liability"],
      excess: { amount: plainHalalas(car.excess, car.currency), currency: "SAR" },
      extra: { code: "FULL", name: "Full cover (no excess)", total: { amount: markedUp(car.extraPerDay * days, car.currency, CAR_MARKUP_ENV, 1000), currency: "SAR" } },
    },
    mileage: car.kmPerDay ? { kmPerDay: car.kmPerDay } : "unlimited", fuelPolicy: "full_to_full",
    pickupDesk: { name: `${car.vendor}, ${q.pickup.place.label}`, inTerminal: car.inTerminal },
    crossBorder: car.crossBorder as CarOffer["crossBorder"], freeCancelUntil: cancelBy,
    expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  };
}

const g = globalThis as unknown as { __madaMockCars?: Map<string, CarBooking> };
const bookings = (g.__madaMockCars ??= new Map());
export const clearMockCarBookings = () => bookings.clear();

function decode(offerId: string): { car: Car; q: CarHireSearch } {
  const k = offerId.startsWith("mock.") ? unb64<Key>(offerId.slice(5)) : null;
  const car = k && fixtures.cars.find((c) => c.code === k.c);
  if (!k || !car) throw new AppError("NOT_FOUND");
  return { car, q: k.q };
}

export const mockCarHire: CarHireSupplier = {
  name: "mock",
  async search(q) {
    if (q.driverAge < 21) return [];
    const at = (q.pickup.place.iata ?? "").toUpperCase();
    return fixtures.cars.filter((c) => c.places.includes(at)).map((c) => offerOf(c, q)).sort((a, b) => a.total.amount - b.total.amount);
  },
  async quote(offerId) {
    const { car, q } = decode(offerId);
    return offerOf(car, q);
  },
  async book({ offerId, driver, reference, extraCover }) {
    const had = bookings.get(reference);
    if (had) return had;
    const { car, q } = decode(offerId);
    if (`${driver.givenNames} ${driver.surname}`.toLowerCase() === "sold out") throw new AppError("VALIDATION", { message: "That car has just gone at the desk." });
    const offer = offerOf(car, q);
    const withCover = extraCover && offer.insurance.extra ? { ...offer, total: { amount: offer.total.amount + offer.insurance.extra.total.amount, currency: "SAR" as const } } : offer;
    const b: CarBooking = { id: `MOCKCAR-${(bookings.size + 1).toString().padStart(5, "0")}`, reference, status: "confirmed", offer: withCover, driver: { givenNames: driver.givenNames, surname: driver.surname }, voucherUrl: null };
    bookings.set(reference, b);
    return b;
  },
  async cancel(bookingId, reference) {
    const b = bookings.get(reference);
    if (!b || b.id !== bookingId) throw new AppError("NOT_FOUND");
    const late = b.offer?.freeCancelUntil && new Date().toISOString().slice(0, 16) > b.offer.freeCancelUntil;
    bookings.set(reference, { ...b, status: "cancelled" });
    return { cancelled: true, fee: late && b.offer ? b.offer.perDay : null };
  },
  async status(bookingId, reference) {
    const b = bookings.get(reference);
    if (!b || b.id !== bookingId) throw new AppError("NOT_FOUND");
    return b;
  },
};
