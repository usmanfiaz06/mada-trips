import "server-only";
import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { t as copy } from "@mada/shared";
import type { PresenceAgent, PresenceResponse } from "@mada/shared";
import { db, schema } from "@/db";
import { appMessages, appUsers } from "@/db/app-schema";
import { appAgentAssignments, appAgentShifts, appAgents, appDeskTyping } from "@/db/app-schema-desk";
import { assertCap, deskAudit, DeskError, type DeskActor } from "./core";
import { available, routeFor, type RotaShift } from "./routing";
import { typicalReplyMinutes } from "./sla";

export type Agent = typeof appAgents.$inferSelect;
export type Rota = { agents: Agent[]; shifts: RotaShift[]; now: Date };

/** Agents and the shifts around now (yesterday to tomorrow): enough to route anything that is open. */
export async function loadRota(now = new Date()): Promise<Rota> {
  const from = new Date(now.getTime() - 36 * 3600_000), to = new Date(now.getTime() + 36 * 3600_000);
  const [agents, shifts] = await Promise.all([
    db.select().from(appAgents).orderBy(asc(appAgents.displayName)),
    db.select({ agentId: appAgentShifts.agentId, startsAt: appAgentShifts.startsAt, endsAt: appAgentShifts.endsAt, coveringForId: appAgentShifts.coveringForId })
      .from(appAgentShifts).where(and(lt(appAgentShifts.startsAt, to), gt(appAgentShifts.endsAt, from))),
  ]);
  return { agents, shifts, now };
}

export const agentForOps = async (opsUserId: string) =>
  (await db.select().from(appAgents).where(eq(appAgents.opsUserId, opsUserId)).limit(1))[0] ?? null;

export const initialOf = (name: string) => (name.trim()[0] ?? "M").toUpperCase();

/** Every traveller's primary agent, for routing a list in one go. */
export async function primaryAgents(userIds: string[]): Promise<Map<string, string>> {
  if (!userIds.length) return new Map();
  const rows = await db.select().from(appAgentAssignments).where(inArray(appAgentAssignments.userId, [...new Set(userIds)]));
  return new Map(rows.map((r) => [r.userId, r.agentId]));
}

/* ───────────── changes ───────────── */

/** Online / away / offline. Any desk member sets their own; desk.admin can set anyone's (signing someone off at shift end). */
export async function setAgentStatus(actor: DeskActor, agentId: string, status: "online" | "away" | "offline") {
  assertCap(actor, "desk.view");
  await db.transaction(async (tx) => {
    const [a] = await tx.select().from(appAgents).where(eq(appAgents.id, agentId)).for("update");
    if (!a) throw new DeskError("Agent not found", "NOT_FOUND");
    if (a.opsUserId !== actor.id) assertCap(actor, "desk.admin");
    if (a.status === status) return;
    await tx.update(appAgents).set({ status, statusAt: new Date(), updatedAt: new Date() }).where(eq(appAgents.id, agentId));
    await deskAudit(tx, actor, { action: "desk.agent.status", entityType: "agent", entityId: agentId, ref: a.displayName,
      summary: `${a.displayName} is now ${status}`, data: { status: { from: a.status, to: status } } });
  });
}

export type AgentInput = { opsUserId: string; displayName: string; displayNameAr?: string | null; languages: string[]; pronoun: "he" | "she"; replyMinutes: number; photoUrl?: string | null; active?: boolean };

/** Create or update the traveller-facing profile for an Ops login. */
export async function saveAgent(actor: DeskActor, v: AgentInput) {
  assertCap(actor, "desk.admin");
  const name = v.displayName.trim();
  if (name.length < 2 || name.length > 30) throw new DeskError("Use a first name between 2 and 30 letters");
  if (v.replyMinutes < 1 || v.replyMinutes > 30) throw new DeskError("Reply time is between 1 and 30 minutes");
  const langs = [...new Set(v.languages.map((l) => l.trim().toLowerCase()).filter((l) => /^[a-z]{2}$/.test(l)))].slice(0, 8);
  if (!langs.length) throw new DeskError("Choose at least one language");
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: schema.users.id, name: schema.users.name, active: schema.users.active }).from(schema.users).where(eq(schema.users.id, v.opsUserId));
    if (!u) throw new DeskError("Team member not found", "NOT_FOUND");
    const [prev] = await tx.select().from(appAgents).where(eq(appAgents.opsUserId, v.opsUserId)).for("update");
    const values = { displayName: name, displayNameAr: v.displayNameAr?.trim() || null, languages: langs, pronoun: v.pronoun, replyMinutes: v.replyMinutes, photoUrl: v.photoUrl ?? prev?.photoUrl ?? null, active: v.active ?? true, updatedAt: new Date() };
    const [row] = prev
      ? await tx.update(appAgents).set(values).where(eq(appAgents.id, prev.id)).returning()
      : await tx.insert(appAgents).values({ opsUserId: v.opsUserId, ...values }).returning();
    await deskAudit(tx, actor, { action: prev ? "desk.agent.updated" : "desk.agent.created", entityType: "agent", entityId: row!.id, ref: name,
      summary: prev ? `Updated ${name}'s desk profile` : `Added ${u.name} to the desk as ${name}` });
    return row!;
  });
}

/** Put a shift on the rota. covering_for makes this agent the one travellers of that agent are routed to. */
export async function addShift(actor: DeskActor, v: { agentId: string; startsAt: Date; endsAt: Date; coveringForId?: string | null; note?: string | null }) {
  assertCap(actor, "desk.admin");
  if (!(v.endsAt > v.startsAt)) throw new DeskError("A shift ends after it starts");
  if (v.endsAt.getTime() - v.startsAt.getTime() > 16 * 3600_000) throw new DeskError("Keep a shift to 16 hours or less");
  if (v.coveringForId && v.coveringForId === v.agentId) throw new DeskError("Someone can't cover for themselves");
  return db.transaction(async (tx) => {
    const ids = [v.agentId, ...(v.coveringForId ? [v.coveringForId] : [])];
    const found = await tx.select({ id: appAgents.id, name: appAgents.displayName }).from(appAgents).where(inArray(appAgents.id, ids));
    if (found.length !== ids.length) throw new DeskError("Agent not found", "NOT_FOUND");
    const overlap = await tx.select({ id: appAgentShifts.id }).from(appAgentShifts)
      .where(and(eq(appAgentShifts.agentId, v.agentId), lt(appAgentShifts.startsAt, v.endsAt), gt(appAgentShifts.endsAt, v.startsAt))).limit(1);
    if (overlap.length) throw new DeskError("That overlaps another shift for the same person", "CONFLICT");
    const [row] = await tx.insert(appAgentShifts).values({ agentId: v.agentId, startsAt: v.startsAt, endsAt: v.endsAt, coveringForId: v.coveringForId ?? null, note: v.note ?? null, createdBy: actor.id }).returning();
    const nm = (id: string) => found.find((f) => f.id === id)?.name ?? "—";
    await deskAudit(tx, actor, { action: "desk.shift.added", entityType: "shift", entityId: row!.id, ref: nm(v.agentId),
      summary: `Put ${nm(v.agentId)} on shift ${v.startsAt.toISOString().slice(0, 16).replace("T", " ")}–${v.endsAt.toISOString().slice(11, 16)} UTC${v.coveringForId ? `, covering for ${nm(v.coveringForId)}` : ""}` });
    return row!;
  });
}

export async function removeShift(actor: DeskActor, shiftId: string) {
  assertCap(actor, "desk.admin");
  await db.transaction(async (tx) => {
    const [s] = await tx.select({ s: appAgentShifts, name: appAgents.displayName }).from(appAgentShifts).innerJoin(appAgents, eq(appAgents.id, appAgentShifts.agentId)).where(eq(appAgentShifts.id, shiftId));
    if (!s) throw new DeskError("Shift not found", "NOT_FOUND");
    await tx.delete(appAgentShifts).where(eq(appAgentShifts.id, shiftId));
    await deskAudit(tx, actor, { action: "desk.shift.removed", entityType: "shift", entityId: shiftId, ref: s.name, summary: `Took ${s.name} off the ${s.s.startsAt.toISOString().slice(0, 16).replace("T", " ")} UTC shift` });
  });
}

/** Make an agent a traveller's primary agent ("Faisal, your Mada agent"). */
export async function assignPrimary(actor: DeskActor, userId: string, agentId: string) {
  assertCap(actor, "desk.admin");
  await db.transaction(async (tx) => {
    const [u] = await tx.select({ id: appUsers.id, name: appUsers.name }).from(appUsers).where(eq(appUsers.id, userId));
    const [a] = await tx.select().from(appAgents).where(eq(appAgents.id, agentId));
    if (!u || !a) throw new DeskError("Traveller or agent not found", "NOT_FOUND");
    const [prev] = await tx.select({ agentId: appAgentAssignments.agentId, name: appAgents.displayName }).from(appAgentAssignments)
      .innerJoin(appAgents, eq(appAgents.id, appAgentAssignments.agentId)).where(eq(appAgentAssignments.userId, userId));
    if (prev?.agentId === agentId) return;
    await tx.insert(appAgentAssignments).values({ userId, agentId, assignedBy: actor.id, assignedAt: new Date() })
      .onConflictDoUpdate({ target: appAgentAssignments.userId, set: { agentId, assignedBy: actor.id, assignedAt: new Date() } });
    await deskAudit(tx, actor, { action: "desk.traveller.assigned", entityType: "app_user", entityId: userId, ref: u.name || "Traveller",
      summary: `${a.displayName} is now ${u.name || "the traveller"}'s agent`, data: { agent: { from: prev?.name ?? null, to: a.displayName } } });
  });
}

/** "Faisal is typing…" for a few seconds; the composer refreshes it while keys are pressed. */
export async function pingTyping(actor: DeskActor, threadKind: "request" | "support", threadId: string) {
  assertCap(actor, "desk.act");
  const me = await agentForOps(actor.id);
  if (!me) return;
  const until = new Date(Date.now() + 6000);
  await db.insert(appDeskTyping).values({ agentId: me.id, threadKind, threadId, until })
    .onConflictDoUpdate({ target: appDeskTyping.agentId, set: { threadKind, threadId, until } });
}

/* ───────────── presence (for the app) ───────────── */

const toPresence = (a: Agent): PresenceAgent => ({ id: a.id, name: a.displayName, initial: initialOf(a.displayName), photoUrl: a.photoUrl, languages: a.languages });

/** First-reply waits (minutes) in thread messages, oldest first per thread: user writes, the agent's next reply answers. */
export function firstReplySamples(msgs: { threadKind: string; threadId: string; authorKind: string; authorOpsUserId: string | null; createdAt: Date }[], opsUserId: string) {
  const out: number[] = [];
  const waiting = new Map<string, Date>();
  for (const m of msgs) {
    const key = `${m.threadKind}:${m.threadId}`;
    if (m.authorKind === "user") { if (!waiting.has(key)) waiting.set(key, m.createdAt); continue; }
    if (m.authorKind !== "agent") continue; // Mada's own acknowledgements don't count as a person replying
    const since = waiting.get(key);
    if (since && m.authorOpsUserId === opsUserId) out.push((m.createdAt.getTime() - since.getTime()) / 60_000);
    waiting.delete(key);
  }
  return out;
}

/** How fast this agent usually answers: the median first reply over the last 30 days, else their own setting. */
export async function replyMinutesFor(agent: Agent): Promise<number> {
  const since = new Date(Date.now() - 30 * 86400_000);
  const rows = await db.select({ threadKind: appMessages.threadKind, threadId: appMessages.threadId, authorKind: appMessages.authorKind, authorOpsUserId: appMessages.authorOpsUserId, createdAt: appMessages.createdAt })
    .from(appMessages).where(and(gt(appMessages.createdAt, since), sql`(${appMessages.threadKind}, ${appMessages.threadId}) IN (
      SELECT DISTINCT m.thread_kind, m.thread_id FROM app_messages m WHERE m.author_ops_user_id = ${agent.opsUserId} AND m.created_at > ${since.toISOString()}::timestamptz LIMIT 60)`))
    .orderBy(asc(appMessages.createdAt)).limit(2000);
  return typicalReplyMinutes(firstReplySamples(rows, agent.opsUserId).slice(-40)) ?? agent.replyMinutes;
}

/**
 * Who the traveller sees under "Mada" (COPY.md §1): their own agent when on shift, the person covering for them,
 * or, with nobody routed, the promise that the desk answers within 10 minutes at any hour.
 */
export async function presenceFor(userId: string, thread?: { kind: "request" | "support"; id: string } | null, now = new Date()): Promise<PresenceResponse> {
  const [rota, primary] = await Promise.all([loadRota(now), primaryAgents([userId])]);
  const primaryId = primary.get(userId) ?? null;
  const route = routeFor(primaryId, rota.agents, rota.shifts, now);
  const agent = route.agentId ? rota.agents.find((a) => a.id === route.agentId) ?? null : null;
  const usual = route.reason === "covering" && primaryId ? rota.agents.find((a) => a.id === primaryId) ?? null : null;
  if (!agent) {
    return { title: copy("presence.title"), agent: null, usual: null, covering: false, online: false, typing: false, replyMinutes: 10, line: copy("presence.away") };
  }
  const online = agent.status === "online" && available(agent, rota.shifts, now);
  const minutes = await replyMinutesFor(agent);
  let typing = false;
  if (thread) {
    const [row] = await db.select({ until: appDeskTyping.until }).from(appDeskTyping)
      .where(and(eq(appDeskTyping.agentId, agent.id), eq(appDeskTyping.threadKind, thread.kind), eq(appDeskTyping.threadId, thread.id), gt(appDeskTyping.until, now)));
    typing = !!row;
  }
  const replies = copy("presence.replies", { minutes });
  const line = typing ? copy("presence.typing", { agent: agent.displayName })
    : usual ? copy("presence.covering", { agent: agent.displayName, usual: usual.displayName, pronoun: agent.pronoun === "she" ? "She" : "He" })
    : online ? `${copy("presence.online", { agent: agent.displayName })} · ${replies}`
    : replies;
  return { title: copy("presence.title"), agent: toPresence(agent), usual: usual ? toPresence(usual) : null, covering: !!usual, online, typing, replyMinutes: minutes, line };
}

/* ───────────── the team page ───────────── */

export async function teamBoard(now = new Date()) {
  const rota = await loadRota(now);
  const [users, shifts, counts] = await Promise.all([
    db.select({ id: schema.users.id, name: schema.users.name, team: schema.users.team, active: schema.users.active, lastSeenAt: schema.users.lastSeenAt }).from(schema.users).orderBy(asc(schema.users.name)),
    db.select().from(appAgentShifts).where(and(gt(appAgentShifts.endsAt, new Date(now.getTime() - 12 * 3600_000)), lt(appAgentShifts.startsAt, new Date(now.getTime() + 7 * 86400_000)))).orderBy(asc(appAgentShifts.startsAt)),
    db.select({ agentId: appAgentAssignments.agentId, n: sql<number>`count(*)::int` }).from(appAgentAssignments).groupBy(appAgentAssignments.agentId),
  ]);
  return { ...rota, users, upcoming: shifts, travellers: new Map(counts.map((c) => [c.agentId, c.n])) };
}

export async function travellersWithAgents(q = "", limit = 100) {
  const like = `%${q.slice(0, 60).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db.select({ id: appUsers.id, name: appUsers.name, phone: appUsers.phone, createdAt: appUsers.createdAt, agentId: appAgentAssignments.agentId })
    .from(appUsers).leftJoin(appAgentAssignments, eq(appAgentAssignments.userId, appUsers.id))
    .where(and(sql`${appUsers.deletedAt} IS NULL`, q ? sql`(${appUsers.name} ILIKE ${like} OR ${appUsers.phone} ILIKE ${like})` : undefined))
    .orderBy(desc(appUsers.createdAt)).limit(limit);
}

