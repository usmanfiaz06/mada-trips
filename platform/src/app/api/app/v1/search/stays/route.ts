import { StaySearchRequest, StaySearchResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { searchStays } from "@/lib/app/booking/search";
import { openRoute } from "@/lib/app/guest";
import { logStaySearch } from "@/lib/app/booking/search-log";

// POST /search/stays { destination, checkIn, nights, travellerIds } → stays priced for the party (outcome ok | none | by_hand).
export const dynamic = "force-dynamic";

// Open to guests (lib/app/guest.ts).
export const POST = openRoute("search", async (req, { userId, demo }) => {
  const q = await body(req, StaySearchRequest);
  const out = StaySearchResponse.parse(await searchStays(userId, q, demo));
  await logStaySearch(userId, q, out);
  return json(out);
});
