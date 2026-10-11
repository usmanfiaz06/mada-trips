import { ThingsResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { localeOfUser } from "@/lib/app/locale";
import { tripThings } from "@/lib/app/activities/trips";
import { queryOf } from "@/lib/app/places/route";
import { loadTrip, withParams } from "@/lib/app/trips/route";

// GET /trips/:id/things?day=&open=&family=&kind= → Things to do in the trip's city, from the hotel, for the children
// going (their ages from the household), on the day being planned. Only the trip's owner.
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const trip = await loadTrip(req, userId, id);
  return json(ThingsResponse.parse(await tripThings(trip, queryOf(req), { locale: await localeOfUser(userId) })));
});
