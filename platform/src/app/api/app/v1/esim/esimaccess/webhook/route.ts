import { clientIp, json, route } from "@/lib/app/http";
import { esimAccessWebhook } from "@/lib/app/esim/service";
import { esimAccessWebhookAllowed } from "@/lib/app/suppliers/live/esimaccess";

// POST /esim/esimaccess/webhook?key=<ESIMACCESS_WEBHOOK_SECRET>: eSIM Access's notices (ORDER_STATUS, ESIM_STATUS,
// SMDP_EVENT, DATA_USAGE, VALIDITY_USAGE, CHECK_HEALTH), { notifyType, notifyId, eventGenerateTime, content }. They are
// not signed: the key in the URL (or, without one, their sender IPs) lets a call in, and every notice is checked
// against their API before it changes anything. Paste the full URL in eSIM Access › Developer › Webhook; saving it
// sends CHECK_HEALTH, which must answer 200.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const raw = await req.text();
  if (raw.length > 32_000) return json({ error: { code: "VALIDATION", message: "Too large" } }, 400);
  const allowed = esimAccessWebhookAllowed(new URL(req.url).searchParams.get("key"), clientIp(req));
  return json(await esimAccessWebhook(raw, { allowed }));
});
