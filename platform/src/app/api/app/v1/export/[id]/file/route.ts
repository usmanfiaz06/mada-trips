import { readExport } from "@/lib/app/account/privacy";
import { fileResponse } from "@/lib/app/documents/storage";
import { authed, uuidParam } from "@/lib/app/account/route";

// GET /export/{id}/file → the copy, as JSON, for its owner while the link is live (7 days).
export const dynamic = "force-dynamic";

export const GET = authed<{ id: string }>(async (_req, { userId }, p) => {
  const { file, bytes } = await readExport(userId, uuidParam(p.id));
  return fileResponse(file, bytes, "attachment");
});
