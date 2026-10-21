import "server-only";
import { and, asc, eq, inArray, lt, notExists, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { appUsers } from "@/db/app-schema";
import { deskTicketEvents, deskTickets } from "@/db/app-schema-desk";
import { pushToUser } from "../push";
import { suppliers } from "../suppliers";
import { loadRota } from "./agents";
import { available } from "./routing";
import { ticketRef } from "./ticket-state";

/*
 * Night cover (DESK-PLAN.md §4.5, §7 default 6): the rota decides who is on. When an urgent ticket is past its
 * promise and nobody is on duty (no active agent on shift and switched on), the on-call lead is paged once per
 * ticket: an SMS to DESK_ONCALL_PHONE, and a push to the app account with that phone (if the lead has the app).
 * Every page is a "paged" event on the ticket and a line in the Ops activity log. Runs with the desk job.
 */

export const oncallPhone = () => process.env.DESK_ONCALL_PHONE?.trim() || null;

/** Urgent: the ticket's priority, or the source marked it (an urgent call-back). */
const urgent = or(eq(deskTickets.priority, "urgent"), sql`coalesce((${deskTickets.meta}->>'urgent')::boolean, false)`);

export async function nightCover(now = new Date()): Promise<{ paged: number; onDuty: number }> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const due = await db.select({ id: deskTickets.id, number: deskTickets.number, subject: deskTickets.subject }).from(deskTickets)
    .where(and(inArray(deskTickets.status, ["new", "open"]), sql`${deskTickets.pausedAt} IS NULL`, lt(deskTickets.dueAt, at), urgent,
      notExists(db.select({ x: sql`1` }).from(deskTicketEvents).where(and(eq(deskTicketEvents.ticketId, deskTickets.id), eq(deskTicketEvents.kind, "paged"))))))
    .orderBy(asc(deskTickets.dueAt)).limit(20);
  if (!due.length) return { paged: 0, onDuty: -1 };
  const rota = await loadRota(now);
  const onDuty = rota.agents.filter((a) => available(a, rota.shifts, now)).length;
  if (onDuty > 0) return { paged: 0, onDuty };

  const phone = oncallPhone();
  const first = due[0]!;
  const text = due.length === 1
    ? `Mada desk: urgent ticket ${ticketRef(first.number)} is past its promise and nobody is on duty. ${first.subject.slice(0, 80)}`
    : `Mada desk: ${due.length} urgent tickets are past their promise and nobody is on duty (first: ${ticketRef(first.number)}).`;
  let sms = false, pushed = 0;
  if (phone) {
    try { await suppliers.sms().send(phone, text); sms = true; } catch (e) { console.warn("[desk] on-call SMS failed", e instanceof Error ? e.message : e); }
    const [lead] = await db.select({ id: appUsers.id }).from(appUsers).where(eq(appUsers.phone, phone)).limit(1);
    if (lead) pushed = (await pushToUser(lead.id, { title: "Urgent on the desk", body: text, timeSensitive: true, channel: "messages", data: { kind: "desk_oncall" } })).sent;
  }
  const how = !phone ? "No on-call phone is set (DESK_ONCALL_PHONE): nobody was paged" : `Paged the on-call lead${sms ? " by SMS" : ""}${pushed ? " and push" : ""}${!sms && !pushed ? " (the SMS failed)" : ""}`;
  await db.insert(deskTicketEvents).values(due.map((t) => ({ ticketId: t.id, actorId: null, kind: "paged", to: phone ? (sms ? "sms" : "failed") : "unconfigured", body: how, at: now })));
  await db.insert(schema.auditEvents).values({ actorId: null, action: "desk.oncall.paged", entityType: "desk", entityRef: ticketRef(first.number), summary: `${how}: ${due.length} urgent ticket(s) past their promise with nobody on duty` });
  return { paged: phone && (sms || pushed) ? due.length : 0, onDuty };
}
