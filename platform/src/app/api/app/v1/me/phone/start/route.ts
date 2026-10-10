import { CodeSentResponse, PhoneStartRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { startPhoneChange } from "@/lib/app/account";
import { authed } from "@/lib/app/account/route";

// POST /me/phone/start { phone } → { to, resendAfter, expiresIn }: a code by text to the new number (same limits as sign-in).
export const dynamic = "force-dynamic";

export const POST = authed(async (req, { userId, ipHash }) => {
  const { phone } = await body(req, PhoneStartRequest);
  return json(CodeSentResponse.parse(await startPhoneChange(userId, phone, ipHash)));
});
