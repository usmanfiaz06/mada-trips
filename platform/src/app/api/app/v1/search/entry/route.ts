import { EntryCheckRequest, EntryCheckResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { checkEntry } from "@/lib/app/booking/search";
import { bookingRoute } from "@/lib/app/booking/route";

// POST /search/entry { destination, travellerIds, depart, return, answers } → every check per traveller (passport
// validity, visas, iqama, exit and re-entry, UK ETA). A blocking check stops review until it's sorted.
export const dynamic = "force-dynamic";

export const POST = bookingRoute(async (req, { userId, demo }) => {
  const q = await body(req, EntryCheckRequest);
  return json(EntryCheckResponse.parse(await checkEntry(userId, q, demo)));
});
