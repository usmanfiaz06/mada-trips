import { z } from "zod";
import { PlanChangeResponse, PlanItemInput, type PlanOp } from "@mada/shared";
import { AppError, body, json } from "@/lib/app/http";
import { applyOps } from "@/lib/app/plans/ops";
import { withParams } from "@/lib/app/trips/route";

// PATCH /api/app/v1/trips/{id}/plan/items/{itemId} { version, item?, day?, afterItemId?, first?, skipped? } → { plan, changes }
// (an update, a move to another day or place in the day, a skip). DELETE ?version=N → { plan, changes }.
export const dynamic = "force-dynamic";

const PatchItem = z.object({
  version: z.number().int().min(1),
  item: PlanItemInput.partial().optional(),
  day: z.number().int().min(0).nullable().optional(),
  afterItemId: z.string().uuid().nullable().optional(),
  /** To the top of the day ("Move up" past the first item). */
  first: z.boolean().optional(),
  skipped: z.boolean().optional(),
});

export const PATCH = withParams<{ id: string; itemId: string }>(async (req, { id, itemId }, { userId }) => {
  const b = await body(req, PatchItem);
  const ops: PlanOp[] = [];
  if (b.item && Object.keys(b.item).length) ops.push({ op: "update", itemId, item: b.item });
  if (b.day !== undefined || b.afterItemId !== undefined || b.first) ops.push({ op: "move", itemId, day: b.day ?? null, afterItemId: b.afterItemId, first: b.first });
  if (b.skipped !== undefined) ops.push({ op: b.skipped ? "skip" : "unskip", itemId });
  if (!ops.length) throw new AppError("VALIDATION", { fields: { _: "Nothing to change" } });
  return json(PlanChangeResponse.parse(await applyOps(userId, id, { version: b.version, ops }, "traveller")));
});

export const DELETE = withParams<{ id: string; itemId: string }>(async (req, { id, itemId }, { userId }) => {
  const version = Number(new URL(req.url).searchParams.get("version"));
  if (!Number.isInteger(version) || version < 1) throw new AppError("VALIDATION", { fields: { version: "Required" } });
  return json(PlanChangeResponse.parse(await applyOps(userId, id, { version, ops: [{ op: "remove", itemId }] }, "traveller")));
});
