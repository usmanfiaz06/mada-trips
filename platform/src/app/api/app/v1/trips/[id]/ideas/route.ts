import { AddTripIdeaRequest, TripIdea, TripIdeasResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { addIdea, listIdeas } from "@/lib/app/activities/trips";
import { withParams } from "@/lib/app/trips/route";

// GET /trips/:id/ideas → { ideas }. POST { ref, placeId, day } → 201 { idea } (200 when it was already there; a new
// day moves it). "Add to my plan": an idea on the itinerary, never booked or held.
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (_req, { id }, { userId }) => json(TripIdeasResponse.parse({ ideas: await listIdeas(userId, id) })));

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const b = await body(req, AddTripIdeaRequest);
  const r = await addIdea(userId, id, b);
  return json({ idea: TripIdea.parse(r.idea) }, r.created ? 201 : 200);
});
