import "server-only";
import { and, eq, inArray, isNotNull, lte, ne } from "drizzle-orm";
import { t } from "@mada/shared";
import { db } from "@/db";
import { appMessages, appQuotes, appRequests, appUsers } from "@/db/app-schema";
import { appAccounts, appDataExports } from "@/db/app-schema-wallet";
import { appOrders } from "@/db/app-schema-booking";
import { appRecoveryRequests } from "@/db/app-schema-recovery";
import { appAuditLog } from "./audit";
import { anonymiseAccount, processExport } from "./account/privacy";
import { cancelOrder } from "./booking/desk";
import { flightQuoteOf } from "./booking/flight-requests";
import { localeOfUser } from "./locale";
import { suppliers } from "./suppliers";
import { notify } from "./trips/notify";
import { hotelbedsContentJob } from "./suppliers/hotelbeds/content";

/*
 * Scheduled jobs (Vercel Cron → GET /api/cron/{job} with CRON_SECRET; locally `npm run app:jobs -- all`). Each is
 * idempotent and safe to run twice or late; each returns what it did, for the log and the tests.
 *
 *   exports     build every copy of everything that's waiting, email the link, and tell the traveller in the app
 *   deletions   accounts whose 30 days are up: anonymised here, and the Supabase Auth user deleted (the admin API with
 *               SUPABASE_SERVICE_ROLE_KEY; the mock records the call when Supabase isn't set up)
 *   recovery    a recovery request's contact details (old and new number or email, name, note, IP hash) are wiped
 *               30 days after the desk closed it; the decision and dates stay for the record
 *   hotelbeds   Hotelbeds hotel content into app_hotelbeds_hotels, daily (suppliers/hotelbeds/content.ts)
 *   quotes      quotes whose hold has passed become expired (the traveller hears it once, and the thread says so);
 *               bookings stuck at the bank's code for 30 minutes are cancelled, nothing charged
 */

export const JOBS = ["exports", "deletions", "recovery", "quotes", "hotelbeds"] as const;
export type JobName = (typeof JOBS)[number];
export type JobResult = Record<string, number>;

const DAY = 86_400_000;
export const RECOVERY_KEEP_DAYS = 30;
export const STUCK_PAYMENT_MIN = 30;

export async function exportsJob(): Promise<JobResult> {
  const pending = await db.select({ id: appDataExports.id, userId: appDataExports.userId }).from(appDataExports).where(eq(appDataExports.status, "pending"));
  let sent = 0, failed = 0;
  for (const e of pending) {
    try {
      const done = await processExport(e.id);
      if (done.status === "sent") {
        sent += 1;
        await notify(e.userId, { kind: "other", level: "active", copy: "notify.export", href: "/account/privacy", data: { exportId: e.id } });
      }
    } catch (err) {
      failed += 1;
      console.error("[jobs] export not built", e.id, err instanceof Error ? err.message : "");
    }
  }
  return { pending: pending.length, sent, failed };
}

export async function deletionsJob(now = new Date()): Promise<JobResult> {
  const due = await db.select({ userId: appAccounts.userId, supabaseUserId: appUsers.supabaseUserId }).from(appAccounts)
    .innerJoin(appUsers, eq(appUsers.id, appAccounts.userId))
    .where(and(isNotNull(appAccounts.deleteAt), lte(appAccounts.deleteAt, now)));
  let deleted = 0, supabase = 0, failed = 0;
  for (const d of due) {
    try {
      await anonymiseAccount(d.userId);
      deleted += 1;
      if (d.supabaseUserId) {
        try {
          await suppliers.supabaseAdmin().deleteUser(d.supabaseUserId);
          supabase += 1;
          await appAuditLog(db, { actorKind: "system", actorId: null, action: "account.supabase_deleted", entityType: "app_user", entityId: d.userId, summary: "Deleted the sign-in in Supabase Auth" });
        } catch (err) {
          // Our side is done; the Supabase user is retried by hand from the log (the id is gone from our row).
          failed += 1;
          console.error("[jobs] Supabase user not deleted", d.userId, err instanceof Error ? err.message : "");
          await appAuditLog(db, { actorKind: "system", actorId: null, action: "account.supabase_delete_failed", entityType: "app_user", entityId: d.userId, summary: "Couldn't delete the sign-in in Supabase Auth: delete it by hand", data: { supabaseUserId: d.supabaseUserId } });
        }
      }
    } catch (err) {
      failed += 1;
      console.error("[jobs] account not deleted", d.userId, err instanceof Error ? err.message : "");
    }
  }
  return { due: due.length, deleted, supabase, failed };
}

export async function recoveryJob(now = new Date()): Promise<JobResult> {
  const before = new Date(now.getTime() - RECOVERY_KEEP_DAYS * DAY);
  const rows = await db.update(appRecoveryRequests)
    .set({ name: "", oldValue: "", newValue: "", note: null, ipHash: null, decisionNote: null, updatedAt: now })
    .where(and(inArray(appRecoveryRequests.status, ["approved", "declined"]), isNotNull(appRecoveryRequests.decidedAt), lte(appRecoveryRequests.decidedAt, before), ne(appRecoveryRequests.oldValue, "")))
    .returning({ id: appRecoveryRequests.id });
  if (rows.length) await appAuditLog(db, { actorKind: "system", actorId: null, action: "recovery.purged", entityType: "app_recovery_request", entityId: null, summary: `Removed the contact details from ${rows.length} closed recovery request${rows.length === 1 ? "" : "s"} after ${RECOVERY_KEEP_DAYS} days` });
  return { purged: rows.length };
}

export async function quotesJob(now = new Date()): Promise<JobResult> {
  const ended = await db.update(appQuotes).set({ status: "expired" })
    .where(and(eq(appQuotes.status, "open"), isNotNull(appQuotes.expiresAt), lte(appQuotes.expiresAt, now)))
    .returning({ id: appQuotes.id, requestId: appQuotes.requestId, snapshot: appQuotes.offerSnapshot });
  let told = 0;
  for (const q of ended) {
    const [r] = await db.select({ ownerId: appRequests.ownerId, agentName: appRequests.agentName, status: appRequests.status }).from(appRequests).where(eq(appRequests.id, q.requestId));
    if (!r || r.status !== "quoted") continue;
    // Said once in the thread and once as a notification, in the traveller's language. Fares held for a flight
    // request matter most (seats go back to the airline); other quotes just need asking again.
    const locale = await localeOfUser(r.ownerId);
    await db.insert(appMessages).values({ threadKind: "request", threadId: q.requestId, authorKind: "mada", body: t("beta.quote.ended", undefined, locale), card: { quoteEnded: q.id } });
    if (flightQuoteOf(q.snapshot)) {
      await notify(r.ownerId, { kind: "agent_reply", level: "active", copy: "notify.quoteEnded", vars: { agent: r.agentName ?? "Mada" }, href: `/ask/request/${q.requestId}`, data: { requestId: q.requestId } });
    }
    told += 1;
  }
  const stuck = await db.select({ id: appOrders.id }).from(appOrders)
    .where(and(eq(appOrders.status, "requires_action"), lte(appOrders.createdAt, new Date(now.getTime() - STUCK_PAYMENT_MIN * 60_000))));
  let stopped = 0;
  for (const o of stuck) {
    try {
      const u = await cancelOrder(o.id, { kind: "agent", name: "Mada" });
      await notify(u.ownerId, { kind: "other", level: "passive", copy: "notify.orderStopped", href: "/trips", data: { orderId: o.id } });
      stopped += 1;
    } catch { /* moved on meanwhile */ }
  }
  return { expired: ended.length, told, stopped };
}

const RUN: Record<JobName, () => Promise<JobResult>> = { exports: () => exportsJob(), deletions: () => deletionsJob(), recovery: () => recoveryJob(), quotes: () => quotesJob(), hotelbeds: () => hotelbedsContentJob() };

/** Run some jobs (or all), one after another; a job that throws doesn't stop the others. */
export async function runJobs(names: readonly JobName[]): Promise<Record<string, JobResult | { error: string }>> {
  const out: Record<string, JobResult | { error: string }> = {};
  for (const n of names) {
    const started = Date.now();
    try {
      out[n] = await RUN[n]();
      console.info(`[jobs] ${n} ${JSON.stringify(out[n])} in ${Date.now() - started} ms`);
    } catch (err) {
      out[n] = { error: err instanceof Error ? err.message.slice(0, 200) : "failed" };
      console.error(`[jobs] ${n} failed`, err);
    }
  }
  return out;
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without a secret set, only outside production. */
export function cronAllowed(req: Request, production: boolean): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return !production;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

