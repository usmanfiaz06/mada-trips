import { INVITE_CODE } from "@mada/shared";
import { clientIp, ipHash } from "@/lib/app/http";
import { previewOrNull } from "@/lib/app/circles/invites";
import { localeFor } from "@/lib/app/links/pages";
import { joinImage } from "@/lib/app/links/og";

// GET /links/og/join/{code}?lang=: the invite's link-preview picture (og:image), 1200×630 PNG.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const code = decodeURIComponent((await ctx.params).code).trim().toLowerCase();
  const p = INVITE_CODE.test(code) ? await previewOrNull(code, null, ipHash(clientIp(req)), { web: true }) : null;
  return joinImage(p, localeFor(req));
}
