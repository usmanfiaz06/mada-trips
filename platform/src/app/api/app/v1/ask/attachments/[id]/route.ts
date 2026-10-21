import { AskAttachmentResponse, AskDocTap, todayIn } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { authed, uuidParam } from "@/lib/app/account/route";
import { decideAttachment } from "@/lib/app/ask-chat/attachments";

// POST /ask/attachments/{id} { choice, personId?, keepCopy? }: the traveller's tap on a document card (use it, add it,
// replace, whose, keep it with their OK, this booking only, not now). The only way a document from a chat is saved.
export const dynamic = "force-dynamic";

export const POST = authed<{ id: string }>(async (req, { userId, ipHash }, p) => {
  const id = uuidParam(p.id);
  const tap = await body(req, AskDocTap);
  return json(AskAttachmentResponse.parse(await decideAttachment(userId, id, tap, { ipHash, today: todayIn() })));
});
