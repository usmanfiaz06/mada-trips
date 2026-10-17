import { passSigner } from "@/lib/app/wallet-pass/config";
import { authTokenOk, pkpassFor } from "@/lib/app/wallet-pass/service";

// GET …/v1/passes/{passTypeIdentifier}/{serialNumber} → the latest signed .pkpass (Authorization: ApplePass <token>),
// 304 when it hasn't changed since If-Modified-Since.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ passType: string; serial: string }> }) {
  const { passType, serial } = await ctx.params;
  const s = passSigner();
  if (!s || passType !== s.passTypeId) return new Response(null, { status: 404 });
  if (!authTokenOk(serial, req.headers.get("authorization"))) return new Response(null, { status: 401 });
  const pass = await pkpassFor(serial).catch(() => null);
  if (!pass) return new Response(null, { status: 404 });
  const since = Date.parse(req.headers.get("if-modified-since") ?? "");
  if (Number.isFinite(since) && Math.floor(pass.updatedAt.getTime() / 1000) <= Math.floor(since / 1000)) return new Response(null, { status: 304 });
  return new Response(new Uint8Array(pass.bytes), { status: 200, headers: { "Content-Type": "application/vnd.apple.pkpass", "Last-Modified": pass.updatedAt.toUTCString(), "Cache-Control": "no-store" } });
}
