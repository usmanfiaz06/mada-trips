import "server-only";
import { createHmac } from "node:crypto";
import { and, count, desc, eq, gt } from "drizzle-orm";
import { PHONE_CHANNEL_HINT_SECONDS, PHONE_CHANNEL_LIMITS, type PhoneChannelRequest, type PhoneChannelResponse, type PhoneChannelSent, type PhoneCodeChannel } from "@mada/shared";
import { db } from "@/db";
import { appPhoneCodeHints } from "@/db/app-schema-phone-codes";
import { pepper, supplierMode } from "./config";
import { AppError } from "./http";
import { zohoWhatsAppConfigured } from "./suppliers";

/*
 * Which way a phone sign-in code travels: WhatsApp (Zoho CPaaS) or SMS (Unifonic / Taqnyat). docs/app/AUTH.md,
 * "Phone codes on WhatsApp (Zoho CPaaS)".
 *
 *   PHONE_CODE_CHANNEL  whatsapp           WhatsApp first; the app offers "Send by SMS instead"
 *                       sms                SMS first; the app offers "Send on WhatsApp instead" when it's set up
 *                       whatsapp_then_sms  WhatsApp first, and SMS at once if WhatsApp refuses or isn't answering
 *                       (unset)            whatsapp when WhatsApp is set up, else sms
 *
 * A channel is "set up" in mock mode always, in live mode when its credentials are present. GET /config tells the app
 * which channels exist (phoneChannels, the usual one first). Supabase doesn't pass the app's channel to the Send SMS
 * hook, so the app leaves a hint here first (POST /auth/phone-channel); the hook reads it and writes down how the code
 * went, which the app reads back with the ticket.
 */

export type PhoneCodeSetting = "whatsapp" | "sms" | "whatsapp_then_sms";

function liveOr(name: "sms" | "whatsapp", live: () => boolean): boolean {
  try {
    return supplierMode(name) === "live" ? live() : true;
  } catch {
    return false; // mock on a production deployment without APP_ALLOW_MOCKS: not usable
  }
}

export const whatsappReady = () => liveOr("whatsapp", zohoWhatsAppConfigured);
export const smsReady = () => liveOr("sms", () => (process.env.SMS_PROVIDER === "taqnyat"
  ? !!(process.env.TAQNYAT_BEARER_TOKEN && process.env.TAQNYAT_SENDER_NAME)
  : !!(process.env.UNIFONIC_APP_SID && process.env.UNIFONIC_SENDER_ID)));

export function phoneCodeSetting(): PhoneCodeSetting {
  const v = process.env.PHONE_CODE_CHANNEL?.trim().toLowerCase();
  if (v === "whatsapp" || v === "sms" || v === "whatsapp_then_sms") return v;
  return whatsappReady() ? "whatsapp" : "sms";
}

/** The channels this server can send by, the usual one first. Never empty: SMS answers NOT_CONFIGURED if nothing is. */
export function phoneChannels(): PhoneCodeChannel[] {
  const first: PhoneCodeChannel = phoneCodeSetting() === "sms" ? "sms" : "whatsapp";
  const ready = (["whatsapp", "sms"] as const).filter((c) => (c === "whatsapp" ? whatsappReady() : smsReady()));
  if (!ready.length) return ["sms"];
  return ready.includes(first) ? [first, ...ready.filter((c) => c !== first)] : [...ready];
}

/** The number as we keep it in hints: a keyed hash, never the digits. */
export const phoneHash = (e164: string) => createHmac("sha256", pepper()).update(`phone:${e164}`).digest("hex").slice(0, 40);

/** E.164 from anything with 8 to 15 digits (Supabase stores numbers without the plus). */
export function e164From(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

/** POST /auth/phone-channel: the app's hint for the next code to this number. Limited per network and per number. */
export async function leaveHint(input: PhoneChannelRequest, ctx: { ipHash: string | null }, now = new Date()): Promise<PhoneChannelResponse> {
  const phone = e164From(input.phone);
  if (!phone) throw new AppError("VALIDATION", { fields: { phone: "Expected a phone number with its country code" } });
  const hash = phoneHash(phone);
  const since = new Date(now.getTime() - 600_000);
  if (ctx.ipHash) {
    const [{ n }] = (await db.select({ n: count() }).from(appPhoneCodeHints).where(and(eq(appPhoneCodeHints.ipHash, ctx.ipHash), gt(appPhoneCodeHints.createdAt, since)))) as [{ n: number }];
    if (n >= PHONE_CHANNEL_LIMITS.perIpPer10Min) throw new AppError("RATE_LIMITED", { retryAfter: 600 });
  }
  const [{ n: perPhone }] = (await db.select({ n: count() }).from(appPhoneCodeHints).where(and(eq(appPhoneCodeHints.phoneHash, hash), gt(appPhoneCodeHints.createdAt, since)))) as [{ n: number }];
  if (perPhone >= PHONE_CHANNEL_LIMITS.perPhonePer10Min) throw new AppError("RATE_LIMITED", { retryAfter: 600 });

  const channels = phoneChannels();
  const wanted = input.channel && channels.includes(input.channel) ? input.channel : null;
  const [row] = await db.insert(appPhoneCodeHints).values({ phoneHash: hash, wanted, ipHash: ctx.ipHash, createdAt: now }).returning({ id: appPhoneCodeHints.id });
  return { ticket: row!.id, channels };
}

/** GET /auth/phone-channel/{ticket}. An unknown or old ticket reads as "nothing sent yet". */
export async function ticketStatus(ticket: string, now = new Date()): Promise<PhoneChannelSent> {
  const [row] = await db.select({ sentVia: appPhoneCodeHints.sentVia, createdAt: appPhoneCodeHints.createdAt })
    .from(appPhoneCodeHints).where(eq(appPhoneCodeHints.id, ticket)).limit(1);
  if (!row || now.getTime() - row.createdAt.getTime() > PHONE_CHANNEL_HINT_SECONDS * 1000) return { sentVia: null };
  return { sentVia: row.sentVia === "whatsapp" || row.sentVia === "sms" ? row.sentVia : null };
}

/** The hook's side: the newest hint for this number from the last 10 minutes, if any. */
export async function latestHint(e164: string, now = new Date()): Promise<{ id: string; wanted: PhoneCodeChannel | null } | null> {
  const since = new Date(now.getTime() - PHONE_CHANNEL_HINT_SECONDS * 1000);
  const [row] = await db.select({ id: appPhoneCodeHints.id, wanted: appPhoneCodeHints.wanted }).from(appPhoneCodeHints)
    .where(and(eq(appPhoneCodeHints.phoneHash, phoneHash(e164)), gt(appPhoneCodeHints.createdAt, since)))
    .orderBy(desc(appPhoneCodeHints.createdAt)).limit(1);
  if (!row) return null;
  return { id: row.id, wanted: row.wanted === "whatsapp" || row.wanted === "sms" ? row.wanted : null };
}

export async function markSent(hintId: string, via: PhoneCodeChannel, now = new Date()) {
  await db.update(appPhoneCodeHints).set({ sentVia: via, sentAt: now }).where(eq(appPhoneCodeHints.id, hintId));
}
