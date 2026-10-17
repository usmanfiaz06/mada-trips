import "server-only";
import { and, eq, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { clockIn } from "@mada/shared";
import { db } from "@/db";
import { appRuntime } from "@/db/app-schema-resilience";
import { appUsers } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appEsims } from "@/db/app-schema-esim";
import { appAuditLog } from "../audit";
import { orderEvent } from "../booking/desk";
import { suppliers } from "../suppliers";
import { notify } from "../trips/notify";
import { syncCatalogue, catalogueStatus } from "./catalogue";
import { pricingRules } from "./pricing";
import { fulfilEsimOrder, refundUndelivered, whereName } from "./service";

/*
 * Running eSIMs day to day (cron job "esim", every 15 minutes, lib/app/jobs.ts):
 *
 *   balance     the supplier's prepaid credit (eSIM Access), kept in app_runtime "esim.balance". Low means below the
 *               owner's threshold or below what a day of orders usually costs (the last 7 days' average). The desk shows
 *               a banner; the ops address (APP_OPS_EMAIL) gets one email, again at most every 12 hours.
 *   low balance an order refused for our balance after the traveller paid: the eSIM is "with Mada" with a promised time
 *               (rules.sortingMinutes); the desk gets an urgent item; each run tries again once the balance is back;
 *               when the promised time passes, the money goes back automatically.
 *   pending     ordered, the supplier still making the eSIMs: looked at again; after 30 minutes it goes to the desk.
 *   catalogue   synced once a day (esim/catalogue.ts).
 */

const BAL_KEY = "esim.balance";
const ALERT_EVERY_MS = 12 * 3600_000;
const PENDING_MAX_MS = 30 * 60_000;
export const LOW_BALANCE = "low_balance";

export type EsimBalance = { usd: number | null; at: string | null; thresholdUsd: number; dayUsd: number; low: boolean; alertedAt: string | null; error: string | null };

type Stored = { usd: number | null; at: string | null; alertedAt: string | null; error: string | null };

async function stored(): Promise<Stored> {
  const [row] = await db.select().from(appRuntime).where(eq(appRuntime.key, BAL_KEY)).catch(() => []);
  const v = (row?.value ?? {}) as Partial<Stored>;
  return { usd: typeof v.usd === "number" ? v.usd : null, at: v.at ?? null, alertedAt: v.alertedAt ?? null, error: v.error ?? null };
}
async function store(v: Stored) {
  await db.insert(appRuntime).values({ key: BAL_KEY, value: v, updatedAt: new Date() }).onConflictDoUpdate({ target: appRuntime.key, set: { value: v, updatedAt: new Date() } });
}

/** What a day of eSIM orders usually costs us, in USD: the last seven days' net cost over seven. */
export async function expectedDayUsd(now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const [r] = await db.select({ cents: sql<number>`coalesce(sum(${appEsims.netUsdCents}), 0)::int` }).from(appEsims).where(and(gte(appEsims.createdAt, since), sql`${appEsims.status} <> 'refunded'`));
  return Math.round((Number(r?.cents ?? 0) / 100 / 7) * 100) / 100;
}

/** The balance as last read (or read now, `fresh`), with whether it is low. Never throws. */
export async function esimBalance(opts: { fresh?: boolean; now?: Date } = {}): Promise<EsimBalance> {
  const now = opts.now ?? new Date();
  let s = await stored();
  if (opts.fresh) {
    const sup = suppliers.esim();
    if (sup.balance) {
      try { s = { ...s, usd: (await sup.balance()).usd, at: now.toISOString(), error: null }; }
      catch (e) { s = { ...s, error: e instanceof Error ? e.message.slice(0, 160) : "no answer" }; }
      await store(s).catch(() => {});
    }
  }
  const [rules, dayUsd] = await Promise.all([pricingRules(), expectedDayUsd(now).catch(() => 0)]);
  const low = s.usd !== null && (s.usd < rules.lowBalanceUsd || s.usd < dayUsd);
  return { usd: s.usd, at: s.at, thresholdUsd: rules.lowBalanceUsd, dayUsd, low, alertedAt: s.alertedAt, error: s.error };
}

const opsEmail = () => { const v = process.env.APP_OPS_EMAIL?.trim(); return v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null; };

/** Tell ops the balance is low: one email, at most every 12 hours (`urgent`: a traveller has paid and is waiting). */
export async function alertLowBalance(b: EsimBalance, opts: { urgent?: boolean; now?: Date } = {}): Promise<boolean> {
  const now = opts.now ?? new Date();
  if (!opts.urgent && b.alertedAt && now.getTime() - Date.parse(b.alertedAt) < ALERT_EVERY_MS) return false;
  const to = opsEmail();
  const s = await stored();
  await store({ ...s, alertedAt: now.toISOString() }).catch(() => {});
  if (!to) { console.warn("[esim] balance is low and APP_OPS_EMAIL is not set: the desk banner is the only alert"); return false; }
  const bal = b.usd === null ? "unknown" : `$${b.usd.toFixed(2)}`;
  const subject = opts.urgent ? `Urgent: a paid eSIM is waiting on the eSIM Access balance (${bal})` : `eSIM Access balance is low: ${bal}`;
  const text = [
    opts.urgent ? "A traveller has paid for an eSIM and eSIM Access refused it for low balance. Mada promised it by a set time; it is refunded automatically if that time passes." : "The eSIM Access prepaid balance is running low.",
    `Balance: ${bal}. Alert below $${b.thresholdUsd.toFixed(2)}; a usual day of orders costs about $${b.dayUsd.toFixed(2)}.`,
    "Top up in the eSIM Access console (Billing › Top up). Waiting eSIMs are ordered again within 15 minutes of the balance coming back.",
    "Desk: /adminwork/desk/esims",
  ].join("\n\n");
  await suppliers.email().send({ to, subject, text }).catch((e) => console.warn("[esim] low-balance email not sent", e instanceof Error ? e.message : e));
  return true;
}

/** The supplier refused a paid order for our balance: promise a time, tell the traveller and the desk, alert ops. */
export async function lowBalanceAfterPayment(o: typeof appOrders.$inferSelect, count: number, now = new Date()): Promise<void> {
  const rules = await pricingRules();
  const due = new Date(now.getTime() + rules.sortingMinutes * 60_000);
  // A second refusal keeps the first promise: the time the traveller was told never moves.
  const rows = await db.update(appEsims).set({ status: "stuck", problem: LOW_BALANCE, dueAt: sql`coalesce(${appEsims.dueAt}, ${due.toISOString()}::timestamptz)`, updatedAt: now })
    .where(eq(appEsims.orderId, o.id)).returning({ dueAt: appEsims.dueAt, plan: appEsims.plan, first: sql<boolean>`${appEsims.dueAt} = ${due.toISOString()}::timestamptz` });
  const promised = rows[0]?.dueAt ?? due;
  const firstTime = rows.some((r) => r.first);
  if (!firstTime) return;
  await db.transaction(async (tx) => {
    await orderEvent(tx, o.id, "esim_low_balance", { kind: "system" }, { count, dueAt: promised.toISOString() });
    await appAuditLog(tx, { actorKind: "system", actorId: null, action: "esim.low_balance", entityType: "app_order", entityId: o.id, summary: `eSIM Access refused ${count} paid eSIM(s) for low balance; promised by ${promised.toISOString()}` });
  });
  const plan = rows[0]?.plan as { coverage?: { code: string; name: string } } | undefined;
  await notify(o.ownerId, { kind: "other", level: "active", copy: "notify.esim.sorting", vars: { where: plan?.coverage ? whereName(plan.coverage as { code: string; name: string }) : "", time: clockIn(promised) }, href: `/esims?order=${o.id}` }).catch(() => {});
  await alertLowBalance(await esimBalance({ fresh: true, now }), { urgent: true, now }).catch(() => {});
}

/** One run of the eSIM job. */
export async function esimJob(now = new Date()): Promise<Record<string, number>> {
  const out = { balanceLow: 0, alerted: 0, retried: 0, delivered: 0, refunded: 0, pending: 0, toDesk: 0, synced: 0 };
  const sup = suppliers.esim();
  const b = await esimBalance({ fresh: !!sup.balance, now });
  if (b.low) { out.balanceLow = 1; if (await alertLowBalance(b, { now })) out.alerted = 1; }

  // Paid, waiting on our balance: past the promised time → money back; balance back → order again.
  const waiting = await db.selectDistinct({ orderId: appEsims.orderId, dueAt: appEsims.dueAt }).from(appEsims)
    .where(and(eq(appEsims.status, "stuck"), eq(appEsims.problem, LOW_BALANCE), isNull(appEsims.iccid)));
  for (const w of waiting) {
    if (w.dueAt && w.dueAt.getTime() <= now.getTime()) {
      await refundUndelivered(w.orderId, "not delivered by the time Mada promised");
      out.refunded += 1;
    } else if (!b.low || b.usd === null) {
      await db.update(appEsims).set({ status: "ordering", problem: null }).where(and(eq(appEsims.orderId, w.orderId), eq(appEsims.status, "stuck")));
      await fulfilEsimOrder(w.orderId);
      out.retried += 1;
      const [r] = await db.select({ iccid: appEsims.iccid }).from(appEsims).where(and(eq(appEsims.orderId, w.orderId), eq(appEsims.idx, 0)));
      if (r?.iccid) out.delivered += 1;
    }
  }

  // Ordered, the supplier still making the eSIMs: look again; after 30 minutes, the desk looks.
  const pending = await db.selectDistinct({ orderId: appEsims.orderId }).from(appEsims)
    .where(and(eq(appEsims.status, "ordering"), isNotNull(appEsims.supplierOrderId), isNull(appEsims.iccid)));
  for (const p of pending) {
    out.pending += 1;
    await fulfilEsimOrder(p.orderId).catch(() => {});
    const still = await db.update(appEsims).set({ status: "stuck", problem: "the supplier hasn't sent the eSIM yet", updatedAt: now })
      .where(and(eq(appEsims.orderId, p.orderId), eq(appEsims.status, "ordering"), isNull(appEsims.iccid), lt(appEsims.createdAt, new Date(now.getTime() - PENDING_MAX_MS)))).returning({ id: appEsims.id });
    if (still.length) out.toDesk += 1;
  }

  // The catalogue, once a day.
  const cat = await catalogueStatus();
  if (!cat.at || now.getTime() - Date.parse(cat.at) > 20 * 3600_000) {
    const r = await syncCatalogue(now).catch((e) => { console.warn("[esim] catalogue sync failed", e instanceof Error ? e.message : e); return null; });
    if (r) out.synced = r.total;
  }
  return out;
}

/** Paid eSIMs that need a person: no answer from the supplier, or waiting on our balance. For the desk's inbox. */
export async function esimsNeedingDesk() {
  return db.select({ id: appEsims.id, orderId: appEsims.orderId, ownerId: appEsims.ownerId, problem: appEsims.problem, dueAt: appEsims.dueAt, plan: appEsims.plan, updatedAt: appEsims.updatedAt, ref: appOrders.ref, total: appOrders.total, name: appUsers.name })
    .from(appEsims).innerJoin(appOrders, eq(appOrders.id, appEsims.orderId)).innerJoin(appUsers, eq(appUsers.id, appEsims.ownerId)).where(and(eq(appEsims.status, "stuck"), eq(appEsims.idx, 0)));
}
