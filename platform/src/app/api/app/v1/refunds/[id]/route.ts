import type { RefundResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { getRefund } from "@/lib/app/trips/money";
import { withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/refunds/{id} → { refund }: the tracker (Requested → Approved → Sent → In your bank).
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (_req, { id }, { userId }) => json({ refund: await getRefund(userId, id) } satisfies RefundResponse));
