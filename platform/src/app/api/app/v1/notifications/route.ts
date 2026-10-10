import { z } from "zod";
import { Id } from "@mada/shared";
import { body, json, route } from "@/lib/app/http";
import { listNotifications, markRead } from "@/lib/app/trips/inbox";
import { authenticate } from "@/lib/app/tokens";

// GET /api/app/v1/notifications?before=<iso> → { items, next, unread, notifications }: the inbox behind the bell, newest first.
// PATCH { ids } or { all: true } → { ok, unread }: marks them read.
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  const before = new URL(req.url).searchParams.get("before");
  const page = await listNotifications(userId, before && !Number.isNaN(Date.parse(before)) ? before : null);
  // `notifications` repeats `items` for clients written against the first draft of this endpoint (the Wallet's inbox).
  return json({ ...page, notifications: page.items });
});

const Patch = z.union([z.object({ ids: z.array(Id).min(1).max(100) }), z.object({ all: z.literal(true) })]);

export const PATCH = route(async (req) => {
  const { userId } = await authenticate(req);
  await markRead(userId, await body(req, Patch));
  return json({ ok: true, unread: (await listNotifications(userId, null, 1)).unread });
});
