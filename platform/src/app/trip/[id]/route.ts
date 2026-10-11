import { tripPage } from "@/lib/app/links/pages";

// GET /trip/{id}: a trip someone shared. The page says nothing about it; the app shows it to people who may see it.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return tripPage(req, (await ctx.params).id);
}
