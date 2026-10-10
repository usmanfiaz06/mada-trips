import { json } from "@/lib/app/http";
import { signOutDevice } from "@/lib/app/account";
import { authed, uuidParam } from "@/lib/app/account/route";

// DELETE /account/devices/{id} → { ok }: sign another device out. It needs Apple, Google or a code to get back in.
export const dynamic = "force-dynamic";

export const DELETE = authed<{ id: string }>(async (_req, { userId, ipHash }, p) => {
  await signOutDevice(userId, uuidParam(p.id), ipHash);
  return json({ ok: true });
});
