import { json, route } from "@/lib/app/http";
import { listRefunds } from "@/lib/app/trips/money";
import { authenticate } from "@/lib/app/tokens";

// GET /api/app/v1/refunds → { refunds }: every refund on the account, newest first, with its stage.
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  return json({ refunds: await listRefunds(userId) });
});
