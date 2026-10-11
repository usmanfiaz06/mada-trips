import { RecoveryRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { requestRecovery } from "@/lib/app/recovery";

// POST /api/app/v1/auth/recovery  { name, oldContact, newContact, note?, locale? }  → { received: true }.
// Signed out: "I can't use this number or email any more". A person on the desk checks it's them and moves the
// account. Always the same answer, whether or not an account uses the old contact. Rate limited per network and per
// old contact; an Idempotency-Key makes a retry answer the same without a second request (route() → resilient()).
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const input = await body(req, RecoveryRequest);
  return json(await requestRecovery(input, requestContext(req)));
});
