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
  /** Set for people at a corporate client. They only ever reach /adminwork/portal. */
  clientId: string | null; clientRole: ClientRole | null;
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
    clientId: row.u.clientId, clientRole: (row.u.clientRole as ClientRole | null) ?? null,
    role: { id: row.r.id, key: row.r.key, name: row.r.name, nameAr: row.r.nameAr },
    permissions: new Set(row.r.permissions as Permission[]),
  };
});

export type ClientRole = "admin" | "approver" | "requester" | "viewer";
export const PORTAL_HOME = "/adminwork/portal";
const PORTAL_ACCOUNT = "/adminwork/portal/account";

/**
 * A signed-in member of Mada staff. People at a corporate client are sent to their own workspace: every staff page
 * and staff action goes through here (or requirePerm), so none of them can ever run for a client login.
 * `allowClient` is only for the few actions both share (changing your own password or language).
 */
export async function requireUser(opts: { allowClient?: boolean } = {}) {
  const u = await getCurrentUser();
  if (!u) redirect("/adminwork/login");
  if (u.clientId && !opts.allowClient) redirect(PORTAL_HOME);
  // Someone else chose this password: nothing else works until they pick their own.
  const path = (await headers()).get("x-pathname");
  const changeAt = u.clientId ? PORTAL_ACCOUNT : "/adminwork/me";
  if (u.mustChangePassword && path !== changeAt && !opts.allowClient) redirect(`${changeAt}?welcome=1`);
  return u;
}

/** A signed-in person at a corporate client, with their company. Staff are sent back to Ops. */
export async function requireClientUser() {
  const u = await getCurrentUser();
  if (!u) redirect("/adminwork/login");
  if (!u.clientId || !u.clientRole) redirect("/adminwork");
  if (u.mustChangePassword && (await headers()).get("x-pathname") !== PORTAL_ACCOUNT) redirect(`${PORTAL_ACCOUNT}?welcome=1`);
  return u as CurrentUser & { clientId: string; clientRole: ClientRole };
}

/** Staff only: for API routes, which answer with a status instead of redirecting. */
export async function getStaffUser() {
  const u = await getCurrentUser();
  return u && !u.clientId ? u : null;
}

/** Where someone lands after signing in. */
export const homeFor = (u: { clientId: string | null; mustChangePassword: boolean }) =>
  u.clientId ? (u.mustChangePassword ? `${PORTAL_ACCOUNT}?welcome=1` : PORTAL_HOME) : u.mustChangePassword ? "/adminwork/me?welcome=1" : "/adminwork";

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
