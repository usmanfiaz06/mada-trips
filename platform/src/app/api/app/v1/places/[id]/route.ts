import { PlaceId, PlaceResponse } from "@mada/shared";
import { AppError, json } from "@/lib/app/http";
import { getGuide } from "@/lib/app/places/guide";
import { placesRoute } from "@/lib/app/places/route";

// GET /places/:id → { place: CityGuide }. :id is a GeoNames id ("611717") or a city's name ("tbilisi").
// Open-data parts are cached for 30 days and refreshed in the background after that.
export const dynamic = "force-dynamic";

export const GET = placesRoute<{ id: string }>(async (_req, _auth, { id }) => {
  const p = PlaceId.safeParse(decodeURIComponent(id ?? ""));
  if (!p.success) throw new AppError("NOT_FOUND");
  return json(PlaceResponse.parse({ place: await getGuide(p.data) }));
});
