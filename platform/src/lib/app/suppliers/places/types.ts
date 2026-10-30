/*
 * Places from Google Places API (New) (docs/app/CONNECT.md §32): restaurants, cafés, sights, malls, mosques,
 * pharmacies, for Ask's find_places and place_details. Everything in our words; the opening hours are kept as Google's
 * weekly periods so "open now" is worked out when a card is made, never cached.
 */

export type PlacePoint = { lat: number; lng: number };

/** A photo's resource name ("places/{id}/photos/{ref}") and the credit Google's terms say must be shown with it. */
export type PlacePhoto = { name: string; authors: { name: string; uri: string | null }[] };

/** Google's weekly period: day 0 is Sunday; no close means open around the clock. */
export type OpeningPeriod = { open: { day: number; hour: number; minute: number }; close?: { day: number; hour: number; minute: number } | null };

export type PlaceRecord = {
  id: string;
  name: string;
  /** "Shawarma restaurant", in the language asked for when Google has it. */
  type: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  ratings: number | null;
  /** 0 (free) to 4 (very expensive). */
  price: number | null;
  periods: OpeningPeriod[] | null;
  /** The week as Google writes it, Monday first ("Monday: 9:00 AM – 11:00 PM"). */
  week: string[] | null;
  utcOffsetMinutes: number | null;
  /** Details only. */
  phone: string | null;
  website: string | null;
  mapsUrl: string | null;
  photos: PlacePhoto[];
};

export type PlaceSearch = {
  query: string;
  /** Results are biased toward this circle (radius in metres, at most 50 km). */
  near: (PlacePoint & { radiusM: number }) | null;
  openNow: boolean;
  lang: "en" | "ar";
  /** 1 to 5. */
  max: number;
};

export interface PlacesSupplier {
  name: "google" | "mock";
  search(q: PlaceSearch): Promise<PlaceRecord[]>;
  details(id: string, lang: "en" | "ar"): Promise<PlaceRecord | null>;
  /** The short-lived image address behind a photo (Google answers it without the key); null when there is none. */
  photoUri(name: string, maxWidthPx: number): Promise<string | null>;
}
