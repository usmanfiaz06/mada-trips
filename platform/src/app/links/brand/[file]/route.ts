import { serveAsset } from "@/lib/app/links/assets";

// GET /links/brand/{file}: a file the invite pages use (lib/app/links/assets.ts).
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  return serveAsset("brand", (await ctx.params).file);
}
