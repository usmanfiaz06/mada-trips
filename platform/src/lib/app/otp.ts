import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import {
  OTP_LENGTH, OTP_MAX_TRIES, OTP_RESEND_SECONDS, OTP_TTL_SECONDS, checkSaudiMobile, maskPhone, t, tn, type OtpStartResponse,
} from "@mada/shared";
import { db } from "@/db";
import { appOtp } from "@/db/app-schema";
import { pepper, supplierMode } from "./config";
import { appAuditLog } from "./audit";
import { AppError } from "./http";
import { MOCK_OTP_CODE, suppliers } from "./suppliers";

/*
 * Phone sign-in codes (FLOWS.md §1): 6 digits, valid 10 minutes, 3 tries per code then locked, a new code after 30 s.
 * Limits, counted from app_otp itself: 5 codes per number per hour, 20 per network per hour.
 * Only an HMAC of the code is stored. In mock SMS mode the code is always 123456 and is logged instead of sent.
 */

export const OTP_LIMITS = { perPhonePerHour: 5, perIpPerHour: 20 };

const codeHash = (phone: string, code: string) => createHmac("sha256", pepper()).update(`otp:${phone}:${code}`).digest("hex");

export function normalisePhone(raw: string): string {
  const r = checkSaudiMobile(raw);
  if (!r.ok) throw new AppError("PHONE_INVALID", { fields: { phone: r.problem } });
  return r.e164;
}

export async function startOtp(rawPhone: string, ipHash: string | null, now = new Date()): Promise<OtpStartResponse> {
  const phone = normalisePhone(rawPhone);
  const hourAgo = new Date(now.getTime() - 3_600_000);

  const [last] = await db.select({ createdAt: appOtp.createdAt }).from(appOtp).where(eq(appOtp.phone, phone)).orderBy(desc(appOtp.createdAt)).limit(1);
  if (last) {
    const wait = OTP_RESEND_SECONDS - Math.floor((now.getTime() - last.createdAt.getTime()) / 1000);
    if (wait > 0) throw new AppError("OTP_COOLDOWN", { retryAfter: wait, vars: { seconds: wait } });
  }
  const [{ n: perPhone }] = (await db.select({ n: count() }).from(appOtp).where(and(eq(appOtp.phone, phone), gt(appOtp.createdAt, hourAgo)))) as [{ n: number }];
  if (perPhone >= OTP_LIMITS.perPhonePerHour) {
    const [oldest] = await db.select({ createdAt: appOtp.createdAt }).from(appOtp).where(and(eq(appOtp.phone, phone), gt(appOtp.createdAt, hourAgo))).orderBy(appOtp.createdAt).limit(1);
    const retryAfter = Math.max(60, Math.ceil(((oldest?.createdAt.getTime() ?? now.getTime()) + 3_600_000 - now.getTime()) / 1000));
    throw new AppError("OTP_RATE_LIMITED", { retryAfter, vars: { minutes: Math.ceil(retryAfter / 60) } });
  }
  if (ipHash) {
    const [{ n: perIp }] = (await db.select({ n: count() }).from(appOtp).where(and(eq(appOtp.ipHash, ipHash), gt(appOtp.createdAt, hourAgo)))) as [{ n: number }];
    if (perIp >= OTP_LIMITS.perIpPerHour) throw new AppError("RATE_LIMITED", { retryAfter: 3600, vars: { seconds: 3600 } });
  }

  const mock = supplierMode("sms") === "mock";
  const code = mock ? MOCK_OTP_CODE : String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");

  await db.transaction(async (tx) => {
    // A new code replaces any open one for this number.
    await tx.update(appOtp).set({ expiresAt: now }).where(and(eq(appOtp.phone, phone), isNull(appOtp.consumedAt), gt(appOtp.expiresAt, now)));
    await tx.insert(appOtp).values({ phone, codeHash: codeHash(phone, code), expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000), ipHash, createdAt: now });
    await appAuditLog(tx, { actorKind: "system", actorId: null, action: "auth.otp_sent", entityType: "phone", entityId: maskPhone(phone), summary: `Sign-in code sent to ${maskPhone(phone)}`, ipHash });
  });
  await suppliers.sms().send(phone, t("sms.otp", { code }));

  return { phone, resendAfter: OTP_RESEND_SECONDS, expiresIn: OTP_TTL_SECONDS, length: OTP_LENGTH };
}

/** Check a code. Succeeds once per code; wrong codes count down to a lock. Returns the verified E.164 number. */
export async function verifyOtp(rawPhone: string, code: string, now = new Date()): Promise<string> {
  const phone = normalisePhone(rawPhone);
  const [row] = await db.select().from(appOtp).where(and(eq(appOtp.phone, phone), isNull(appOtp.consumedAt))).orderBy(desc(appOtp.createdAt)).limit(1);
  if (!row || row.expiresAt <= now) throw new AppError("OTP_EXPIRED");
  if (row.attempts >= OTP_MAX_TRIES) throw new AppError("OTP_LOCKED", { triesLeft: 0 });

  const a = Buffer.from(codeHash(phone, code), "hex");
  const b = Buffer.from(row.codeHash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    const [u] = await db.update(appOtp).set({ attempts: sql`${appOtp.attempts} + 1` })
      .where(and(eq(appOtp.id, row.id), lt(appOtp.attempts, OTP_MAX_TRIES)))
      .returning({ attempts: appOtp.attempts });
    const left = OTP_MAX_TRIES - (u?.attempts ?? OTP_MAX_TRIES);
    if (left <= 0) throw new AppError("OTP_LOCKED", { triesLeft: 0 });
    throw new AppError("OTP_WRONG", { triesLeft: left, message: tn("otp.wrong", left) });
  }

  const [used] = await db.update(appOtp).set({ consumedAt: now })
    .where(and(eq(appOtp.id, row.id), isNull(appOtp.consumedAt), lt(appOtp.attempts, OTP_MAX_TRIES)))
    .returning({ id: appOtp.id });
  if (!used) throw new AppError("OTP_EXPIRED");
  return phone;
}
