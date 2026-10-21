import { z } from "zod";
import { PlanChangeResponse, PlanItemInput } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { applyOps } from "@/lib/app/plans/ops";
import { withParams } from "@/lib/app/trips/route";

// POST /api/app/v1/trips/{id}/plan/items { version, day, afterItemId?, item } → 201 { plan, changes }: one "add" op
// from the plan screen ("+ Add to day 1").
export const dynamic = "force-dynamic";

const AddItem = z.object({ version: z.number().int().min(1), day: z.number().int().min(0).nullable(), afterItemId: z.string().uuid().nullable().optional(), item: PlanItemInput });

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const b = await body(req, AddItem);
  const r = await applyOps(userId, id, { version: b.version, ops: [{ op: "add", day: b.day, afterItemId: b.afterItemId, item: b.item }] }, "traveller");
  return json(PlanChangeResponse.parse(r), 201);
});
