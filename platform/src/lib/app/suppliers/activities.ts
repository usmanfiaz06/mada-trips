import "server-only";
import { supplierMode } from "../config";
import { guarded } from "../resilience/breaker";
import type { ActivitiesSupplier } from "./activities-types";
import { hotelbedsActivities } from "./hotelbeds/activities";
import { mockActivities } from "./mock/activities";
import { getYourGuide } from "./live/getyourguide";
import { viator } from "./live/viator";

export type * from "./activities-types";

/*
 * Bookable experiences, in order: Hotelbeds Activities (SUPPLIER_MODE_ACTIVITIES=live, HOTELBEDS_ACTIVITIES_API_KEY /
 * HOTELBEDS_ACTIVITIES_SECRET, HOTELBEDS_ENV), then GetYourGuide (GYG_PARTNER_TOKEN) and Viator (VIATOR_API_KEY) when
 * their keys are set. Mock mode: one mock that behaves like Hotelbeds.
 */
export function activitySuppliers(): ActivitiesSupplier[] {
  if (supplierMode("activities") !== "live") return [mockActivities];
  const out: ActivitiesSupplier[] = [guarded("activities", hotelbedsActivities())];
  if (process.env.GYG_PARTNER_TOKEN) out.push(guarded("activities", getYourGuide(process.env.GYG_PARTNER_TOKEN)));
  if (process.env.VIATOR_API_KEY) out.push(guarded("activities", viator(process.env.VIATOR_API_KEY)));
  return out;
}

/** The supplier the desk books a Hotelbeds activity with (mock in mock mode). */
export function hotelbedsActivitiesSupplier(): ActivitiesSupplier {
  return supplierMode("activities") === "live" ? guarded("activities", hotelbedsActivities()) : mockActivities;
}
