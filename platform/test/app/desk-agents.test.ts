import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { and, eq, sql as rawSql } from "drizzle-orm";
import { SupportCsatResponse } from "@mada/shared";
import { db, schema } from "@/db";
import { appDevices, appPayments, appRefunds, appUsers } from "@/db/app-schema";
import { appAgentAssignments, appAgentShifts, appAgents, appDeskCanned, deskTicketEvents, deskTickets } from "@/db/app-schema-desk";
import { appAgentPresenceLog } from "@/db/app-schema-agents";
import { SUPPORT_ROLE_KEYS, SYSTEM_ROLES } from "@/lib/permissions";
import { outbox } from "@/lib/app/suppliers";
import { pushOutbox } from "@/lib/app/push";
import { createSession } from "@/lib/app/tokens";
import { GET as csatGet, POST as csatPost } from "@/app/api/app/v1/support/csat/route";
import type { DeskActor } from "@/lib/app/desk/core";
import { addShift, loadRota, removeShift, saveAgent, setAgentStatus, shiftOccurrences } from "@/lib/app/desk/agents";
import { agentProfile, agentsBoard, createAgent, deactivateAgent, deleteCanned, reactivateAgent, saveCanned, updateAgent } from "@/lib/app/desk/agent-admin";
import { routeFor } from "@/lib/app/desk/routing";
import { dayLogs, timeLogs } from "@/lib/app/desk/timelog";
import { buckets, median, metrics, percentile, performanceReport, slaHit, type PerfTicket } from "@/lib/app/desk/performance";
import { nightCover } from "@/lib/app/desk/oncall";
import { deskQueue } from "@/lib/app/desk/tickets";
import { call } from "./helpers";

/* Agents, roles, time and performance (DESK-PLAN.md U7): Add agent, deactivate, the rota, time logs, performance, CSAT, night cover. */

const MIN = 60_000, H = 3600_000, DAY = 86400_000;
const LEAD = ["desk.view", "desk.act", "desk.ask.read", "desk.issue", "desk.refund", "desk.moderate", "desk.admin", "desk.tickets.manage", "desk.reports"];
let seq = 0;

async function opsUser(name: string, perms: string[]): Promise<DeskActor> {
  seq += 1;
  const [role] = await db.insert(schema.roles).values({ key: `agents_test_${Date.now()}_${seq}`, name: `Agents ${seq}`, nameAr: "مكتب", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name, email: `agents${Date.now()}${seq}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name, permissions: new Set(perms) };
}
const email = (s: string) => `${s}.${Date.now()}.${++seq}@madatrips.test`;
async function traveller(name = "Sara Alqahtani", phone?: string) {
  const [u] = await db.insert(appUsers).values({ name, phone: phone ?? `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` }).returning();
  return u!;
}
async function ticket(v: Partial<typeof deskTickets.$inferInsert> & { openedAt: Date }) {
  const [t] = await db.insert(deskTickets).values({ kind: "manual", subject: "Test", slaMinutes: 60, dueAt: new Date(v.openedAt.getTime() + 60 * MIN), slaStartedAt: v.openedAt, status: "open", ...v }).returning();
  return t!;
}

let lead: DeskActor;
beforeAll(async () => { lead = await opsUser("Bader Al Sulaiman", LEAD); });

describe("roles", () => {
  it("the migration adds Support agent and Support lead, matching SYSTEM_ROLES (§7 default 1)", async () => {
    const rows = await db.select().from(schema.roles).where(rawSql`${schema.roles.key} IN ('support_agent', 'support_lead')`);
    expect(rows.map((r) => r.key).sort()).toEqual([...SUPPORT_ROLE_KEYS]);
    for (const r of rows) {
      const def = SYSTEM_ROLES.find((s) => s.key === r.key)!;
      expect([...r.permissions].sort()).toEqual([...def.permissions].sort());
      expect(r.isSystem).toBe(true);
    }
    const agent = rows.find((r) => r.key === "support_agent")!, leadRole = rows.find((r) => r.key === "support_lead")!;
    // An agent sees masked passports and can't issue; a lead can, behind the audited reveal.
    expect(agent.permissions).not.toContain("desk.issue");
    expect(agent.permissions).not.toContain("desk.refund");
    expect(leadRole.permissions).toEqual(expect.arrayContaining(["desk.issue", "desk.refund", "desk.admin", "desk.tickets.manage", "desk.reports"]));
    // The partners got desk.reports.
    const partner = (await db.select().from(schema.roles).where(eq(schema.roles.key, "partner")))[0];
    if (partner) expect(partner.permissions).toContain("desk.reports");
  });
});

describe("Add agent, change, deactivate", () => {
  it("creates the login, role, profile and invite in one step; routed work follows once they're on shift", async () => {
    const before = outbox.length;
    const addr = email("faisal");
    const r = await createAgent(lead, { name: "Faisal Al-Harbi", email: addr.toUpperCase(), phone: "+966500000001", role: "support_agent", team: "riyadh", displayName: "Faisal", displayNameAr: "فيصل", languages: ["ar", "en", "xx1"], pronoun: "he" }, { signInUrl: "https://ops.test/adminwork/login" });
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, r.userId));
    expect(u).toMatchObject({ email: addr, mustChangePassword: true, active: true, team: "riyadh" });
    expect(await bcrypt.compare(r.password, u!.passwordHash)).toBe(true);
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, u!.roleId));
    expect(role!.key).toBe("support_agent");
    const [a] = await db.select().from(appAgents).where(eq(appAgents.id, r.agentId));
    expect(a).toMatchObject({ opsUserId: r.userId, displayName: "Faisal", displayNameAr: "فيصل", languages: ["ar", "en"], status: "offline", active: true });
    // The invite: an email with the sign-in link, never the password.
    const mail = outbox.slice(0, outbox.length - before).find((o) => o.channel === "email" && o.to === addr);
    expect(mail?.body).toContain("https://ops.test/adminwork/login");
    expect(mail?.body).not.toContain(r.password);
    expect(r.emailed).toBe(true);
    // One open presence interval (offline) and both audit trails.
    expect(await db.select().from(appAgentPresenceLog).where(eq(appAgentPresenceLog.agentId, a!.id))).toHaveLength(1);
    const ops = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.actorId, lead.id));
    expect(ops.map((e) => e.action)).toEqual(expect.arrayContaining(["user.created", "desk.agent.created"]));

    // Routed work: a traveller whose agent is Faisal goes to the queue until he's on shift and switched on.
    const sara = await traveller();
    await db.insert(appAgentAssignments).values({ userId: sara.id, agentId: a!.id });
    const now = new Date(Date.UTC(2031, 0, 5, 9));
    let rota = await loadRota(now);
    expect(routeFor(a!.id, rota.agents, rota.shifts, now).reason).toBe("queue");
    await addShift(lead, { agentId: a!.id, startsAt: new Date(now.getTime() - H), endsAt: new Date(now.getTime() + 7 * H) });
    const me: DeskActor = { id: r.userId, name: "Faisal Al-Harbi", permissions: new Set(role!.permissions) };
    await setAgentStatus(me, a!.id, "online");
    rota = await loadRota(now);
    expect(routeFor(a!.id, rota.agents, rota.shifts, now)).toMatchObject({ agentId: a!.id, reason: "primary" });
  });

  it("refuses duplicates, people without desk.admin, and roles beyond the lead's own access", async () => {
    const addr = email("dupe");
    const base = { name: "Dupe Person", email: addr, role: "support_agent" as const, team: "riyadh" as const, displayName: "Dupe", languages: ["en"], pronoun: "he" as const };
    await createAgent(lead, base, { signInUrl: "x" });
    await expect(createAgent(lead, base, { signInUrl: "x" })).rejects.toThrow(/already uses/);
    const agent = await opsUser("Plain Agent", ["desk.view", "desk.act"]);
    await expect(createAgent(agent, { ...base, email: email("x") }, { signInUrl: "x" })).rejects.toThrow(/access/);
    const narrow = await opsUser("Narrow Admin", ["desk.view", "desk.act", "desk.ask.read", "desk.admin"]);
    await expect(createAgent(narrow, { ...base, email: email("y"), role: "support_lead" }, { signInUrl: "x" })).rejects.toThrow(/can't hand out/);
    await expect(createAgent(narrow, { ...base, email: email("z") }, { signInUrl: "x" })).resolves.toBeTruthy();
  });

  it("changes role and profile; a lead's role change is audited", async () => {
    const r = await createAgent(lead, { name: "Omar Saleh", email: email("omar"), role: "support_agent", team: "riyadh", displayName: "Omar", languages: ["ar"], pronoun: "he" }, { signInUrl: "x" });
    expect(await updateAgent(lead, r.agentId, { role: "support_lead", team: "pakistan", displayName: "Omar", languages: ["ar", "ur"] })).toBe(true);
    const p = (await agentProfile(r.agentId))!;
    expect(p.role.key).toBe("support_lead");
    expect(p.user.team).toBe("pakistan");
    expect(p.agent.languages).toEqual(["ar", "ur"]);
    expect(p.audit.map((e) => e.action)).toEqual(expect.arrayContaining(["user.role_changed", "desk.agent.updated", "desk.agent.created"]));
    expect(await updateAgent(lead, r.agentId, { displayName: "Omar" })).toBe(false);
  });

  it("deactivating empties their queue, hands on travellers, clears future shifts and turns the login off", async () => {
    const now = new Date(Date.UTC(2031, 1, 3, 10));
    const r = await createAgent(lead, { name: "Huda Nasser", email: email("huda"), role: "support_agent", team: "riyadh", displayName: "Huda", languages: ["ar"], pronoun: "she" }, { signInUrl: "x" });
    const other = await createAgent(lead, { name: "Lina Fahad", email: email("lina"), role: "support_agent", team: "riyadh", displayName: "Lina", languages: ["ar"], pronoun: "she" }, { signInUrl: "x" });
    const huda = r.agentId;
    await setAgentStatus({ id: r.userId, name: "Huda", permissions: new Set(["desk.view"]) }, huda, "online");
    const t1 = await ticket({ openedAt: now, ownerAgentId: huda, ownerReason: "manual" });
    const t2 = await ticket({ openedAt: now, ownerAgentId: huda, ownerReason: "primary", status: "waiting_customer" });
    const done = await ticket({ openedAt: now, ownerAgentId: huda, status: "resolved", resolvedAt: now });
    const sara = await traveller();
    await db.insert(appAgentAssignments).values({ userId: sara.id, agentId: huda });
    await addShift(lead, { agentId: huda, startsAt: new Date(now.getTime() - H), endsAt: new Date(now.getTime() + 2 * H) });
    await addShift(lead, { agentId: huda, startsAt: new Date(now.getTime() + DAY), endsAt: new Date(now.getTime() + DAY + 8 * H) });
    await db.insert(schema.sessions).values({ id: `t${Date.now()}${seq}`, userId: r.userId, expiresAt: new Date(Date.now() + DAY) });
    const me = (await deskQueue({ filter: "mine", me: (await db.select().from(appAgents).where(eq(appAgents.id, huda)))[0]!, sync: false, now })).total;
    expect(me).toBeGreaterThanOrEqual(1);

    await expect(deactivateAgent(lead, huda, { toAgentId: huda, now })).rejects.toThrow(/someone else/);
    const res = await deactivateAgent(lead, huda, { now });
    expect(res).toMatchObject({ tickets: 2, travellers: 1, shifts: 1, loginOff: true });
    const [a] = await db.select().from(appAgents).where(eq(appAgents.id, huda));
    expect(a).toMatchObject({ active: false, status: "offline" });
    for (const id of [t1.id, t2.id]) {
      const [t] = await db.select().from(deskTickets).where(eq(deskTickets.id, id));
      expect(t).toMatchObject({ ownerAgentId: null, ownerReason: "queue" });
      expect((await db.select().from(deskTicketEvents).where(and(eq(deskTicketEvents.ticketId, id), eq(deskTicketEvents.kind, "assigned"))))[0]?.body).toMatch(/deactivated/);
    }
    expect((await db.select().from(deskTickets).where(eq(deskTickets.id, done.id)))[0]!.ownerAgentId).toBe(huda); // history stays
    expect(await db.select().from(appAgentAssignments).where(eq(appAgentAssignments.agentId, huda))).toHaveLength(0);
    const shifts = await db.select().from(appAgentShifts).where(eq(appAgentShifts.agentId, huda));
    expect(shifts).toHaveLength(1);
    expect(shifts[0]!.endsAt.getTime()).toBe(now.getTime()); // the shift under way ended now
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, r.userId));
    expect(u!.active).toBe(false);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, r.userId))).toHaveLength(0);
    expect((await deskQueue({ filter: "mine", me: a!, sync: false, now })).total).toBe(0);
    // The presence log: online closed, signed off from now.
    const plog = await db.select().from(appAgentPresenceLog).where(eq(appAgentPresenceLog.agentId, huda));
    expect(plog.filter((l) => !l.endedAt).map((l) => l.status)).toEqual(["offline"]);
    await expect(deactivateAgent(lead, huda, { now })).rejects.toThrow(/Already/);

    // Handing on to a named agent; then back.
    await reactivateAgent(lead, huda, now);
    expect((await db.select().from(schema.users).where(eq(schema.users.id, r.userId)))[0]!.active).toBe(true);
    const t3 = await ticket({ openedAt: now, ownerAgentId: huda });
    const res2 = await deactivateAgent(lead, huda, { toAgentId: other.agentId, now });
    expect(res2.tickets).toBe(1);
    expect((await db.select().from(deskTickets).where(eq(deskTickets.id, t3.id)))[0]).toMatchObject({ ownerAgentId: other.agentId, ownerReason: "manual" });
    expect((await agentsBoard(now)).find((x) => x.id === huda)?.active).toBe(false);
  });
});

describe("rota: repeating shifts", () => {
  it("lists the same hours on each chosen weekday, for N weeks (Riyadh days)", () => {
    // Sunday 1 Jun 2031, 09:00–17:00 Riyadh = 06:00–14:00 UTC.
    const s = new Date("2031-06-01T06:00:00Z"), e = new Date("2031-06-01T14:00:00Z");
    const occ = shiftOccurrences(s, e, 2, [0, 2]); // Sundays and Tuesdays
    expect(occ.map((o) => o.startsAt.toISOString())).toEqual(["2031-06-01T06:00:00.000Z", "2031-06-03T06:00:00.000Z", "2031-06-08T06:00:00.000Z", "2031-06-10T06:00:00.000Z"]);
    expect(occ.every((o) => o.endsAt.getTime() - o.startsAt.getTime() === 8 * H)).toBe(true);
    // A late shift that starts at 23:00 Riyadh on Saturday is a Saturday shift, even though it's 20:00 UTC.
    expect(shiftOccurrences(new Date("2031-06-07T20:00:00Z"), new Date("2031-06-08T04:00:00Z"), 2).map((o) => o.startsAt.toISOString())).toEqual(["2031-06-07T20:00:00.000Z", "2031-06-14T20:00:00.000Z"]);
  });

  it("adds a weekly series, skips overlapping weeks, and takes the rest of a series off at once", async () => {
    const r = await createAgent(lead, { name: "Rana Ali", email: email("rana"), role: "support_agent", team: "riyadh", displayName: "Rana", languages: ["ar"], pronoun: "she" }, { signInUrl: "x" });
    const s = new Date("2031-07-06T06:00:00Z"); // a Sunday
    await addShift(lead, { agentId: r.agentId, startsAt: new Date("2031-07-13T07:00:00Z"), endsAt: new Date("2031-07-13T09:00:00Z") }); // in the way in week 2
    const res = await addShift(lead, { agentId: r.agentId, startsAt: s, endsAt: new Date(s.getTime() + 8 * H), weeks: 3, days: [0, 1] });
    expect(res).toMatchObject({ added: 5, skipped: 1 });
    const rows = await db.select().from(appAgentShifts).where(and(eq(appAgentShifts.agentId, r.agentId), eq(appAgentShifts.repeat, "weekly")));
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((x) => x.seriesId)).size).toBe(1);
    const second = rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[1]!;
    await removeShift(lead, second.id, { series: true });
    expect(await db.select().from(appAgentShifts).where(and(eq(appAgentShifts.agentId, r.agentId), eq(appAgentShifts.repeat, "weekly")))).toHaveLength(1);
  });
});

describe("time logs", () => {
  it("counts online, away, rostered, late and handled per Riyadh day (by hand)", () => {
    const d0 = new Date("2031-08-02T21:00:00Z"); // Sunday 3 Aug 2031, 00:00 Riyadh
    const at = (h: number, m = 0) => new Date(d0.getTime() + h * H + m * MIN);
    const intervals = [
      { status: "online", startedAt: at(9, 12), endedAt: at(12) },  // 2h48m online
      { status: "away", startedAt: at(12), endedAt: at(12, 30) },    // 30m away
      { status: "online", startedAt: at(12, 30), endedAt: at(17) },  // 4h30m online
      { status: "offline", startedAt: at(17), endedAt: at(33) },
      { status: "online", startedAt: at(33), endedAt: null },        // day 2 from 09:00, still on at "now"
    ];
    const shifts = [{ startsAt: at(9), endsAt: at(17) }, { startsAt: at(33), endsAt: at(41) }];
    const logs = dayLogs(intervals, shifts, [at(10), at(16), at(34)], d0, 2, at(35));
    expect(logs[0]).toEqual({ day: "2031-08-03", onlineMin: 168 + 270, awayMin: 30, rosteredMin: 480, lateMin: 12, handled: 2 });
    expect(logs[1]).toEqual({ day: "2031-08-04", onlineMin: 120, awayMin: 0, rosteredMin: 480, lateMin: 0, handled: 1 });
  });

  it("the header switch writes the presence log the time logs read", async () => {
    const r = await createAgent(lead, { name: "Sami Q", email: email("sami"), role: "support_agent", team: "riyadh", displayName: "Sami", languages: ["ar"], pronoun: "he" }, { signInUrl: "x" });
    const me: DeskActor = { id: r.userId, name: "Sami", permissions: new Set(["desk.view"]) };
    await setAgentStatus(me, r.agentId, "online");
    await setAgentStatus(me, r.agentId, "online"); // no change, no new interval
    await setAgentStatus(me, r.agentId, "away");
    const log = await db.select().from(appAgentPresenceLog).where(eq(appAgentPresenceLog.agentId, r.agentId)).orderBy(appAgentPresenceLog.startedAt);
    expect(log.map((l) => l.status)).toEqual(["offline", "online", "away"]);
    expect(log.filter((l) => !l.endedAt)).toHaveLength(1);
    expect(log.every((l) => l.setBy)).toBe(true);
    const tl = await timeLogs({ days: 1 });
    expect(tl.rows.find((x) => x.agent.id === r.agentId)).toBeTruthy();
  });
});

describe("performance", () => {
  it("median, p90 and SLA hit by the book", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([7], 90)).toBe(7);
    const base = { ownerAgentId: null, openedAt: new Date(0), resolvedAt: new Date(50 * MIN), dueAt: new Date(60 * MIN), escalationLevel: 0, csat: null, csatAt: null, reopenedCount: 0 };
    expect(slaHit({ ...base, firstResponseAt: new Date(10 * MIN) })).toBe(true);
    expect(slaHit({ ...base, firstResponseAt: new Date(70 * MIN) })).toBe(false);
    expect(slaHit({ ...base, firstResponseAt: null })).toBe(true); // resolved by its due time without a reply
    expect(slaHit({ ...base, firstResponseAt: new Date(10 * MIN), escalationLevel: 1 })).toBe(false);
    // Riyadh weeks start on Sunday.
    const b = buckets(new Date("2031-09-02T21:00:00Z"), new Date("2031-09-16T21:00:00Z"), "week"); // Wed 3 Sep … Tue 16 Sep
    expect(b.map((x) => x.start.toISOString())).toEqual(["2031-09-02T21:00:00.000Z", "2031-09-06T21:00:00.000Z", "2031-09-13T21:00:00.000Z"]);
  });

  it("matches a hand count on seeded tickets, refunds and ratings", async () => {
    const A = await createAgent(lead, { name: "Perf Ali", email: email("pa"), role: "support_agent", team: "riyadh", displayName: "PerfA", languages: ["ar"], pronoun: "he" }, { signInUrl: "x" });
    const B = await createAgent(lead, { name: "Perf Bea", email: email("pb"), role: "support_lead", team: "riyadh", displayName: "PerfB", languages: ["en"], pronoun: "she" }, { signInUrl: "x" });
    const day1 = new Date("2031-03-01T21:00:00Z"); // Sunday 2 Mar 2031, 00:00 Riyadh
    const at = (d: number, h: number, m = 0) => new Date(day1.getTime() + d * DAY + h * H + m * MIN);
    // Agent A: three tickets on day 1.
    //  a1: opened 09:00, first reply 09:04, resolved 10:00, due 10:00, rated 5   → FR 4, res 60, hit
    //  a2: opened 09:00, first reply 09:20, resolved 11:00, due 09:10, escalated → FR 20, res 120, miss
    //  a3: opened 13:00, first reply 13:10, still open                          → FR 10
    await ticket({ ownerAgentId: A.agentId, openedAt: at(0, 9), firstResponseAt: at(0, 9, 4), resolvedAt: at(0, 10), dueAt: at(0, 10), status: "resolved", csat: 5, csatAt: at(0, 11) });
    await ticket({ ownerAgentId: A.agentId, openedAt: at(0, 9), firstResponseAt: at(0, 9, 20), resolvedAt: at(0, 11), dueAt: at(0, 9, 10), escalationLevel: 1, status: "resolved", reopenedCount: 1, csat: 2, csatAt: at(1, 8) });
    await ticket({ ownerAgentId: A.agentId, openedAt: at(0, 13), firstResponseAt: at(0, 13, 10), status: "open" });
    // Agent B: one ticket on day 2, opened 08:00, first reply 08:30, resolved day 2 18:00, due 12:00 → FR 30, res 600, hit.
    await ticket({ ownerAgentId: B.agentId, openedAt: at(1, 8), firstResponseAt: at(1, 8, 30), resolvedAt: at(1, 18), dueAt: at(1, 12), status: "resolved" });
    // Merged away: counts nowhere.
    const target = await ticket({ ownerAgentId: B.agentId, openedAt: at(1, 9), status: "open" });
    await ticket({ ownerAgentId: B.agentId, openedAt: at(1, 9), status: "closed", mergedIntoId: target.id, resolvedAt: at(1, 10), closedAt: at(1, 10) });
    // B approved one refund of SAR 350 on day 2 (as the desk's approve writes it).
    const sara = await traveller();
    const [pay] = await db.insert(appPayments).values({ ownerId: sara.id, method: "card", status: "captured", amount: 100000, provider: "mock", idempotencyKey: `perf-${Date.now()}` } as never).returning();
    const [rf] = await db.insert(appRefunds).values({ paymentId: pay!.id, amount: 35000, stage: "approved" }).returning();
    await db.insert(schema.auditEvents).values({ actorId: B.userId, action: "desk.refund.approved", entityType: "desk", entityId: rf!.id, summary: "Approved a refund", at: at(1, 15) });

    const r = await performanceReport({ from: day1, to: at(2, 0), by: "day" });
    const a = r.agents.find((x) => x.id === A.agentId)!.m, b = r.agents.find((x) => x.id === B.agentId)!.m;
    expect(a).toMatchObject({ volume: 3, handled: 2, slaHit: 0.5, slaN: 2, csat: 3.5, csatN: 2, reopenRate: 0.5, refunds: 0, refundSar: 0 });
    expect(a.firstResponse).toEqual({ median: 10, p90: 20, n: 3 });
    expect(a.resolution).toEqual({ median: 90, p90: 120, n: 2 });
    expect(b).toMatchObject({ volume: 2, handled: 1, slaHit: 1, csat: null, csatN: 0, refunds: 1, refundSar: 35000 });
    expect(b.firstResponse).toEqual({ median: 30, p90: 30, n: 1 });
    expect(b.resolution.median).toBe(600);
    // By day: day 1 has A's three openings and two resolutions; day 2 has B's.
    const [d1, d2] = r.series.map((s) => s.m);
    expect(d1).toMatchObject({ volume: 3, handled: 2, csatN: 1 });
    expect(d2).toMatchObject({ volume: 2, handled: 1, csatN: 1, refunds: 1 });
    // The team sums them (plus any other test's tickets in this window: none, it's 2031).
    expect(r.team).toMatchObject({ volume: 5, handled: 3, csatN: 2, refunds: 1 });
    // One agent only (own stats).
    const own = await performanceReport({ from: day1, to: at(2, 0), by: "week", onlyAgentId: A.agentId });
    expect(own.agents).toHaveLength(1);
    expect(own.team.handled).toBe(2);
    expect(own.team.refunds).toBe(0);
    // The pure function agrees with itself on the same rows.
    const rows: PerfTicket[] = [{ ownerAgentId: "x", openedAt: at(0, 1), firstResponseAt: at(0, 1, 6), resolvedAt: at(0, 2), dueAt: at(0, 3), escalationLevel: 0, csat: 4, csatAt: at(0, 2), reopenedCount: 0 }];
    expect(metrics(rows, [], day1, at(1, 0))).toMatchObject({ volume: 1, handled: 1, slaHit: 1, csat: 4 });
  });
});

describe("CSAT", () => {
  it("asks once after a resolved, answered ticket; the rating closes it and shows per agent", async () => {
    const A = await createAgent(lead, { name: "Csat Agent", email: email("csat"), role: "support_agent", team: "riyadh", displayName: "Maha", languages: ["ar"], pronoun: "she" }, { signInUrl: "x" });
    const sara = await traveller();
    const tokens = await createSession(db, sara.id);
    const now = new Date();
    const get = async () => SupportCsatResponse.parse((await call(csatGet, { method: "GET", token: tokens.accessToken, path: "/api/app/v1/support/csat" })).json);
    expect((await get()).pending).toBeNull();
    // Not answered by a person: no prompt.
    await ticket({ customerId: sara.id, ownerAgentId: A.agentId, openedAt: new Date(now.getTime() - 2 * H), status: "resolved", resolvedAt: new Date(now.getTime() - H) });
    expect((await get()).pending).toBeNull();
    const t = await ticket({ customerId: sara.id, ownerAgentId: A.agentId, openedAt: new Date(now.getTime() - 2 * H), firstResponseAt: new Date(now.getTime() - 100 * MIN), status: "resolved", resolvedAt: new Date(now.getTime() - 30 * MIN) });
    expect((await get()).pending).toEqual({ ticketId: t.id, agent: "Maha" });

    expect((await call(csatGet, { method: "GET", path: "/api/app/v1/support/csat" })).status).toBe(401);
    expect((await call(csatPost, { method: "POST", token: tokens.accessToken, path: "/api/app/v1/support/csat", body: { ticketId: t.id, score: 9 } })).status).toBe(400);
    // Someone else's ticket is not found.
    const other = await createSession(db, (await traveller("Other Person")).id);
    expect((await call(csatPost, { method: "POST", token: other.accessToken, path: "/api/app/v1/support/csat", body: { ticketId: t.id, score: 5 } })).status).toBe(404);

    expect((await call(csatPost, { method: "POST", token: tokens.accessToken, path: "/api/app/v1/support/csat", body: { ticketId: t.id, score: 4 } })).status).toBe(200);
    const [after] = await db.select().from(deskTickets).where(eq(deskTickets.id, t.id));
    expect(after).toMatchObject({ csat: 4, status: "closed" });
    expect(after!.csatAt).toBeTruthy();
    expect((await get()).pending).toBeNull(); // asked once
    // A second answer keeps the first.
    await call(csatPost, { method: "POST", token: tokens.accessToken, path: "/api/app/v1/support/csat", body: { ticketId: t.id, score: 1 } });
    expect((await db.select().from(deskTickets).where(eq(deskTickets.id, t.id)))[0]!.csat).toBe(4);
    expect((await agentProfile(A.agentId))!.stats).toMatchObject({ csatN: 1, csatAvg: 4 });

    // Skipping: never asked again, no score, the ticket stays resolved.
    const t2 = await ticket({ customerId: sara.id, ownerAgentId: A.agentId, openedAt: new Date(now.getTime() - H), firstResponseAt: new Date(now.getTime() - 50 * MIN), status: "resolved", resolvedAt: new Date(now.getTime() - 10 * MIN) });
    expect((await get()).pending?.ticketId).toBe(t2.id);
    expect((await call(csatPost, { method: "POST", token: tokens.accessToken, path: "/api/app/v1/support/csat", body: { ticketId: t2.id, score: null } })).status).toBe(200);
    expect((await db.select().from(deskTickets).where(eq(deskTickets.id, t2.id)))[0]).toMatchObject({ csat: null, status: "resolved" });
    expect((await get()).pending).toBeNull();
  });
});

describe("night cover (§7 default 6)", () => {
  it("pages the on-call lead once by SMS and push when an urgent ticket breaches with nobody on duty", async () => {
    const now = new Date(Date.UTC(2032, 4, 9, 23)); // 02:00 Riyadh, nobody rostered
    const phone = "+966511112222";
    const leadApp = await traveller("On Call Lead", phone);
    await db.insert(appDevices).values({ userId: leadApp.id, platform: "ios", pushToken: "ExponentPushToken[oncallleadtoken01]" } as never);
    const t = await ticket({ openedAt: new Date(now.getTime() - 2 * H), dueAt: new Date(now.getTime() - H), priority: "urgent", subject: "Stuck at the gate" });
    const quiet = await ticket({ openedAt: new Date(now.getTime() - 2 * H), dueAt: new Date(now.getTime() - H), priority: "normal" });
    const prev = process.env.DESK_ONCALL_PHONE;
    process.env.DESK_ONCALL_PHONE = phone;
    try {
      const before = outbox.length;
      const r = await nightCover(now);
      expect(r.onDuty).toBe(0);
      expect(r.paged).toBeGreaterThanOrEqual(1);
      const sms = outbox.slice(0, outbox.length - before).find((o) => o.channel === "sms" && o.to === phone);
      expect(sms?.body).toMatch(/urgent/);
      expect(pushOutbox.some((p) => p.to === "ExponentPushToken[oncallleadtoken01]" && p.title === "Urgent on the desk")).toBe(true);
      const paged = await db.select().from(deskTicketEvents).where(and(eq(deskTicketEvents.ticketId, t.id), eq(deskTicketEvents.kind, "paged")));
      expect(paged).toHaveLength(1);
      expect(await db.select().from(deskTicketEvents).where(and(eq(deskTicketEvents.ticketId, quiet.id), eq(deskTicketEvents.kind, "paged")))).toHaveLength(0);
      // Once per ticket.
      const again = outbox.length;
      await nightCover(new Date(now.getTime() + 10 * MIN));
      expect(outbox.length).toBe(again);
      expect(await db.select().from(deskTicketEvents).where(and(eq(deskTicketEvents.ticketId, t.id), eq(deskTicketEvents.kind, "paged")))).toHaveLength(1);

      // With someone on duty, the rota covers it: no page.
      const later = new Date(now.getTime() + DAY);
      const on = await createAgent(lead, { name: "Night Owl", email: email("owl"), role: "support_agent", team: "riyadh", displayName: "Owl", languages: ["ar"], pronoun: "he" }, { signInUrl: "x" });
      await addShift(lead, { agentId: on.agentId, startsAt: new Date(later.getTime() - H), endsAt: new Date(later.getTime() + 6 * H) });
      await setAgentStatus({ id: on.userId, name: "Owl", permissions: new Set(["desk.view"]) }, on.agentId, "online");
      const t2 = await ticket({ openedAt: new Date(later.getTime() - 2 * H), dueAt: new Date(later.getTime() - H), priority: "urgent" });
      const r2 = await nightCover(later);
      expect(r2).toMatchObject({ paged: 0 });
      expect(r2.onDuty).toBeGreaterThan(0);
      expect(await db.select().from(deskTicketEvents).where(and(eq(deskTicketEvents.ticketId, t2.id), eq(deskTicketEvents.kind, "paged")))).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.DESK_ONCALL_PHONE; else process.env.DESK_ONCALL_PHONE = prev;
    }
  });
});

describe("saved replies", () => {
  it("adds, edits and deletes, audited; desk.admin only", async () => {
    const c = await saveCanned(lead, null, { title: "Bag tag photo", bodyEn: "Please send a photo of your bag tag.", bodyAr: "أرسل صورة ملصق الشنطة لو سمحت.", sort: 3 });
    const e = await saveCanned(lead, c.id, { title: "Bag tag", bodyEn: "A photo of the bag tag, please.", bodyAr: "صورة ملصق الشنطة لو سمحت.", sort: 1 });
    expect(e).toMatchObject({ title: "Bag tag", sort: 1 });
    expect(e.updatedAt).toBeTruthy();
    await expect(saveCanned(lead, null, { title: "x", bodyEn: "", bodyAr: "" })).rejects.toThrow(/both languages/);
    const agent = await opsUser("No Admin", ["desk.view", "desk.act"]);
    await expect(deleteCanned(agent, c.id)).rejects.toThrow(/access/);
    await deleteCanned(lead, c.id);
    expect(await db.select().from(appDeskCanned).where(eq(appDeskCanned.id, c.id))).toHaveLength(0);
    const log = await db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.entityId, c.id), eq(schema.auditEvents.entityType, "desk"))).orderBy(schema.auditEvents.id);
    expect(log.map((l) => l.action)).toEqual(["desk.canned.added", "desk.canned.updated", "desk.canned.deleted"]);
  });
});

// saveAgent (attach a profile to an existing login) still works next to Add agent.
it("saveAgent still attaches a profile to an existing Ops login", async () => {
  const u = await opsUser("Existing Login", ["desk.view", "desk.act"]);
  const a = await saveAgent(lead, { opsUserId: u.id, displayName: "Existing", languages: ["en"], pronoun: "he", replyMinutes: 3 });
  expect(a.opsUserId).toBe(u.id);
});
