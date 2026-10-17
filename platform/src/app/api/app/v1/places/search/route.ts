import { PlaceSearchQuery, PlaceSearchResponse } from "@mada/shared";
import { AppError, json } from "@/lib/app/http";
import { queryOf } from "@/lib/app/places/route";
import { openRoute } from "@/lib/app/guest";
import { searchPlaces } from "@/lib/app/places/search";

// GET /places/search?q=tbil → { query, results: PlaceHit[≤8], suggestions } — cities, other names, Arabic names,
// airport names and codes ("IST", "Heathrow"). Suggestions only when nothing matched.
export const dynamic = "force-dynamic";

// Open to guests.
export const GET = openRoute("read", async (req) => {
  const q = PlaceSearchQuery.safeParse(queryOf(req));
  if (!q.success) throw new AppError("VALIDATION", { fields: { q: "Type a city or an airport code" } });
  return json(PlaceSearchResponse.parse(await searchPlaces(q.data.q, q.data.limit)), 200, { "Cache-Control": "private, max-age=300" });
});
