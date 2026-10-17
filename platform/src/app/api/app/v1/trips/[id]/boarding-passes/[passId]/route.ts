import { json } from "@/lib/app/http";
import { deletePass } from "@/lib/app/boarding";
import { requestContext } from "@/lib/app/context";
import { loadTrip, withParams } from "@/lib/app/trips/route";

// DELETE /api/app/v1/trips/{id}/boarding-passes/{passId} → { deleted: true }. The traveller removes a pass (a wrong
// file, an old check-in); the desk can add it again.
export const dynamic = "force-dynamic";

export const DELETE = withParams<{ id: string; passId: string }>(async (req, { id, passId }, { userId }) => {
  await loadTrip(req, userId, id);
  await deletePass(userId, id, passId, requestContext(req).ipHash);
  return json({ deleted: true });
});
