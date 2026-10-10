import { requestContext } from "@/lib/app/context";
import { json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { deletePost, getPost } from "@/lib/app/circles/posts";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// GET /posts/{id} → { post }. DELETE /posts/{id} → { ok }: the author takes it down for everyone.
export const dynamic = "force-dynamic";

export const GET = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  return json({ post: await getPost(userId, uuidParam(p.id)) });
});

export const DELETE = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await deletePost(userId, uuidParam(p.id), requestContext(req).ipHash);
  return json({ ok: true });
});
