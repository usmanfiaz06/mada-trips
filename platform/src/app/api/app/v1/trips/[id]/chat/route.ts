import { TripChatResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { setTripChat, tripChat } from "@/lib/app/ask-chat/trip-chat";
import { withParams } from "@/lib/app/trips/route";

// The shared trip chat (ASK-INTEGRATED.md §5.5). GET → { on, threadId, canManage, members }: anyone on the trip.
// POST → the same, turned on (owner only; one thread for the trip, Mada's first line says who reads it). DELETE → turned
// off (owner only; archived, every line kept, and POST brings the same thread back). Private chats are never touched.
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (_req, { id }, { userId }) => json(TripChatResponse.parse(await tripChat(userId, id))));
export const POST = withParams<{ id: string }>(async (_req, { id }, { userId }) => json(TripChatResponse.parse(await setTripChat(userId, id, true))));
export const DELETE = withParams<{ id: string }>(async (_req, { id }, { userId }) => json(TripChatResponse.parse(await setTripChat(userId, id, false))));
