import { OtpStartRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { startOtp } from "@/lib/app/otp";

// POST /api/app/v1/auth/otp/start  { phone }  → a 6-digit code by SMS (logged, and always 123456, in mock mode).
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { phone } = await body(req, OtpStartRequest);
  return json(await startOtp(phone, requestContext(req).ipHash));
});
