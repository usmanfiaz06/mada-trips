import { PlanEventsResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { unseenEvents } from "@/lib/app/plans/plans";
import { withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/trips/{id}/plan/events → { events }: changes the trip's chat hasn't been told about yet (by the
// traveller, the desk or a booking), oldest first (ASK-INTEGRATED §3.6). Ask marks them seen when it uses them.
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (_req, { id }, { userId }) => {
  const rows = await unseenEvents(userId, id);
  return json(PlanEventsResponse.parse({
    events: rows.map((e) => ({ id: e.id, itemId: e.itemId, at: e.at.toISOString(), by: e.byKind, op: e.op, diff: e.diff })),
  }));
});
