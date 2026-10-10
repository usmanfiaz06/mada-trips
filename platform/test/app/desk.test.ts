import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql as rawSql } from "drizzle-orm";
import { PresenceResponse } from "@mada/shared";
import { db, schema } from "@/db";
import {
  appCreditLedger, appMessages, appNotifications, appPayments, appPeople, appQuotes, appRefunds, appRequests, appSegments, appTrips, appUsers,
} from "@/db/app-schema";
import { appAgentShifts, appAgents, appDeskModeration } from "@/db/app-schema-desk";
import { appOrders } from "@/db/app-schema-booking";
import { appSupportThreads } from "@/db/app-schema-wallet";
import { appPosts, appReports } from "@/db/app-schema-circles";
import { encryptField, passportAad } from "@/lib/app/crypto";
import { createSession } from "@/lib/app/tokens";
import { suppliers } from "@/lib/app/suppliers";
import { bookingSuppliers } from "@/lib/app/booking/common";
import { GET as presenceGet } from "@/app/api/app/v1/support/presence/route";
import type { DeskActor } from "@/lib/app/desk/core";
import { addShift, assignPrimary, firstReplySamples, pingTyping, presenceFor, saveAgent, setAgentStatus } from "@/lib/app/desk/agents";
import {
  addNote, approveRefund, askTraveller, blockTraveller, confirmHold, decideModeration, failTicketing, getRequestFull, issueTickets, listConversations,
  destinationOf, listModeration, listOrders, markDone, priceChanged, rejectRefund, revealPassport, sendAgentReply, sendQuote,
} from "@/lib/app/desk/adapters";
import { pushPlan, zonedToUtc } from "@/lib/app/desk/disruptions";
import { deskInbox, escalate, filterInbox, reassign } from "@/lib/app/desk/inbox";
import { routeFor } from "@/lib/app/desk/routing";
import { compareUrgency, slaFor, typicalReplyMinutes } from "@/lib/app/desk/sla";
import { call } from "./helpers";

const ALL = ["desk.view", "desk.act", "desk.issue", "desk.refund", "desk.moderate", "desk.admin"];
let seq = 0;

async function opsUser(name: string, perms: string[]): Promise<DeskActor> {
  seq += 1;
  const [role] = await db.insert(schema.roles).values({ key: `desk_test_${Date.now()}_${seq}`, name: `Desk ${seq}`, nameAr: "مكتب", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name, email: `desk${Date.now()}${seq}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name, permissions: new Set(perms) };
}

async function traveller(name = "Sara Alqahtani") {
  const [u] = await db.insert(appUsers).values({ name, phone: `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` }).returning();
  const [p] = await db.insert(appPeople).values({ ownerId: u!.id, isSelf: true, givenNames: name.split(" ")[0]!, surname: name.split(" ")[1] ?? "", relation: "self", nationality: "SAU" }).returning();
  await db.update(appPeople).set({ passportNumberEnc: encryptField("A11493107", passportAad(p!.id)), passportNumberMasked: "A11•••07", passportExpiry: "2030-01-01" }).where(eq(appPeople.id, p!.id));
  return { user: u!, person: p! };
}

/** An order waiting for the desk: a trip with a flight, a quote, and a card hold authorised through the mock provider. */
async function order(userId: string, personIds: string[], opts: { token?: string; method?: string } = {}) {
  const [trip] = await db.insert(appTrips).values({ ownerId: userId, city: "Istanbul", country: "TR", startDate: "2026-11-14", travellerIds: personIds, status: "planning" }).returning();
  await db.insert(appSegments).values({ tripId: trip!.id, direction: "out", carrier: "SV", carrierName: "Saudia", flightNumber: "SV263", fromAirport: "RUH", toAirport: "IST",
    departLocal: "2026-11-14 09:40:00", departTz: "Asia/Riyadh", arriveLocal: "2026-11-14 13:55:00", arriveTz: "Europe/Istanbul", durationMin: 255 });
  const [r] = await db.insert(appRequests).values({ ownerId: userId, kind: "flight", status: "with_agent", summary: "Riyadh to Istanbul, 14 Nov", travellerIds: personIds, tripId: trip!.id }).returning();
  const [q] = await db.insert(appQuotes).values({ requestId: r!.id, lines: [{ label: "Flights", amount: 412000, kind: "flight" }], total: 412000, status: "accepted" }).returning();
  const key = `test:${r!.id}`;
  const auth = await bookingSuppliers.payments().authorize({ amount: 412000, currency: "SAR", token: opts.token ?? "tok_visa", idempotencyKey: key, customerRef: userId, description: "test" } as never);
  const [p] = await db.insert(appPayments).values({ ownerId: userId, requestId: r!.id, quoteId: q!.id, method: opts.method ?? "card", status: auth.status, amount: 412000, label: "Visa ending 41", provider: "mock", providerRef: auth.providerRef, idempotencyKey: key }).returning();
  return { request: r!, trip: trip!, payment: p! };
}

const audits = (entityId: string) => db.execute<{ action: string; summary: string; actor_kind: string }>(rawSql`SELECT action, summary, actor_kind FROM app_audit WHERE entity_id = ${entityId} ORDER BY created_at`);
const opsAudits = (entityId: string) => db.execute<{ action: string; summary: string }>(rawSql`SELECT action, summary FROM audit_events WHERE entity_type = 'desk' AND entity_id = ${entityId} ORDER BY id`);

let lead: DeskActor, counter: DeskActor, viewer: DeskActor;
let faisal: typeof appAgents.$inferSelect, noura: typeof appAgents.$inferSelect;

beforeAll(async () => {
  lead = await opsUser("Bader Al Sulaiman", ALL);
  counter = await opsUser("Riyadh Counter", ["desk.view", "desk.act"]);
  viewer = await opsUser("Read Only", ["desk.view"]);
  faisal = await saveAgent(lead, { opsUserId: counter.id, displayName: "Faisal", languages: ["ar", "en"], pronoun: "he", replyMinutes: 2 });
  const nouraUser = await opsUser("Pakistan Desk 1", ["desk.view", "desk.act"]);
  noura = await saveAgent(lead, { opsUserId: nouraUser.id, displayName: "Noura", languages: ["en", "ar", "ur"], pronoun: "she", replyMinutes: 5 });
});

/* ───────────── pure logic ───────────── */

describe("desk SLA maths", () => {
  const t0 = new Date("2026-10-10T09:00:00Z");
  it("orders are due in 4 minutes and warn in the last minute", () => {
    expect(slaFor("order", t0, new Date("2026-10-10T09:01:00Z")).state).toBe("ok");
    const soon = slaFor("order", t0, new Date("2026-10-10T09:03:10Z"));
    expect(soon.state).toBe("soon");
    expect(soon.dueAt.toISOString()).toBe("2026-10-10T09:04:00.000Z");
    expect(slaFor("order", t0, new Date("2026-10-10T09:05:00Z"))).toMatchObject({ state: "breached", minutesLeft: -1 });
  });
  it("chats get a first reply within 10 minutes; an answer stops the clock", () => {
    expect(slaFor("chat", t0, new Date("2026-10-10T09:08:00Z")).state).toBe("soon");
    expect(slaFor("chat", t0, new Date("2026-10-10T09:30:00Z"), { answeredAt: new Date("2026-10-10T09:06:00Z") }).state).toBe("met");
    expect(slaFor("chat", t0, new Date("2026-10-10T09:30:00Z"), { answeredAt: new Date("2026-10-10T09:12:00Z") }).state).toBe("breached");
  });
  it("a request's promised time wins over the default", () => {
    expect(slaFor("request", t0, t0, { due: new Date("2026-10-10T09:30:00Z") }).dueAt.toISOString()).toBe("2026-10-10T09:30:00.000Z");
  });
  it("sorts breached first, then escalated, then soonest due", () => {
    const now = new Date("2026-10-10T09:20:00Z");
    const a = { sla: slaFor("chat", new Date("2026-10-10T09:15:00Z"), now) };
    const b = { sla: slaFor("order", new Date("2026-10-10T09:00:00Z"), now) };
    const c = { sla: slaFor("refund", new Date("2026-10-10T09:00:00Z"), now), escalated: true };
    const d = { sla: slaFor("refund", new Date("2026-10-10T08:00:00Z"), now) };
    expect([a, c, d, b].sort(compareUrgency)).toEqual([b, c, a, d]);
  });
  it("typical reply time is a median, rounded up, between 1 and 10", () => {
    expect(typicalReplyMinutes([1, 2, 3])).toBeNull();
    expect(typicalReplyMinutes([0.5, 1.2, 1.4, 2.1, 30])).toBe(2);
    expect(typicalReplyMinutes([40, 50, 60, 70, 80])).toBe(10);
  });
  it("counts first replies only from the agent who answered", () => {
    const m = (min: number, authorKind: string, ops: string | null = null) => ({ threadKind: "support", threadId: "t", authorKind, authorOpsUserId: ops, createdAt: new Date(t0.getTime() + min * 60_000) });
    expect(firstReplySamples([m(0, "user"), m(1, "user"), m(2, "mada"), m(3, "agent", "a"), m(10, "user"), m(16, "agent", "b"), m(20, "user"), m(21, "agent", "a")], "a")).toEqual([3, 1]);
  });
});

describe("routing and covering", () => {
  const now = new Date("2026-10-10T20:00:00Z");
  const shift = (agentId: string, h1: number, h2: number, coveringForId: string | null = null) => ({ agentId, coveringForId, startsAt: new Date(`2026-10-10T${String(h1).padStart(2, "0")}:00:00Z`), endsAt: new Date(`2026-10-10T${String(h2).padStart(2, "0")}:00:00Z`) });
  const agents = [{ id: "F", status: "online", active: true }, { id: "N", status: "online", active: true }, { id: "O", status: "offline", active: true }];
  it("goes to the primary agent while they are on shift", () => {
    expect(routeFor("F", agents, [shift("F", 18, 23)], now)).toMatchObject({ agentId: "F", reason: "primary" });
  });
  it("goes to whoever covers for them when they are off", () => {
    expect(routeFor("F", agents, [shift("F", 6, 14), shift("N", 18, 23, "F")], now)).toMatchObject({ agentId: "N", reason: "covering", usualId: "F" });
  });
  it("goes to the shared queue when nobody covers, or the cover signed off", () => {
    expect(routeFor("F", agents, [shift("F", 6, 14)], now)).toMatchObject({ agentId: null, reason: "queue" });
    expect(routeFor("F", agents, [shift("O", 18, 23, "F")], now)).toMatchObject({ agentId: null, reason: "queue" });
    expect(routeFor(null, agents, [], now)).toMatchObject({ agentId: null, reason: "queue" });
  });
  it("a person's reassignment wins over the rota", () => {
    expect(routeFor("F", agents, [shift("F", 18, 23)], now, "N")).toMatchObject({ agentId: "N", reason: "manual" });
  });
  it("reads local flight times in their own zone", () => {
    expect(zonedToUtc("2026-11-14 09:40:00", "Asia/Riyadh").toISOString()).toBe("2026-11-14T06:40:00.000Z");
    expect(zonedToUtc("2026-11-14 13:55:00", "Europe/Istanbul").toISOString()).toBe("2026-11-14T10:55:00.000Z");
  });
});

/* ───────────── capabilities ───────────── */

describe("desk capabilities", () => {
  it("each action needs its capability", async () => {
    const { user, person } = await traveller();
    const { request } = await order(user.id, [person.id]);
    await expect(confirmHold(viewer, request.id)).rejects.toThrow(/access/);
    await expect(issueTickets(counter, request.id, { pnr: "X7K2QD", tickets: ["0651234567890"] })).rejects.toThrow(/access/);
    await expect(revealPassport(counter, person.id, { requestId: request.id })).rejects.toThrow(/access/);
    await expect(addShift(counter, { agentId: faisal.id, startsAt: new Date(), endsAt: new Date(Date.now() + 3600_000) })).rejects.toThrow(/access/);
    await expect(assignPrimary(counter, user.id, faisal.id)).rejects.toThrow(/access/);
    await expect(blockTraveller(counter, user.id, "Spam in tips")).rejects.toThrow(/access/);
    await expect(sendAgentReply(viewer, "request", request.id, { body: "Hello" })).rejects.toThrow(/access/);
    await expect(pushPlan(counter, { flightNumber: "SV263", date: "2026-11-14", status: "delayed", plan: "Take the 21:15 instead.", options: [], voucher: 10000 })).rejects.toThrow(/access/);
    // Nothing happened.
    const [r] = await db.select().from(appRequests).where(eq(appRequests.id, request.id));
    expect(r!.status).toBe("with_agent");
    expect(await audits(request.id)).toHaveLength(0);
  });
  it("an agent can change their own status, but only desk.admin can change someone else's", async () => {
    await setAgentStatus(counter, faisal.id, "away");
    await expect(setAgentStatus(counter, noura.id, "offline")).rejects.toThrow(/access/);
    await setAgentStatus(lead, noura.id, "online");
    const [f] = await db.select().from(appAgents).where(eq(appAgents.id, faisal.id));
    expect(f!.status).toBe("away");
  });
});

/* ───────────── orders ───────────── */

describe("order desk", () => {
  it("confirm & hold, then issue: captures the card and signs the trip with the agent's name", async () => {
    const { user, person } = await traveller("Hessa Alharbi");
    const { request, trip, payment } = await order(user.id, [person.id]);
    await confirmHold(counter, request.id, { pnr: "x7k2qd" });
    await expect(confirmHold(counter, request.id)).rejects.toThrow(/Already held/);
    const lead2 = { ...lead, id: counter.id, name: counter.name }; // the counter with issuing rights
    await expect(issueTickets(lead2, request.id, { pnr: "X7K2QD", tickets: ["123"] })).rejects.toThrow(/13 digits/);
    await expect(issueTickets(lead2, request.id, { pnr: "X7K2QD", tickets: [] })).rejects.toThrow(/each traveller/);
    const res = await issueTickets(lead2, request.id, { pnr: "X7K2QD", tickets: ["065 1234567890"] });
    expect(res.ok).toBe(true);
    const full = await getRequestFull(request.id);
    expect(full!.request.status).toBe("confirmed");
    expect(full!.desk).toMatchObject({ pnr: "X7K2QD", tickets: ["0651234567890"] });
    expect(full!.request.agentName).toBe("Faisal");
    const [p] = await db.select().from(appPayments).where(eq(appPayments.id, payment.id));
    expect(p!.status).toBe("captured");
    const [t] = await db.select().from(appTrips).where(eq(appTrips.id, trip.id));
    expect(t).toMatchObject({ status: "booked", bookingRef: "X7K2QD", confirmedByName: "Faisal", confirmedByOpsUserId: counter.id });
    const msgs = full!.messages.map((m) => [m.authorKind, m.authorName]);
    expect(msgs).toEqual([["agent", "Faisal"], ["agent", "Faisal"]]);
    const [n] = await db.select().from(appNotifications).where(and(eq(appNotifications.userId, user.id), eq(appNotifications.kind, "booking_confirmed")));
    expect(n!.body).toBe("Confirmed by Faisal. Booking X7K2QD.");
    expect((await audits(request.id)).map((a) => a.action)).toEqual(["desk.order.held", "desk.order.issued"]);
    expect((await opsAudits(request.id)).map((a) => a.action)).toEqual(["desk.order.held", "desk.order.issued"]);
    expect((await audits(request.id)).every((a) => a.actor_kind === "agent")).toBe(true);
  });

  it("a failed capture leaves the order unconfirmed; ticketing failed voids the hold and says nothing was charged", async () => {
    const { user, person } = await traveller();
    const { request, payment } = await order(user.id, [person.id], { token: "tok_visa_failcapture" });
    const res = await issueTickets(lead, request.id, { pnr: "QWE123", tickets: ["0651234567891"] });
    expect(res.ok).toBe(false);
    let full = await getRequestFull(request.id);
    expect(full!.request.status).toBe("with_agent");
    expect(full!.stage).toBe("held");
    const { items } = await deskInbox(new Date());
    expect(items.find((i) => i.id === request.id)?.kind).toBe("ticketing");
    await expect(failTicketing(counter, request.id, { reason: "" })).rejects.toThrow(/Say what happened/);
    await failTicketing(counter, request.id, { reason: "Saudia rejected the fare at issue" });
    full = await getRequestFull(request.id);
    expect(full!.request.status).toBe("cancelled");
    expect(full!.stage).toBe("not_issued");
    const [p] = await db.select().from(appPayments).where(eq(appPayments.id, payment.id));
    expect(p!.status).toBe("voided"); // the capture never went through, and the hold is released
    const last = full!.messages.at(-1)!;
    expect(last.authorKind).toBe("mada");
    expect(last.body).toContain("Nothing was charged");
  });

  it("ticketing failed on a live hold voids the authorisation", async () => {
    const { user, person } = await traveller();
    const { request, payment } = await order(user.id, [person.id]);
    await failTicketing(counter, request.id, { reason: "No seats left in this fare" });
    const [p] = await db.select().from(appPayments).where(eq(appPayments.id, payment.id));
    expect(p!.status).toBe("voided");
    await expect(failTicketing(counter, request.id, { reason: "again" })).rejects.toThrow(/already closed/);
  });

  it("asks the traveller a question with one-tap answers, shown on the waiting screen", async () => {
    const { user, person } = await traveller();
    const { request } = await order(user.id, [person.id]);
    await expect(askTraveller(counter, request.id, { question: "Hi", choices: [] })).rejects.toThrow(/5 to 300/);
    await askTraveller(counter, request.id, { question: "Is the name on Ahmed's ticket AHMED ALHARBI, as on his passport?", choices: ["Yes", "No, I'll fix it"] });
    const full = await getRequestFull(request.id);
    expect(full!.request.status).toBe("needs_answer");
    expect(full!.desk.question).toMatchObject({ choices: ["Yes", "No, I'll fix it"], answer: null });
    expect(full!.messages.at(-1)!.card).toMatchObject({ question: true, choices: [{ label: "Yes", key: "c1" }, { label: "No, I'll fix it", key: "c2" }] });
    const [n] = await db.select().from(appNotifications).where(and(eq(appNotifications.userId, user.id), eq(appNotifications.kind, "agent_needs_answer")));
    expect(n!.title).toBe("Mada needs an answer");
    expect(n!.body.startsWith("Faisal: ")).toBe(true);
    expect(n!.body.length).toBeLessThanOrEqual(90);
  });

  it("price changed: new quote, the old hold released, nothing captured", async () => {
    const { user, person } = await traveller();
    const { request, payment } = await order(user.id, [person.id]);
    await expect(priceChanged(counter, request.id, { total: 412000 })).rejects.toThrow(/same price/);
    const q = await priceChanged(counter, request.id, { total: 436000, reason: "Fare class sold out" });
    expect(q!.total).toBe(436000);
    const quotes = await db.select().from(appQuotes).where(eq(appQuotes.requestId, request.id));
    expect(quotes.map((x) => x.status).sort()).toEqual(["open", "withdrawn"]);
    const [p] = await db.select().from(appPayments).where(eq(appPayments.id, payment.id));
    expect(p!.status).toBe("voided");
    const full = await getRequestFull(request.id);
    expect(full!.stage).toBe("price_changed");
    expect(full!.messages.at(-1)!.body).toContain("SAR 4,360");
  });

  it("reveals a full passport only with desk.issue, only for travellers on the order, and logs it", async () => {
    const { user, person } = await traveller();
    const other = await traveller();
    const { request } = await order(user.id, [person.id]);
    expect(await revealPassport(lead, person.id, { requestId: request.id })).toBe("A11493107");
    await expect(revealPassport(lead, other.person.id, { requestId: request.id })).rejects.toThrow(/isn't on this order/);
    const a = await audits(person.id);
    expect(a.map((x) => x.action)).toEqual(["desk.passport.revealed"]);
    expect(a[0]!.summary).not.toContain("A11493107");
    expect((await opsAudits(person.id))[0]!.summary).toContain("A11•••07");
  });
});

describe("orders made by the booking engine (app_orders)", () => {
  async function engineOrder(userId: string, personIds: string[], token = "tok_visa") {
    const [r] = await db.insert(appRequests).values({ ownerId: userId, kind: "flight", status: "with_agent", summary: "Riyadh to Dubai", travellerIds: personIds, details: { source: "order" } }).returning();
    const key = `eng:${r!.id}`;
    const auth = await bookingSuppliers.payments().authorize({ amount: 250000, method: "card", token, idempotencyKey: key, description: "test" });
    const [p] = await db.insert(appPayments).values({ ownerId: userId, requestId: r!.id, method: "card", status: auth.status, amount: 250000, label: "Visa ending 41", provider: "mock", providerRef: auth.providerRef, idempotencyKey: key }).returning();
    const [o] = await db.insert(appOrders).values({ ownerId: userId, kind: "quote", status: "pending_agent", idempotencyKey: key, draft: {}, snapshot: {}, lines: [], travellerIds: personIds,
      subtotal: 250000, total: 250000, paymentLabel: "Visa ending 41", paymentMethod: { method: "card" }, paymentId: p!.id, requestId: r!.id }).returning();
    return { request: r!, order: o!, payment: p! };
  }
  it("hold and issue go through lib/app/booking/desk.ts, signed by the agent, in the Ops log", async () => {
    const { user, person } = await traveller();
    const { request, order, payment } = await engineOrder(user.id, [person.id]);
    expect((await listOrders({ stage: "open" })).find((x) => x.id === request.id)?.stage).toBe("awaiting");
    await confirmHold(counter, request.id, { pnr: "dxb7aa" });
    let [o] = await db.select().from(appOrders).where(eq(appOrders.id, order.id));
    expect(o).toMatchObject({ status: "held", supplierRef: "DXB7AA", agentName: "Faisal" });
    expect((await getRequestFull(request.id))!.stage).toBe("held");
    const res = await issueTickets({ ...lead, id: counter.id, name: counter.name }, request.id, { pnr: "DXB7AA", tickets: ["0651234567777"] });
    expect(res.ok).toBe(true);
    [o] = await db.select().from(appOrders).where(eq(appOrders.id, order.id));
    expect(o).toMatchObject({ status: "confirmed", confirmedByName: "Faisal" });
    const [p] = await db.select().from(appPayments).where(eq(appPayments.id, payment.id));
    expect(p!.status).toBe("captured");
    expect((await opsAudits(request.id)).map((a) => a.action)).toEqual(["desk.order.held", "desk.order.issued"]);
  });
  it("a question and ticketing failed go through the engine too", async () => {
    const { user, person } = await traveller();
    const a = await engineOrder(user.id, [person.id]);
    await askTraveller(counter, a.request.id, { question: "Is the name on the ticket as on the passport?", choices: [] });
    expect((await db.select().from(appOrders).where(eq(appOrders.id, a.order.id)))[0]!.status).toBe("needs_answer");
    const b = await engineOrder(user.id, [person.id]);
    await confirmHold(counter, b.request.id);
    await failTicketing(counter, b.request.id, { reason: "The airline refused the fare" });
    expect((await db.select().from(appOrders).where(eq(appOrders.id, b.order.id)))[0]!.status).toBe("ticketing_failed");
    expect((await db.select().from(appPayments).where(eq(appPayments.id, b.payment.id)))[0]!.status).toBe("voided");
    const { items } = await deskInbox(new Date());
    expect(items.find((i) => i.id === b.request.id)).toMatchObject({ kind: "ticketing", note: "Ticketing failed" });
  });
});

/* ───────────── requests, chat, refunds ───────────── */

describe("requests and quotes", () => {
  it("builds a quote with a line per person, then marks the request done", async () => {
    const { user } = await traveller();
    const [r] = await db.insert(appRequests).values({ ownerId: user.id, kind: "visa", status: "sent", summary: "Schengen visa for Sara" }).returning();
    await expect(sendQuote(counter, r!.id, { lines: [] })).rejects.toThrow(/at least one line/);
    const q = await sendQuote(counter, r!.id, { lines: [{ label: "Sara · visa fee", amount: 32000, kind: "visa" }, { label: "Omar · visa fee", amount: 32000, kind: "visa" }, { label: "Appointment and forms", amount: 25000, kind: "service" }], cancellation: "Fees are not refundable once submitted.", holdHours: 24 });
    expect(q.total).toBe(89000);
    let full = await getRequestFull(r!.id);
    expect(full!.request).toMatchObject({ status: "quoted", agentName: "Faisal" });
    await markDone(counter, r!.id);
    full = await getRequestFull(r!.id);
    expect(full!.request.status).toBe("done");
    expect((await audits(r!.id)).map((a) => a.action)).toEqual(["desk.quote.sent", "desk.request.done"]);
  });
});

describe("destination requests (Plan it with Mada)", () => {
  it("land in the inbox as a request to quote, with the city and a guide link", async () => {
    const { user } = await traveller();
    const [r] = await db.insert(appRequests).values({ ownerId: user.id, kind: "destination", status: "sent", summary: "Plan a trip to Tbilisi",
      details: { place: { id: "plc_tbilisi", name: "Tbilisi", country: "Georgia", airports: ["TBS", { code: "KUT" }] }, message: "Can you plan Tbilisi for us in May?" } }).returning();
    expect(destinationOf(r!.details)).toMatchObject({ name: "Tbilisi", country: "Georgia", airports: ["TBS", "KUT"], id: "plc_tbilisi" });
    expect(destinationOf({})).toBeNull();
    const item = (await deskInbox(new Date())).items.find((i) => i.id === r!.id)!;
    expect(item).toMatchObject({ kind: "request", title: "Tbilisi, Georgia", note: "Needs a quote", tag: "Destination" });
    expect(item.link!.href).toContain("Tbilisi");
  });
});

describe("chat", () => {
  it("lists a waiting traveller, replies as the agent, keeps notes internal", async () => {
    const { user } = await traveller("Omar Alharbi");
    const threadId = crypto.randomUUID();
    await db.insert(appMessages).values({ threadKind: "support", threadId, authorKind: "user", authorUserId: user.id, authorName: "Omar", body: "My bag didn't arrive in Istanbul" });
    let c = (await listConversations()).find((x) => x.id === threadId)!;
    expect(c.waitingSince).toBeTruthy();
    expect(c.userName).toBe("Omar A.");
    await addNote(counter, "support", threadId, "Turkish Airlines baggage desk, ref pending");
    await pingTyping(counter, "support", threadId);
    await sendAgentReply(counter, "support", threadId, { body: "I'm on it. Send me the bag tag photo." });
    c = (await listConversations()).find((x) => x.id === threadId)!;
    expect(c.waitingSince).toBeNull();
    const msgs = await db.select().from(appMessages).where(eq(appMessages.threadId, threadId));
    expect(msgs.map((m) => m.body).join(" ")).not.toContain("baggage desk");
    expect(msgs.at(-1)).toMatchObject({ authorKind: "agent", authorName: "Faisal", authorOpsUserId: counter.id });
    await expect(sendAgentReply(counter, "support", crypto.randomUUID(), { body: "Hi" })).rejects.toThrow(/not found/);
  });
});

describe("support threads (lib/app/support/desk.ts)", () => {
  it("replies through the support module, which updates the thread", async () => {
    const { user } = await traveller("Reem Alshehri");
    const [th] = await db.insert(appSupportThreads).values({ userId: user.id, about: "Your account", lastMessageAt: new Date() }).returning();
    await db.insert(appMessages).values({ threadKind: "support", threadId: th!.id, authorKind: "user", authorUserId: user.id, body: "Can I change my email?" });
    expect((await listConversations()).find((c) => c.id === th!.id)).toMatchObject({ summary: "Your account", userName: "Reem A." });
    await sendAgentReply(counter, "support", th!.id, { body: "Yes. Open Account, then Email." });
    const [after] = await db.select().from(appSupportThreads).where(eq(appSupportThreads.id, th!.id));
    expect(after!.agentReadAt).toBeTruthy();
    expect(after!.assignedOpsUserId).toBe(counter.id);
    expect((await listConversations()).find((c) => c.id === th!.id)!.waitingSince).toBeNull();
  });
});

describe("refunds", () => {
  async function refund(method = "card") {
    const { user, person } = await traveller();
    const { payment } = await order(user.id, [person.id], { method });
    await db.update(appPayments).set({ status: "captured" }).where(eq(appPayments.id, payment.id));
    await bookingSuppliers.payments().capture(payment.providerRef!, payment.amount);
    const [f] = await db.insert(appRefunds).values({ paymentId: payment.id, amount: 120000 }).returning();
    return { user, payment, refund: f! };
  }
  it("to Mada credit: instant, a ledger entry, the payment partly refunded", async () => {
    const { user, refund: f, payment } = await refund();
    await expect(approveRefund(counter, f.id, { destination: "credit" })).rejects.toThrow(/access/);
    await approveRefund(lead, f.id, { destination: "credit" });
    const [row] = await db.select().from(appRefunds).where(eq(appRefunds.id, f.id));
    expect(row).toMatchObject({ stage: "sent", destination: "credit" });
    const ledger = await db.select().from(appCreditLedger).where(eq(appCreditLedger.userId, user.id));
    expect(ledger).toMatchObject([{ amount: 120000, kind: "refund", refundId: f.id }]);
    const [p] = await db.select().from(appPayments).where(eq(appPayments.id, payment.id));
    expect(p!.status).toBe("partially_refunded");
    await expect(approveRefund(lead, f.id, { destination: "credit" })).rejects.toThrow(/already been decided/);
  });
  it("to the card through the provider, with the Tabby note", async () => {
    const { refund: f, payment } = await refund("tabby");
    await approveRefund(lead, f.id, { destination: "original" });
    const [row] = await db.select().from(appRefunds).where(eq(appRefunds.id, f.id));
    expect(row!.stage).toBe("approved");
    const msgs = await db.select().from(appMessages).where(eq(appMessages.threadId, payment.requestId!));
    expect(msgs.at(-1)!.body).toContain("Paid with Tabby");
  });
  it("rejected with a reason the traveller reads", async () => {
    const { refund: f, payment } = await refund();
    await expect(rejectRefund(lead, f.id, { reason: "No" })).rejects.toThrow(/clear reason/);
    await rejectRefund(lead, f.id, { reason: "This fare is non-refundable after check-in opened." });
    const [row] = await db.select().from(appRefunds).where(eq(appRefunds.id, f.id));
    expect(row).toMatchObject({ stage: "rejected", reason: "This fare is non-refundable after check-in opened." });
    const msgs = await db.select().from(appMessages).where(eq(appMessages.threadId, payment.requestId!));
    expect(msgs.at(-1)!.body).toBe("We can't refund this one. This fare is non-refundable after check-in opened.");
  });
});

/* ───────────── assignment, inbox, presence ───────────── */

describe("assignment, inbox and presence", () => {
  it("routes to the primary agent on shift, to the cover when off, and the app sees the same", async () => {
    const { user, person } = await traveller("Nora Alshehri");
    await assignPrimary(lead, user.id, faisal.id);
    const { request } = await order(user.id, [person.id]);
    const now = new Date();
    await setAgentStatus(counter, faisal.id, "online");

    // Faisal is off shift; Noura covers for him tonight.
    await db.delete(appAgentShifts);
    await addShift(lead, { agentId: noura.id, startsAt: new Date(now.getTime() - 3600_000), endsAt: new Date(now.getTime() + 3600_000), coveringForId: faisal.id });
    await expect(addShift(lead, { agentId: noura.id, startsAt: new Date(now.getTime() - 60_000), endsAt: new Date(now.getTime() + 60_000) })).rejects.toThrow(/overlaps/);
    let item = (await deskInbox(new Date())).items.find((i) => i.id === request.id)!;
    expect(item).toMatchObject({ kind: "order", agentName: "Noura" });
    expect(item.route.reason).toBe("covering");
    expect(item.sla.target).toBe(4);
    let p = await presenceFor(user.id);
    expect(p).toMatchObject({ title: "Mada", covering: true, agent: { name: "Noura" }, usual: { name: "Faisal" } });
    expect(p.line).toBe("Noura is covering for Faisal tonight. She has your whole trip.");

    // Faisal comes on shift.
    await addShift(lead, { agentId: faisal.id, startsAt: new Date(now.getTime() - 600_000), endsAt: new Date(now.getTime() + 3600_000) });
    item = (await deskInbox(new Date())).items.find((i) => i.id === request.id)!;
    expect(item).toMatchObject({ agentName: "Faisal" });
    p = await presenceFor(user.id);
    expect(p.line).toBe("Faisal is online · Usually replies in 2 min");

    // Reassigned by hand, then escalated.
    await reassign(counter, "order", request.id, noura.id);
    await escalate(counter, "order", request.id, "Name on passport doesn't match the booking");
    const { items } = await deskInbox(new Date());
    item = items.find((i) => i.id === request.id)!;
    expect(item).toMatchObject({ agentName: "Noura", escalated: true });
    expect(filterInbox(items, "escalated", null).some((i) => i.id === request.id)).toBe(true);
    expect(filterInbox(items, "mine", noura).some((i) => i.id === request.id)).toBe(true);
    expect(filterInbox(items, "unassigned", null).some((i) => i.id === request.id)).toBe(false);
    expect((await opsAudits(request.id)).map((a) => a.action)).toEqual(["desk.item.reassigned", "desk.item.escalated"]);
  });

  it("GET /support/presence: auth, typing in the caller's own thread, nobody routed", async () => {
    const { user } = await traveller("Sultan Aldosari");
    const tokens = await createSession(db, user.id);
    expect((await call(presenceGet, { method: "GET", path: "/api/app/v1/support/presence" })).status).toBe(401);
    let r = await call(presenceGet, { method: "GET", token: tokens.accessToken, path: "/api/app/v1/support/presence" });
    expect(r.status).toBe(200);
    expect(PresenceResponse.parse(r.json)).toMatchObject({ title: "Mada", agent: null, line: "Replies within 10 minutes, any hour" });

    await assignPrimary(lead, user.id, faisal.id);
    const threadId = crypto.randomUUID();
    await db.insert(appMessages).values({ threadKind: "support", threadId, authorKind: "user", authorUserId: user.id, body: "Can I add a bag?" });
    await pingTyping(counter, "support", threadId);
    r = await call(presenceGet, { method: "GET", token: tokens.accessToken, path: `/api/app/v1/support/presence?threadKind=support&threadId=${threadId}` });
    expect(PresenceResponse.parse(r.json)).toMatchObject({ typing: true, line: "Faisal is typing…" });
    // Someone else's thread: no typing leaks.
    const other = await traveller();
    const t2 = await createSession(db, other.user.id);
    r = await call(presenceGet, { method: "GET", token: t2.accessToken, path: `/api/app/v1/support/presence?threadKind=support&threadId=${threadId}` });
    expect(r.json.typing).toBe(false);
    r = await call(presenceGet, { method: "GET", token: tokens.accessToken, path: "/api/app/v1/support/presence?threadKind=support" });
    expect(r.status).toBe(400);
  });
});

/* ───────────── moderation and disruption ───────────── */

describe("moderation", () => {
  it("rejects a tip with a reason, dismisses a report, blocks an account once", async () => {
    const { user } = await traveller("Spam Account");
    const [tip] = await db.insert(appDeskModeration).values({ kind: "tip", targetKind: "post", targetId: crypto.randomUUID(), authorUserId: user.id, snapshot: { city: "Istanbul", place: "Cheap visas", text: "DM me for visas in 1 hour" } }).returning();
    await expect(decideModeration(counter, tip!.id, { decision: "approved" })).rejects.toThrow(/access/);
    await expect(decideModeration(lead, tip!.id, { decision: "rejected" })).rejects.toThrow(/Say why/);
    await decideModeration(lead, tip!.id, { decision: "rejected", reason: "Selling services in tips" });
    await expect(decideModeration(lead, tip!.id, { decision: "approved" })).rejects.toThrow(/Already decided/);
    await blockTraveller(lead, user.id, "Selling visas in tips");
    await expect(blockTraveller(lead, user.id, "Again please")).rejects.toThrow(/Already blocked/);
    const a = await audits(user.id);
    expect(a.map((x) => x.action)).toEqual(["desk.traveller.blocked"]);
  });
});

describe("circles moderation (lib/app/circles/moderation.ts)", () => {
  it("lists pending tips and open reports, and decides them at the source", async () => {
    const { user } = await traveller("Tip Writer");
    const other = await traveller("Reporter Person");
    const [post] = await db.insert(appPosts).values({ authorId: user.id, city: "Istanbul", place: "Galata", body: "DM me for cheap tours", kind: "todo", audience: "everyone", flagged: "matched dm me" }).returning();
    const [rep] = await db.insert(appReports).values({ reporterId: other.user.id, targetKind: "post", targetId: post!.id, targetUserId: user.id, reason: "unwanted" }).returning();
    const q = await listModeration("open");
    expect(q.find((m) => m.id === post!.id)).toMatchObject({ source: "post", kind: "tip" });
    expect(q.find((m) => m.id === rep!.id)).toMatchObject({ source: "report", kind: "report" });
    await decideModeration(lead, post!.id, { decision: "rejected", reason: "Selling tours in tips" }, "post");
    expect((await db.select().from(appPosts).where(eq(appPosts.id, post!.id)))[0]!.status).toBe("rejected");
    await decideModeration(lead, rep!.id, { decision: "dismissed" }, "report");
    expect((await db.select().from(appReports).where(eq(appReports.id, rep!.id)))[0]!.status).toBe("dismissed");
    await expect(decideModeration(lead, rep!.id, { decision: "dismissed" }, "report")).rejects.toThrow(/Already decided/);
  });
});

describe("disruptions", () => {
  it("pushes a plan to everyone on the flight; vouchers need desk.refund and land as credit", async () => {
    const one = await traveller(), two = await traveller();
    const date = "2026-12-01";
    for (const t of [one, two]) {
      const [trip] = await db.insert(appTrips).values({ ownerId: t.user.id, city: "Dubai", startDate: date, travellerIds: [t.person.id], status: "booked" }).returning();
      await db.insert(appSegments).values({ tripId: trip!.id, direction: "out", carrier: "XY", carrierName: "flynas", flightNumber: "XY201", fromAirport: "RUH", toAirport: "DXB",
        departLocal: `${date} 18:10:00`, departTz: "Asia/Riyadh", arriveLocal: `${date} 20:40:00`, arriveTz: "Asia/Dubai", durationMin: 150, status: "cancelled" });
    }
    const row = await pushPlan(lead, { flightNumber: "XY201", date, status: "cancelled", plan: "We moved you to XY205 at 21:15. Same seats.", options: [{ label: "Take XY205", detail: "21:15, same seats" }], voucher: 15000 });
    expect(row.userIds.sort()).toEqual([one.user.id, two.user.id].sort());
    const ns = await db.select().from(appNotifications).where(eq(appNotifications.kind, "flight_cancelled"));
    expect(ns.filter((n) => n.title === "A new plan for XY201")).toHaveLength(2);
    const credit = await db.select().from(appCreditLedger).where(eq(appCreditLedger.userId, one.user.id));
    expect(credit).toMatchObject([{ amount: 15000, kind: "goodwill" }]);
    await expect(pushPlan(lead, { flightNumber: "XY999", date, status: "delayed", plan: "Nobody is on this flight.", options: [], voucher: 0 })).rejects.toThrow(/Nobody/);
  });
});
