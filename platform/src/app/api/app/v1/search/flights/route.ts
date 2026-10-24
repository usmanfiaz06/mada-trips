import { FlightSearchRequest, FlightSearchResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { searchFlights } from "@/lib/app/booking/search";
import { openRoute } from "@/lib/app/guest";
import { logFlightSearch } from "@/lib/app/booking/search-log";

// POST /search/flights { from, destination, depart, return, travellerIds, infants, cabin, flexibleDays, direction? } →
// options with ids and a 20-minute hold, the bundle, and outcome ok | none | partial (an airline not answering) | by_hand.
// direction "back" (with return null): one-way flights home from the destination on `depart`, to book apart from the
// way out (another airline, day or time); the desk files it as the trip's way home (booking/desk.ts tripToJoin).
export const dynamic = "force-dynamic";

// Open to guests (lib/app/guest.ts): priced for the people they said, offers kept without an owner until booked.
export const POST = openRoute("search", async (req, { userId, demo }) => {
  const q = await body(req, FlightSearchRequest);
  const out = FlightSearchResponse.parse(await searchFlights(userId, q, demo));
  // Signed in: one line in the search log, for the desk's Drop-offs (booking/search-log.ts).
  await logFlightSearch(userId, q, out);
  return json(out);
});
