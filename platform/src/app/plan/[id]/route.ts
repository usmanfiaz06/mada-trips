import { planPage } from "@/lib/app/links/pages";

// GET /plan/{id}: one of Mada's plans, shared from the app (lib/app/links/pages.ts).
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return planPage(req, (await ctx.params).id);
}
