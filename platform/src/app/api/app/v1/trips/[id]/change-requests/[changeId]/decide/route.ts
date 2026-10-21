import { ChangeRequestResponse, DecideChangeRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { withParams } from "@/lib/app/trips/route";
import { decideChange } from "@/lib/app/trips/change-requests";

// POST /api/app/v1/trips/{id}/change-requests/{changeId}/decide { decision: approve | decline, reason? } → { change }.
// The owner only. Approve applies the plan ops (versioned); a plan that moved on since answers 422 with the "ask again" line.
export const dynamic = "force-dynamic";

export const POST = withParams<{ id: string; changeId: string }>(async (req, { id, changeId }, { userId }) =>
  json(ChangeRequestResponse.parse({ change: await decideChange(userId, id, changeId, await body(req, DecideChangeRequest)) })));
