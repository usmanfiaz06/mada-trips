import { ConsentsResponse, UpdateConsentsRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { getConsents, updateConsents } from "@/lib/app/account";
import { authed } from "@/lib/app/account/route";

// GET /consents → { consents, history }. PATCH { marketing?, analytics? } → { consents, history }. Every change is kept (PDPL).
export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId }) => json(ConsentsResponse.parse(await getConsents(userId))));

export const PATCH = authed(async (req, { userId, ipHash }) => {
  const patch = await body(req, UpdateConsentsRequest);
  return json(ConsentsResponse.parse(await updateConsents(userId, patch, ipHash)));
});
