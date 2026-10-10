import { json } from "@/lib/app/http";
import { markRead } from "@/lib/app/support/threads";
import { authed, uuidParam } from "@/lib/app/account/route";

// POST /support/threads/{id}/read → { ok }: everything so far has been seen.
export const dynamic = "force-dynamic";

export const POST = authed<{ id: string }>(async (_req, { userId }, p) => {
  await markRead(userId, uuidParam(p.id));
  return json({ ok: true });
});
