import { joinPage } from "@/lib/app/links/pages";

// GET /i/{code}: the short form of /join/{code}, same page.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return joinPage(req, (await ctx.params).code);
}
