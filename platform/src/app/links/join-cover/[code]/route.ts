import { INVITE_CODE } from "@mada/shared";
import { clientIp, ipHash } from "@/lib/app/http";
import { previewOrNull } from "@/lib/app/circles/invites";
import { approvedUploadBytes } from "@/lib/app/circles/covers";

// GET /links/join-cover/{code}: a circle's uploaded cover for its invite page, only while the invite is open and only
// once the photo has been approved. Anything else is a plain 404.
export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const code = decodeURIComponent((await ctx.params).code).trim().toLowerCase();
  const p = INVITE_CODE.test(code) ? await previewOrNull(code, null, ipHash(clientIp(req)), { web: true }) : null;
  const c = p?.status === "open" ? p.circle?.cover : null;
  if (c?.kind !== "upload" || c.status !== "approved") return notFound();
  try {
    const { file, bytes } = await approvedUploadBytes(c.fileId);
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": file.mime, "Content-Length": String(bytes.length), "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
    });
  } catch { return notFound(); }
}
