import { FlightSearchRequest, FlightSearchResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { searchFlights } from "@/lib/app/booking/search";
import { bookingRoute } from "@/lib/app/booking/route";

// POST /search/flights { from, destination, depart, return, travellerIds, infants, cabin, flexibleDays } → options with
// ids and a 20-minute hold, the bundle, and outcome ok | none | partial (an airline not answering) | by_hand.
export const dynamic = "force-dynamic";

export const POST = bookingRoute(async (req, { userId, demo }) => {
  const q = await body(req, FlightSearchRequest);
  return json(FlightSearchResponse.parse(await searchFlights(userId, q, demo)));
});
