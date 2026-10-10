import { json } from "@/lib/app/http";
import { refreshTrip } from "@/lib/app/trips/status";
import { demoPhase, loadTrip, withParams } from "@/lib/app/trips/route";

// POST /api/app/v1/trips/{id}/refresh → { trip, changes }: re-reads the flight from the flightStatus supplier. Each gate
// change or cancellation is told once (inbox and push). On a demo travel day the gate moves B12 → C4.
export const dynamic = "force-dynamic";

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const changes = await refreshTrip(userId, await loadTrip(req, userId, id), demoPhase(req));
  return json({ trip: await loadTrip(req, userId, id), changes });
});
