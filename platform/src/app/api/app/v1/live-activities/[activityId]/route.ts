import { json } from "@/lib/app/http";
import { authed } from "@/lib/app/account/route";
import { endActivity } from "@/lib/app/live";

// DELETE /api/app/v1/live-activities/{activityId} → { ended: true }: the traveller took it off the lock screen.
export const dynamic = "force-dynamic";

export const DELETE = authed<{ activityId: string }>(async (_req, { userId }, { activityId }) => {
  await endActivity(userId, activityId.slice(0, 120));
  return json({ ended: true });
});
