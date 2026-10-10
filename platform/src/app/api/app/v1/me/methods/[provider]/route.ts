import { LinkMethodRequest, type MeResponse } from "@mada/shared";
import { AppError, body, json } from "@/lib/app/http";
import { linkMethod, unlinkMethod } from "@/lib/app/account";
import { toUser } from "@/lib/app/users";
import { authed } from "@/lib/app/account/route";

// POST /me/methods/{apple|google} { idToken, nonce? } → { user }: add a way in.
// DELETE /me/methods/{apple|google|phone} → { user }: remove one, never the last.
export const dynamic = "force-dynamic";

export const POST = authed<{ provider: string }>(async (req, { userId, ipHash }, p) => {
  if (p.provider !== "apple" && p.provider !== "google") throw new AppError("NOT_FOUND");
  const { idToken, nonce } = await body(req, LinkMethodRequest);
  return json({ user: toUser(await linkMethod(userId, p.provider, idToken, nonce, ipHash)) } satisfies MeResponse);
});

export const DELETE = authed<{ provider: string }>(async (_req, { userId, ipHash }, p) => {
  if (p.provider !== "apple" && p.provider !== "google" && p.provider !== "phone") throw new AppError("NOT_FOUND");
  return json({ user: toUser(await unlinkMethod(userId, p.provider, ipHash)) } satisfies MeResponse);
});
