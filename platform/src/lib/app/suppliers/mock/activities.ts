import { createHash } from "node:crypto";
import { MOCK_EXPERIENCES, type Experience } from "@mada/shared";
import type { ActivitiesSupplier } from "../activities-types";

/*
 * Mock bookable experiences (SUPPLIER_MODE_ACTIVITIES=mock): the shared sample for the cities the prototype features,
 * and a guided walk anywhere else. Rates and bookings behave like Hotelbeds' (a rate key per day, a reference back).
 */

const generic = (placeId: string, city: string): Experience[] => [{
  id: `hotelbeds:E-MOCK-${placeId}-WALK`, supplier: "hotelbeds", code: `E-MOCK-${placeId}-WALK`, modality: "STD", title: `${city} old town walk with a guide`,
  summary: "Two hours on foot with a local guide, small group.", image: null, photo: null, priceFrom: { amount: 9500, currency: "SAR" }, durationMin: 120,
  rating: null, reviews: null, family: true, minAge: 0, freeCancel: true,
}];

export const bookedMock = new Map<string, { code: string; from: string; status: "CONFIRMED" | "CANCELLED" }>();

export const mockActivities: ActivitiesSupplier = {
  name: "hotelbeds",
  async search(q) {
    const list = MOCK_EXPERIENCES[q.placeId] ?? generic(q.placeId, q.city);
    const youngest = q.ages.length ? Math.min(...q.ages) : 30;
    return list.filter((e) => e.minAge === null || youngest >= e.minAge).slice(0, q.limit);
  },
  async offers(code, q) {
    const e = Object.values(MOCK_EXPERIENCES).flat().find((x) => x.code === code);
    const people = Math.max(1, q.ages.length || 2);
    const each = e?.priceFrom.amount ?? 9500;
    return [{ code, modality: q.modality ?? "STD", modalityName: "Standard", rateKey: `mock-${code}-${q.from}`, from: q.from, to: q.to, sell: each * people, net: { amount: Math.round((each * people) / 100 / 4.5), currency: "EUR" }, freeCancelUntil: q.from }];
  },
  async book(b) {
    const reference = `MOCK-${createHash("sha256").update(`${b.rateKey}:${b.clientReference}`).digest("hex").slice(0, 8).toUpperCase()}`;
    bookedMock.set(reference, { code: b.rateKey, from: b.from, status: "CONFIRMED" });
    return { reference, status: "CONFIRMED", total: { amount: 52.5, currency: "EUR" } };
  },
  async cancel(reference, simulate) {
    const b = bookedMock.get(reference);
    if (b && !simulate) b.status = "CANCELLED";
    return { amount: 0, currency: "EUR" };
  },
};
