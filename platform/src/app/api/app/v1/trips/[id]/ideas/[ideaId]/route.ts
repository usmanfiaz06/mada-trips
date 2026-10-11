import { AppError, json } from "@/lib/app/http";
import { isUuid } from "@/lib/app/booking/common";
import { removeIdea } from "@/lib/app/activities/trips";
import { withParams } from "@/lib/app/trips/route";

// DELETE /trips/:id/ideas/:ideaId → { ok: true }. Takes an idea off the plan.
export const dynamic = "force-dynamic";

export const DELETE = withParams<{ id: string; ideaId: string }>(async (_req, { id, ideaId }, { userId }) => {
  if (!isUuid(id) || !isUuid(ideaId)) throw new AppError("NOT_FOUND");
  await removeIdea(userId, id, ideaId);
  return json({ ok: true });
});
