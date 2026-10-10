import { StaySearchRequest, StaySearchResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { searchStays } from "@/lib/app/booking/search";
import { bookingRoute } from "@/lib/app/booking/route";

// POST /search/stays { destination, checkIn, nights, travellerIds } → stays priced for the party (outcome ok | none | by_hand).
export const dynamic = "force-dynamic";

export const POST = bookingRoute(async (req, { userId, demo }) => {
  const q = await body(req, StaySearchRequest);
  return json(StaySearchResponse.parse(await searchStays(userId, q, demo)));
});
