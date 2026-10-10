import { OtpVerifyRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { signInWithPhone } from "@/lib/app/signin";
import { authenticateOptional } from "@/lib/app/tokens";

// POST /api/app/v1/auth/otp/verify  { phone, code, device? }  → { tokens, user, isNew }.
// With a Bearer token (signed in with Apple/Google first), the verified number is added to that account.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const input = await body(req, OtpVerifyRequest);
  const current = await authenticateOptional(req);
  return json(await signInWithPhone(input.phone, input.code, { ...requestContext(req), device: input.device }, current));
});
