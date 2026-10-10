import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { maskPhone, t } from "@mada/shared";
import { db } from "@/db";
import { appAuditLog } from "./audit";
import { suppliers } from "./suppliers";

/*
 * Supabase Auth's "Send SMS" hook (docs/app/AUTH.md). Supabase makes the code; we deliver it through a Saudi sender
 * (Unifonic or Taqnyat, registered sender ID), which reaches Saudi numbers far better than Twilio does.
 *
 * Calls are signed with Standard Webhooks (https://www.standardwebhooks.com): headers webhook-id, webhook-timestamp and
 * webhook-signature ("v1,<base64 HMAC-SHA256 of `${id}.${timestamp}.${body}`>", several separated by spaces), keyed by
 * SUPABASE_SMS_HOOK_SECRET ("v1,whsec_<base64>"). Calls older or newer than 5 minutes are refused (replays).
 */

export const HOOK_TOLERANCE_SECONDS = 5 * 60;

function secretBytes(secret: string): Buffer {
  const raw = secret.trim().replace(/^v1,/, "").replace(/^whsec_/, "");
  return Buffer.from(raw, "base64");
}

export function signStandardWebhook(secret: string, id: string, timestamp: number, body: string): string {
  return `v1,${createHmac("sha256", secretBytes(secret)).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

export type HookCheck = { ok: true } | { ok: false; reason: "missing" | "stale" | "signature" };

export function verifyStandardWebhook(secret: string, headers: Headers, body: string, now = Date.now()): HookCheck {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigs = headers.get("webhook-signature");
  if (!id || !ts || !sigs || !/^\d+$/.test(ts)) return { ok: false, reason: "missing" };
  if (Math.abs(Math.floor(now / 1000) - Number(ts)) > HOOK_TOLERANCE_SECONDS) return { ok: false, reason: "stale" };
  const expected = Buffer.from(signStandardWebhook(secret, id, Number(ts), body).slice(3), "base64");
  for (const part of sigs.split(" ")) {
    const [version, sig] = part.split(",", 2);
    if (version !== "v1" || !sig) continue;
    const got = Buffer.from(sig, "base64");
    if (got.length === expected.length && timingSafeEqual(got, expected)) return { ok: true };
  }
  return { ok: false, reason: "signature" };
}

/** The parts of Supabase's payload we use. A phone change sends the code to the new number. */
export const SmsHookPayload = z.object({
  user: z.object({
    id: z.string().optional(),
    phone: z.string().optional().nullable(),
    new_phone: z.string().optional().nullable(),
    user_metadata: z.object({ locale: z.string().optional() }).passthrough().optional().nullable(),
  }).passthrough(),
  sms: z.object({ otp: z.string().regex(/^\d{4,10}$/) }).passthrough(),
});
export type SmsHookPayload = z.infer<typeof SmsHookPayload>;

/** Supabase reads `{ error: { http_code, message } }` on failure, `{}` on success. */
export const hookError = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { http_code: status, message } }), { status, headers: { "content-type": "application/json" } });

export async function deliverAuthSms(p: SmsHookPayload, ipHash: string | null): Promise<void> {
  const digits = (p.user.new_phone || p.user.phone || "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) throw new Error("no phone number");
  const to = `+${digits}`;
  const locale = p.user.user_metadata?.locale === "ar" ? "ar" : "en";
  await suppliers.sms().send(to, t("sms.otp", { code: p.sms.otp }, locale));
  await appAuditLog(db, { actorKind: "system", actorId: null, action: "auth.otp_sent", entityType: "phone", entityId: maskPhone(to), summary: `Sign-in code sent to ${maskPhone(to)}`, data: { via: "supabase-hook" }, ipHash });
}
