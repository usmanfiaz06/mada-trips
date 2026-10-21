import { AskDeskResponse } from "@mada/shared";
import { AppError, json } from "@/lib/app/http";
import { authed, uuidParam } from "@/lib/app/account/route";
import { currentLocale } from "@/lib/app/resilience/request";
import { deskUpdates } from "@/lib/app/ask-chat/takeover";

// GET /ask/chat/desk?threadId=…&after=n → { mode, agent, lines, last }: while a person on the desk has the
// conversation, their replies and the "Noura from Mada joined" line since line n (DESK-PLAN.md U5). The caller's own
// thread only; anything else is 404.
export const dynamic = "force-dynamic";

export const GET = authed(async (req, { userId }) => {
  const q = new URL(req.url).searchParams;
  const threadId = uuidParam(q.get("threadId") ?? undefined);
  const after = Number.parseInt(q.get("after") ?? "-1", 10);
  const r = await deskUpdates(userId, threadId, Number.isFinite(after) ? after : -1, currentLocale());
  if (!r) throw new AppError("NOT_FOUND");
  return json(AskDeskResponse.parse(r));
});
