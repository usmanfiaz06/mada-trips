import { SocialSignInRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { signInWithProvider } from "@/lib/app/signin";

// POST /api/app/v1/auth/apple  { idToken, nonce?, givenName?, familyName?, device? }  → { tokens, user, isNew }.
// Sign in with Apple. Mock mode accepts "mock:<sub>[:<email>]"; live mode verifies the token against Apple's keys.
// The app still asks for a mobile number afterwards (FLOWS.md §1), verified through /auth/otp/* with this session.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const input = await body(req, SocialSignInRequest);
  return json(await signInWithProvider("apple", input, { ...requestContext(req), device: input.device }));
});
