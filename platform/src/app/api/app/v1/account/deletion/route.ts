import { DeletionRequest, DeletionResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { cancelDeletion, scheduleDeletion } from "@/lib/app/account/privacy";
import { authed } from "@/lib/app/account/route";

// POST /account/deletion { confirm: "DELETE" } → { deleteAt }: deleted in 30 days unless cancelled.
// DELETE /account/deletion → { deleteAt: null }: changed their mind.
export const dynamic = "force-dynamic";

export const POST = authed(async (req, { userId, ipHash }) => {
  await body(req, DeletionRequest);
  return json(DeletionResponse.parse({ deleteAt: (await scheduleDeletion(userId, ipHash)).toISOString() }));
});

export const DELETE = authed(async (_req, { userId, ipHash }) => {
  await cancelDeletion(userId, ipHash);
  return json(DeletionResponse.parse({ deleteAt: null }));
});
