import { z } from "zod";
import { Id } from "@mada/shared";
import { body, json, route } from "@/lib/app/http";
import { listNotifications, markRead } from "@/lib/app/trips/inbox";
import { authenticate } from "@/lib/app/tokens";

// POST /api/app/v1/notifications/read { ids? } → { ok, unread }: marks those read, or all of them without ids.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const { ids } = await body(req, z.object({ ids: z.array(Id).max(100).optional() }));
  await markRead(userId, ids?.length ? { ids } : { all: true });
  return json({ ok: true, unread: (await listNotifications(userId, null, 1)).unread });
});
