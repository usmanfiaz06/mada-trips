import { cityPage } from "@/lib/app/links/pages";

// GET /city/{id}: a city page shared from the app (GeoNames id or name).
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return cityPage(req, (await ctx.params).id);
}
