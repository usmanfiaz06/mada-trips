import { z } from "zod";
import { passSigner } from "@/lib/app/wallet-pass/config";
import { authTokenOk, passFor, register, unregister } from "@/lib/app/wallet-pass/service";

// Apple Wallet's web service (PassKit): a device registers for updates to a pass, or stops.
//   POST   …/v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}  { pushToken }
//          → 201 registered, 200 already registered, 401 wrong token
//   DELETE same path → 200
// Authorization: ApplePass <the pass's authenticationToken>.
export const dynamic = "force-dynamic";

type P = { params: Promise<{ device: string; passType: string; serial: string }> };
const ok = (status: number) => new Response(null, { status });
const Body = z.object({ pushToken: z.string().min(8).max(512) });

async function check(req: Request, ctx: P): Promise<{ error: Response } | { device: string; passType: string; serial: string }> {
  const { device, passType, serial } = await ctx.params;
  const s = passSigner();
  if (!s || passType !== s.passTypeId || !/^[\w-]{1,128}$/.test(device)) return { error: ok(404) };
  if (!authTokenOk(serial, req.headers.get("authorization"))) return { error: ok(401) };
  return { device, passType, serial };
}

export async function POST(req: Request, ctx: P) {
  const c = await check(req, ctx);
  if ("error" in c) return c.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return ok(400);
  if (!(await passFor(c.serial))) return ok(404);
  return ok((await register(c.device, c.passType, c.serial, parsed.data.pushToken)) === "created" ? 201 : 200);
}

export async function DELETE(req: Request, ctx: P) {
  const c = await check(req, ctx);
  if ("error" in c) return c.error;
  await unregister(c.device, c.passType, c.serial);
  return ok(200);
}
