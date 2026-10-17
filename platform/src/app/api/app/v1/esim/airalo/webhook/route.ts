import { json, route } from "@/lib/app/http";
import { airaloWebhook } from "@/lib/app/esim/service";

// POST /esim/airalo/webhook: Airalo's low-data notices ({ level: 75%|90%|3days|1days, iccid, remaining_percentage }),
// signed with airalo-signature (hex HMAC-SHA512 of the raw body, keyed with AIRALO_CLIENT_SECRET). Opt in with
// POST /v2/notifications/opt-in { type: "webhook_low_data", webhook_url }. Airalo checks the URL with HEAD first.
export const dynamic = "force-dynamic";

export const HEAD = () => new Response(null, { status: 200 });

export const POST = route(async (req) => {
  const raw = await req.text();
  if (raw.length > 16_000) return json({ error: { code: "VALIDATION", message: "Too large" } }, 400);
  return json(await airaloWebhook(raw, req.headers.get("airalo-signature")));
});
