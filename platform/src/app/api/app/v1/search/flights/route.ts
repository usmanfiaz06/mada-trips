import { FlightSearchRequest, FlightSearchResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { searchFlights } from "@/lib/app/booking/search";
import { openRoute } from "@/lib/app/guest";

// POST /search/flights { from, destination, depart, return, travellerIds, infants, cabin, flexibleDays } → options with
// ids and a 20-minute hold, the bundle, and outcome ok | none | partial (an airline not answering) | by_hand.
export const dynamic = "force-dynamic";

// Open to guests (lib/app/guest.ts): priced for the people they said, offers kept without an owner until booked.
export const POST = openRoute("search", async (req, { userId, demo }) => {
  const q = await body(req, FlightSearchRequest);
  return json(FlightSearchResponse.parse(await searchFlights(userId, q, demo)));
});
