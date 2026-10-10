import { authenticate } from "@/lib/app/tokens";
import { photo } from "@/lib/app/circles/posts";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// GET /posts/{id}/photo → the image, for people who may see the tip.
export const dynamic = "force-dynamic";

export const GET = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  const img = await photo(userId, uuidParam(p.id));
  return new Response(new Uint8Array(img.data), { headers: { "Content-Type": img.mime, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
});
