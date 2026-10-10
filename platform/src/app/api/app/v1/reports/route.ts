import { requestContext } from "@/lib/app/context";
import { json, route, body } from "@/lib/app/http";
import { ReportRequest } from "@mada/shared";
import { authenticate } from "@/lib/app/tokens";
import { report } from "@/lib/app/circles/safety";

// POST /reports { targetKind, targetId, reason, note?, block? } → 201 { ok }: a person looks within 24 hours.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, ReportRequest);
  await report(userId, input, requestContext(req).ipHash);
  return json({ ok: true }, 201);
});
