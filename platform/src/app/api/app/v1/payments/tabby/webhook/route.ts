import { json, route } from "@/lib/app/http";
import { handlePayLaterWebhook } from "@/lib/app/suppliers/pay-later";

// POST /payments/tabby/webhook: Tabby's notification, authenticated by X-Mada-Webhook header (TABBY_WEBHOOK_SECRET, registered with the webhook), then read back from Tabby
// before anything acts on it. No traveller token. A repeat changes nothing.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const raw = await req.text();
  if (raw.length > 64_000) return json({ error: { code: "VALIDATION", message: "Too large" } }, 400);
  const ev = await handlePayLaterWebhook("tabby", raw, req.headers, req.url);
  return json({ ok: true, status: ev.status });
}, { ungated: true });
