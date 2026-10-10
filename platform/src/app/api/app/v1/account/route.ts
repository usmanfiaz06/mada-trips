import { AccountResponse, UpdateAccountRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { getAccount, updateAccount } from "@/lib/app/account";
import { authed } from "@/lib/app/account/route";

// GET /account → { account }: what Mada calls you, home airport, currency, preferences, Face ID, consents, deletion.
// PATCH /account { preferredName?, home?, currency?, arabicNotify?, prefs?, faceId? } → { account }.
export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId }) => json(AccountResponse.parse({ account: await getAccount(userId) })));

export const PATCH = authed(async (req, { userId, ipHash }) => {
  const patch = await body(req, UpdateAccountRequest);
  return json(AccountResponse.parse({ account: await updateAccount(userId, patch, ipHash) }));
});
