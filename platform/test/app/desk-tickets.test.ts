import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql as rawSql } from "drizzle-orm";
import { db, schema } from "@/db";
import { appMessages, appPayments, appPeople, appQuotes, appRequests, appSegments, appTrips, appUsers } from "@/db/app-schema";
import { appDeskNotes, deskTicketEvents, deskTicketLinks, deskTickets } from "@/db/app-schema-desk";
import { encryptField, passportAad } from "@/lib/app/crypto";
import { bookingSuppliers } from "@/lib/app/booking/common";
import type { DeskActor } from "@/lib/app/desk/core";
import { saveAgent } from "@/lib/app/desk/agents";
import { confirmHold, issueTickets, sendAgentReply } from "@/lib/app/desk/adapters";
import { escalate, reassign } from "@/lib/app/desk/inbox";
import { escalationLevel, MANUAL_SLA_MINUTES, pauseClock, resumeClock, ticketSla } from "@/lib/app/desk/sla";
import { applyMove, nextStatus, parseTicketRef, ticketRef, type TicketClock } from "@/lib/app/desk/ticket-state";
import {
  addTicketNote, assignTicket, createTicket, deskQueue, escalationAlerts, getTicket, listTickets, mergeTickets, moveTicket, replyOnTicket,
  setPriority, sweepEscalations, syncTickets, takeTicket, ticketsFor, ticketsRepliedOnThread,
} from "@/lib/app/desk/tickets";

/* Desk tickets (lib/app/desk/tickets.ts, DESK-PLAN.md §4.4–4.5): the lifecycle, the SLA clock, the sync with the queue. */

const MIN = 60_000;
const at = (m: number) => new Date(Date.UTC(2026, 9, 21, 9, 0) + m * MIN);
const clock = (o: Partial<TicketClock> = {}): TicketClock => ({
  status: "open", slaStartedAt: at(0), slaMinutes: 60, dueAt: at(60), pausedAt: null, firstResponseAt: null, resolvedAt: null, closedAt: null, reopenedCount: 0, escalationLevel: 0, ...o,
});

describe("ticket lifecycle (pure)", () => {
  it("allows the moves in the plan and refuses the rest", () => {
    expect(nextStatus("new", "take")).toBe("open");
    expect(nextStatus("open", "reply")).toBe("waiting_customer");
    expect(nextStatus("waiting_customer", "customer_replied")).toBe("open");
    expect(nextStatus("open", "wait_supplier")).toBe("waiting_supplier");
    expect(nextStatus("waiting_supplier", "supplier_answered")).toBe("open");
    expect(nextStatus("open", "resolve")).toBe("resolved");
    expect(nextStatus("resolved", "customer_replied")).toBe("open");
    expect(nextStatus("resolved", "close")).toBe("closed");
    expect(nextStatus("waiting_customer", "merge")).toBe("closed");
    // Not allowed: a closed ticket is final, and an open one can't be reopened or closed without resolving.
    for (const m of ["reopen", "take", "reply", "resolve", "merge", "source_live"] as const) expect(nextStatus("closed", m)).toBeNull();
    expect(nextStatus("open", "reopen")).toBeNull();
    expect(nextStatus("open", "close")).toBeNull();
    expect(nextStatus("waiting_customer", "supplier_answered")).toBeNull();
    expect(() => applyMove(clock({ status: "closed" }), "reopen", at(5))).toThrow(/closed/);
  });

  it("the first reply sets first_response_at once, and the ticket then waits on the customer", () => {
    const p = applyMove(clock({ status: "new" }), "reply", at(4));
    expect(p).toMatchObject({ status: "waiting_customer", firstResponseAt: at(4), pausedAt: at(4) });
    const again = applyMove(clock({ status: "open", firstResponseAt: at(4) }), "reply", at(9));
    expect(again.firstResponseAt).toBeUndefined();
  });

  it("pauses the SLA while waiting and moves the due time on by the pause", () => {
    const c = { slaStartedAt: at(0), dueAt: at(60), pausedAt: null };
    const paused = pauseClock(c, at(20));
    expect(paused.pausedAt).toEqual(at(20));
    expect(pauseClock(paused, at(30)).pausedAt).toEqual(at(20)); // already paused: the first pause stands
    const resumed = resumeClock(paused, at(110)); // stood still 90 minutes
    expect(resumed).toEqual({ slaStartedAt: at(0), dueAt: at(150), pausedAt: null });
    // Through the state machine: wait on a supplier at 20, the answer at 110.
    const w = applyMove(clock(), "wait_supplier", at(20));
    const back = applyMove(clock({ status: "waiting_supplier", pausedAt: w.pausedAt! }), "supplier_answered", at(110));
    expect(back).toMatchObject({ status: "open", pausedAt: null, dueAt: at(150) });
    // A paused clock never reads late and never escalates, however long it waits.
    const waiting = { ...clock({ status: "waiting_customer", pausedAt: at(20) }) };
    expect(escalationLevel(waiting, at(500))).toBe(0);
    expect(ticketSla(waiting, at(500)).state).toBe("ok");
  });

  it("escalates at 100% of the target and again at 200%", () => {
    const c = clock();
    expect(escalationLevel(c, at(59))).toBe(0);
    expect(escalationLevel(c, at(61))).toBe(1);
    expect(escalationLevel(c, at(119))).toBe(1);
    expect(escalationLevel(c, at(120))).toBe(2);
  });

  it("a reopen counts, starts a fresh clock and spends the old escalation; resolve and close stamp their times", () => {
    const r = applyMove(clock({ status: "resolved", resolvedAt: at(30), escalationLevel: 2 }), "customer_replied", at(200));
    expect(r).toMatchObject({ status: "open", reopenedCount: 1, resolvedAt: null, slaStartedAt: at(200), dueAt: at(260), escalationLevel: 0 });
    expect(applyMove(clock({ status: "waiting_customer", pausedAt: at(5) }), "resolve", at(40))).toMatchObject({ status: "resolved", resolvedAt: at(40), pausedAt: null });
    expect(applyMove(clock({ status: "open" }), "merge", at(41))).toMatchObject({ status: "closed", closedAt: at(41), resolvedAt: at(41) });
  });

  it("reads and writes refs", () => {
    expect(ticketRef(123)).toBe("T-000123");
    expect(parseTicketRef("t-000123")).toBe(123);
    expect(parseTicketRef("T123")).toBe(123);
    expect(parseTicketRef("R-7B21C4")).toBeNull();
    expect(MANUAL_SLA_MINUTES).toEqual({ urgent: 30, high: 240, normal: 1440, low: 4320 });
  });
});

/* ───────────── against the database ───────────── */

let seq = 0;
async function opsUser(name: string, perms: string[]): Promise<DeskActor> {
  seq += 1;
  const [role] = await db.insert(schema.roles).values({ key: `tickets_test_${Date.now()}_${seq}`, name: `Tickets ${seq}`, nameAr: "تذاكر", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name, email: `tickets${Date.now()}${seq}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name, permissions: new Set(perms) };
}

async function traveller(name = "Lama Alqahtani") {
  const [u] = await db.insert(appUsers).values({ name, phone: `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` }).returning();
  const [p] = await db.insert(appPeople).values({ ownerId: u!.id, isSelf: true, givenNames: name.split(" ")[0]!, surname: name.split(" ")[1] ?? "", relation: "self", nationality: "SAU" }).returning();
  await db.update(appPeople).set({ passportNumberEnc: encryptField("A11493107", passportAad(p!.id)), passportNumberMasked: "A11•••07", passportExpiry: "2030-01-01" }).where(eq(appPeople.id, p!.id));
  return { user: u!, person: p! };
}

/** An order waiting for the desk to confirm, as in desk.test.ts. */
async function order(userId: string, personIds: string[]) {
  const [trip] = await db.insert(appTrips).values({ ownerId: userId, city: "Cairo", country: "EG", startDate: "2026-12-02", travellerIds: personIds, status: "planning" }).returning();
  await db.insert(appSegments).values({ tripId: trip!.id, direction: "out", carrier: "SV", carrierName: "Saudia", flightNumber: "SV305", fromAirport: "RUH", toAirport: "CAI",
    departLocal: "2026-12-02 08:10:00", departTz: "Asia/Riyadh", arriveLocal: "2026-12-02 10:15:00", arriveTz: "Africa/Cairo", durationMin: 185 });
  const [r] = await db.insert(appRequests).values({ ownerId: userId, kind: "flight", status: "with_agent", summary: "Riyadh to Cairo, 2 Dec", travellerIds: personIds, tripId: trip!.id }).returning();
  const [q] = await db.insert(appQuotes).values({ requestId: r!.id, lines: [{ label: "Flights", amount: 210000, kind: "flight" }], total: 210000, status: "accepted" }).returning();
  const key = `tickets:${r!.id}`;
  const auth = await bookingSuppliers.payments().authorize({ amount: 210000, currency: "SAR", token: "tok_visa", idempotencyKey: key, customerRef: userId, description: "test" } as never);
  await db.insert(appPayments).values({ ownerId: userId, requestId: r!.id, quoteId: q!.id, method: "card", status: auth.status, amount: 210000, label: "Visa ending 41", provider: "mock", providerRef: auth.providerRef, idempotencyKey: key });
  return r!;
}

const ofSource = (kind: string, id: string) => db.select().from(deskTickets).where(and(eq(deskTickets.sourceKind, kind), eq(deskTickets.sourceId, id)));
const eventsOf = (id: string) => db.select().from(deskTicketEvents).where(eq(deskTicketEvents.ticketId, id)).orderBy(deskTicketEvents.at);

let lead: DeskActor, agent: DeskActor, other: DeskActor;
let agentProfile: { id: string }, otherProfile: { id: string };

beforeAll(async () => {
  lead = await opsUser("Bader Lead", ["desk.view", "desk.act", "desk.issue", "desk.refund", "desk.moderate", "desk.admin", "desk.tickets.manage"]);
  agent = await opsUser("Ticket Agent", ["desk.view", "desk.act", "desk.issue"]);
  other = await opsUser("Other Agent", ["desk.view", "desk.act"]);
  agentProfile = await saveAgent(lead, { opsUserId: agent.id, displayName: "Reem", languages: ["ar", "en"], pronoun: "she", replyMinutes: 2 });
  otherProfile = await saveAgent(lead, { opsUserId: other.id, displayName: "Majed", languages: ["ar", "en"], pronoun: "he", replyMinutes: 2 });
});

describe("tickets from the queue", () => {
  it("an order needing confirmation makes exactly one ticket, through hold and issue, and issuing resolves it", async () => {
    const { user, person } = await traveller("Lama Alqahtani");
    const r = await order(user.id, [person.id]);
    await syncTickets();
    await syncTickets(); // twice: still one
    let [t, ...more] = await ofSource("order", r.id);
    expect(more).toHaveLength(0);
    expect(t).toMatchObject({ kind: "order", status: "new", customerId: user.id, need: "Confirm the order", slaMinutes: 4 });
    const links = await db.select().from(deskTicketLinks).where(eq(deskTicketLinks.ticketId, t!.id));
    expect(links.map((l) => `${l.entityKind}:${l.entityId}`).sort()).toEqual([`customer:${user.id}`, `order:${r.id}`].sort());

    // Held: the same ticket, now about issuing.
    await confirmHold(agent, r.id, { pnr: "CAI305" });
    await syncTickets();
    [t, ...more] = await ofSource("order", r.id);
    expect(more).toHaveLength(0);
    expect(t).toMatchObject({ kind: "ticketing", need: "Issue tickets", slaMinutes: 15 });

    // While the order still needs the desk, the ticket can't be resolved by hand.
    await expect(moveTicket(agent, t!.id, "resolve")).rejects.toThrow(/still needs the desk/);

    await issueTickets(agent, r.id, { pnr: "CAI305", tickets: ["065 1234567001"] });
    await syncTickets();
    [t] = await ofSource("order", r.id);
    expect(t).toMatchObject({ status: "resolved" });
    expect(t!.resolvedAt).toBeTruthy();
    const ev = await eventsOf(t!.id);
    expect(ev.map((e) => e.kind)).toEqual(["created", "status"]);
    expect(ev.at(-1)).toMatchObject({ from: "new", to: "resolved", actorId: null });

    // Quiet for 72 hours: closed, and the source is free for a new ticket.
    await syncTickets(new Date(Date.now() + 73 * 3_600_000));
    [t] = await ofSource("order", r.id);
    expect(t).toMatchObject({ status: "closed" });
  });

  it("carries a hand assignment and an escalation made on the queue onto the ticket", async () => {
    const { user, person } = await traveller("Nouf Alanazi");
    const r = await order(user.id, [person.id]);
    await reassign(agent, "order", r.id, otherProfile.id); // before any ticket exists: app_desk_items
    await syncTickets();
    let [t] = await ofSource("order", r.id);
    expect(t).toMatchObject({ ownerAgentId: otherProfile.id, ownerReason: "manual", status: "open" });
    await escalate(agent, "order", r.id, "Passport name doesn't match");
    [t] = await ofSource("order", r.id);
    expect(t).toMatchObject({ escalationNote: "Passport name doesn't match" });
    expect(t!.escalatedAt).toBeTruthy();
    const q = await deskQueue({ filter: "escalated", me: null, q: ticketRef(t!.number) });
    expect(q.rows.map((x) => x.id)).toEqual([t!.id]);
  });

  it("a chat: the first reply sets first_response_at and waits on the traveller; their next message reopens the clock", async () => {
    const { user } = await traveller("Yousef Alharthi");
    const threadId = crypto.randomUUID();
    await db.insert(appMessages).values({ threadKind: "support", threadId, authorKind: "user", authorUserId: user.id, authorName: "Yousef", body: "Can I change my seat?" });
    await syncTickets();
    let [t] = await ofSource("chat", `support:${threadId}`);
    expect(t).toMatchObject({ kind: "chat", status: "new", firstResponseAt: null, slaMinutes: 10 });
    await expect(moveTicket(agent, t!.id, "resolve")).rejects.toThrow(/reply first/);

    await sendAgentReply(agent, "support", threadId, { body: "Yes, which seat would you like?" });
    expect(await ticketsRepliedOnThread(agent, "support", threadId)).toBe(1);
    [t] = await ofSource("chat", `support:${threadId}`);
    expect(t!.firstResponseAt).toBeTruthy();
    expect(t).toMatchObject({ status: "waiting_customer" });
    expect(t!.pausedAt).toBeTruthy();
    const first = t!.firstResponseAt!;

    await syncTickets(); // the chat left the queue: nothing changes, it already waits
    [t] = await ofSource("chat", `support:${threadId}`);
    expect(t).toMatchObject({ status: "waiting_customer" });

    await db.insert(appMessages).values({ threadKind: "support", threadId, authorKind: "user", authorUserId: user.id, authorName: "Yousef", body: "12A please" });
    await syncTickets();
    [t] = await ofSource("chat", `support:${threadId}`);
    expect(t).toMatchObject({ status: "open", pausedAt: null, slaMinutes: 30 }); // the next reply is due within 30 minutes
    expect(t!.firstResponseAt).toEqual(first);

    // Replying from the ticket page.
    await replyOnTicket(agent, t!.id, { body: "Done: 12A is yours." });
    [t] = await ofSource("chat", `support:${threadId}`);
    expect(t).toMatchObject({ status: "waiting_customer" });
    expect(t!.firstResponseAt).toEqual(first);
    const msgs = await db.select().from(appMessages).where(eq(appMessages.threadId, threadId));
    expect(msgs.at(-1)).toMatchObject({ authorKind: "agent", body: "Done: 12A is yours." });
  });
});

describe("tickets by hand", () => {
  it("creates one from an order, owned by the agent who opened it, due by its priority", async () => {
    const { user, person } = await traveller("Sara Alotaibi");
    const r = await order(user.id, [person.id]);
    const now = new Date();
    const t = await createTicket(agent, { subject: "Wants a wheelchair at Cairo", priority: "high", about: { kind: "order", id: r.id }, note: "Call the airline" }, now);
    expect(t).toMatchObject({ kind: "manual", status: "open", ownerAgentId: agentProfile.id, ownerReason: "manual", customerId: user.id, priority: "high", slaMinutes: 240, sourceId: null });
    expect(t.dueAt.getTime() - now.getTime()).toBe(240 * MIN);
    expect((await ticketsFor("order", r.id)).map((x) => x.id)).toContain(t.id);
    expect((await ticketsFor("customer", user.id)).map((x) => x.id)).toContain(t.id);
    const full = await getTicket(ticketRef(t.number));
    expect(full!.notes.map((n) => n.n.body)).toEqual(["Call the airline"]);
    expect(full!.thread).toEqual({ kind: "request", id: r.id }); // replies go to the order's thread
    await expect(createTicket(agent, { subject: "x" })).rejects.toThrow(/what the ticket is about/);

    // Priority: urgent pulls the due time in to 30 minutes from when the clock started.
    const u2 = await setPriority(agent, t.id, "urgent");
    expect(u2.slaMinutes).toBe(30);
    expect(u2.dueAt.getTime() - now.getTime()).toBe(30 * MIN);
  });

  it("reassigning someone else's ticket needs desk.tickets.manage", async () => {
    const t = await createTicket(agent, { subject: "Follow up the hotel's refund" });
    await expect(assignTicket(other, t.id, otherProfile.id)).rejects.toThrow(/Only a lead/);
    await expect(takeTicket(other, t.id)).rejects.toThrow(/Only a lead/);
    await assignTicket(lead, t.id, otherProfile.id);
    const mine = await takeTicket(other, t.id); // their own now
    expect(mine.ownerAgentId).toBe(otherProfile.id);
    await assignTicket(other, t.id, agentProfile.id); // handing on their own is fine
    const ev = await eventsOf(t.id);
    expect(ev.filter((e) => e.kind === "assigned").map((e) => e.to)).toEqual(["Majed", "Majed", "Reem"]);
  });

  it("waits on a supplier with the clock stopped, resolves, reopens and closes", async () => {
    const t = await createTicket(agent, { subject: "Hotel to confirm the late check-in", priority: "normal" });
    await moveTicket(agent, t.id, "wait_supplier");
    let [row] = await db.select().from(deskTickets).where(eq(deskTickets.id, t.id));
    expect(row).toMatchObject({ status: "waiting_supplier" });
    expect(row!.pausedAt).toBeTruthy();
    await db.update(deskTickets).set({ pausedAt: new Date(row!.pausedAt!.getTime() - 120 * MIN) }).where(eq(deskTickets.id, t.id)); // two hours ago
    await moveTicket(agent, t.id, "supplier_answered");
    [row] = await db.select().from(deskTickets).where(eq(deskTickets.id, t.id));
    expect(row).toMatchObject({ status: "open", pausedAt: null });
    expect(Math.round((row!.dueAt.getTime() - t.dueAt.getTime()) / MIN)).toBe(120);
    await addTicketNote(agent, t.id, "Hotel confirmed by email");
    await moveTicket(agent, t.id, "resolve");
    await expect(moveTicket(agent, t.id, "resolve")).rejects.toThrow(/can't be done/);
    await moveTicket(agent, t.id, "reopen");
    [row] = await db.select().from(deskTickets).where(eq(deskTickets.id, t.id));
    expect(row).toMatchObject({ status: "open", reopenedCount: 1 });
    await moveTicket(agent, t.id, "resolve");
    await moveTicket(agent, t.id, "close");
    [row] = await db.select().from(deskTickets).where(eq(deskTickets.id, t.id));
    expect(row).toMatchObject({ status: "closed" });
    expect((await eventsOf(t.id)).map((e) => e.kind)).toEqual(["created", "status", "status", "note", "status", "reopened", "status", "status"]);
    const audit = await db.execute<{ action: string }>(rawSql`SELECT action FROM audit_events WHERE entity_type = 'desk' AND entity_id = ${t.id} ORDER BY id`);
    expect((audit as unknown as { action: string }[]).map((a) => a.action)).toContain("desk.ticket.resolve");
  });
});

describe("merge", () => {
  it("moves links and notes to the target, links back, and closes the merged ticket", async () => {
    const { user } = await traveller("Faris Alshammari");
    const a = await createTicket(agent, { subject: "Bag lost on SV305", customerId: user.id, note: "First report" });
    const b = await createTicket(agent, { subject: "Where is my bag?", customerId: user.id, priority: "urgent", about: { kind: "chat", id: `support:${crypto.randomUUID()}` } });
    await expect(mergeTickets(agent, b.id, ticketRef(a.number))).rejects.toThrow(/access/);
    await expect(mergeTickets(lead, b.id, ticketRef(b.number))).rejects.toThrow(/different ticket/);
    await mergeTickets(lead, b.id, ticketRef(a.number));
    const [from] = await db.select().from(deskTickets).where(eq(deskTickets.id, b.id));
    expect(from).toMatchObject({ status: "closed", mergedIntoId: a.id });
    const links = await db.select().from(deskTicketLinks).where(eq(deskTicketLinks.ticketId, a.id));
    expect(links.map((l) => l.entityKind).sort()).toEqual(["chat", "customer", "ticket"]);
    expect(await db.select().from(deskTicketLinks).where(eq(deskTicketLinks.ticketId, b.id))).toHaveLength(0);
    const [into] = await db.select().from(deskTickets).where(eq(deskTickets.id, a.id));
    expect(into!.priority).toBe("urgent"); // the higher of the two
    const notes = await db.select().from(appDeskNotes).where(eq(appDeskNotes.ticketId, a.id));
    expect(notes.map((n) => n.body)).toEqual(["First report"]);
    const full = await getTicket(a.id);
    expect(full!.merged.map((m) => m.id)).toEqual([b.id]);
    await expect(mergeTickets(lead, b.id, ticketRef(a.number))).rejects.toThrow(/closed/);
  });

  it("a source merged into another ticket keeps that ticket instead of opening a new one", async () => {
    const { user } = await traveller("Hind Alsubaie");
    const threadId = crypto.randomUUID();
    await db.insert(appMessages).values({ threadKind: "support", threadId, authorKind: "user", authorUserId: user.id, body: "Any news on my visa?" });
    await syncTickets();
    const [chat] = await ofSource("chat", `support:${threadId}`);
    const target = await createTicket(agent, { subject: "Visa for Hind", customerId: user.id });
    await mergeTickets(lead, chat!.id, ticketRef(target.number));
    await syncTickets();
    const open = await db.select().from(deskTickets).where(and(eq(deskTickets.sourceId, `support:${threadId}`), rawSql`${deskTickets.status} <> 'closed'`));
    expect(open).toHaveLength(0); // no second ticket for the chat
    expect((await ticketsFor("chat", `support:${threadId}`)).map((x) => x.id)).toEqual([target.id]);
  });
});

describe("escalation on breach", () => {
  it("past its promise goes to level 1 once, twice past to level 2, and the lead's bell shows it", async () => {
    const t = await createTicket(other, { subject: "Refund promised by phone", priority: "urgent" });
    const later = (m: number) => new Date(t.slaStartedAt.getTime() + m * MIN);
    expect(await sweepEscalations(later(29))).not.toContainEqual(expect.objectContaining({ id: t.id }));
    expect((await sweepEscalations(later(31))).filter((r) => r.id === t.id)).toEqual([{ id: t.id, level: 1 }]);
    expect((await sweepEscalations(later(32))).filter((r) => r.id === t.id)).toEqual([]); // once per level
    expect((await sweepEscalations(later(61))).filter((r) => r.id === t.id)).toEqual([{ id: t.id, level: 2 }]);
    const ev = (await eventsOf(t.id)).filter((e) => e.kind === "escalated");
    expect(ev.map((e) => e.to)).toEqual(["level 1", "level 2"]);

    const leadUser = { ...lead, email: "", team: "riyadh", locale: "en", partnerId: null, isDirector: false, mustChangePassword: false, role: { id: "", key: "", name: "", nameAr: "" } } as never;
    const alerts = await escalationAlerts(leadUser, later(62), 1000);
    expect(alerts.find((a) => a.id === t.id)).toMatchObject({ ref: ticketRef(t.number), level: 2 });
    const agentUser = { ...agent, email: "", team: "riyadh", locale: "en", partnerId: null, isDirector: false, mustChangePassword: false, role: { id: "", key: "", name: "", nameAr: "" } } as never;
    expect(await escalationAlerts(agentUser, later(62))).toEqual([]);

    // A paused ticket doesn't escalate.
    const w = await createTicket(other, { subject: "Waiting on Hotelbeds", priority: "urgent" });
    await moveTicket(other, w.id, "wait_supplier");
    expect((await sweepEscalations(new Date(w.slaStartedAt.getTime() + 300 * MIN))).filter((r) => r.id === w.id)).toEqual([]);
  });
});

describe("My queue and the Tickets list", () => {
  it("filters, searches and pages in SQL", async () => {
    const t = await createTicket(agent, { subject: "Queue check: lounge access in Jeddah", priority: "low" });
    const mine = await deskQueue({ filter: "mine", me: { id: agentProfile.id } as never, q: "lounge access", sync: false });
    expect(mine.rows.map((x) => x.id)).toEqual([t.id]);
    expect((await deskQueue({ filter: "mine", me: { id: otherProfile.id } as never, q: "lounge access", sync: false })).total).toBe(0);
    expect((await deskQueue({ filter: "team", me: null, q: ticketRef(t.number), sync: false })).rows.map((x) => x.id)).toEqual([t.id]);
    const all = await deskQueue({ filter: "team", me: null, limit: 2, sync: false });
    expect(all.rows.length).toBeLessThanOrEqual(2);
    expect(all.counts.all).toBe(all.total);
    const next = await deskQueue({ filter: "team", me: null, limit: 2, offset: 2, sync: false });
    expect(next.rows.some((x) => all.rows.some((y) => y.id === x.id))).toBe(false);
    const list = await listTickets({ tab: "all", q: "lounge access" });
    expect(list.rows.map((x) => x.id)).toEqual([t.id]);
    expect(list.counts.open).toBe(1);
    expect((await listTickets({ tab: "resolved", q: "lounge access" })).total).toBe(0);
  });
});
