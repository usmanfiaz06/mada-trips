import { ChangeFlightRequest, ChangeKind, changeOptions, fareRulesFor, moveNeeded, outSegment, timing } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { AppError, body, json } from "@/lib/app/http";
import { changeFlight } from "@/lib/app/trips/changes";
import { loadTrip, withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/trips/{id}/changes?kind=date|time|return|one → { kind, fare, options, within24 }.
// POST { kind, optionId | travellerId+names | offerKey, clientKey } → { result: done | quoted | sent, say, total, request, trip, move }.
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const trip = await loadTrip(req, userId, id);
  const kind = ChangeKind.safeParse(new URL(req.url).searchParams.get("kind") ?? "date");
  if (!kind.success) throw new AppError("VALIDATION", { fields: { kind: "Expected date, time, return, one, airline or name" } });
  const count = kind.data === "one" ? 1 : Math.max(1, trip.travellers.length);
  return json({ kind: kind.data, fare: trip.fare ?? fareRulesFor(outSegment(trip)?.carrier), options: changeOptions(kind.data, trip, count), within24: timing(trip.clock.phase).within24 });
});

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const input = await body(req, ChangeFlightRequest);
  const r = await changeFlight(userId, await loadTrip(req, userId, id), input, requestContext(req).ipHash);
  const trip = await loadTrip(req, userId, id);
  return json({ ...r, trip, move: moveNeeded(trip) });
});
