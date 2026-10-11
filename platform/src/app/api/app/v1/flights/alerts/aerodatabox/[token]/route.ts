import { AppError, json, resilient } from "@/lib/app/http";
import { alertsEnabled, handleNotification, tokenMatches } from "@/lib/app/flight-status/alerts";

// POST /api/app/v1/flights/alerts/aerodatabox/{token}: AeroDataBox flight-alert notifications (subscriptions by flight
// number, made by /api/cron/flights). AeroDataBox doesn't sign notifications, so the URL carries a secret token
// (AERODATABOX_WEBHOOK_SECRET) and only notifications for subscriptions we created are acted on. Each change goes
// through the same disruption logic as polling, told once. Answers 2xx fast: AeroDataBox waits 10 s at most.
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  return resilient(req, async () => {
    if (!alertsEnabled()) throw new AppError("NOT_CONFIGURED");
    if (!tokenMatches(decodeURIComponent((await ctx.params).token))) throw new AppError("UNAUTHORIZED");
    const text = await req.text();
    if (text.length > 512_000) throw new AppError("VALIDATION", { fields: { body: "Too large" } });
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new AppError("VALIDATION", { fields: { body: "Expected JSON" } }); }
    return json(await handleNotification(body));
  }, { ungated: true });
}
