import { DocumentGrantResponse, ShareDocumentRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { revokeShare, shareDocument } from "@/lib/app/documents";
import { authed, uuidParam } from "@/lib/app/account/route";

// POST /documents/{id}/share { tripId?, until? } → 201 { grant }: Faisal can see it, read-only, until the trip ends.
// DELETE → { ok }: stop sharing now.
export const dynamic = "force-dynamic";

export const POST = authed<{ id: string }>(async (req, { userId, ipHash }, p) => {
  const input = await body(req, ShareDocumentRequest);
  return json(DocumentGrantResponse.parse({ grant: await shareDocument(userId, uuidParam(p.id), input, ipHash) }), 201);
});

export const DELETE = authed<{ id: string }>(async (_req, { userId, ipHash }, p) => {
  await revokeShare(userId, uuidParam(p.id), ipHash);
  return json({ ok: true });
});
