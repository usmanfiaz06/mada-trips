import { json, route } from "@/lib/app/http";
import { handlePayLaterWebhook } from "@/lib/app/suppliers/pay-later";

// POST /payments/tamara/webhook: Tamara's notification, authenticated by a JWT signed with TAMARA_NOTIFICATION_TOKEN (tamaraToken or Authorization), then read back from Tamara
// before anything acts on it. No traveller token. A repeat changes nothing.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const raw = await req.text();
  if (raw.length > 64_000) return json({ error: { code: "VALIDATION", message: "Too large" } }, 400);
  const ev = await handlePayLaterWebhook("tamara", raw, req.headers, req.url);
  return json({ ok: true, status: ev.status });
}, { ungated: true });
