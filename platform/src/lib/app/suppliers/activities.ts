import "server-only";
import type { Experience } from "@mada/shared";
import { keyedExplicit, keyedMode, supplierMode } from "../config";
import { guarded } from "../resilience/breaker";
import type { ActivitiesSupplier } from "./activities-types";
import { hotelbedsActivities } from "./hotelbeds/activities";
import { mockActivities } from "./mock/activities";
import { getYourGuide } from "./live/getyourguide";
import { viator } from "./live/viator";
import { klook } from "./klook/klook";
import { mockKlook } from "./klook/mock";

export type * from "./activities-types";

/*
 * Bookable experiences, in order: Hotelbeds Activities (SUPPLIER_MODE_ACTIVITIES=live, HOTELBEDS_ACTIVITIES_API_KEY /
 * HOTELBEDS_ACTIVITIES_SECRET, HOTELBEDS_ENV), then GetYourGuide (GYG_PARTNER_TOKEN) and Viator (VIATOR_API_KEY) when
 * their keys are set. Mock mode: one mock that behaves like Hotelbeds. Klook joins either way when its own switch is
 * on (KLOOK_API_KEY, or SUPPLIER_MODE_KLOOK=mock for its fixtures), behind its own "klook" breaker.
 */
export function activitySuppliers(): ActivitiesSupplier[] {
  const out: ActivitiesSupplier[] = [];
  if (supplierMode("activities") !== "live") out.push(mockActivities);
  else {
    out.push(guarded("activities", hotelbedsActivities()));
    if (process.env.GYG_PARTNER_TOKEN) out.push(guarded("activities", getYourGuide(process.env.GYG_PARTNER_TOKEN)));
    if (process.env.VIATOR_API_KEY) out.push(guarded("activities", viator(process.env.VIATOR_API_KEY)));
  }
  const k = keyedMode("klook");
  if (k === "live" && process.env.KLOOK_API_KEY) out.push(guarded("klook", klook(process.env.KLOOK_API_KEY)));
  else if (k === "mock" && keyedExplicit("klook")) out.push(mockKlook);
  return out;
}

const words = (t: string) => new Set(t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const STOP = new Set(["the", "and", "with", "ticket", "tickets", "tour", "admission", "entry", "from"]);
/** Two titles that name the same thing ("Burj Khalifa: At the Top, levels 124 and 125" / "Burj Khalifa At the Top tickets…"). */
export function sameExperience(a: string, b: string): boolean {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return false;
  const both = [...x].filter((w) => y.has(w)).length;
  return both / Math.min(x.size, y.size) >= 0.75;
}

/** Ratings pulled towards 4.2 until there are enough reviews to trust them (50 reviews weigh as much as the prior). */
export const experienceScore = (e: Experience) => {
  const r = e.rating ?? 4.2, n = e.reviews ?? 0;
  return (r * n + 4.2 * 50) / (n + 50) + (e.freeCancel ? 0.05 : 0);
};

/**
 * Every supplier's experiences as one list: the same product from two suppliers once (the cheaper), then best first
 * (the review-weighted rating), cheaper first on a tie.
 */
export function rankExperiences(list: Experience[]): Experience[] {
  const kept: Experience[] = [];
  for (const e of [...list].sort((a, b) => a.priceFrom.amount - b.priceFrom.amount)) {
    if (!kept.some((k) => k.supplier !== e.supplier && sameExperience(k.title, e.title))) kept.push(e);
  }
  return kept.sort((a, b) => experienceScore(b) - experienceScore(a) || a.priceFrom.amount - b.priceFrom.amount);
}

/** The supplier the desk books a Hotelbeds activity with (mock in mock mode). */
export function hotelbedsActivitiesSupplier(): ActivitiesSupplier {
  return supplierMode("activities") === "live" ? guarded("activities", hotelbedsActivities()) : mockActivities;
}
