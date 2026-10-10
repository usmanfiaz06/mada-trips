import { json } from "@/lib/app/http";
import { signOutEverywhere } from "@/lib/app/account";
import { authed } from "@/lib/app/account/route";

// POST /account/devices/signout-all → { ok }: every session ends, this one included.
export const dynamic = "force-dynamic";

export const POST = authed(async (_req, { userId, ipHash }) => {
  await signOutEverywhere(userId, ipHash);
  return json({ ok: true });
});
