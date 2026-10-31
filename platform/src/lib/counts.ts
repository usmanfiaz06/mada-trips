import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CurrentUser } from "./auth";
import { pendingApprovalsFor } from "./approvals";
import { canSeeIssuance } from "./issuance";
import { myUrgentTasks } from "./tasks";

export async function navCounts(u: CurrentUser) {
  const [approvals, issuance, closes, expenses, tasks, leads, corporate, inbox] = await Promise.all([
    pendingApprovalsFor(u.id).then((r) => r.length),
    canSeeIssuance(u).then(async (ok) => ok
      ? (await db.select({ n: sql<number>`count(*)::int` }).from(schema.bookings).where(eq(schema.bookings.status, "pending_issue")))[0].n : 0),
    u.permissions.has("close.verify")
      ? db.select({ n: sql<number>`count(*)::int` }).from(schema.dailyCloses).where(eq(schema.dailyCloses.status, "submitted")).then((r) => r[0].n) : Promise.resolve(0),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.expenses).where(and(eq(schema.expenses.submittedBy, u.id), inArray(schema.expenses.status, ["pending"]))).then((r) => r[0].n),
    myUrgentTasks(u.id).then((r) => r.length),
    u.permissions.has("leads.view")
      ? db.select({ n: sql<number>`count(*)::int` }).from(schema.leads).where(eq(schema.leads.status, "new")).then((r) => r[0].n) : Promise.resolve(0),
    u.permissions.has("clients.manage")
      ? db.select({ n: sql<number>`count(*)::int` }).from(schema.portalRequests).where(eq(schema.portalRequests.status, "submitted")).then((r) => r[0].n) : Promise.resolve(0),
    u.permissions.has("clients.manage")
      ? db.select({ n: sql<number>`count(distinct ${schema.portalMessages.clientId})::int` }).from(schema.portalMessages)
        .where(and(eq(schema.portalMessages.side, "client"), sql`${schema.portalMessages.handledAt} IS NULL`)).then((r) => r[0].n) : Promise.resolve(0),
  ]);
  return { approvals, issuance, closes, myPendingExpenses: expenses, tasks, leads, corporate, inbox };
}
