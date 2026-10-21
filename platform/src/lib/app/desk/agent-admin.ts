import "server-only";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { appAgentAssignments, appAgentShifts, appAgents, appDeskCanned, appDeskItems, appDeskNotes, deskTicketEvents, deskTickets } from "@/db/app-schema-desk";
import { appAgentPresenceLog } from "@/db/app-schema-agents";
import { SUPPORT_ROLE_KEYS, type Permission } from "@/lib/permissions";
import { suppliers } from "../suppliers";
import { logPresence } from "./agents";
import { assertCap, deskAudit, DeskError, type DeskActor } from "./core";
import { onShift } from "./routing";
import { ticketRef } from "./ticket-state";

/*
 * Agents & roles (DESK-PLAN.md §4.6, U7): the lead's one-step Add agent (the Ops login, its support role, the
 * traveller-facing profile and the invite, in one transaction), Deactivate (login and profile off, open tickets and
 * travellers handed on, future shifts removed, nothing deleted), and the per-agent history page. Saved replies live
 * here too: they are the team's shared words.
 */

const BCRYPT_COST = 12;
// The same shape Ops uses for every new login (team/actions.ts): 80 bits, changed on first sign-in.
const tempPassword = () => `Mada-${randomBytes(10).toString("hex").match(/.{4}/g)!.join("-")}`;
const OPEN = ["new", "open", "waiting_customer", "waiting_supplier"];

export type SupportRoleKey = (typeof SUPPORT_ROLE_KEYS)[number];
export type NewAgent = {
  name: string; email: string; phone?: string | null; role: SupportRoleKey; team: "riyadh" | "pakistan";
  displayName: string; displayNameAr?: string | null; languages: string[]; pronoun: "he" | "she";
};

function cleanLanguages(v: string[]) {
  const langs = [...new Set(v.map((l) => l.trim().toLowerCase()).filter((l) => /^[a-z]{2}$/.test(l)))].slice(0, 8);
  if (!langs.length) throw new DeskError("Choose at least one language");
  return langs;
}

/**
 * Add agent: creates the Ops login (must change its password on first sign-in), gives it a support role, creates the
 * desk profile (offline, so no work is routed until they're on the rota and switch on), and sends the invite: an
 * email with the sign-in link. The temporary password is returned once, for the lead to pass on privately.
 */
export async function createAgent(actor: DeskActor, v: NewAgent, opts: { signInUrl: string; now?: Date }) {
  assertCap(actor, "desk.admin");
  const now = opts.now ?? new Date();
  const name = v.name.trim(), email = v.email.trim().toLowerCase(), display = v.displayName.trim();
  if (name.length < 2) throw new DeskError("Enter their full name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DeskError("Enter a valid email");
  if (display.length < 2 || display.length > 30) throw new DeskError("Use a first name between 2 and 30 letters");
  if (!SUPPORT_ROLE_KEYS.includes(v.role)) throw new DeskError("Choose a support role");
  if (v.team !== "riyadh" && v.team !== "pakistan") throw new DeskError("Choose a team");
  const languages = cleanLanguages(v.languages);
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.key, v.role));
  if (!role) throw new DeskError("The support roles aren't set up yet (run the migrations)", "NOT_FOUND");
  // Only hand out access you hold yourself: an agent's lead can add agents and leads, never more.
  if ((role.permissions as Permission[]).some((p) => !actor.permissions.has(p))) throw new DeskError("That role includes access you can't hand out", "FORBIDDEN");
  const [dupe] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(sql`lower(${schema.users.email})`, email));
  if (dupe) throw new DeskError("Someone already uses that email", "CONFLICT");
  const password = tempPassword();
  // Hash outside the transaction: bcrypt is slow and would hold the connection idle in transaction.
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const out = await db.transaction(async (tx) => {
    const [user] = await tx.insert(schema.users).values({ name, email, phone: v.phone?.trim() || null, roleId: role.id, team: v.team, passwordHash, mustChangePassword: true }).returning();
    const [agent] = await tx.insert(appAgents).values({
      opsUserId: user!.id, displayName: display, displayNameAr: v.displayNameAr?.trim() || null, languages, pronoun: v.pronoun === "she" ? "she" : "he",
      status: "offline", statusAt: now, active: true,
    }).returning();
    await logPresence(tx, agent!.id, "offline", now, actor.id);
    await tx.insert(schema.auditEvents).values({ actorId: actor.id, action: "user.created", entityType: "user", entityId: user!.id, entityRef: name, summary: `Added ${name} as ${role.name} from the desk` });
    await deskAudit(tx, actor, { action: "desk.agent.created", entityType: "agent", entityId: agent!.id, ref: display,
      summary: `Added ${name} to the desk as ${display} (${role.name}, ${v.team === "riyadh" ? "Riyadh" : "Pakistan"})` });
    return { user: user!, agent: agent! };
  });
  let emailed = false;
  try {
    await suppliers.email().send({
      to: email, subject: "You're on the Mada desk",
      text: `Hi ${name.split(" ")[0]},\n\nYou've been added to the Mada Trips desk as ${display}. Sign in at ${opts.signInUrl} with this email. Your lead will give you a temporary password; you'll choose your own the first time you sign in.\n\nMada Trips`,
    });
    emailed = true;
  } catch { /* the lead still has the password and the link on screen */ }
  return { userId: out.user.id, agentId: out.agent.id, password, signInUrl: opts.signInUrl, emailed };
}

export type AgentChanges = { role?: SupportRoleKey; team?: "riyadh" | "pakistan"; displayName?: string; displayNameAr?: string | null; languages?: string[]; pronoun?: "he" | "she"; replyMinutes?: number };

/** Change an agent's role (support roles only), team or profile. */
export async function updateAgent(actor: DeskActor, agentId: string, v: AgentChanges) {
  assertCap(actor, "desk.admin");
  return db.transaction(async (tx) => {
    const [a] = await tx.select({ a: appAgents, u: schema.users, roleKey: schema.roles.key, roleName: schema.roles.name }).from(appAgents)
      .innerJoin(schema.users, eq(schema.users.id, appAgents.opsUserId)).innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
      .where(eq(appAgents.id, agentId)).for("update", { of: appAgents });
    if (!a) throw new DeskError("Agent not found", "NOT_FOUND");
    const changed: string[] = [];
    if (v.role && v.role !== a.roleKey) {
      if (a.u.id === actor.id) throw new DeskError("You can't change your own role");
      if (!SUPPORT_ROLE_KEYS.includes(a.roleKey as SupportRoleKey)) throw new DeskError("This person's Ops role is managed from Team, not the desk", "FORBIDDEN");
      const [role] = await tx.select().from(schema.roles).where(eq(schema.roles.key, v.role));
      if (!role) throw new DeskError("Choose a support role");
      if ((role.permissions as Permission[]).some((p) => !actor.permissions.has(p))) throw new DeskError("That role includes access you can't hand out", "FORBIDDEN");
      await tx.update(schema.users).set({ roleId: role.id }).where(eq(schema.users.id, a.u.id));
      await tx.insert(schema.auditEvents).values({ actorId: actor.id, action: "user.role_changed", entityType: "user", entityId: a.u.id, entityRef: a.u.name, summary: `Changed ${a.u.name}'s role from ${a.roleName} to ${role.name} from the desk`, changes: { roleId: { from: a.roleName, to: role.name } } });
      changed.push(`role ${role.name}`);
    }
    if (v.team && v.team !== a.u.team) { await tx.update(schema.users).set({ team: v.team }).where(eq(schema.users.id, a.u.id)); changed.push(`team ${v.team}`); }
    const profile: Partial<typeof appAgents.$inferInsert> = {};
    if (v.displayName !== undefined) {
      const d = v.displayName.trim();
      if (d.length < 2 || d.length > 30) throw new DeskError("Use a first name between 2 and 30 letters");
      if (d !== a.a.displayName) profile.displayName = d;
    }
    if (v.displayNameAr !== undefined && (v.displayNameAr?.trim() || null) !== a.a.displayNameAr) profile.displayNameAr = v.displayNameAr?.trim() || null;
    if (v.languages) { const l = cleanLanguages(v.languages); if (l.join() !== a.a.languages.join()) profile.languages = l; }
    if (v.pronoun && v.pronoun !== a.a.pronoun) profile.pronoun = v.pronoun;
    if (v.replyMinutes !== undefined && v.replyMinutes !== a.a.replyMinutes) {
      if (!(v.replyMinutes >= 1 && v.replyMinutes <= 30)) throw new DeskError("Reply time is between 1 and 30 minutes");
      profile.replyMinutes = v.replyMinutes;
    }
    if (Object.keys(profile).length) { await tx.update(appAgents).set({ ...profile, updatedAt: new Date() }).where(eq(appAgents.id, agentId)); changed.push(...Object.keys(profile)); }
    if (!changed.length) return false;
    await deskAudit(tx, actor, { action: "desk.agent.updated", entityType: "agent", entityId: agentId, ref: profile.displayName ?? a.a.displayName, summary: `Updated ${a.a.displayName}: ${changed.join(", ")}` });
    return true;
  });
}

/**
 * Deactivate: the profile goes off (no routing, no presence), the login too when it's a support login, their open
 * tickets and their travellers go to `toAgentId` or back to the queue, and their future shifts come off the rota
 * (a shift under way ends now). History stays: nothing is deleted.
 */
export async function deactivateAgent(actor: DeskActor, agentId: string, opts: { toAgentId?: string | null; now?: Date } = {}) {
  assertCap(actor, "desk.admin");
  const now = opts.now ?? new Date();
  const to = opts.toAgentId || null;
  if (to === agentId) throw new DeskError("Hand their work to someone else");
  return db.transaction(async (tx) => {
    const [a] = await tx.select({ a: appAgents, u: schema.users, roleKey: schema.roles.key }).from(appAgents)
      .innerJoin(schema.users, eq(schema.users.id, appAgents.opsUserId)).innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
      .where(eq(appAgents.id, agentId)).for("update", { of: appAgents });
    if (!a) throw new DeskError("Agent not found", "NOT_FOUND");
    if (a.u.id === actor.id) throw new DeskError("You can't deactivate yourself");
    if (!a.a.active) throw new DeskError("Already deactivated", "CONFLICT");
    const target = to ? (await tx.select().from(appAgents).where(eq(appAgents.id, to)))[0] : null;
    if (to && (!target || !target.active)) throw new DeskError("Choose someone active to hand their work to");

    await tx.update(appAgents).set({ active: false, status: "offline", statusAt: now, updatedAt: now }).where(eq(appAgents.id, agentId));
    if (a.a.status !== "offline") await logPresence(tx, agentId, "offline", now, actor.id);
    else await tx.update(appAgentPresenceLog).set({ endedAt: now }).where(and(eq(appAgentPresenceLog.agentId, agentId), isNull(appAgentPresenceLog.endedAt)));

    // Their open tickets: to the named agent (a person decided), or back to the rota.
    const tickets = await tx.update(deskTickets).set({ ownerAgentId: to, ownerReason: to ? "manual" : "queue", updatedAt: now, lastActivityAt: now })
      .where(and(eq(deskTickets.ownerAgentId, agentId), inArray(deskTickets.status, OPEN))).returning({ id: deskTickets.id, number: deskTickets.number });
    if (tickets.length) await tx.insert(deskTicketEvents).values(tickets.map((t) => ({
      ticketId: t.id, actorId: actor.id, kind: "assigned", from: a.a.displayName, to: target?.displayName ?? null, at: now,
      body: target ? `${a.a.displayName} was deactivated` : `${a.a.displayName} was deactivated: back on the rota`,
    })));
    await tx.update(appDeskItems).set({ assignedAgentId: to, assignedBy: actor.id, assignedAt: now, updatedAt: now }).where(eq(appDeskItems.assignedAgentId, agentId));

    // Their travellers: to the named agent, or no primary agent (the queue answers).
    const travellers = to
      ? await tx.update(appAgentAssignments).set({ agentId: to, assignedBy: actor.id, assignedAt: now }).where(eq(appAgentAssignments.agentId, agentId)).returning({ id: appAgentAssignments.userId })
      : await tx.delete(appAgentAssignments).where(eq(appAgentAssignments.agentId, agentId)).returning({ id: appAgentAssignments.userId });

    // The rota: future shifts off; one under way ends now.
    const removed = await tx.delete(appAgentShifts).where(and(eq(appAgentShifts.agentId, agentId), gt(appAgentShifts.startsAt, now))).returning({ id: appAgentShifts.id });
    await tx.update(appAgentShifts).set({ endsAt: now }).where(and(eq(appAgentShifts.agentId, agentId), lt(appAgentShifts.startsAt, now), gt(appAgentShifts.endsAt, now)));

    // The login: off and signed out everywhere, when it's a support login (other Ops roles are managed from Team).
    const loginOff = SUPPORT_ROLE_KEYS.includes(a.roleKey as SupportRoleKey) && !a.u.partnerId;
    if (loginOff) {
      await tx.update(schema.users).set({ active: false }).where(eq(schema.users.id, a.u.id));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, a.u.id));
      await tx.insert(schema.auditEvents).values({ actorId: actor.id, action: "user.deactivated", entityType: "user", entityId: a.u.id, entityRef: a.u.name, summary: `Deactivated ${a.u.name} from the desk and signed them out everywhere` });
    }
    const where = target ? `to ${target.displayName}` : "back to the queue";
    await deskAudit(tx, actor, { action: "desk.agent.deactivated", entityType: "agent", entityId: agentId, ref: a.a.displayName,
      summary: `Deactivated ${a.a.displayName}: ${tickets.length} open ticket(s) and ${travellers.length} traveller(s) ${where}, ${removed.length} future shift(s) removed${loginOff ? ", login off" : ""}`,
      data: { tickets: tickets.map((t) => ticketRef(t.number)), to: target?.displayName ?? null } });
    return { tickets: tickets.length, travellers: travellers.length, shifts: removed.length, loginOff };
  });
}

/** Bring a deactivated agent back: profile and (support) login on; they start offline with nothing routed. */
export async function reactivateAgent(actor: DeskActor, agentId: string, now = new Date()) {
  assertCap(actor, "desk.admin");
  await db.transaction(async (tx) => {
    const [a] = await tx.select({ a: appAgents, u: schema.users, roleKey: schema.roles.key }).from(appAgents)
      .innerJoin(schema.users, eq(schema.users.id, appAgents.opsUserId)).innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId)).where(eq(appAgents.id, agentId));
    if (!a) throw new DeskError("Agent not found", "NOT_FOUND");
    if (a.a.active) return;
    await tx.update(appAgents).set({ active: true, status: "offline", statusAt: now, updatedAt: now }).where(eq(appAgents.id, agentId));
    if (SUPPORT_ROLE_KEYS.includes(a.roleKey as SupportRoleKey) && !a.u.active) {
      await tx.update(schema.users).set({ active: true }).where(eq(schema.users.id, a.u.id));
      await tx.insert(schema.auditEvents).values({ actorId: actor.id, action: "user.reactivated", entityType: "user", entityId: a.u.id, entityRef: a.u.name, summary: `Reactivated ${a.u.name} from the desk` });
    }
    await deskAudit(tx, actor, { action: "desk.agent.reactivated", entityType: "agent", entityId: agentId, ref: a.a.displayName, summary: `Reactivated ${a.a.displayName} on the desk` });
  });
}

/* ───────────── reading ───────────── */

/** Midnight in Riyadh (UTC+3, no DST) on the day of `d`. */
export const riyadhMidnight = (d: Date) => new Date(Math.floor((d.getTime() + 3 * 3600_000) / 86400_000) * 86400_000 - 3 * 3600_000);

/** The Agents & roles table: every agent with their login, role, shift now, open tickets and today's work. */
export async function agentsBoard(now = new Date()) {
  const today = riyadhMidnight(now);
  const [rows, shifts, open, today_, travellers] = await Promise.all([
    db.select({ a: appAgents, email: schema.users.email, userName: schema.users.name, team: schema.users.team, loginActive: schema.users.active, lastSeenAt: schema.users.lastSeenAt, roleKey: schema.roles.key, roleName: schema.roles.name, roleNameAr: schema.roles.nameAr })
      .from(appAgents).innerJoin(schema.users, eq(schema.users.id, appAgents.opsUserId)).innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
      .orderBy(desc(appAgents.active), asc(appAgents.displayName)),
    db.select({ agentId: appAgentShifts.agentId, startsAt: appAgentShifts.startsAt, endsAt: appAgentShifts.endsAt, coveringForId: appAgentShifts.coveringForId }).from(appAgentShifts)
      .where(and(lt(appAgentShifts.startsAt, new Date(now.getTime() + 36 * 3600_000)), gt(appAgentShifts.endsAt, new Date(now.getTime() - 36 * 3600_000)))),
    db.select({ id: deskTickets.ownerAgentId, n: sql<number>`count(*)::int` }).from(deskTickets).where(inArray(deskTickets.status, OPEN)).groupBy(deskTickets.ownerAgentId),
    db.select({ id: deskTickets.ownerAgentId, n: sql<number>`count(*)::int` }).from(deskTickets).where(sql`${deskTickets.resolvedAt} >= ${today.toISOString()}::timestamptz AND ${deskTickets.mergedIntoId} IS NULL`).groupBy(deskTickets.ownerAgentId),
    db.select({ id: appAgentAssignments.agentId, n: sql<number>`count(*)::int` }).from(appAgentAssignments).groupBy(appAgentAssignments.agentId),
  ]);
  const m = (list: { id: string | null; n: number }[]) => new Map(list.map((x) => [x.id, x.n]));
  const o = m(open), d = m(today_), tr = m(travellers);
  return rows.map((r) => ({
    ...r.a, email: r.email, userName: r.userName, team: r.team, loginActive: r.loginActive, lastSeenAt: r.lastSeenAt, roleKey: r.roleKey, roleName: r.roleName, roleNameAr: r.roleNameAr,
    onShift: onShift(r.a.id, shifts, now), covering: shifts.find((s) => s.agentId === r.a.id && s.coveringForId && s.startsAt <= now && now < s.endsAt)?.coveringForId ?? null,
    open: o.get(r.a.id) ?? 0, handledToday: d.get(r.a.id) ?? 0, travellers: tr.get(r.a.id) ?? 0,
  }));
}
export type AgentRow = Awaited<ReturnType<typeof agentsBoard>>[number];

/** Support roles the desk can hand out, as stored (names, Arabic names, permissions). */
export const supportRoles = () => db.select().from(schema.roles).where(inArray(schema.roles.key, [...SUPPORT_ROLE_KEYS])).orderBy(asc(schema.roles.key));

/** One agent's page: who they are, their tickets, notes they wrote, and everything they did (both audit trails). */
export async function agentProfile(agentId: string, now = new Date()) {
  const [row] = await db.select({ a: appAgents, u: schema.users, roleKey: schema.roles.key, roleName: schema.roles.name, roleNameAr: schema.roles.nameAr, permissions: schema.roles.permissions })
    .from(appAgents).innerJoin(schema.users, eq(schema.users.id, appAgents.opsUserId)).innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId)).where(eq(appAgents.id, agentId));
  if (!row) return null;
  const since30 = new Date(now.getTime() - 30 * 86400_000);
  const [tickets, notes, audit, counts, shifts] = await Promise.all([
    db.select({ id: deskTickets.id, number: deskTickets.number, subject: deskTickets.subject, kind: deskTickets.kind, status: deskTickets.status, priority: deskTickets.priority, openedAt: deskTickets.openedAt, resolvedAt: deskTickets.resolvedAt, csat: deskTickets.csat, lastActivityAt: deskTickets.lastActivityAt })
      .from(deskTickets).where(and(eq(deskTickets.ownerAgentId, agentId), isNull(deskTickets.mergedIntoId))).orderBy(desc(deskTickets.lastActivityAt)).limit(25),
    db.select({ id: appDeskNotes.id, body: appDeskNotes.body, threadKind: appDeskNotes.threadKind, threadId: appDeskNotes.threadId, ticketId: appDeskNotes.ticketId, number: deskTickets.number, createdAt: appDeskNotes.createdAt })
      .from(appDeskNotes).leftJoin(deskTickets, eq(deskTickets.id, appDeskNotes.ticketId)).where(eq(appDeskNotes.opsUserId, row.u.id)).orderBy(desc(appDeskNotes.createdAt)).limit(15),
    db.select({ id: schema.auditEvents.id, action: schema.auditEvents.action, summary: schema.auditEvents.summary, entityRef: schema.auditEvents.entityRef, at: schema.auditEvents.at, actorId: schema.auditEvents.actorId })
      .from(schema.auditEvents).where(or(eq(schema.auditEvents.actorId, row.u.id), and(eq(schema.auditEvents.entityId, agentId), eq(schema.auditEvents.entityType, "desk")), and(eq(schema.auditEvents.entityId, row.u.id), eq(schema.auditEvents.entityType, "user"))))
      .orderBy(desc(schema.auditEvents.at)).limit(40),
    db.select({
      open: sql<number>`count(*) FILTER (WHERE ${inArray(deskTickets.status, OPEN)})::int`,
      handled: sql<number>`count(*) FILTER (WHERE ${deskTickets.resolvedAt} >= ${since30.toISOString()}::timestamptz)::int`,
      csatN: sql<number>`count(${deskTickets.csat}) FILTER (WHERE ${deskTickets.csatAt} >= ${since30.toISOString()}::timestamptz)::int`,
      csatSum: sql<number>`coalesce(sum(${deskTickets.csat}) FILTER (WHERE ${deskTickets.csatAt} >= ${since30.toISOString()}::timestamptz), 0)::int`,
    }).from(deskTickets).where(and(eq(deskTickets.ownerAgentId, agentId), isNull(deskTickets.mergedIntoId))),
    db.select().from(appAgentShifts).where(and(eq(appAgentShifts.agentId, agentId), gt(appAgentShifts.endsAt, now))).orderBy(asc(appAgentShifts.startsAt)).limit(8),
  ]);
  const c = counts[0]!;
  return {
    agent: row.a, user: { id: row.u.id, name: row.u.name, email: row.u.email, phone: row.u.phone, team: row.u.team, active: row.u.active, lastSeenAt: row.u.lastSeenAt, mustChangePassword: row.u.mustChangePassword },
    role: { key: row.roleKey, name: row.roleName, nameAr: row.roleNameAr, permissions: row.permissions as string[] },
    tickets, notes, audit, shifts, stats: { open: c.open, handled30: c.handled, csatN: c.csatN, csatAvg: c.csatN ? c.csatSum / c.csatN : null },
  };
}

/* ───────────── saved replies ───────────── */

export type CannedInput = { title: string; bodyEn: string; bodyAr: string; sort?: number };

function cleanCanned(v: CannedInput) {
  const title = v.title.trim(), en = v.bodyEn.trim(), ar = v.bodyAr.trim();
  if (title.length < 2 || en.length < 2 || ar.length < 2) throw new DeskError("Fill in the title and both languages");
  return { title: title.slice(0, 60), bodyEn: en.slice(0, 1000), bodyAr: ar.slice(0, 1000), sort: Math.max(0, Math.min(999, Math.round(v.sort ?? 0))) };
}

export const listCanned = () => db.select().from(appDeskCanned).orderBy(asc(appDeskCanned.sort), desc(appDeskCanned.createdAt));

/** Add a saved reply (id null) or change one. Every reply box on the desk lists them. */
export async function saveCanned(actor: DeskActor, id: string | null, v: CannedInput) {
  assertCap(actor, "desk.admin");
  const values = cleanCanned(v);
  return db.transaction(async (tx) => {
    if (!id) {
      const [row] = await tx.insert(appDeskCanned).values({ ...values, createdBy: actor.id }).returning();
      await deskAudit(tx, actor, { action: "desk.canned.added", entityType: "canned", entityId: row!.id, ref: values.title, summary: `Added the saved reply "${values.title}"` });
      return row!;
    }
    const [before] = await tx.select().from(appDeskCanned).where(eq(appDeskCanned.id, id)).for("update");
    if (!before) throw new DeskError("Saved reply not found", "NOT_FOUND");
    const [row] = await tx.update(appDeskCanned).set({ ...values, updatedAt: new Date() }).where(eq(appDeskCanned.id, id)).returning();
    await deskAudit(tx, actor, { action: "desk.canned.updated", entityType: "canned", entityId: id, ref: values.title, summary: `Edited the saved reply "${values.title}"${before.title !== values.title ? ` (was "${before.title}")` : ""}` });
    return row!;
  });
}

export async function deleteCanned(actor: DeskActor, id: string) {
  assertCap(actor, "desk.admin");
  await db.transaction(async (tx) => {
    const [row] = await tx.delete(appDeskCanned).where(eq(appDeskCanned.id, id)).returning();
    if (!row) throw new DeskError("Saved reply not found", "NOT_FOUND");
    await deskAudit(tx, actor, { action: "desk.canned.deleted", entityType: "canned", entityId: id, ref: row.title, summary: `Deleted the saved reply "${row.title}"` });
  });
}

/** Active agents other than these, for "hand their work to". */
export const otherActiveAgents = (except: string[]) =>
  db.select({ id: appAgents.id, name: appAgents.displayName }).from(appAgents).where(and(eq(appAgents.active, true), except.length ? notInArray(appAgents.id, except) : undefined)).orderBy(asc(appAgents.displayName));
