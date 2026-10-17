import { errorResponse } from "@/lib/app/http";
import { pkpassFor, serialFromLink } from "@/lib/app/wallet-pass/service";

// GET /api/app/v1/wallet/pass/{token} → application/vnd.apple.pkpass. The token is the signed ten-minute link from
// POST /trips/{id}/wallet (no Authorization header: Safari opens it). An expired or altered link is 404.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  try {
    const serial = serialFromLink((await ctx.params).token);
    const pass = serial ? await pkpassFor(serial) : null;
    if (!pass) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response(new Uint8Array(pass.bytes), {
      status: 200,
      headers: { "Content-Type": "application/vnd.apple.pkpass", "Content-Disposition": `attachment; filename="mada-${serial}.pkpass"`, "Cache-Control": "no-store", "Last-Modified": pass.updatedAt.toUTCString() },
    });
  } catch (e) { return errorResponse(e); }
}
