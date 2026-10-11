import { PhoneChannelRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { leaveHint } from "@/lib/app/phone-channel";

// POST /api/app/v1/auth/phone-channel  { phone, channel? }  → { ticket, channels }.
// Signed out, just before the app asks Supabase for a phone code: which channel the next code to this number should
// take (WhatsApp or SMS; none for the usual one). Supabase doesn't pass a channel to the Send SMS hook, so the hook
// reads this. The ticket reads back how the code went (GET …/{ticket}). Limited per network and per number; the
// number is stored only as a keyed hash.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const input = await body(req, PhoneChannelRequest);
  return json(await leaveHint(input, requestContext(req)));
});
