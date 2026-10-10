import { SupabaseSyncRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { syncSupabaseIdentity } from "@/lib/app/supabase-session";
import { authenticate } from "@/lib/app/tokens";

// POST /api/app/v1/auth/session/sync  { accessToken }  with a Bearer token → { user }.
// After the app adds a phone, an email, Apple or Google in Supabase: copy it onto this account.
// 409 PHONE_TAKEN or IDENTITY_TAKEN when it belongs to another Mada account.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const { accessToken } = await body(req, SupabaseSyncRequest);
  return json(await syncSupabaseIdentity(userId, accessToken, requestContext(req).ipHash));
});
