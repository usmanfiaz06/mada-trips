import { CreatePostRequest, PostKind, t } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { AppError, json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { createPost, feed } from "@/lib/app/circles/posts";

// GET /posts?city=&kind=food|todo&scope=city|known → { posts }: friends first; your own pending tips included.
// POST /posts { city, place, text, kind, audience, photo?, photoConsent? } → 201 { post } (pending until checked).
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  const q = new URL(req.url).searchParams;
  const kind = PostKind.safeParse(q.get("kind"));
  return json({ posts: await feed(userId, { city: q.get("city"), kind: kind.success ? kind.data : null, scope: q.get("scope") === "known" ? "known" : "city" }) });
});

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  // A tip may carry a photo, so this body may be larger than the usual 64 KB (createPost checks the photo itself).
  const text = await req.text();
  if (text.length > 3_000_000) throw new AppError("VALIDATION", { copy: "circles.postTip.photoTooBig", fields: { photo: t("circles.postTip.photoTooBig") } });
  let raw: unknown;
  try { raw = text ? JSON.parse(text) : {}; } catch { throw new AppError("VALIDATION"); }
  const r = CreatePostRequest.safeParse(raw);
  if (!r.success) throw new AppError("VALIDATION", { fields: Object.fromEntries(r.error.issues.map((i) => [i.path.join(".") || "_", i.message])) });
  return json({ post: await createPost(userId, r.data, requestContext(req).ipHash) }, 201);
});
