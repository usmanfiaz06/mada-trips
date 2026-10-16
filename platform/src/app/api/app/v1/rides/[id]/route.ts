import { RideResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { bookingRoute } from "@/lib/app/booking/route";
import { getRide } from "@/lib/app/rides/service";

// GET /rides/{id} → { ride }: requesting, a driver on the way (name, car, plate, meeting point, price), here, or none.
export const dynamic = "force-dynamic";

export const GET = bookingRoute<{ id: string }>(async (_req, { userId }, { id }) => json(RideResponse.parse({ ride: await getRide(userId, id) })));
