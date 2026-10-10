import { SupportThreadResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { getThread } from "@/lib/app/support/threads";
import { authed, uuidParam } from "@/lib/app/account/route";

// GET /support/threads/{id} → { thread, messages }.
export const dynamic = "force-dynamic";

export const GET = authed<{ id: string }>(async (_req, { userId }, p) => json(SupportThreadResponse.parse(await getThread(userId, uuidParam(p.id)))));
