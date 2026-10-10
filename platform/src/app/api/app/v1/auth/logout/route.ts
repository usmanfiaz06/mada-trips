import { LogoutRequest } from "@mada/shared";
import { db } from "@/db";
import { appAuditLog } from "@/lib/app/audit";
import { requestContext } from "@/lib/app/context";
import { AppError, body, json, route } from "@/lib/app/http";
import { authenticateOptional, revokeByRefresh, revokeSession } from "@/lib/app/tokens";

// POST /api/app/v1/auth/logout  { refreshToken? }  with or without a Bearer token. Ends this device's session.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { refreshToken } = await body(req, LogoutRequest);
  const auth = await authenticateOptional(req).catch(() => null);
  let userId = auth?.userId ?? null;
  if (auth) await revokeSession(auth.sessionId, "logout");
  if (refreshToken) userId = (await revokeByRefresh(refreshToken, "logout"))?.userId ?? userId;
  if (!userId) throw new AppError("UNAUTHORIZED");
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: "auth.signed_out", entityType: "app_user", entityId: userId, summary: "Signed out on this device", ipHash: requestContext(req).ipHash });
  return json({ ok: true });
});
