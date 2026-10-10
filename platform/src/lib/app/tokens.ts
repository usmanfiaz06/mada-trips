import "server-only";
import { setRequestLocale } from "./resilience/request";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS, type AuthTokens, type DeviceInfo } from "@mada/shared";
import { db, type Tx } from "@/db";
import { appSessions, appUsers } from "@/db/app-schema";
import { jwtSecret } from "./config";
import { AppError } from "./http";

/*
 * Sessions. A short-lived access token (JWT, HS256, 15 minutes) for every API call, and a long-lived refresh token
 * (opaque, 256 bits) that is stored only as a SHA-256 hash and rotates on every use. Presenting an already-rotated
 * refresh token means it was copied: the whole session is revoked.
 */

const ISSUER = "mada-core";
const AUDIENCE = "mada-app";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newRefreshToken = () => `mrt_${randomBytes(32).toString("base64url")}`;

async function signAccess(userId: string, sessionId: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + ACCESS_TOKEN_TTL_SECONDS;
  const token = await new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt(Math.floor(now / 1000)).setExpirationTime(exp)
    .sign(jwtSecret());
  return { token, expiresAt: new Date(exp * 1000) };
}

export type SessionContext = { device?: DeviceInfo | null; ip?: string | null; userAgent?: string | null };

export async function createSession(tx: Tx | typeof db, userId: string, ctx: SessionContext = {}): Promise<AuthTokens> {
  const refresh = newRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  const [s] = await tx.insert(appSessions).values({
    userId, refreshHash: sha256(refresh), expiresAt: refreshExpiresAt,
    platform: ctx.device?.platform ?? null, deviceName: ctx.device?.name ?? null, appVersion: ctx.device?.appVersion ?? null,
    ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null,
  }).returning({ id: appSessions.id });
  const access = await signAccess(userId, s!.id);
  return { accessToken: access.token, accessExpiresAt: access.expiresAt.toISOString(), refreshToken: refresh, refreshExpiresAt: refreshExpiresAt.toISOString() };
}

/** Swap a refresh token for a new pair. Atomic: two racing refreshes can't both win. */
export async function rotateRefresh(refreshToken: string): Promise<{ tokens: AuthTokens; userId: string }> {
  const oldHash = sha256(refreshToken);
  const next = newRefreshToken();
  const now = new Date();
  const [s] = await db.update(appSessions)
    .set({ refreshHash: sha256(next), previousHash: oldHash, lastUsedAt: now })
    .where(and(eq(appSessions.refreshHash, oldHash), isNull(appSessions.revokedAt)))
    .returning({ id: appSessions.id, userId: appSessions.userId, expiresAt: appSessions.expiresAt });

  if (!s) {
    // Reuse of a rotated token: someone else has it. End that session everywhere.
    const [stolen] = await db.update(appSessions)
      .set({ revokedAt: now, revokedReason: "refresh_reuse" })
      .where(and(eq(appSessions.previousHash, oldHash), isNull(appSessions.revokedAt)))
      .returning({ id: appSessions.id });
    throw new AppError(stolen ? "SESSION_REVOKED" : "UNAUTHORIZED");
  }
  if (s.expiresAt < now) {
    await revokeSession(s.id, "expired");
    throw new AppError("SESSION_REVOKED");
  }
  const [u] = await db.select({ deletedAt: appUsers.deletedAt }).from(appUsers).where(eq(appUsers.id, s.userId));
  if (!u || u.deletedAt) throw new AppError("UNAUTHORIZED");
  const access = await signAccess(s.userId, s.id);
  return {
    userId: s.userId,
    tokens: { accessToken: access.token, accessExpiresAt: access.expiresAt.toISOString(), refreshToken: next, refreshExpiresAt: s.expiresAt.toISOString() },
  };
}

export async function revokeSession(sessionId: string, reason: string) {
  await db.update(appSessions).set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(appSessions.id, sessionId), isNull(appSessions.revokedAt)));
}

export async function revokeByRefresh(refreshToken: string, reason: string) {
  const [s] = await db.update(appSessions).set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(appSessions.refreshHash, sha256(refreshToken)), isNull(appSessions.revokedAt)))
    .returning({ id: appSessions.id, userId: appSessions.userId });
  return s ?? null;
}

export type AppAuth = { userId: string; sessionId: string };

/** Verify the Bearer access token, then check the session is still live (so sign-out takes effect at once). */
export async function authenticate(req: Request): Promise<AppAuth> {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+([\w-]+\.[\w-]+\.[\w-]+)$/i.exec(h.trim());
  if (!m) throw new AppError("UNAUTHORIZED");
  let sub: string, sid: string;
  try {
    const { payload } = await jwtVerify(m[1]!, jwtSecret(), { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
    sub = String(payload.sub ?? "");
    sid = String(payload.sid ?? "");
  } catch (e) {
    throw new AppError(e instanceof joseErrors.JWTExpired ? "TOKEN_EXPIRED" : "UNAUTHORIZED");
  }
  const [row] = await db.select({ revokedAt: appSessions.revokedAt, userId: appSessions.userId, deletedAt: appUsers.deletedAt, locale: appUsers.locale })
    .from(appSessions).innerJoin(appUsers, eq(appUsers.id, appSessions.userId))
    .where(eq(appSessions.id, sid)).limit(1);
  if (!row || row.userId !== sub) throw new AppError("UNAUTHORIZED");
  if (row.revokedAt) throw new AppError("SESSION_REVOKED");
  if (row.deletedAt) throw new AppError("UNAUTHORIZED");
  // From here the request speaks the traveller's saved language (resilience/request.ts).
  setRequestLocale(row.locale);
  return { userId: sub, sessionId: sid };
}

/** Like authenticate, but returns null when there is no Authorization header at all. */
export async function authenticateOptional(req: Request): Promise<AppAuth | null> {
  return req.headers.has("authorization") ? authenticate(req) : null;
}
