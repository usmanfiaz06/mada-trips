import { UpdateMeRequest, type MeResponse } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { getUser, toUser, updateMe } from "@/lib/app/users";

// GET /api/app/v1/me → { user }.  PATCH /api/app/v1/me { name?, locale?, alerts?, notifications?, onboarded? } → { user }.
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  return json({ user: toUser(await getUser(userId)) } satisfies MeResponse);
});

export const PATCH = route(async (req) => {
  const { userId } = await authenticate(req);
  const patch = await body(req, UpdateMeRequest);
  return json({ user: toUser(await updateMe(userId, patch, requestContext(req).ipHash)) } satisfies MeResponse);
});
