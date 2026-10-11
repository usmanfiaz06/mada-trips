import type { SupplierVouchersResponse } from "@mada/shared";
import type { z } from "zod";
import { json } from "@/lib/app/http";
import { loadTrip, withParams } from "@/lib/app/trips/route";
import { tripVouchers } from "@/lib/app/suppliers/hotelbeds/bookings";

// GET /api/app/v1/trips/{id}/vouchers → { vouchers }: Hotelbeds vouchers for the trip's stay and pickups (confirmed or cancelled).
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  await loadTrip(req, userId, id);
  return json({ vouchers: await tripVouchers(userId, id) } satisfies z.infer<typeof SupplierVouchersResponse>);
});
