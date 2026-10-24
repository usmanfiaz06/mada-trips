import { HotelReviewsResponse } from "@mada/shared";
import { AppError, json } from "@/lib/app/http";
import { openRoute } from "@/lib/app/guest";
import { hotelCodeOf } from "@/lib/app/shield";
import { hotelContent } from "@/lib/app/suppliers/hotelbeds/content";
import { hotelReviews } from "@/lib/app/hotels/google-reviews";

// GET /hotels/{code}/reviews?lang=ar → { place: { rating, count, mapsUrl, reviews[≤5] } | null, source: "google" }:
// what guests say on Google Maps, found by the hotel's name and address near its coordinates. 501 NOT_CONFIGURED
// without GOOGLE_MAPS_API_KEY (the page shows no reviews). Not cached here: Google's terms keep only the place id.
export const dynamic = "force-dynamic";

export const GET = openRoute<{ code: string }>("read", async (req, _auth, { code }) => {
  const n = hotelCodeOf(code);
  if (!n) throw new AppError("NOT_FOUND");
  const h = await hotelContent(n);
  if (!h) throw new AppError("NOT_FOUND");
  const lang = new URL(req.url).searchParams.get("lang") === "ar" ? "ar" : "en";
  const address = [h.address, h.city ? h.city.charAt(0) + h.city.slice(1).toLowerCase() : null].filter(Boolean).join(", ") || null;
  return json(HotelReviewsResponse.parse(await hotelReviews({ name: h.name, address, latitude: h.latitude, longitude: h.longitude }, lang)), 200, { "Cache-Control": "private, max-age=600" });
});
