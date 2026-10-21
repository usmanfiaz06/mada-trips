import { ChangeRequestResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { withParams } from "@/lib/app/trips/route";
import { getChange } from "@/lib/app/trips/change-requests";

// GET /api/app/v1/trips/{id}/change-requests/{changeId} → { change }: the card's live state, for the owner and for
// the companion who asked (§5.5). Anyone else: 404.
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string; changeId: string }>(async (_req, { id, changeId }, { userId }) =>
  json(ChangeRequestResponse.parse({ change: await getChange(userId, id, changeId) })));
