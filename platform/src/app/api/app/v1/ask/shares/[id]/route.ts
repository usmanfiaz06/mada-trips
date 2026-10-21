import { AskShareAnswer, AskShareResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { authed, uuidParam } from "@/lib/app/account/route";
import { localeOfUser } from "@/lib/app/locale";
import { answerShare, getShare } from "@/lib/app/ask-chat/doc-shares";

// GET /ask/shares/{id} → { share }: a passport-share request, as the owner or the companion sees it.
// POST { action: send | share | decline }: the owner's tap sends it; the companion's tap shares or declines
// (docs/app/ASK-INTEGRATED.md §5.4). The owner only ever sees the last two characters and the expiry.
export const dynamic = "force-dynamic";

export const GET = authed<{ id: string }>(async (_req, { userId }, p) => {
  return json(AskShareResponse.parse({ share: await getShare(userId, uuidParam(p.id), await localeOfUser(userId)) }));
});

export const POST = authed<{ id: string }>(async (req, { userId, ipHash }, p) => {
  const id = uuidParam(p.id);
  const { action } = await body(req, AskShareAnswer);
  return json(AskShareResponse.parse({ share: await answerShare(userId, id, action, await localeOfUser(userId), ipHash) }));
});
