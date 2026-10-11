import { StayRoomsResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { stayRooms } from "@/lib/app/booking/search";
import { bookingRoute } from "@/lib/app/booking/route";

// GET /offers/{id}/rooms → every room the stay's hotel has for the same dates and party, each a stored offer to book.
export const dynamic = "force-dynamic";

export const GET = bookingRoute<{ id: string }>(async (_req, { userId }, p) => {
  return json(StayRoomsResponse.parse({ options: await stayRooms(userId, p.id) }));
});
