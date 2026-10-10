import { readDocumentFile } from "@/lib/app/documents";
import { fileResponse } from "@/lib/app/documents/storage";
import { authed, uuidParam } from "@/lib/app/account/route";

// GET /documents/{id}/file → the decrypted file, for its owner only (never cached). Every view is audited.
export const dynamic = "force-dynamic";

export const GET = authed<{ id: string }>(async (_req, { userId, ipHash }, p) => {
  const { file, bytes } = await readDocumentFile(userId, uuidParam(p.id), ipHash);
  return fileResponse(file, bytes);
});
