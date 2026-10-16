import { RideResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { bookingRoute } from "@/lib/app/booking/route";
import { cancelRide } from "@/lib/app/rides/service";

// POST /rides/{id}/cancel → { ride }: free until the driver is at the meeting point.
export const dynamic = "force-dynamic";

export const POST = bookingRoute<{ id: string }>(async (_req, { userId, ipHash }, { id }) => json(RideResponse.parse({ ride: await cancelRide(userId, id, ipHash) })));
