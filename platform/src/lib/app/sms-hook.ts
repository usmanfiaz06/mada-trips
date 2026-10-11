import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { maskPhone, t } from "@mada/shared";
import { db } from "@/db";
import { appAuditLog } from "./audit";
import type { PhoneCodeChannel } from "@mada/shared";
import { e164From, latestHint, markSent, phoneChannels, phoneCodeSetting } from "./phone-channel";
import { suppliers } from "./suppliers";

/*
 * Supabase Auth's "Send SMS" hook (docs/app/AUTH.md). Supabase makes the code; we deliver it on WhatsApp through Zoho
 * CPaaS (an approved Authentication template) or by SMS through a Saudi sender (Unifonic or Taqnyat, registered sender
 * ID), which reaches Saudi numbers far better than Twilio does. phone-channel.ts picks which.
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

export type Delivered = { channel: PhoneCodeChannel; fellBack: boolean };

/**
 * Sends Supabase's code on WhatsApp (Zoho CPaaS) or by SMS (phone-channel.ts decides): the app's hint for this number
 * if it left one, otherwise the usual channel. With PHONE_CODE_CHANNEL=whatsapp_then_sms a WhatsApp refusal (not on
 * WhatsApp, undelivered, the template refused) or outage sends the same code by SMS at once. Arabic when the person
 * reads Arabic (user_metadata.locale). Never logs the code.
 */
export async function deliverAuthSms(p: SmsHookPayload, ipHash: string | null): Promise<Delivered> {
  const to = e164From(p.user.new_phone || p.user.phone || "");
  if (!to) throw new Error("no phone number");
  const locale = p.user.user_metadata?.locale === "ar" ? "ar" : "en";
  const channels = phoneChannels();
  const hint = await latestHint(to).catch(() => null);
  let channel: PhoneCodeChannel = hint?.wanted && channels.includes(hint.wanted) ? hint.wanted : channels[0]!;
  let fellBack = false;
  if (channel === "whatsapp") {
    try {
      await suppliers.whatsappCodes().sendAuthCode(to, p.sms.otp, locale);
    } catch (e) {
      if (phoneCodeSetting() !== "whatsapp_then_sms" || !channels.includes("sms")) throw e;
      console.warn(`[app-api] auth/sms-hook: WhatsApp didn't take the code for ${maskPhone(to)}, sending by SMS (${e instanceof Error ? e.name : "unknown"})`);
      channel = "sms";
      fellBack = true;
    }
  }
  if (channel === "sms") await suppliers.sms().send(to, t("sms.otp", { code: p.sms.otp }, locale));
  if (hint) await markSent(hint.id, channel).catch(() => {});
  const how = channel === "whatsapp" ? "on WhatsApp" : fellBack ? "by SMS (WhatsApp refused)" : "by SMS";
  await appAuditLog(db, { actorKind: "system", actorId: null, action: "auth.otp_sent", entityType: "phone", entityId: maskPhone(to), summary: `Sign-in code sent ${how} to ${maskPhone(to)}`, data: { via: "supabase-hook", channel, fellBack, locale }, ipHash });
  return { channel, fellBack };
}
