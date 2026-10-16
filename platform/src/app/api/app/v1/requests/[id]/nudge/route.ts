import { json } from "@/lib/app/http";
import { requestContext } from "@/lib/app/context";
import { nudgeRequest } from "@/lib/app/outcomes";
import { withParams } from "@/lib/app/trips/route";

// POST /requests/{id}/nudge → { progress }: the promised time has passed; the desk is told (once every 30 minutes).
export const dynamic = "force-dynamic";

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => json({ progress: await nudgeRequest(userId, id, requestContext(req).ipHash) }));
