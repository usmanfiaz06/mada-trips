import { DisruptionChoiceRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { AppError, body, json } from "@/lib/app/http";
import { chooseDisruption, disruptionFor, disruptionKind } from "@/lib/app/trips/disruption";
import { tripDetail } from "@/lib/app/trips/core";
import { loadTrip, withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/trips/{id}/disruption?kind=delay|cancel|night → the options Mada is holding.
// POST { kind, optionId, clientKey } → what happened: moved to another flight, staying put, or the refund. A choice
// queued offline is sent once, however often the phone retries (clientKey).
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const trip = await loadTrip(req, userId, id);
  const kind = disruptionKind(trip, new URL(req.url).searchParams.get("kind"));
  if (!kind) throw new AppError("NOT_FOUND", { message: "Nothing has gone wrong with this flight." });
  return json(disruptionFor(trip, kind));
});

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const input = await body(req, DisruptionChoiceRequest);
  const trip = await loadTrip(req, userId, id);
  const r = await chooseDisruption(userId, trip, input.kind, input.optionId, input.clientKey, requestContext(req).ipHash);
  const after = r.kind === "refund" ? null : await tripDetail(userId, id, null);
  return json({ ...r, trip: after });
});
