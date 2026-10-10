import { CodeSentResponse, EmailStartRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { startEmailChange } from "@/lib/app/account";
import { authed } from "@/lib/app/account/route";

// POST /me/email/start { email } → { to, resendAfter, expiresIn }: a 6-digit code to prove the address (123456 in mock mode).
export const dynamic = "force-dynamic";

export const POST = authed(async (req, { userId, ipHash }) => {
  const { email } = await body(req, EmailStartRequest);
  return json(CodeSentResponse.parse(await startEmailChange(userId, email, ipHash)));
});
