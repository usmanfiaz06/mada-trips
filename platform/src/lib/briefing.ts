import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CurrentUser } from "./auth";
import { pendingForUser } from "./approvals";
import { canSeeIssuance } from "./issuance";
import { myUrgentTasks } from "./tasks";
import { getT } from "./i18n";
import { riyadhDate } from "./dates";
import { sar } from "./money";

export type AlertTone = "urgent" | "warn" | "info";
export type AlertIcon = "Stamp" | "ListChecks" | "Inbox" | "Ticket" | "MoonStar" | "Wallet";

export type Alert = {
  /** Stable key: the browser remembers which alerts it has already toasted this session. */
  key: string;
  tone: AlertTone;
  icon: AlertIcon;
  title: string;
  detail?: string;
  href: string;
};

/**
 * Everything waiting on this person right now, newest-pressure first. One source of truth for the
 * notification bell and the "welcome back" toasts, so both always agree with the sidebar badges.
 */
export async function whatsDue(u: CurrentUser): Promise<Alert[]> {
  const t = await getT();
  const today = riyadhDate();

  const [approvals, tasks, leads, issuance, closes, flightReview] = await Promise.all([
    db.transaction((tx) => pendingForUser(tx, u.id)),
    myUrgentTasks(u.id, today),
    u.permissions.has("leads.view")
      ? db.select({ n: sql<number>`count(*)::int` }).from(schema.leads).where(eq(schema.leads.status, "new")).then((r) => r[0].n)
      : Promise.resolve(0),
    canSeeIssuance(u).then(async (ok) => ok
      ? (await db.select({ n: sql<number>`count(*)::int` }).from(schema.bookings).where(eq(schema.bookings.status, "pending_issue")))[0].n
      : 0),
    u.permissions.has("close.verify")
      ? db.select({ n: sql<number>`count(*)::int` }).from(schema.dailyCloses).where(eq(schema.dailyCloses.status, "submitted")).then((r) => r[0].n)
      : Promise.resolve(0),
    // Flights recorded before the IATA/Direct choice, still sitting in the IATA balance unconfirmed.
    u.permissions.has("finance.reconcile")
      ? db.select({ n: sql<number>`count(*)::int` }).from(schema.bookings)
          .where(and(eq(schema.bookings.serviceType, "flight"), eq(schema.bookings.viaBsp, true), eq(schema.bookings.supplierReviewed, false),
            sql`${schema.bookings.status} not in ('void','refunded','draft')`,
            isNull(schema.bookings.bspClosingId),
            sql`NOT EXISTS (SELECT 1 FROM ${schema.supplierPayments} sp WHERE sp.booking_id = ${schema.bookings.id} AND sp.status IN ('settled','pending_approval'))`)).then((r) => r[0].n)
      : Promise.resolve(0),
  ]);

  const out: Alert[] = [];

  // Approvals waiting on your vote — the most time-sensitive thing in the business.
  if (approvals.length) {
    const amount = approvals.reduce((s, a) => s + Number(a.amount ?? 0), 0);
    const oldest = approvals.reduce((d, a) => (a.createdAt < d ? a.createdAt : d), approvals[0].createdAt);
    const age = Math.max(0, Math.floor((Date.now() - new Date(oldest).getTime()) / 86_400_000));
    out.push({
      key: `approvals:${approvals.length}`, tone: "urgent", icon: "Stamp",
      title: approvals.length === 1 ? t("1 approval is waiting on you") : t("{n} approvals are waiting on you", { n: approvals.length }),
      detail: [amount > 0 ? `SAR ${sar(amount)}` : "", age >= 1 ? (age === 1 ? t("oldest since yesterday") : t("oldest {n} days", { n: age })) : t("just now")].filter(Boolean).join(" · "),
      href: "/adminwork/approvals",
    });
  }

  // Tasks assigned to you — overdue is louder than due-today.
  const overdue = tasks.filter((k) => !!k.dueDate && k.dueDate < today);
  const dueToday = tasks.filter((k) => k.dueDate === today);
  if (overdue.length) {
    out.push({
      key: `tasks-overdue:${overdue.length}`, tone: "urgent", icon: "ListChecks",
      title: overdue.length === 1 ? t("1 task is overdue") : t("{n} tasks are overdue", { n: overdue.length }),
      detail: overdue.length === 1 ? `${overdue[0].ref} · ${overdue[0].title}` : undefined,
      href: "/adminwork/tasks",
    });
  }
  if (dueToday.length) {
    out.push({
      key: `tasks-today:${dueToday.length}`, tone: "warn", icon: "ListChecks",
      title: dueToday.length === 1 ? t("1 task is due today") : t("{n} tasks are due today", { n: dueToday.length }),
      detail: dueToday.length === 1 ? `${dueToday[0].ref} · ${dueToday[0].title}` : undefined,
      href: "/adminwork/tasks",
    });
  }

  // New website enquiries that nobody has picked up yet.
  if (leads > 0) {
    out.push({
      key: `leads:${leads}`, tone: "warn", icon: "Inbox",
      title: leads === 1 ? t("1 new enquiry from the website") : t("{n} new enquiries from the website", { n: leads }),
      detail: t("Assign someone to follow up"),
      href: "/adminwork/leads",
    });
  }

  // Tickets/visas waiting to be issued.
  if (issuance > 0) {
    out.push({
      key: `issuance:${issuance}`, tone: "warn", icon: "Ticket",
      title: issuance === 1 ? t("1 booking is waiting to be issued") : t("{n} bookings are waiting to be issued", { n: issuance }),
      href: "/adminwork/issuance",
    });
  }

  // Older flight tickets to confirm as IATA or direct (one-time cleanup after the settlement fix).
  if (flightReview > 0) {
    out.push({
      key: `flight-review:${flightReview}`, tone: "warn", icon: "Ticket",
      title: flightReview === 1 ? t("1 older ticket needs a settlement check") : t("{n} older tickets need a settlement check", { n: flightReview }),
      detail: t("Confirm each was bought through IATA or direct"),
      href: "/adminwork/sales/review",
    });
  }

  // Daily closes submitted and waiting for your verification.
  if (closes > 0) {
    out.push({
      key: `closes:${closes}`, tone: "info", icon: "MoonStar",
      title: closes === 1 ? t("1 daily close needs verifying") : t("{n} daily closes need verifying", { n: closes }),
      href: "/adminwork/close",
    });
  }

  return out;
}
