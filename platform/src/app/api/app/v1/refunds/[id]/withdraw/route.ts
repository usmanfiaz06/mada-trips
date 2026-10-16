import { json } from "@/lib/app/http";
import { requestContext } from "@/lib/app/context";
import { takeBackRefund } from "@/lib/app/trips/take-back";
import { withParams } from "@/lib/app/trips/route";

// POST /refunds/{id}/withdraw → { refund }: take back an "ask anyway" refund before the desk decides.
export const dynamic = "force-dynamic";

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => json({ refund: await takeBackRefund(userId, id, requestContext(req).ipHash) }));
