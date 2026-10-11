import { route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { liveStream, resumeFrom } from "@/lib/app/circles/live";

// GET /circles/live[?after=<cursor>] → text/event-stream: what changes in your circles, as it happens
// (lib/app/circles/live.ts). Events: hello {cursor}, circle CircleLiveEvent (id: = cursor), cursor {cursor},
// bye {cursor}. The stream ends after ~25 s; reconnect with ?after= (or Last-Event-ID) to carry on.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  const start = await resumeFrom(req);
  return new Response(liveStream(userId, start, req.signal), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
