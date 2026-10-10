import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";
import {
  TravelPrefs, maskPhone, t, tn, type Account, type Consents, type Device, type TravelPrefs as Prefs, type UpdateAccountRequest,
} from "@mada/shared";
import { db, type Tx } from "@/db";
import { appSessions, appUsers } from "@/db/app-schema";
import { appAccounts, appConsentEvents, appEmailCodes } from "@/db/app-schema-wallet";
import { appAuditLog } from "../audit";
import { pepper, supplierMode } from "../config";
import { AppError } from "../http";
import { normalisePhone, startOtp, verifyOtp } from "../otp";
import { suppliers, MOCK_OTP_CODE } from "../suppliers";
import { revokeSession } from "../tokens";
import { attachPhone } from "../users";

/*
 * Account settings beyond /me (Account.jsx): what Mada calls you, home airport, currency, travel preferences,
 * Face ID for the Wallet, consents, email and phone changes, sign-in methods and signed-in devices.
 */

type AccountRow = typeof appAccounts.$inferSelect;

export const DEFAULT_PREFS: Prefs = { seat: "any", together: true, meal: "halal", assist: [], loyalty: [], notes: "" };

/** The row, created on first use. */
export async function accountRow(userId: string, tx: Tx | typeof db = db): Promise<AccountRow> {
  const [r] = await tx.select().from(appAccounts).where(eq(appAccounts.userId, userId));
  if (r) return r;
  const [made] = await tx.insert(appAccounts).values({ userId, prefs: DEFAULT_PREFS }).onConflictDoNothing().returning();
  if (made) return made;
  const [again] = await tx.select().from(appAccounts).where(eq(appAccounts.userId, userId));
  return again!;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function toAccount(r: AccountRow): Account {
  const prefs = TravelPrefs.safeParse({ ...DEFAULT_PREFS, ...(r.prefs ?? {}) });
  return {
    preferredName: r.preferredName, preferredAt: iso(r.preferredAt), home: r.home, homeAt: iso(r.homeAt),
    currency: r.currency as Account["currency"], arabicNotify: r.arabicNotify, prefs: prefs.success ? prefs.data : DEFAULT_PREFS,
    faceId: r.faceId, consents: { marketing: r.marketing, analytics: r.analytics },
    photo: r.photoFileId && r.photoAt ? { updatedAt: r.photoAt.toISOString() } : null,
    emailVerifiedAt: iso(r.emailVerifiedAt), phoneVerifiedAt: iso(r.phoneVerifiedAt),
    deleteAt: iso(r.deleteAt), exportRequestedAt: iso(r.exportRequestedAt),
  };
}

export async function getAccount(userId: string): Promise<Account> {
  return toAccount(await accountRow(userId));
}

export async function updateAccount(userId: string, patch: UpdateAccountRequest, ipHash: string | null): Promise<Account> {
  return db.transaction(async (tx) => {
    await accountRow(userId, tx);
    const now = new Date();
    const set: Partial<typeof appAccounts.$inferInsert> = { updatedAt: now };
    if (patch.preferredName !== undefined) { set.preferredName = patch.preferredName; set.preferredAt = patch.preferredName ? now : null; }
    if (patch.home) { set.home = patch.home; set.homeAt = now; }
    if (patch.currency) set.currency = patch.currency;
    if (patch.arabicNotify !== undefined) set.arabicNotify = patch.arabicNotify;
    if (patch.prefs) set.prefs = TravelPrefs.parse(patch.prefs);
    if (patch.faceId !== undefined) set.faceId = patch.faceId;
    const [r] = await tx.update(appAccounts).set(set).where(eq(appAccounts.userId, userId)).returning();
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "account.settings_updated", entityType: "app_user", entityId: userId, summary: `Updated ${Object.keys(patch).join(", ")}`, data: { fields: Object.keys(patch) }, ipHash });
    return toAccount(r!);
  });
}

/* ───────────── consents (PDPL): every change is kept ───────────── */

export async function getConsents(userId: string) {
  const r = await accountRow(userId);
  const history = await db.select().from(appConsentEvents).where(eq(appConsentEvents.userId, userId)).orderBy(desc(appConsentEvents.createdAt)).limit(50);
  return {
    consents: { marketing: r.marketing, analytics: r.analytics },
    history: history.map((h) => ({ consent: h.consent as keyof Consents, granted: h.granted, at: h.createdAt.toISOString() })),
  };
}

export async function updateConsents(userId: string, patch: Partial<Consents>, ipHash: string | null) {
  await db.transaction(async (tx) => {
    const before = await accountRow(userId, tx);
    const set: Partial<typeof appAccounts.$inferInsert> = { updatedAt: new Date() };
    for (const k of ["marketing", "analytics"] as const) {
      const v = patch[k];
      if (v === undefined || v === before[k]) continue;
      set[k] = v;
      await tx.insert(appConsentEvents).values({ userId, consent: k, granted: v, ipHash });
      await appAuditLog(tx, { actorKind: "user", actorId: userId, action: v ? "consent.granted" : "consent.withdrawn", entityType: "app_user", entityId: userId, summary: `${v ? "Allowed" : "Withdrew"} ${k}`, ipHash });
    }
    await tx.update(appAccounts).set(set).where(eq(appAccounts.userId, userId));
  });
  return getConsents(userId);
}

/* ───────────── email: a code proves it's yours ───────────── */

const EMAIL_CODE_TTL = 10 * 60_000;
const EMAIL_RESEND_S = 30;
const MAX_TRIES = 3;
const emailHash = (userId: string, email: string, code: string) => createHmac("sha256", pepper()).update(`email:${userId}:${email}:${code}`).digest("hex");

export async function startEmailChange(userId: string, rawEmail: string, ipHash: string | null) {
  const email = rawEmail.trim().toLowerCase();
  const [u] = await db.select({ email: appUsers.email }).from(appUsers).where(eq(appUsers.id, userId));
  if (u?.email && u.email.toLowerCase() === email) throw new AppError("VALIDATION", { copy: "account.email.same", fields: { email: "same" } });
  const [last] = await db.select({ createdAt: appEmailCodes.createdAt }).from(appEmailCodes).where(eq(appEmailCodes.userId, userId)).orderBy(desc(appEmailCodes.createdAt)).limit(1);
  const wait = last ? EMAIL_RESEND_S - Math.floor((Date.now() - last.createdAt.getTime()) / 1000) : 0;
  if (wait > 0) throw new AppError("OTP_COOLDOWN", { retryAfter: wait, vars: { seconds: wait } });
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(appEmailCodes).where(and(eq(appEmailCodes.userId, userId), gt(appEmailCodes.createdAt, new Date(Date.now() - 3_600_000))))) as [{ n: number }];
  if (n >= 5) throw new AppError("OTP_RATE_LIMITED", { retryAfter: 3600, vars: { minutes: 60 } });
  const code = supplierMode("email") === "mock" ? MOCK_OTP_CODE : String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.transaction(async (tx) => {
    await tx.update(appEmailCodes).set({ expiresAt: new Date() }).where(and(eq(appEmailCodes.userId, userId), isNull(appEmailCodes.consumedAt)));
    await tx.insert(appEmailCodes).values({ userId, email, codeHash: emailHash(userId, email, code), expiresAt: new Date(Date.now() + EMAIL_CODE_TTL) });
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "account.email_code_sent", entityType: "app_user", entityId: userId, summary: "Email code sent", ipHash });
  });
  await suppliers.email().send({ to: email, subject: "Your Mada Trips code", text: t("sms.otp", { code }) });
  return { to: email, resendAfter: EMAIL_RESEND_S, expiresIn: EMAIL_CODE_TTL / 1000 };
}

export async function verifyEmailChange(userId: string, rawEmail: string, code: string, ipHash: string | null) {
  const email = rawEmail.trim().toLowerCase();
  const [row] = await db.select().from(appEmailCodes).where(and(eq(appEmailCodes.userId, userId), eq(appEmailCodes.email, email), isNull(appEmailCodes.consumedAt))).orderBy(desc(appEmailCodes.createdAt)).limit(1);
  if (!row || row.expiresAt <= new Date()) throw new AppError("OTP_EXPIRED");
  if (row.attempts >= MAX_TRIES) throw new AppError("OTP_LOCKED", { triesLeft: 0 });
  const a = Buffer.from(emailHash(userId, email, code), "hex");
  const b = Buffer.from(row.codeHash, "hex");
  if (!timingSafeEqual(a, b)) {
    const [u] = await db.update(appEmailCodes).set({ attempts: sql`${appEmailCodes.attempts} + 1` }).where(and(eq(appEmailCodes.id, row.id), lt(appEmailCodes.attempts, MAX_TRIES))).returning({ attempts: appEmailCodes.attempts });
    const left = MAX_TRIES - (u?.attempts ?? MAX_TRIES);
    if (left <= 0) throw new AppError("OTP_LOCKED", { triesLeft: 0 });
    throw new AppError("OTP_WRONG", { triesLeft: left, message: tn("account.code.wrong", left) });
  }
  return db.transaction(async (tx) => {
    const [used] = await tx.update(appEmailCodes).set({ consumedAt: new Date() }).where(and(eq(appEmailCodes.id, row.id), isNull(appEmailCodes.consumedAt))).returning({ id: appEmailCodes.id });
    if (!used) throw new AppError("OTP_EXPIRED");
    const [user] = await tx.update(appUsers).set({ email, emailRelay: false, updatedAt: new Date() }).where(eq(appUsers.id, userId)).returning();
    await accountRow(userId, tx);
    await tx.update(appAccounts).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(appAccounts.userId, userId));
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "account.email_verified", entityType: "app_user", entityId: userId, summary: "Email verified and saved", ipHash });
    return user!;
  });
}

/* ───────────── phone: the same codes as sign-in ───────────── */

export async function startPhoneChange(userId: string, rawPhone: string, ipHash: string | null) {
  const phone = normalisePhone(rawPhone);
  const [u] = await db.select({ phone: appUsers.phone }).from(appUsers).where(eq(appUsers.id, userId));
  if (u?.phone === phone) throw new AppError("VALIDATION", { copy: "account.phone.same", fields: { phone: "same" } });
  const [owner] = await db.select({ id: appUsers.id }).from(appUsers).where(and(eq(appUsers.phone, phone), isNull(appUsers.deletedAt), ne(appUsers.id, userId)));
  if (owner) throw new AppError("PHONE_TAKEN", { copy: "account.phone.taken" });
  const r = await startOtp(phone, ipHash);
  return { to: maskPhone(r.phone), resendAfter: r.resendAfter, expiresIn: r.expiresIn };
}

export async function verifyPhoneChange(userId: string, rawPhone: string, code: string, ipHash: string | null) {
  const phone = await verifyOtp(rawPhone, code);
  return db.transaction(async (tx) => {
    const user = await attachPhone(tx, userId, phone, ipHash);
    await accountRow(userId, tx);
    await tx.update(appAccounts).set({ phoneVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(appAccounts.userId, userId));
    return user;
  });
}

/* ───────────── sign-in methods ───────────── */

const methodCount = (u: typeof appUsers.$inferSelect) => [u.appleSub, u.googleSub, u.phone].filter(Boolean).length;

export async function linkMethod(userId: string, provider: "apple" | "google", idToken: string, nonce: string | undefined, ipHash: string | null) {
  let id;
  try { id = await suppliers.identity().verify(provider, idToken, nonce); } catch (e) { if (e instanceof AppError) throw e; throw new AppError("UNAUTHORIZED"); }
  const col = provider === "apple" ? appUsers.appleSub : appUsers.googleSub;
  return db.transaction(async (tx) => {
    const [other] = await tx.select({ id: appUsers.id }).from(appUsers).where(and(eq(col, id.sub), isNull(appUsers.deletedAt), ne(appUsers.id, userId)));
    if (other) throw new AppError("PHONE_TAKEN", { copy: "signinMethods.taken", vars: { name: provider === "apple" ? "Apple" : "Google" } });
    const [before] = await tx.select().from(appUsers).where(eq(appUsers.id, userId));
    const set: Partial<typeof appUsers.$inferInsert> = provider === "apple" ? { appleSub: id.sub } : { googleSub: id.sub };
    if (!before?.email && id.email) { set.email = id.email; set.emailRelay = id.isPrivateEmail; }
    const [u] = await tx.update(appUsers).set({ ...set, updatedAt: new Date() }).where(eq(appUsers.id, userId)).returning();
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "account.method_linked", entityType: "app_user", entityId: userId, summary: `Linked ${provider === "apple" ? "Apple" : "Google"} sign-in`, ipHash });
    return u!;
  });
}

/** Remove a way in. Never the last one (Account.jsx: "This is your only way in."). */
export async function unlinkMethod(userId: string, method: "apple" | "google" | "phone", ipHash: string | null) {
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(appUsers).where(eq(appUsers.id, userId)).for("update");
    if (!u) throw new AppError("UNAUTHORIZED");
    const has = method === "apple" ? !!u.appleSub : method === "google" ? !!u.googleSub : !!u.phone;
    if (!has) throw new AppError("NOT_FOUND");
    if (methodCount(u) <= 1) throw new AppError("FORBIDDEN", { copy: "error.lastMethod" });
    const set: Partial<typeof appUsers.$inferInsert> = method === "apple" ? { appleSub: null } : method === "google" ? { googleSub: null } : { phone: null };
    const [after] = await tx.update(appUsers).set({ ...set, updatedAt: new Date() }).where(eq(appUsers.id, userId)).returning();
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "account.method_removed", entityType: "app_user", entityId: userId, summary: `Removed ${method} sign-in`, ipHash });
    return after!;
  });
}

/* ───────────── devices (sessions) ───────────── */

export async function listDevices(userId: string, currentSessionId: string): Promise<Device[]> {
  const rows = await db.select().from(appSessions).where(and(eq(appSessions.userId, userId), isNull(appSessions.revokedAt), gt(appSessions.expiresAt, new Date()))).orderBy(desc(appSessions.lastUsedAt));
  return rows.map((s) => ({
    id: s.id,
    name: s.deviceName || (s.platform === "web" ? t("security.device.web") : t("security.device.unknown")),
    platform: s.platform, current: s.id === currentSessionId,
    lastUsedAt: s.lastUsedAt.toISOString(), createdAt: s.createdAt.toISOString(),
  })).sort((a, b) => Number(b.current) - Number(a.current));
}

export async function signOutDevice(userId: string, sessionId: string, ipHash: string | null) {
  const [s] = await db.select({ id: appSessions.id }).from(appSessions).where(and(eq(appSessions.id, sessionId), eq(appSessions.userId, userId), isNull(appSessions.revokedAt)));
  if (!s) throw new AppError("NOT_FOUND");
  await revokeSession(sessionId, "signed_out_by_owner");
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: "auth.device_signed_out", entityType: "app_session", entityId: sessionId, summary: "Signed out another device", ipHash });
}

/** Every session, this one included (the app then signs out here too). */
export async function signOutEverywhere(userId: string, ipHash: string | null) {
  await db.update(appSessions).set({ revokedAt: new Date(), revokedReason: "signed_out_everywhere" }).where(and(eq(appSessions.userId, userId), isNull(appSessions.revokedAt)));
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: "auth.signed_out_everywhere", entityType: "app_user", entityId: userId, summary: "Signed out on every device", ipHash });
}
