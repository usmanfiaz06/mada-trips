import { RefreshRequest, type RefreshResponse } from "@mada/shared";
import { body, json, route } from "@/lib/app/http";
import { rotateRefresh } from "@/lib/app/tokens";

// POST /api/app/v1/auth/refresh  { refreshToken }  → { tokens }. The old refresh token stops working at once.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { refreshToken } = await body(req, RefreshRequest);
  const { tokens } = await rotateRefresh(refreshToken);
  return json({ tokens } satisfies RefreshResponse);
});
