import { passSigner } from "@/lib/app/wallet-pass/config";
import { updatedSince } from "@/lib/app/wallet-pass/service";

// GET …/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}?passesUpdatedSince={tag}
// → 200 { serialNumbers, lastUpdated } | 204 nothing new | 404 no registrations. No auth header (Apple's protocol).
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ device: string; passType: string }> }) {
  const { device, passType } = await ctx.params;
  const s = passSigner();
  if (!s || passType !== s.passTypeId) return new Response(null, { status: 404 });
  const tag = new URL(req.url).searchParams.get("passesUpdatedSince");
  const r = await updatedSince(device, passType, tag && /^\d+$/.test(tag) ? Number(tag) : null);
  if (!r) return new Response(null, { status: 404 });
  if (!r.serials.length) return new Response(null, { status: 204 });
  return Response.json({ serialNumbers: r.serials, lastUpdated: r.lastUpdated }, { headers: { "Cache-Control": "no-store" } });
}
