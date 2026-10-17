import { PlaceId, ThingsResponse } from "@mada/shared";
import { AppError, json } from "@/lib/app/http";
import { localeOfUser } from "@/lib/app/locale";
import { thingsFor } from "@/lib/app/activities/things";
import { queryOf } from "@/lib/app/places/route";
import { openRoute } from "@/lib/app/guest";

// GET /places/:id/things?near=&open=&family=&ages=&day=&kind=&limit= → ThingsResponse: open-data places (OSM, Wikidata),
// bookable experiences (Hotelbeds first), what's on (the desk's list, Ticketmaster), today's weather and ideas.
export const dynamic = "force-dynamic";

// Open to guests: in the request's language.
export const GET = openRoute<{ id: string }>("read", async (req, { userId }, { id }) => {
  const p = PlaceId.safeParse(decodeURIComponent(id ?? ""));
  if (!p.success) throw new AppError("NOT_FOUND");
  return json(ThingsResponse.parse(await thingsFor(p.data, queryOf(req), { locale: await localeOfUser(userId) })));
});
