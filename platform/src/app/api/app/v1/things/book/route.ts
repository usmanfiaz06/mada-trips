import { BookThingRequest, BookThingResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { bookThing } from "@/lib/app/activities/book";
import { placesRoute } from "@/lib/app/places/route";

// POST /things/book { ref: { kind, id }, placeId, day?, travellers?, travellerIds?, ages?, tripId?, message?, clientId }
// → 201 { request, message }: "Book with Mada" makes a desk request (the beta books through the desk). Idempotent by clientId.
export const dynamic = "force-dynamic";

export const POST = placesRoute(async (req, { userId, ipHash }) => {
  const b = await body(req, BookThingRequest);
  return json(BookThingResponse.parse(await bookThing(userId, b, ipHash)), 201);
});
