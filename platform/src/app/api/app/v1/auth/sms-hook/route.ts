import { requestContext } from "@/lib/app/context";
import { SmsHookPayload, deliverAuthSms, hookError, verifyStandardWebhook } from "@/lib/app/sms-hook";

// POST /api/app/v1/auth/sms-hook: Supabase Auth's "Send SMS" hook. Signed with Standard Webhooks using
// SUPABASE_SMS_HOOK_SECRET; sends the code through our SMS adapter (Unifonic or Taqnyat live, logged in mock mode).
// Answers {} on success, or { error: { http_code, message } } as Supabase expects.
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.SUPABASE_SMS_HOOK_SECRET;
  if (!secret) {
    console.warn("[app-api] auth/sms-hook called but SUPABASE_SMS_HOOK_SECRET is not set");
    return hookError(501, "SMS hook is not configured");
  }
  const raw = await req.text();
  const check = verifyStandardWebhook(secret, req.headers, raw);
  if (!check.ok) return hookError(401, `Signature check: ${check.reason}`);

  let payload;
  try { payload = SmsHookPayload.parse(JSON.parse(raw)); } catch { return hookError(400, "Unexpected payload"); }
  try {
    await deliverAuthSms(payload, requestContext(req).ipHash);
  } catch (e) {
    console.warn("[app-api] auth/sms-hook could not send", e instanceof Error ? e.message : e);
    return hookError(503, "The SMS provider did not take the message");
  }
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
}
