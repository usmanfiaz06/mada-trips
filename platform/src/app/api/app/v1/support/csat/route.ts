import { SupportCsatRequest, SupportCsatResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { authed } from "@/lib/app/account/route";
import { pendingCsat, rateTicket } from "@/lib/app/desk/csat";

// GET /support/csat → { pending }: the resolved conversation waiting for a one-tap rating, if any (asked once).
// POST /support/csat { ticketId, score: 1–5 | null } → { ok }: the rating, or null to skip it.
export const dynamic = "force-dynamic";

export const GET = authed(async (_req, { userId }) => json(SupportCsatResponse.parse({ pending: await pendingCsat(userId) })));

export const POST = authed(async (req, { userId }) => {
  const v = await body(req, SupportCsatRequest);
  await rateTicket(userId, v.ticketId, v.score);
  return json({ ok: true });
});
