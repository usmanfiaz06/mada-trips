import { CancelSupplierVoucherBody, money, type CancelSupplierVoucherResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { withParams } from "@/lib/app/trips/route";
import { cancelOwnVoucher, voucherOf } from "@/lib/app/suppliers/hotelbeds/bookings";
import { toAppError } from "@/lib/app/suppliers/hotelbeds/app";

// POST /api/app/v1/vouchers/{id}/cancel { confirm: false } → what cancelling costs now (the partner's simulation);
// { confirm: true } → cancelled with the partner. The traveller's own bookings only.
export const dynamic = "force-dynamic";

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const { confirm } = await body(req, CancelSupplierVoucherBody);
  try {
    const r = await cancelOwnVoucher(userId, id, confirm);
    return json({ simulated: r.simulated, fee: money(r.fee), voucher: voucherOf(r.row) } satisfies CancelSupplierVoucherResponse, r.simulated ? 200 : 201);
  } catch (e) { throw toAppError(e); }
});
