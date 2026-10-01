import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CurrentUser } from "./auth";
import { eligibleApprovers } from "./approvals";
import { isUuid } from "./security";

export const RECORD_TYPES = ["booking", "expense", "client", "approval", "close", "settlement", "user", "task", "lead"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

/**
 * Whether this person may see a record, using the same rule as the record's own page.
 * Used for files, remarks and timelines, so nothing is reachable by guessing an id.
 */
export async function canViewRecord(u: CurrentUser, type: string, id: string): Promise<boolean> {
  if (!isUuid(id) && type !== "close") return false;
  const p = u.permissions;
  switch (type) {
    case "booking": {
      const [b] = await db.select({ team: schema.users.team }).from(schema.bookings).innerJoin(schema.users, eq(schema.users.id, schema.bookings.preparedBy)).where(eq(schema.bookings.id, id));
      return !!b && (p.has("sales.view_all") || b.team === u.team);
    }
    case "expense": {
      const [e] = await db.select({ by: schema.expenses.submittedBy }).from(schema.expenses).where(eq(schema.expenses.id, id));
      return !!e && (p.has("expenses.view_all") || e.by === u.id);
    }
    case "client": {
      const [c] = await db.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.id, id));
      return !!c;
    }
    case "approval": {
      const [r] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, id));
      if (!r) return false;
      if (r.requestedBy === u.id || p.has("approvals.decide") || p.has("expenses.verify") || p.has("finance.view")) return true;
      const pool = await db.transaction((tx) => eligibleApprovers(tx, r));
      return pool.some((x) => x.id === u.id);
    }
    case "close": {
      if (!isUuid(id)) return false;
      const [c] = await db.select({ team: schema.dailyCloses.team }).from(schema.dailyCloses).where(eq(schema.dailyCloses.id, id));
      return !!c && (p.has("close.verify") || u.team === c.team || u.team === "management");
    }
    case "settlement":
      return p.has("finance.view");
    case "user":
      return p.has("team.manage") || id === u.id;
    case "task": {
      const [t] = await db.select({ a: schema.tasks.assigneeId, c: schema.tasks.createdBy }).from(schema.tasks).where(eq(schema.tasks.id, id));
      return !!t && (p.has("tasks.manage") || t.a === u.id || t.c === u.id);
    }
    case "lead": {
      if (!p.has("leads.view")) return false;
      const [l] = await db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.id, id));
      return !!l;
    }
    default:
      return false;
  }
}

/** Whether this person may add remarks or files to a record: they must be able to see it, and some records lock once final. */
export async function canAnnotateRecord(u: CurrentUser, type: string, id: string, what: "remark" | "file"): Promise<boolean> {
  if (!(await canViewRecord(u, type, id))) return false;
  if (what === "file" && type === "expense") {
    // Proof can't be swapped after verification.
    const [e] = await db.select({ status: schema.expenses.status, by: schema.expenses.submittedBy }).from(schema.expenses).where(eq(schema.expenses.id, id));
    return !!e && e.status === "pending" && e.by === u.id;
  }
  if (what === "file" && (type === "settlement" || type === "lead" || type === "approval" || type === "user")) return false;
  return true;
}

/** A readable, server-side label for a record (never trust a label sent by the browser). */
export async function recordLabel(type: string, id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  switch (type) {
    case "booking": return (await db.select({ l: schema.bookings.ref }).from(schema.bookings).where(eq(schema.bookings.id, id)))[0]?.l ?? null;
    case "expense": return (await db.select({ l: schema.expenses.ref }).from(schema.expenses).where(eq(schema.expenses.id, id)))[0]?.l ?? null;
    case "client": return (await db.select({ l: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, id)))[0]?.l ?? null;
    case "approval": return (await db.select({ l: schema.approvalRequests.ref }).from(schema.approvalRequests).where(eq(schema.approvalRequests.id, id)))[0]?.l ?? null;
    case "settlement": return (await db.select({ l: schema.settlementCycles.label }).from(schema.settlementCycles).where(eq(schema.settlementCycles.id, id)))[0]?.l ?? null;
    case "task": return (await db.select({ l: schema.tasks.ref }).from(schema.tasks).where(eq(schema.tasks.id, id)))[0]?.l ?? null;
    case "lead": return (await db.select({ l: schema.leads.ref }).from(schema.leads).where(eq(schema.leads.id, id)))[0]?.l ?? null;
    case "user": return (await db.select({ l: schema.users.name }).from(schema.users).where(eq(schema.users.id, id)))[0]?.l ?? null;
    default: return null;
  }
}

/** Where each record lives, so revalidation never uses a browser-supplied path. */
export function recordPath(type: string, id: string): string {
  const base: Record<string, string> = { booking: "sales", expense: "expenses", client: "clients", approval: "approvals", settlement: "settlement", user: "team", task: "tasks", lead: "leads" };
  return base[type] ? `/adminwork/${base[type]}/${id}` : "/adminwork";
}
