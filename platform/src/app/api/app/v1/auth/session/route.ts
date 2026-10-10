import { SupabaseSessionRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { exchangeSupabaseSession } from "@/lib/app/supabase-session";

// POST /api/app/v1/auth/session  { accessToken, givenName?, familyName?, device? }  → { tokens, user, isNew }.
// The app signs in with Supabase Auth (phone or email code, Apple, Google) and swaps the Supabase access token for our
// own session. The account is found by Supabase user id, then linked by verified phone or email, else created.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const input = await body(req, SupabaseSessionRequest);
  return json(await exchangeSupabaseSession(input, { ...requestContext(req), device: input.device }));
});
