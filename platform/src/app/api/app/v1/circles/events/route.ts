import { json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { eventsFor, resumeFrom, sweep } from "@/lib/app/circles/live";

// GET /circles/events[?after=<cursor>] → { events, cursor }: the live channel's polling twin, for when a stream
// can't stay open. Without ?after= it answers no events and the current cursor.
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  const hasCursor = new URL(req.url).searchParams.has("after") || req.headers.has("last-event-id");
  const start = await resumeFrom(req);
  sweep();
  return json(hasCursor ? await eventsFor(userId, start) : { events: [], cursor: start });
});
