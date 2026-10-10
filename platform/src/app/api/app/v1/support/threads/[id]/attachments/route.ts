import { SendSupportMessageResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { readUpload } from "@/lib/app/documents/storage";
import { sendAttachment } from "@/lib/app/support/threads";
import { authed, uuidParam } from "@/lib/app/account/route";

// POST /support/threads/{id}/attachments (multipart "file", optional "meta" { clientId }) → 201 { messages }:
// a photo or PDF up to 10 MB, stored encrypted.
export const dynamic = "force-dynamic";

export const POST = authed<{ id: string }>(async (req, { userId, ipHash }, p) => {
  const id = uuidParam(p.id);
  const up = await readUpload(req);
  const meta = (up.meta ?? {}) as { clientId?: unknown };
  const clientId = typeof meta.clientId === "string" && meta.clientId.length <= 64 ? meta.clientId : undefined;
  return json(SendSupportMessageResponse.parse({ messages: await sendAttachment(userId, id, up, { clientId }, ipHash) }), 201);
});
