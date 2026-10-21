import "server-only";
import { and, desc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { appPayments } from "@/db/app-schema";
import { appAgents, deskTickets } from "@/db/app-schema-desk";
import { deskAlerts } from "@/db/app-schema-desk-alerts";
import type { CurrentUser } from "@/lib/auth";
import { supplierBalances } from "@/lib/app/finance/balances";
import { loadRota } from "./agents";
import { dropoffRate } from "./dropoffs";
import { pageOncall, urgentTicket } from "./oncall";
import { available } from "./routing";
import { ticketRef } from "./ticket-state";

/*
 * Desk alerts (DESK-PLAN.md U8) in the header bell, each fired once:
 *
 *   sla       a running ticket past its promise: one per breach (the ticket and the clock it broke)
 *   balance   a supplier's balance below its threshold (Supplier balances' "low"): one per dip
 *   dropoffs  drop-offs in the last hour at least SPIKE_MIN and SPIKE_TIMES the hourly average of the week before
 *   payments  declined payments in the last hour, the same rule
 *   noduty    urgent tickets open and nobody on duty (on shift and switched on): pages the on-call lead by push and SMS
 *             (DESK_ONCALL_PHONE, through the SMS and push adapters) once per spell, per §7 default 6
 *
 * evaluateAlerts() writes a desk_alerts row the first time a condition is seen and clears it when it stops; the open
 * row's unique key is the dedupe, so another run (another request, the job) never fires it twice. It runs with the
 * desk job and, at most once a minute per server, when someone opens a page.
 */

export const SPIKE_MIN = 5;
export const SPIKE_TIMES = 3;
const EVAL_EVERY_MS = 60_000;
const D = "/adminwork/desk";

export type DeskAlert = typeof deskAlerts.$inferSelect;
type Want = { key: string; kind: string; tone: "urgent" | "warn"; href: string; data: Record<string, string | number | null> };

/** A spike: enough in the last hour, and well above the week's hourly average. */
export const isSpike = (lastHour: number, perHour: number) => lastHour >= SPIKE_MIN && lastHour >= SPIKE_TIMES * perHour;

async function conditions(now: Date): Promise<Want[]> {
  const at = sql`${now.toISOString()}::timestamptz`;
  const running = and(inArray(deskTickets.status, ["new", "open"]), isNull(deskTickets.pausedAt));
  const [late, urgent, bal, drops, [pays], rota] = await Promise.all([
    db.select({ id: deskTickets.id, number: deskTickets.number, subject: deskTickets.subject, started: deskTickets.slaStartedAt, level: deskTickets.escalationLevel, owner: appAgents.displayName })
      .from(deskTickets).leftJoin(appAgents, eq(appAgents.id, deskTickets.ownerAgentId))
      .where(and(running, sql`${deskTickets.dueAt} < ${at}`)).orderBy(deskTickets.dueAt).limit(50),
    db.select({ n: sql<number>`count(*)::int`, first: sql<number | null>`min(${deskTickets.number})` }).from(deskTickets).where(and(inArray(deskTickets.status, ["new", "open"]), urgentTicket)),
    supplierBalances().catch(() => []),
    dropoffRate().catch(() => ({ lastHour: 0, perHour: 0 })),
    db.select({
      h: sql<number>`count(*) FILTER (WHERE ${appPayments.updatedAt} >= ${at} - interval '1 hour')::int`,
      w: sql<number>`count(*) FILTER (WHERE ${appPayments.updatedAt} < ${at} - interval '1 hour')::int`,
    }).from(appPayments).where(and(eq(appPayments.status, "declined"), gte(appPayments.updatedAt, sql`${at} - interval '169 hours'`))),
    loadRota(now),
  ]);
  const out: Want[] = [];
  for (const t of late) {
    const ref = ticketRef(t.number);
    out.push({ key: `sla:${t.id}:${t.started.getTime()}`, kind: "sla", tone: t.level >= 2 ? "urgent" : "warn", href: `${D}/tickets/${ref}`, data: { ref, subject: t.subject.slice(0, 120), owner: t.owner ?? null } });
  }
  for (const b of bal.filter((x) => x.state === "low"))
    out.push({ key: `balance:${b.key}`, kind: "balance", tone: "urgent", href: `${D}/finance/balances`, data: { supplier: b.name, days: b.daysLeft, usd: b.balanceUsd ?? null, sar: b.balance } });
  if (isSpike(drops.lastHour, drops.perHour))
    out.push({ key: "spike:dropoffs", kind: "dropoffs", tone: "warn", href: `${D}/drop-offs`, data: { n: drops.lastHour, usual: Math.round(drops.perHour * 10) / 10 } });
  const payHour = pays?.h ?? 0, payPer = (pays?.w ?? 0) / 168;
  if (isSpike(payHour, payPer))
    out.push({ key: "spike:payments", kind: "payments", tone: "urgent", href: `${D}/drop-offs?s=payment`, data: { n: payHour, usual: Math.round(payPer * 10) / 10 } });
  const onDuty = rota.agents.filter((a) => available(a, rota.shifts, now)).length;
  const u = urgent[0];
  if (u && u.n > 0 && onDuty === 0)
    out.push({ key: "noduty", kind: "noduty", tone: "urgent", href: `${D}/tickets?p=urgent`, data: { n: u.n, ref: u.first != null ? ticketRef(Number(u.first)) : null } });
  return out;
}

/** The text the on-call lead gets. */
const pageText = (w: Want) => Number(w.data.n) === 1
  ? `Mada desk: an urgent ticket (${w.data.ref}) is open and nobody is on duty.`
  : `Mada desk: ${w.data.n} urgent tickets are open and nobody is on duty (first: ${w.data.ref}).`;

/**
 * Fires what is new, refreshes what still holds (an SLA breach that went to level 2 turns urgent without firing
 * again), and clears what stopped. Returns the alerts that fired on this run.
 */
export async function evaluateAlerts(now = new Date()): Promise<{ fired: DeskAlert[]; cleared: number }> {
  const want = await conditions(now);
  const result = await db.transaction(async (tx) => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext('desk_alerts')) AS ok`);
    if (!(lock as unknown as { ok: boolean }[])[0]?.ok) return null;
    const fired = want.length ? await tx.insert(deskAlerts).values(want.map((w) => ({ ...w, firedAt: now }))).onConflictDoNothing().returning() : [];
    const firedKeys = new Set(fired.map((f) => f.key));
    for (const w of want.filter((x) => !firedKeys.has(x.key)))
      await tx.update(deskAlerts).set({ tone: w.tone, data: w.data }).where(and(eq(deskAlerts.key, w.key), isNull(deskAlerts.clearedAt), sql`(${deskAlerts.tone} <> ${w.tone} OR ${deskAlerts.data} <> ${JSON.stringify(w.data)}::jsonb)`));
    const cleared = await tx.update(deskAlerts).set({ clearedAt: now })
      .where(and(isNull(deskAlerts.clearedAt), want.length ? notInArray(deskAlerts.key, want.map((w) => w.key)) : undefined)).returning({ id: deskAlerts.id });
    return { fired, cleared: cleared.length };
  });
  if (!result) return { fired: [], cleared: 0 };

  // Paging happens after the row is committed: a second run can't page again for the same spell.
  for (const a of result.fired.filter((f) => f.kind === "noduty")) {
    const w = want.find((x) => x.key === a.key)!;
    const p = await pageOncall(pageText(w));
    const paged = !p.phone ? "unconfigured" : p.sms && p.pushed ? "sms+push" : p.sms ? "sms" : p.pushed ? "push" : "failed";
    await db.update(deskAlerts).set({ paged }).where(eq(deskAlerts.id, a.id));
    a.paged = paged;
    await db.insert(schema.auditEvents).values({ actorId: null, action: "desk.oncall.paged", entityType: "desk", entityRef: String(w.data.ref ?? "desk"),
      summary: paged === "unconfigured" ? "Urgent tickets open with nobody on duty; no on-call phone is set (DESK_ONCALL_PHONE)" : `Urgent tickets open with nobody on duty: paged the on-call lead (${paged})` });
  }
  return result;
}

let lastEval = 0;
/** evaluateAlerts() at most once a minute on this server, for page loads; the desk job runs it on its own schedule. */
export async function maybeEvaluate(now = new Date()) {
  if (now.getTime() - lastEval < EVAL_EVERY_MS) return;
  lastEval = now.getTime();
  await evaluateAlerts(now).catch((e) => console.error("[desk] alerts failed", e instanceof Error ? e.message : e));
}

/** Who sees which alert: balances go to everyone on the desk (paid eSIMs wait on them); the rest to leads. */
export const seesAlert = (u: Pick<CurrentUser, "permissions">, kind: string) =>
  kind === "balance" ? u.permissions.has("desk.view") : u.permissions.has("desk.tickets.manage") || u.permissions.has("desk.reports");

/** The open alerts this person sees, newest first. */
export async function openAlerts(u: Pick<CurrentUser, "permissions">, limit = 8): Promise<DeskAlert[]> {
  if (!u.permissions.has("desk.view")) return [];
  const kinds = ["balance", "sla", "dropoffs", "payments", "noduty"].filter((k) => seesAlert(u, k));
  return db.select().from(deskAlerts).where(and(isNull(deskAlerts.clearedAt), inArray(deskAlerts.kind, kinds)))
    .orderBy(sql`${deskAlerts.tone} = 'urgent' DESC`, desc(deskAlerts.firedAt)).limit(limit);
}

type T = (s: string, v?: Record<string, string | number>) => string;
/** One alert as the bell's line: title and detail in the reader's language. */
export function alertLine(a: Pick<DeskAlert, "kind" | "data" | "paged">, t: T): { title: string; detail?: string } {
  const d = a.data;
  switch (a.kind) {
    case "sla": return { title: t("{ref} is late: {subject}", { ref: String(d.ref), subject: String(d.subject) }), detail: d.owner ? t("With {name}", { name: String(d.owner) }) : t("Nobody has it") };
    case "balance": return {
      title: t("{supplier} balance is low", { supplier: String(d.supplier) }),
      detail: d.days != null ? t("About {n} days left at this week's rate", { n: Number(d.days) }) : t("Top it up in the supplier's console"),
    };
    case "dropoffs": return { title: t("Drop-offs are spiking: {n} in the last hour", { n: Number(d.n) }), detail: t("Usually {n} an hour", { n: Number(d.usual) }) };
    case "payments": return { title: t("Failed payments are spiking: {n} in the last hour", { n: Number(d.n) }), detail: t("Usually {n} an hour", { n: Number(d.usual) }) };
    case "noduty": return {
      title: Number(d.n) === 1 ? t("An urgent ticket is open and nobody is on duty") : t("{n} urgent tickets are open and nobody is on duty", { n: Number(d.n) }),
      detail: a.paged === "unconfigured" ? t("No on-call phone is set (DESK_ONCALL_PHONE)") : a.paged && a.paged !== "failed" ? t("The on-call lead was paged") : a.paged === "failed" ? t("Paging the on-call lead failed") : undefined,
    };
    default: return { title: a.kind };
  }
}
