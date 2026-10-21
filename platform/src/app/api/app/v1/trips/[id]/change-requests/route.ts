import { ChangeAsk, PlanChangeAskResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { requestChange } from "@/lib/app/trips/change-requests";
import { withParams } from "@/lib/app/trips/route";

// POST /api/app/v1/trips/{id}/change-requests { summary, ops } → 201 { applied, changeId, text }: a companion's edit on
// the plan screen (ASK-INTEGRATED.md §5.5). "Can suggest": a change request the owner approves in their chat (with a
// push); "Can edit": ideas change at once, anything to book still goes to the owner; "Can view": 403. The owner edits
// the plan directly (POST …/plan/ops), never through here.
export const dynamic = "force-dynamic";

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const b = await body(req, ChangeAsk);
  const r = await requestChange(userId, id, b, { threadId: null });
  return json(PlanChangeAskResponse.parse({ applied: r.applied, changeId: r.change?.id ?? null, text: r.text }), 201);
});
