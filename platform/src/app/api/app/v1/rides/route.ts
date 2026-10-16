import { RequestRideBody, RideResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { bookingRoute } from "@/lib/app/booking/route";
import { requestRide } from "@/lib/app/rides/service";

// POST /rides { when: now|in15, city, meetingPoint, tripId?, clientKey } → 201 { ride }: a car right now. The same
// clientKey returns the same ride, so a retry never books two cars.
export const dynamic = "force-dynamic";

export const POST = bookingRoute(async (req, { userId, ipHash }) => {
  const b = await body(req, RequestRideBody);
  return json(RideResponse.parse({ ride: await requestRide(userId, b, ipHash) }), 201);
});
