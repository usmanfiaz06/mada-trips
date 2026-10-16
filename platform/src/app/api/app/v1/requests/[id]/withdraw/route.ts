import { json } from "@/lib/app/http";
import { requestContext } from "@/lib/app/context";
import { takeBackRequest } from "@/lib/app/trips/take-back";
import { withParams } from "@/lib/app/trips/route";

// POST /requests/{id}/withdraw → { request }: take back a request or a change until the desk has it (marked, never deleted).
export const dynamic = "force-dynamic";

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => json({ request: await takeBackRequest(userId, id, requestContext(req).ipHash) }));
