import { ContactsMatchRequest } from "@mada/shared";
import { body, json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { matchContacts } from "@/lib/app/circles/friends";

// POST /friends/contacts { hashes } → { people }: contacts already on Mada. Only salted hashes arrive; nothing is kept.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, ContactsMatchRequest);
  return json({ people: await matchContacts(userId, input.hashes) });
});
