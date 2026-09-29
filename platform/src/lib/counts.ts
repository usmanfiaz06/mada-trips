import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CurrentUser } from "./auth";
import { pendingForUser } from "./approvals";
import { canSeeIssuance } from "./issuance";
import { myUrgentTasks } from "./tasks";

export async function navCounts(u: CurrentUser) {
  const [approvals, issuance, closes, expenses, tasks] = await Promise.all([
    db.transaction((tx) => pendingForUser(tx, u.id)).then((r) => r.length),
    canSeeIssuance(u).then(async (ok) => ok
      ? (await db.select({ n: sql<number>`count(*)::int` }).from(schema.bookings).where(eq(schema.bookings.status, "pending_issue")))[0].n : 0),
    u.permissions.has("close.verify")
      ? db.select({ n: sql<number>`count(*)::int` }).from(schema.dailyCloses).where(eq(schema.dailyCloses.status, "submitted")).then((r) => r[0].n) : Promise.resolve(0),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.expenses).where(and(eq(schema.expenses.submittedBy, u.id), inArray(schema.expenses.status, ["pending"]))).then((r) => r[0].n),
    myUrgentTasks(u.id).then((r) => r.length),
  ]);
  return { approvals, issuance, closes, myPendingExpenses: expenses, tasks };
}
