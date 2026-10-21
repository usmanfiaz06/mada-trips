import { AskThreadsResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { authed } from "@/lib/app/account/route";
import { THREAD_FILTERS, listThreads, type ThreadFilter } from "@/lib/app/ask-chat/threads";

// GET /ask/threads?q=&archived=1&filter=trips|upcoming|past&tripId=&before= → { threads, next, archivedCount }: the
// traveller's Ask chats, newest first, 30 a page (before = the last page's next). q searches titles, trip places and the
// lines said in the chat; each row then carries `match`, the line that matched. docs/app/ASK-INTEGRATED.md §2.4, §11 U1+.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = authed(async (req, { userId }) => {
  const u = new URL(req.url).searchParams;
  const tripId = u.get("tripId");
  const out = await listThreads(userId, {
    q: u.get("q"), archived: u.get("archived") === "1" || u.get("archived") === "true",
    tripId: tripId && UUID.test(tripId) ? tripId : null, before: u.get("before"),
    filter: (THREAD_FILTERS as readonly string[]).includes(u.get("filter") ?? "") ? (u.get("filter") as ThreadFilter) : null,
  });
  return json(AskThreadsResponse.parse(out));
});
