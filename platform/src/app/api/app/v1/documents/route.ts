import { DocumentResponse, DocumentsResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { createDocument, listDocuments } from "@/lib/app/documents";
import { readUpload } from "@/lib/app/documents/storage";
import { authed, uuidParam } from "@/lib/app/account/route";

// GET /documents[?personId=] → { documents }. POST /documents: multipart (file + meta JSON) or JSON meta alone → 201 { document }.
// Files are photos or PDFs up to 10 MB, checked by content, stored encrypted; nothing gets a public URL.
export const dynamic = "force-dynamic";

export const GET = authed(async (req, { userId }) => {
  const personId = new URL(req.url).searchParams.get("personId");
  return json(DocumentsResponse.parse({ documents: await listDocuments(userId, personId ? uuidParam(personId) : undefined) }));
});

export const POST = authed(async (req, { userId, ipHash }) => {
  const multipart = (req.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  if (multipart) {
    const up = await readUpload(req);
    return json(DocumentResponse.parse({ document: await createDocument(userId, up.meta, { name: up.name, mime: up.mime, bytes: up.bytes }, ipHash) }), 201);
  }
  let meta: unknown = {};
  try { meta = JSON.parse((await req.text()) || "{}"); } catch { meta = null; }
  return json(DocumentResponse.parse({ document: await createDocument(userId, meta, null, ipHash) }), 201);
});
