import { json } from "@/lib/app/http";
import { untrack } from "@/lib/app/trips/status";
import { withParams } from "@/lib/app/trips/route";

// DELETE /api/app/v1/tracked/{id} → { ok }: stop tracking a flight.
export const dynamic = "force-dynamic";

export const DELETE = withParams<{ id: string }>(async (_req, { id }, { userId }) => {
  await untrack(userId, id);
  return json({ ok: true });
});
