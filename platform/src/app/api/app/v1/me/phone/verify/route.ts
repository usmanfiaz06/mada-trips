import { PhoneVerifyRequest, type MeResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { verifyPhoneChange } from "@/lib/app/account";
import { toUser } from "@/lib/app/users";
import { authed } from "@/lib/app/account/route";

// POST /me/phone/verify { phone, code } → { user }: the old number stops working for sign-in straight away.
export const dynamic = "force-dynamic";

export const POST = authed(async (req, { userId, ipHash }) => {
  const { phone, code } = await body(req, PhoneVerifyRequest);
  return json({ user: toUser(await verifyPhoneChange(userId, phone, code, ipHash)) } satisfies MeResponse);
});
