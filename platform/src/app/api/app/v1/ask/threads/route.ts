import { AskThreadsResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { authed } from "@/lib/app/account/route";
import { listThreads } from "@/lib/app/ask-chat/threads";

// GET /ask/threads?q=&archived=1&tripId=&before= → { threads, next, archivedCount }: the traveller's Ask chats, newest
// first, 30 a page (before = the last page's next). q searches titles, previews and trip places, never the words inside.
// docs/app/ASK-INTEGRATED.md §2.4.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = authed(async (req, { userId }) => {
  const u = new URL(req.url).searchParams;
  const tripId = u.get("tripId");
  const out = await listThreads(userId, {
    q: u.get("q"), archived: u.get("archived") === "1" || u.get("archived") === "true",
    tripId: tripId && UUID.test(tripId) ? tripId : null, before: u.get("before"),
  });
  return json(AskThreadsResponse.parse(out));
});
