import { ImportTrackedRequest, type TrackedResponse } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { listTracked, trackFlight } from "@/lib/app/trips/status";
import { authenticate } from "@/lib/app/tokens";

// POST /api/app/v1/tracked/import { flights: [...] } → { flights }: flights tracked as a guest (kept on the phone) come
// with the traveller when they sign up. Past days are skipped.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const { flights } = await body(req, ImportTrackedRequest);
  const ip = requestContext(req).ipHash;
  for (const f of flights) await trackFlight(userId, f, ip).catch(() => null);
  return json({ flights: await listTracked(userId) } satisfies TrackedResponse);
});
