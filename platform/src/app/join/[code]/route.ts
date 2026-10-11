import { joinPage } from "@/lib/app/links/pages";

// GET /join/{code}: the invite page for someone without the app (lib/app/links/pages.ts). With the app installed,
// iOS and Android open the app instead (/.well-known files).
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return joinPage(req, (await ctx.params).code);
}
