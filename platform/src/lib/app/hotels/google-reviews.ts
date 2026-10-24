import type { HotelReviewsResponse } from "@mada/shared";
import { AppError } from "@/lib/app/http";

/*
 * Guest reviews for a partner hotel from Google Maps (Places API, New: Text Search), looked up by the hotel's name and
 * address near its own coordinates. One call per hotel page; nothing is stored (Google's terms allow keeping the place
 * id only). Without GOOGLE_MAPS_API_KEY the route answers NOT_CONFIGURED and the page simply shows no reviews.
 * A place more than NEAR_M from the hotel, or not a lodging, is treated as "not found": a wrong hotel's reviews would
 * be worse than none.
 */
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELDS = ["places.id", "places.displayName", "places.types", "places.location", "places.rating", "places.userRatingCount", "places.googleMapsUri", "places.reviews"].join(",");
const NEAR_M = 600;
const TIMEOUT_MS = 6000;

type GoogleReview = {
  rating?: number; relativePublishTimeDescription?: string;
  text?: { text?: string; languageCode?: string }; originalText?: { text?: string; languageCode?: string };
  authorAttribution?: { displayName?: string; uri?: string; photoUri?: string };
};
type GooglePlace = {
  id?: string; types?: string[]; location?: { latitude?: number; longitude?: number };
  rating?: number; userRatingCount?: number; googleMapsUri?: string; reviews?: GoogleReview[];
};

export type HotelForReviews = { name: string; address: string | null; latitude: number | null; longitude: number | null };

/** Metres between two points (haversine). */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Google's answer in our shape: the first place that is a lodging near the hotel, its rating and up to 5 reviews. */
export function reviewsOf(hotel: HotelForReviews, places: GooglePlace[] | undefined): HotelReviewsResponse {
  const at = hotel.latitude != null && hotel.longitude != null ? { lat: hotel.latitude, lng: hotel.longitude } : null;
  const p = (places ?? []).find((x) => {
    if (!x.googleMapsUri || !(x.types ?? []).some((t) => t === "lodging" || t === "hotel" || t === "resort_hotel")) return false;
    if (!at) return true;
    const l = x.location;
    return l?.latitude != null && l.longitude != null && metresBetween(at, { lat: l.latitude, lng: l.longitude }) <= NEAR_M;
  });
  if (!p) return { place: null, source: "google" };
  const reviews = (p.reviews ?? []).filter((r) => r.rating && (r.text?.text || r.originalText?.text)).slice(0, 5).map((r) => ({
    author: r.authorAttribution?.displayName?.trim() || "Google user",
    authorUrl: r.authorAttribution?.uri ?? null,
    authorPhoto: r.authorAttribution?.photoUri ?? null,
    rating: Math.min(5, Math.max(1, Math.round(r.rating!))),
    text: (r.text?.text || r.originalText?.text || "").trim(),
    when: r.relativePublishTimeDescription ?? "",
    lang: r.text?.languageCode ?? r.originalText?.languageCode ?? null,
    translated: !!(r.text?.languageCode && r.originalText?.languageCode && r.text.languageCode !== r.originalText.languageCode),
  }));
  return { place: { rating: p.rating != null ? Math.round(p.rating * 10) / 10 : null, count: p.userRatingCount ?? 0, mapsUrl: p.googleMapsUri!, reviews }, source: "google" };
}

export async function hotelReviews(hotel: HotelForReviews, lang: "en" | "ar", fetcher: typeof fetch = fetch): Promise<HotelReviewsResponse> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new AppError("NOT_CONFIGURED");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetcher(ENDPOINT, {
      method: "POST", signal: ctl.signal,
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS },
      body: JSON.stringify({
        textQuery: [hotel.name, hotel.address].filter(Boolean).join(", "),
        languageCode: lang, maxResultCount: 3, includedType: "lodging",
        ...(hotel.latitude != null && hotel.longitude != null ? { locationBias: { circle: { center: { latitude: hotel.latitude, longitude: hotel.longitude }, radius: 1000 } } } : {}),
      }),
    });
    if (!r.ok) {
      console.warn("[reviews] google places answered", r.status);
      throw new AppError(r.status === 403 || r.status === 401 ? "NOT_CONFIGURED" : "SUPPLIER_DOWN");
    }
    const data = (await r.json()) as { places?: GooglePlace[] };
    return reviewsOf(hotel, data.places);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(e instanceof Error && e.name === "AbortError" ? "TIMEOUT" : "SUPPLIER_DOWN");
  } finally { clearTimeout(timer); }
}
