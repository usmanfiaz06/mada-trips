import { DocumentResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { deleteDocument, getDocument } from "@/lib/app/documents";
import { authed, uuidParam } from "@/lib/app/account/route";

// GET /documents/{id} → { document }. DELETE → { ok } (documents Mada added at set-up can't be deleted here).
export const dynamic = "force-dynamic";

export const GET = authed<{ id: string }>(async (_req, { userId }, p) => json(DocumentResponse.parse({ document: await getDocument(userId, uuidParam(p.id)) })));

export const DELETE = authed<{ id: string }>(async (_req, { userId, ipHash }, p) => {
  await deleteDocument(userId, uuidParam(p.id), ipHash);
  return json({ ok: true });
});
