import { EmailVerifyRequest, type MeResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { verifyEmailChange } from "@/lib/app/account";
import { toUser } from "@/lib/app/users";
import { authed } from "@/lib/app/account/route";

// POST /me/email/verify { email, code } → { user }: 3 tries per code, then a new code is needed.
export const dynamic = "force-dynamic";

export const POST = authed(async (req, { userId, ipHash }) => {
  const { email, code } = await body(req, EmailVerifyRequest);
  return json({ user: toUser(await verifyEmailChange(userId, email, code, ipHash)) } satisfies MeResponse);
});
