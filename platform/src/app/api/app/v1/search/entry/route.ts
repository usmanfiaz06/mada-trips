import { EntryCheckRequest, EntryCheckResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { checkEntry } from "@/lib/app/booking/search";
import { openRoute } from "@/lib/app/guest";

// POST /search/entry { destination, travellerIds, depart, return, answers } → every check per traveller (passport
// validity, visas, iqama, exit and re-entry, UK ETA). A blocking check stops review until it's sorted.
export const dynamic = "force-dynamic";

// Open to guests (lib/app/guest.ts): the rules for the people they said; passports are asked for at booking.
export const POST = openRoute("read", async (req, { userId, demo }) => {
  const q = await body(req, EntryCheckRequest);
  return json(EntryCheckResponse.parse(await checkEntry(userId, q, demo)));
});
