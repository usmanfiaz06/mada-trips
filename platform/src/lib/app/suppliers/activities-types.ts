import type { Experience } from "@mada/shared";

/*
 * Bookable experiences (tours, tickets, classes) from partners. Hotelbeds Activities is the primary supplier;
 * GetYourGuide and Viator are optional (only when their keys are set). For the beta every booking goes through the
 * desk: the app's "Book with Mada" makes a request carrying the supplier code (and, for Hotelbeds, the modality), and
 * the desk books it — on Hotelbeds in one step ("Book on Hotelbeds", desk/activity.ts). Nobody is sent to a partner's
 * own site.
 */

export const EXPERIENCE_SUPPLIERS = ["hotelbeds", "getyourguide", "viator", "klook"] as const;
export type ExperienceSupplier = (typeof EXPERIENCE_SUPPLIERS)[number];

/**
 * An experience as the server knows it: the shared Experience plus the partner, its product code and (Hotelbeds) the
 * modality. The app gets the shared shape only, with an opaque id (lib/app/shield.ts seals "<supplier>:<code>").
 */
export type SupplierExperience = Experience & {
  supplier: ExperienceSupplier;
  /** The supplier's own code for the product (Hotelbeds activity code, GYG tour id, Viator product code). */
  code: string;
  /** Hotelbeds: the modality we'd book (cheapest that fits), so the desk can book it in one step. */
  modality: string | null;
};

export type ActivitySearch = {
  placeId: string; city: string; countryCode: string; lat: number; lon: number;
  /** The days to look at (a trip's days, or today and the next 6). */
  from: string; to: string;
  /** Everyone going: adults count as 30. */
  ages: number[];
  language: "en" | "ar";
  limit: number;
};

/** One bookable rate: what the desk confirms with. Hotelbeds rate keys last 30 minutes and work once. */
export type ActivityOffer = {
  code: string; modality: string; modalityName: string; rateKey: string; from: string; to: string;
  /** What the traveller pays, in halalas (converted, with Mada's margin, rounded up to a riyal). */
  sell: number;
  net: { amount: number; currency: string };
  freeCancelUntil: string | null;
};

export type ActivityHolder = { name: string; surname: string; email: string; country: string };
export type ActivityPax = { age: number; name: string; surname: string; type: "ADULT" | "CHILD" };
export type ActivityBooking = { reference: string; status: "CONFIRMED" | "CANCELLED"; total: { amount: number; currency: string } };

export interface ActivitiesSupplier {
  readonly name: ExperienceSupplier;
  search(q: ActivitySearch): Promise<SupplierExperience[]>;
  /** Rates for one product on a day (Hotelbeds detail). */
  offers?(code: string, q: { from: string; to: string; ages: number[]; language: "en" | "ar"; modality?: string | null }): Promise<ActivityOffer[]>;
  /** Confirm with a fresh rate key. Never retried by us. */
  book?(b: { rateKey: string; from: string; to: string; clientReference: string; holder: ActivityHolder; paxes: ActivityPax[]; language: "en" | "ar" }): Promise<ActivityBooking>;
  /** simulate=true asks what cancelling would cost without cancelling. */
  cancel?(reference: string, simulate: boolean, language?: "en" | "ar"): Promise<{ amount: number; currency: string }>;
}
