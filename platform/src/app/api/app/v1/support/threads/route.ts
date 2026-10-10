import { OpenThreadRequest, SupportThreadResponse, SupportThreadsResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { getThread, listThreads, openThread } from "@/lib/app/support/threads";
import { authed } from "@/lib/app/account/route";

// GET /support/threads → { threads } with unread counts. POST { tripId?, about? } → { thread, messages }: the
// conversation for the account or for one trip, created on first use.
export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId }) => json(SupportThreadsResponse.parse({ threads: await listThreads(userId) })));

export const POST = authed(async (req, { userId }) => {
  const input = await body(req, OpenThreadRequest);
  const th = await openThread(userId, input);
  return json(SupportThreadResponse.parse(await getThread(userId, th.id)));
});
