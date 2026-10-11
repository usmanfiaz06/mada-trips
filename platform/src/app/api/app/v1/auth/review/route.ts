import { ReviewLoginRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { reviewSignIn } from "@/lib/app/review-login";

// POST /api/app/v1/auth/review  { contact, code }  → { accessToken } (a Supabase access token for /auth/session).
// The App Review sign-in (lib/app/review-login.ts): 404 unless APP_REVIEW_LOGIN and APP_REVIEW_CODE are both set and
// Supabase is live; only the review contact with the exact code; audited; 20 wrong codes an hour pause it.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const input = await body(req, ReviewLoginRequest);
  return json(await reviewSignIn(input, requestContext(req)));
}, { idempotent: false });
