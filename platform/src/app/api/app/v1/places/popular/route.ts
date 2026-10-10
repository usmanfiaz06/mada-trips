import { PopularPlacesQuery, PopularPlacesResponse } from "@mada/shared";
import { AppError, json } from "@/lib/app/http";
import { CURATED } from "@/lib/app/places/curated";
import { placesRoute, queryOf } from "@/lib/app/places/route";
import { popularPlaces } from "@/lib/app/places/search";

// GET /places/popular?from=RUH → { from, places }: our cities in our order (not the one you're in), then the cities
// people asked us to plan most in the last 90 days.
export const dynamic = "force-dynamic";

export const GET = placesRoute(async (req) => {
  const q = PopularPlacesQuery.safeParse(queryOf(req));
  if (!q.success) throw new AppError("VALIDATION", { fields: { from: "An airport code, like RUH" } });
  return json(PopularPlacesResponse.parse({ from: q.data.from, places: await popularPlaces(q.data.from, CURATED.map((c) => c.geonameId)) }));
});
