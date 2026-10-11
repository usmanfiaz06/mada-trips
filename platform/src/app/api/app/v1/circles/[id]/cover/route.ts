import { authenticate } from "@/lib/app/tokens";
import { routeP, uuidParam } from "@/lib/app/circles/common";
import { memberCoverBytes } from "@/lib/app/circles/covers";
import { fileResponse } from "@/lib/app/documents/storage";

// GET /circles/{id}/cover → the circle's uploaded cover photo: for members once it's approved, for the person who
// added it while it waits, and for someone invited once it's approved. 404 otherwise (drawings and shipped photos
// are drawn by the app itself).
export const dynamic = "force-dynamic";

export const GET = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  const { file, bytes } = await memberCoverBytes(uuidParam(p.id), userId);
  return fileResponse(file, bytes);
});
