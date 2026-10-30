import { CreditResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { getCredit } from "@/lib/app/credit";
import { authed } from "@/lib/app/account/route";

// GET /credit → { credit: { balance, entries } }: the Mada Wallet (bookings only), a ledger, newest first.
export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId }) => json(CreditResponse.parse({ credit: await getCredit(userId) })));
