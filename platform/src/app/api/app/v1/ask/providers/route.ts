import { AppError, json, route } from "@/lib/app/http";
import { isProductionDeploy } from "@/lib/app/config";
import { authenticate } from "@/lib/app/tokens";
import { probeChain, probeTurn } from "@/lib/app/ask-chat/providers";

// GET /ask/providers → { providers: [{ name, model, ok, ms, status, error, restingFor }] }: is each provider in
// ASK_CHAT_PROVIDERS answering right now. Staging only, signed in; 404 on production.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export const GET = route(async (req) => {
  if (isProductionDeploy()) throw new AppError("NOT_FOUND");
  await authenticate(req);
  if (new URL(req.url).searchParams.get("deep") === "1") return json({ turns: await probeTurn() });
  return json({ providers: await probeChain() });
});
