import "server-only";
import { localeOfUser } from "@/lib/app/locale";
import { and, eq, inArray, sql } from "drizzle-orm";
import { icaoCallsign, t as copy, type FlightPosition } from "@mada/shared";
import { db } from "@/db";
import { appNotifications, appSegments, appTrips, appUsers } from "@/db/app-schema";
import { appDeskDisruptions } from "@/db/app-schema-desk";
import { suppliers } from "@/lib/app/suppliers";
import { addDays, riyadhDate } from "@/lib/dates";
import { actingAgent, creditEntry } from "./adapters";
import { assertCap, deskAudit, DeskError, sarText, travellerName, type DeskActor } from "./core";

export const DISRUPTED = ["delayed", "cancelled", "diverted"] as const;
export const isDisrupted = (s: string) => (DISRUPTED as readonly string[]).includes(s);

/** "2026-10-10 09:40:00" at Asia/Riyadh → the instant. Local wall-clock times are how segments are stored. */
export function zonedToUtc(local: string, tz: string): Date {
  const iso = local.replace(" ", "T").slice(0, 19);
  const guess = new Date(`${iso}Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(guess).map((p) => [p.type, p.value]));
  const asLocal = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

export type BoardFlight = {
  key: string; flightNumber: string; date: string; carrier: string; from: string; to: string; departLocal: string; arriveLocal: string; departTz: string;
  departAt: Date; arriveAt: Date; status: string; source: string | null; gate: string | null; terminal: string | null; disrupted: boolean;
  travellers: { userId: string; name: string; tripId: string; count: number }[]; travellerCount: number; changedAt: Date;
  position: FlightPosition | null; plans: (typeof appDeskDisruptions.$inferSelect)[];
};

/** Rows for today's flights with Mada travellers on board (local departure day), grouped by flight. */
async function todaysSegments(now: Date) {
  const today = riyadhDate(now);
  return db.select({ s: appSegments, ownerId: appTrips.ownerId, travellerIds: appTrips.travellerIds, userName: appUsers.name, tripStatus: appTrips.status })
    .from(appSegments).innerJoin(appTrips, eq(appTrips.id, appSegments.tripId)).innerJoin(appUsers, eq(appUsers.id, appTrips.ownerId))
    .where(and(sql`${appSegments.departLocal}::date BETWEEN ${addDays(today, -1)}::date AND ${addDays(today, 1)}::date`, sql`${appTrips.status} <> 'cancelled'`));
}

/** Flights with a status worth the desk's attention, without calling any supplier (for the inbox and counts). */
export async function disruptedToday(now = new Date()) {
  const rows = await todaysSegments(now);
  const today = riyadhDate(now);
  const out = new Map<string, { flightNumber: string; date: string; status: string; changedAt: Date; userIds: Set<string>; names: string[]; route: string }>();
  for (const r of rows) {
    const date = r.s.departLocal.slice(0, 10);
    if (date !== today || !isDisrupted(r.s.status)) continue;
    const key = `${r.s.flightNumber}:${date}`;
    const e = out.get(key) ?? { flightNumber: r.s.flightNumber, date, status: r.s.status, changedAt: r.s.updatedAt, userIds: new Set(), names: [], route: `${r.s.fromAirport} → ${r.s.toAirport}` };
    if (!e.userIds.has(r.ownerId)) { e.userIds.add(r.ownerId); e.names.push(travellerName(r.userName)); }
    if (r.s.updatedAt < e.changedAt) e.changedAt = r.s.updatedAt;
    out.set(key, e);
  }
  const keys = [...out.values()];
  const plans = keys.length ? await db.select({ f: appDeskDisruptions.flightNumber, d: appDeskDisruptions.date }).from(appDeskDisruptions)
    .where(inArray(appDeskDisruptions.flightNumber, keys.map((k) => k.flightNumber))) : [];
  return keys.filter((k) => !plans.some((p) => p.f === k.flightNumber && p.d === k.date));
}

/** The board: every flight today with Mada travellers, live status from flightStatus and live positions in the air. */
export async function disruptionBoard(now = new Date()): Promise<BoardFlight[]> {
  const rows = await todaysSegments(now);
  const today = riyadhDate(now);
  const groups = new Map<string, BoardFlight>();
  for (const r of rows) {
    const s = r.s;
    const date = s.departLocal.slice(0, 10);
    if (date !== today) continue;
    const key = `${s.flightNumber}:${date}`;
    const g = groups.get(key) ?? {
      key, flightNumber: s.flightNumber, date, carrier: s.carrierName, from: s.fromAirport, to: s.toAirport, departLocal: s.departLocal, arriveLocal: s.arriveLocal, departTz: s.departTz,
      departAt: zonedToUtc(s.departLocal, s.departTz), arriveAt: zonedToUtc(s.arriveLocal, s.arriveTz), status: s.status, source: s.statusSource, gate: s.gate, terminal: s.terminal,
      disrupted: false, travellers: [], travellerCount: 0, changedAt: s.updatedAt, position: null, plans: [],
    };
    if (isDisrupted(s.status)) g.status = s.status;
    if (!g.travellers.some((x) => x.tripId === s.tripId)) {
      const count = Math.max(1, r.travellerIds.length);
      g.travellers.push({ userId: r.ownerId, name: travellerName(r.userName), tripId: s.tripId, count });
      g.travellerCount += count;
    }
    groups.set(key, g);
  }
  const flights = [...groups.values()];
  const plans = flights.length ? await db.select().from(appDeskDisruptions).where(inArray(appDeskDisruptions.flightNumber, flights.map((f) => f.flightNumber))) : [];
  await Promise.all(flights.map(async (f) => {
    f.plans = plans.filter((p) => p.flightNumber === f.flightNumber && p.date === f.date).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const live = await withTimeout(suppliers.flightStatus().lookup(f.flightNumber, f.date), 2500);
    if (live) {
      // Our own record wins when it already says disrupted (an airline email the desk logged); otherwise the feed does.
      if (!isDisrupted(f.status)) f.status = live.status;
      f.gate = live.gate ?? f.gate; f.terminal = live.terminal ?? f.terminal; f.source = live.source;
    }
    const airborne = ["departed", "in_air"].includes(f.status) || (f.status !== "cancelled" && now >= f.departAt && now <= f.arriveAt);
    const callsign = icaoCallsign(f.flightNumber);
    if (airborne && callsign) f.position = await withTimeout(suppliers.flightPositions().byCallsign(callsign), 2500);
    f.disrupted = isDisrupted(f.status);
  }));
  return flights.sort((a, b) => Number(b.disrupted && !b.plans.length) - Number(a.disrupted && !a.plans.length) || a.departAt.getTime() - b.departAt.getTime());
}

/**
 * Push a rebooking plan to everyone on a disrupted flight: a time-sensitive notification signed by the agent,
 * and, when given, a voucher as Mada credit for each account (needs desk.refund).
 */
export async function pushPlan(actor: DeskActor, v: { flightNumber: string; date: string; status: string; plan: string; options: { label: string; detail: string }[]; voucher: number }) {
  assertCap(actor, "desk.act");
  if (v.voucher > 0) assertCap(actor, "desk.refund");
  const plan = v.plan.trim();
  if (plan.length < 10 || plan.length > 400) throw new DeskError("Write the plan in 10 to 400 characters");
  if (!/^[A-Z0-9]{2}\d{1,4}$/.test(v.flightNumber) || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) throw new DeskError("Unknown flight");
  if (!Number.isInteger(v.voucher) || v.voucher < 0 || v.voucher > 5_000_00) throw new DeskError("Vouchers are up to SAR 5,000");
  const options = v.options.map((o) => ({ label: o.label.trim().slice(0, 60), detail: o.detail.trim().slice(0, 140) })).filter((o) => o.label).slice(0, 4);
  return db.transaction(async (tx) => {
    const segs = await tx.select({ ownerId: appTrips.ownerId, tripId: appTrips.id }).from(appSegments).innerJoin(appTrips, eq(appTrips.id, appSegments.tripId))
      .where(and(eq(appSegments.flightNumber, v.flightNumber), sql`${appSegments.departLocal}::date = ${v.date}::date`, sql`${appTrips.status} <> 'cancelled'`));
    const users = [...new Set(segs.map((s) => s.ownerId))];
    if (!users.length) throw new DeskError("Nobody from Mada is on that flight", "NOT_FOUND");
    const me = await actingAgent(tx, actor);
    const [row] = await tx.insert(appDeskDisruptions).values({ flightNumber: v.flightNumber, date: v.date, status: v.status, plan, options, voucherAmount: v.voucher, userIds: users, pushedBy: actor.id, agentName: me.name }).returning();
    const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
    for (const userId of users) {
      const trip = segs.find((s) => s.ownerId === userId)!.tripId;
      const locale = await localeOfUser(userId, tx);
      await tx.insert(appNotifications).values({
        userId, kind: v.status === "cancelled" ? "flight_cancelled" : "flight_delayed", level: "time_sensitive",
        title: clip(copy("notify.desk.plan.title", { flight: v.flightNumber }, locale), 32), body: clip(copy("notify.desk.plan.body", { agent: me.name, plan }, locale), 90), href: `/trips/${trip}/disruption`,
        data: { disruptionId: row!.id, options, voucher: v.voucher },
      });
      if (v.voucher > 0) await creditEntry(tx, actor, { userId, amount: v.voucher, kind: "goodwill", note: `For the trouble on ${v.flightNumber}` });
    }
    await deskAudit(tx, actor, { action: "desk.disruption.plan_pushed", entityType: "flight", entityId: `${v.flightNumber}:${v.date}`, ref: v.flightNumber,
      summary: `Sent a new plan for ${v.flightNumber} (${v.status}) to ${users.length} traveller account${users.length === 1 ? "" : "s"}${v.voucher ? ` with ${sarText(v.voucher)} credit each` : ""}`, data: { disruptionId: row!.id, users: users.length, voucher: v.voucher } });
    return row!;
  });
}
