import { json, route } from "@/lib/app/http";
import { handleWebhook } from "@/lib/app/booking/payments";

// POST /payments/webhook (MyFatoorah) with X-MF-Signature: hex HMAC-SHA256 of the raw body. No traveller token: the
// signature is the authentication. A repeated event id changes nothing (idempotent).
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const raw = await req.text();
  if (raw.length > 64_000) return json({ error: { code: "VALIDATION", message: "Too large" } }, 400);
  const r = await handleWebhook(raw, req.headers.get("x-mf-signature"));
  return json({ ok: true, ...r });
});
