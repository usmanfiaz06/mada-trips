import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Permission } from "./permissions";
import { BASE } from "./base";

export const SESSION_COOKIE = "mada_session";
const SESSION_DAYS = 14;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(schema.sessions).values({
    id: hash(token), userId, expiresAt,
    ip: (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0])?.trim().slice(0, 64) || null,
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: BASE || "/", expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, hash(token)));
  jar.set(SESSION_COOKIE, "", { path: BASE || "/", maxAge: 0 });
}

export type CurrentUser = {
  id: string; name: string; email: string; team: string; locale: string;
  partnerId: string | null; isDirector: boolean; mustChangePassword: boolean;
  role: { id: string; key: string; name: string; nameAr: string };
  permissions: Set<Permission>;
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({ u: schema.users, r: schema.roles, p: schema.partners })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .leftJoin(schema.partners, eq(schema.partners.id, schema.users.partnerId))
    .where(and(eq(schema.sessions.id, hash(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || !row.u.active) return null;
  // Presence for the team page; cheap and not audited.
  if (!row.u.lastSeenAt || Date.now() - row.u.lastSeenAt.getTime() > 60_000) {
    db.update(schema.users).set({ lastSeenAt: new Date() }).where(eq(schema.users.id, row.u.id)).catch(() => {});
  }
  return {
    id: row.u.id, name: row.u.name, email: row.u.email, team: row.u.team, locale: row.u.locale,
    partnerId: row.u.partnerId, isDirector: !!row.p?.isDirector, mustChangePassword: row.u.mustChangePassword,
    role: { id: row.r.id, key: row.r.key, name: row.r.name, nameAr: row.r.nameAr },
    permissions: new Set(row.r.permissions as Permission[]),
  };
});

export async function requireUser() {
  const u = await getCurrentUser();
  if (!u) redirect("/adminwork/login");
  // Someone else chose this password: nothing else works until they pick their own.
  if (u.mustChangePassword && (await headers()).get("x-pathname") !== "/adminwork/me") redirect("/adminwork/me?welcome=1");
  return u;
}

export const can = (u: CurrentUser, p: Permission) => u.permissions.has(p);

/** People who run approvals. Only they see the internal rules, thresholds and who voted; everyone else sees their request's status. */
export const isOversight = (u: CurrentUser) => u.permissions.has("approvals.decide") || u.permissions.has("expenses.verify");

export async function requirePerm(p: Permission) {
  const u = await requireUser();
  if (!can(u, p)) redirect("/adminwork?denied=1");
  return u;
}

/** The caller's IP. On Vercel, x-real-ip and x-forwarded-for are set by the edge, not the browser. */
export async function clientIp() {
  const h = await headers();
  return (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0])?.trim().slice(0, 64) || null;
}
