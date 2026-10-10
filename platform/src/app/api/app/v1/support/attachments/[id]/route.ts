import { fileResponse } from "@/lib/app/documents/storage";
import { readAttachment } from "@/lib/app/support/threads";
import { authed, uuidParam } from "@/lib/app/account/route";

// GET /support/attachments/{id} → the file, for the traveller who sent it.
export const dynamic = "force-dynamic";

export const GET = authed<{ id: string }>(async (_req, { userId }, p) => {
  const { file, bytes } = await readAttachment(userId, uuidParam(p.id));
  return fileResponse(file, bytes);
});
