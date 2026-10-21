import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull, like, lt, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { appDevices, appPayments, appUsers } from "@/db/app-schema";
import { appOrderEvents, appOrders } from "@/db/app-schema-booking";
import { appAgents, appAgentShifts, deskTickets } from "@/db/app-schema-desk";
import { appSearchLog } from "@/db/app-schema-dropoffs";
import { appOrderCosts } from "@/db/app-schema-finance";
import { deskAlerts } from "@/db/app-schema-desk-alerts";
import { riyadhDate } from "@/lib/dates";
import { outbox } from "@/lib/app/suppliers";
import { pushOutbox } from "@/lib/app/push";
import { riyadhMidnight } from "@/lib/app/desk/agent-admin";
import { pageDropoffs } from "@/lib/app/desk/dropoffs";
import { performanceReport } from "@/lib/app/desk/performance";
import { TICKET_PRIORITIES } from "@/lib/app/desk/sla";
import { listTickets, TICKET_AGES } from "@/lib/app/desk/tickets";
import { revenueReport } from "@/lib/app/finance/revenue";
import { backlog, deskBriefing, deskOverview, funnelCounts, funnelRows, FUNNEL_STEPS, overviewHref, revenue, service } from "@/lib/app/desk/overview";
import { alertLine, evaluateAlerts, isSpike, openAlerts, SPIKE_MIN } from "@/lib/app/desk/alerts";
import { AR } from "@/lib/i18n/ar";

/* The desk overview and its alerts (DESK-PLAN.md U8): every number equals the count of the list it links to, and each
   alert fires once (the dedupe key), with the on-call page for urgent work with nobody on duty. */

const MIN = 60_000, H = 3600_000, DAY = 86_400_000;
const TODAY = riyadhDate();
let seq = 0;
const key = () => `overview-${Date.now()}-${++seq}`;

async function traveller(name = "Noura Al-Otaibi") {
  const [u] = await db.insert(appUsers).values({ name, phone: `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` }).returning();
  return u!;
}
async function ticket(v: Partial<typeof deskTickets.$inferInsert> & { openedAt: Date }) {
  const [t] = await db.insert(deskTickets).values({ kind: "manual", subject: "Overview test", slaMinutes: 60, dueAt: new Date(v.openedAt.getTime() + 60 * MIN), slaStartedAt: v.openedAt, status: "open", ...v }).returning();
  return t!;
}
async function payment(ownerId: string, status: string, amount: number, at = new Date()) {
  const [p] = await db.insert(appPayments).values({ ownerId, method: "card", status, amount, provider: "mock", idempotencyKey: key(), createdAt: at, updatedAt: at }).returning();
  return p!;
}

let sara: Awaited<ReturnType<typeof traveller>>, khalid: Awaited<ReturnType<typeof traveller>>;
beforeAll(async () => {
  sara = await traveller();
  const now = Date.now();
  // Running tickets across priorities and ages, and two that aren't in the backlog (waiting, resolved).
  for (const [priority, ago] of [["urgent", 20 * MIN], ["urgent", 3 * H], ["high", 2 * H], ["normal", 10 * H], ["low", 3 * DAY], ["normal", 30 * MIN]] as const)
    await ticket({ priority, openedAt: new Date(now - ago), customerId: sara.id });
  await ticket({ priority: "high", openedAt: new Date(now - H), status: "waiting_customer", pausedAt: new Date(now - 10 * MIN) });
  await ticket({ priority: "high", openedAt: new Date(now - H), status: "resolved", resolvedAt: new Date(now - 5 * MIN), firstResponseAt: new Date(now - 50 * MIN) });

  // Today's funnel: two searches, a pay sheet, a payment that went through, a declined one, and a confirmed booking.
  await db.insert(appSearchLog).values([
    { userId: sara.id, kind: "flight", summary: "RUH → Istanbul · 14–18 Nov", value: 120_000 },
    { userId: sara.id, kind: "stay", summary: "Istanbul · 3 nights", value: 90_000 },
    { userId: sara.id, kind: "pay_sheet", summary: "Flight to Istanbul", value: 125_000 },
  ]);
  const paid = await payment(sara.id, "captured", 125_000);
  khalid = await traveller("Khalid Al-Harbi");
  await payment(khalid.id, "declined", 80_000);
  const [o] = await db.insert(appOrders).values({ ownerId: sara.id, kind: "trip", status: "confirmed", idempotencyKey: key(), draft: {}, snapshot: { title: "Flight to Istanbul" }, lines: [],
    subtotal: 125_000, total: 125_000, paymentLabel: "Visa •• 4242", paymentMethod: {}, paymentId: paid.id }).returning();
  await db.insert(appOrderEvents).values({ orderId: o!.id, kind: "confirmed", actorKind: "agent" });
  // Revenue: a line today and one earlier this month (when today isn't the 1st).
  await db.insert(appOrderCosts).values([
    { paymentId: paid.id, orderId: o!.id, lineKey: "fare", product: "flight", label: "Fare", supplier: "tbo", sell: 115_000, vat: 0, netSar: 100_000, businessDate: TODAY, capturedAt: new Date() },
    { paymentId: paid.id, orderId: o!.id, lineKey: "fee", product: "flight", label: "Service fee", sell: 10_000, vat: 1_304, netSar: 0, businessDate: `${TODAY.slice(0, 7)}-01`, capturedAt: new Date() },
  ]);
});

describe("every number equals its list", () => {
  it("backlog: each priority × age cell, each row and column, and the total are the Tickets list's count", async () => {
    const b = await backlog();
    expect(b.total).toBeGreaterThanOrEqual(6);
    expect(b.cells.urgent["1h"]).toBeGreaterThanOrEqual(1);
    expect(b.cells.low.older).toBeGreaterThanOrEqual(1);
    expect((await listTickets({})).total).toBe(b.total);
    for (const p of TICKET_PRIORITIES) {
      expect((await listTickets({ priority: p })).total, p).toBe(b.byPriority[p]);
      for (const a of TICKET_AGES) expect((await listTickets({ priority: p, age: a })).total, `${p} ${a}`).toBe(b.cells[p][a]);
    }
    for (const a of TICKET_AGES) expect((await listTickets({ age: a })).total, a).toBe(b.byAge[a]);
    // The links carry exactly those filters.
    expect(overviewHref.cell("urgent", "1h")).toBe("/adminwork/desk/tickets?p=urgent&age=1h");
  });

  it("funnel: each step's count is its list's count, and today's rows are in it", async () => {
    const f = await funnelCounts(TODAY);
    for (const s of FUNNEL_STEPS) {
      const rows = await funnelRows(s, TODAY, { limit: 200 });
      expect(rows.total, s).toBe(f[s].n);
      expect(rows.rows.length, s).toBe(Math.min(200, f[s].n));
    }
    expect(f.searches.n).toBeGreaterThanOrEqual(2);
    expect(f.sheets.n).toBeGreaterThanOrEqual(1);
    const paid = await funnelRows("paid", TODAY, { limit: 200 });
    expect(paid.rows.some((r) => r.userId === sara.id && r.value === 125_000)).toBe(true);
    // A declined payment isn't paid.
    expect(paid.rows.some((r) => r.userId === khalid.id)).toBe(false);
    const confirmed = await funnelRows("confirmed", TODAY, { limit: 200 });
    expect(confirmed.rows.some((r) => r.userId === sara.id && r.what === "Flight to Istanbul")).toBe(true);
  });

  it("drop-offs today, revenue today and MTD, SLA today and CSAT this week match Drop-offs, App revenue and Performance", async () => {
    const o = await deskOverview({ finance: true });
    const d = await pageDropoffs({ day: TODAY });
    expect(o.dropoffs.n).toBe(d.total);
    expect(o.dropoffs.value).toBe(d.value);
    expect(d.rows.some((r) => r.userId === khalid.id && r.kind === "payment")).toBe(true);

    const rev = await revenue(TODAY);
    const day = await revenueReport({ from: TODAY, to: TODAY, by: "day" });
    const mtd = await revenueReport({ from: `${TODAY.slice(0, 7)}-01`, to: TODAY, by: "day" });
    expect(rev.today).toMatchObject({ gross: day.total.gross, margin: day.total.margin, net: day.total.net });
    expect(rev.mtd).toMatchObject({ gross: mtd.total.gross, margin: mtd.total.margin, net: mtd.total.net });
    expect(rev.mtd.gross).toBeGreaterThanOrEqual(125_000);

    // The Performance page's ranges: today is [midnight, +1 day); the default 7 days end at the same instant.
    const now = new Date();
    const to = new Date(riyadhMidnight(now).getTime() + DAY);
    const s = await service(now);
    const today = await performanceReport({ from: new Date(to.getTime() - DAY), to, by: "day" });
    const week = await performanceReport({ from: new Date(to.getTime() - 7 * DAY), to, by: "day" });
    expect(s.today).toEqual(today.team);
    expect(s.week).toEqual(week.team);
    expect(s.today.slaN).toBeGreaterThanOrEqual(1);
  });

  it("the Ops dashboard's line counts the same running tickets as the backlog", async () => {
    const [line, b] = await Promise.all([deskBriefing(), backlog()]);
    expect(line.open).toBe(b.total);
    expect(line.urgent).toBeGreaterThanOrEqual(b.byPriority.urgent);
  });
});

describe("alerts fire once", () => {
  it("a spike needs SPIKE_MIN and three times the usual hour", () => {
    expect(isSpike(SPIKE_MIN - 1, 0)).toBe(false);
    expect(isSpike(SPIKE_MIN, 0)).toBe(true);
    expect(isSpike(SPIKE_MIN, 2)).toBe(false);
    expect(isSpike(12, 3.9)).toBe(true);
  });

  it("SLA breach and nobody on duty fire once, page the on-call lead once, and clear when they stop", async () => {
    // A time with nobody on the rota at all (no shifts that far ahead).
    const now = new Date(Date.UTC(2034, 2, 1, 2));
    const late = await ticket({ priority: "urgent", subject: "Missed connection in Doha", openedAt: new Date(now.getTime() - 2 * H), dueAt: new Date(now.getTime() - H) });
    const phone = `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    const [lead] = await db.insert(appUsers).values({ name: "On-call lead", phone }).returning();
    await db.insert(appDevices).values({ userId: lead!.id, pushToken: "ExponentPushToken[overviewoncall01]", platform: "ios" }).onConflictDoNothing();
    const prev = process.env.DESK_ONCALL_PHONE;
    process.env.DESK_ONCALL_PHONE = phone;
    // Other files leave running tickets that are late too, and the alerts read the 50 most overdue: park them for this
    // test (paused tickets aren't "running") so this one is read, and give them back after. No open alert carries over.
    const parked = await db.update(deskTickets).set({ pausedAt: now })
      .where(and(inArray(deskTickets.status, ["new", "open"]), isNull(deskTickets.pausedAt), lt(deskTickets.dueAt, now), ne(deskTickets.id, late.id)))
      .returning({ id: deskTickets.id });
    await db.update(deskAlerts).set({ clearedAt: new Date(now.getTime() - MIN) }).where(isNull(deskAlerts.clearedAt));
    try {
      // The mock outboxes put the newest first: what this test sent is the head of each list.
      const before = outbox.length, pushBefore = pushOutbox.length;
      const sentSince = <T,>(list: T[], n: number) => list.slice(0, list.length - n);
      const first = await evaluateAlerts(now);
      const sla = first.fired.filter((a) => a.key === `sla:${late.id}:${late.slaStartedAt.getTime()}`);
      expect(sla).toHaveLength(1);
      const noduty = first.fired.filter((a) => a.kind === "noduty");
      expect(noduty).toHaveLength(1);
      expect(noduty[0]!.paged).toMatch(/sms/);
      const sms = sentSince(outbox, before).filter((o) => o.channel === "sms" && o.to === phone);
      expect(sms).toHaveLength(1);
      expect(sms[0]!.body).toMatch(/urgent/i);
      expect(sentSince(pushOutbox, pushBefore).filter((p) => p.to === "ExponentPushToken[overviewoncall01]")).toHaveLength(1);

      // Again, and again later: nothing new fires and nobody is paged twice.
      const again = await evaluateAlerts(new Date(now.getTime() + 5 * MIN));
      expect(again.fired.filter((a) => a.kind === "sla" || a.kind === "noduty")).toHaveLength(0);
      await evaluateAlerts(new Date(now.getTime() + 10 * MIN));
      expect(sentSince(outbox, before).filter((o) => o.channel === "sms" && o.to === phone)).toHaveLength(1);
      expect(await db.select().from(deskAlerts).where(like(deskAlerts.key, `sla:${late.id}:%`))).toHaveLength(1);
      expect(await db.select().from(deskAlerts).where(and(eq(deskAlerts.kind, "noduty"), isNull(deskAlerts.clearedAt)))).toHaveLength(1);

      // The lead's bell shows it, in English and Arabic; an agent without the lead's rights doesn't see it.
      const leadView = await openAlerts({ permissions: new Set(["desk.view", "desk.tickets.manage"]) }, 100);
      const mine = leadView.find((a) => a.key.startsWith(`sla:${late.id}:`))!;
      expect(mine).toBeTruthy();
      const fill = (dict: Record<string, string>) => (s: string, v?: Record<string, string | number>) => (dict[s] ?? s).replace(/\{(\w+)\}/g, (_, k) => String(v?.[k] ?? ""));
      expect(alertLine(mine, fill({})).title).toBe(`${mine.data.ref} is late: Missed connection in Doha`);
      expect(alertLine(mine, fill(AR)).title).toContain("متأخرة");
      expect((await openAlerts({ permissions: new Set(["desk.view"]) }, 100)).some((a) => a.kind === "sla")).toBe(false);

      // Resolved: the breach clears. A new breach on a new clock is a new alert.
      await db.update(deskTickets).set({ status: "resolved", resolvedAt: now }).where(eq(deskTickets.id, late.id));
      await evaluateAlerts(new Date(now.getTime() + 15 * MIN));
      const [row] = await db.select().from(deskAlerts).where(like(deskAlerts.key, `sla:${late.id}:%`));
      expect(row!.clearedAt).not.toBeNull();
      const restart = new Date(now.getTime() + 20 * MIN);
      await db.update(deskTickets).set({ status: "open", resolvedAt: null, slaStartedAt: restart, dueAt: new Date(restart.getTime() + 10 * MIN) }).where(eq(deskTickets.id, late.id));
      const next = await evaluateAlerts(new Date(restart.getTime() + 30 * MIN));
      expect(next.fired.filter((a) => a.key === `sla:${late.id}:${restart.getTime()}`)).toHaveLength(1);
    } finally {
      if (prev === undefined) delete process.env.DESK_ONCALL_PHONE; else process.env.DESK_ONCALL_PHONE = prev;
      if (parked.length) await db.update(deskTickets).set({ pausedAt: null }).where(inArray(deskTickets.id, parked.map((p) => p.id)));
    }
  });

  it("with someone on duty there is no nobody-on-duty alert", async () => {
    const now = new Date(Date.UTC(2034, 2, 1, 2));
    const [role] = await db.insert(schema.roles).values({ key: key(), name: "Overview agent", nameAr: "موظف", permissions: ["desk.view"] }).returning();
    const [ops] = await db.insert(schema.users).values({ name: "Reem", email: `${key()}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
    const [a] = await db.insert(appAgents).values({ opsUserId: ops!.id, displayName: "Reem", status: "online" }).returning();
    await db.insert(appAgentShifts).values({ agentId: a!.id, startsAt: new Date(now.getTime() - H), endsAt: new Date(now.getTime() + H) });
    await evaluateAlerts(new Date(now.getTime() + 40 * MIN));
    expect(await db.select().from(deskAlerts).where(and(eq(deskAlerts.kind, "noduty"), isNull(deskAlerts.clearedAt)))).toHaveLength(0);
  });
});
