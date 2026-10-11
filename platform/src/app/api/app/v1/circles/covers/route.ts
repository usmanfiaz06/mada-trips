import { UploadCoverResponse } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { uploadCover } from "@/lib/app/circles/covers";

// POST /circles/covers (multipart "file": JPEG, PNG, WebP or HEIC, up to 10 MB) → 201 { fileId, status: "pending" }.
// A cover photo, stored encrypted and not on any circle yet: name it in POST /circles or PATCH /circles/{id} as
// { cover: { kind: "upload", fileId } }. It's checked before anyone else sees it (lib/app/circles/covers.ts).
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  return json(UploadCoverResponse.parse(await uploadCover(userId, req, requestContext(req).ipHash)), 201);
});
