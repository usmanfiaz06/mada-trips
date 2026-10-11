import { localeFor } from "@/lib/app/links/pages";
import { planImage } from "@/lib/app/links/og";

// GET /links/og/plan/{id}?lang=: a plan's link-preview picture (og:image), 1200×630 PNG.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return planImage(decodeURIComponent((await ctx.params).id), localeFor(req));
}
