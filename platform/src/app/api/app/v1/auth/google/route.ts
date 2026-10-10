import { SocialSignInRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { AppError, body, json, route } from "@/lib/app/http";
import { legacyAuthEnabled } from "@/lib/app/config";
import { signInWithProvider } from "@/lib/app/signin";

// POST /api/app/v1/auth/google  { idToken, nonce?, givenName?, familyName?, device? }  → { tokens, user, isNew }.
// Sign in with Google. Mock mode accepts "mock:<sub>[:<email>]"; live mode verifies the token against Google's keys.
// The app still asks for a mobile number afterwards (FLOWS.md §1), verified through /auth/otp/* with this session.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  // Replaced by Supabase Auth + /auth/session (docs/app/AUTH.md); kept for tests and tools, off in production.
  if (!legacyAuthEnabled()) throw new AppError("NOT_FOUND");
  const input = await body(req, SocialSignInRequest);
  return json(await signInWithProvider("google", input, { ...requestContext(req), device: input.device }));
});
