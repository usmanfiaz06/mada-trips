import "server-only";
import { and, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CurrentUser } from "./auth";
import { addDays, riyadhDate } from "./dates";

export type Task = typeof schema.tasks.$inferSelect;
export type ChecklistItem = { id: string; text: string; done: boolean };
export const OPEN_STATUSES = ["open", "in_progress", "waiting"] as const;

// Who may do what with a task:
//   see it          the person it's assigned to, whoever created it, and anyone with tasks.manage
//   move it along   (start, waiting, done, reopen, tick the checklist) the same people
//   change it       (title, notes, due date, priority, assignee) or cancel it: the creator and tasks.manage
//   assign to       yourself or anyone active on your own team; tasks.manage assigns to anyone
export const canManageAll = (u: CurrentUser) => u.permissions.has("tasks.manage");
export const canSeeTask = (u: CurrentUser, t: Pick<Task, "assigneeId" | "createdBy">) => canManageAll(u) || t.assigneeId === u.id || t.createdBy === u.id;
export const canEditTask = (u: CurrentUser, t: Pick<Task, "createdBy">) => canManageAll(u) || t.createdBy === u.id;

/** People this person can hand work to, active only. */
export async function assignableUsers(u: CurrentUser) {
  const rows = await db.select({ id: schema.users.id, name: schema.users.name, team: schema.users.team }).from(schema.users)
    .where(and(eq(schema.users.active, true), canManageAll(u) ? undefined : or(eq(schema.users.team, u.team), eq(schema.users.id, u.id))))
    .orderBy(schema.users.name);
  return rows;
}

/** Where a task falls on the calendar, in Riyadh time. */
export function dueBucket(t: Pick<Task, "dueDate" | "status">, today = riyadhDate()): "overdue" | "today" | "week" | "later" | "none" | "closed" {
  if (t.status === "done" || t.status === "cancelled") return "closed";
  if (!t.dueDate) return "none";
  if (t.dueDate < today) return "overdue";
  if (t.dueDate === today) return "today";
  if (t.dueDate <= addDays(today, 7)) return "week";
  return "later";
}

export const isOverdue = (t: Pick<Task, "dueDate" | "status">, today = riyadhDate()) => dueBucket(t, today) === "overdue";

/** Tasks with who they're for and who set them, filtered by the viewer's rights. */
export async function listTasks(u: CurrentUser, f: { view: "mine" | "assigned" | "team" | "done"; who?: string; link?: { type: string; id: string } }) {
  const w: (SQL | undefined)[] = [];
  if (f.view === "mine") w.push(eq(schema.tasks.assigneeId, u.id), inArray(schema.tasks.status, [...OPEN_STATUSES]));
  if (f.view === "assigned") w.push(eq(schema.tasks.createdBy, u.id), ne(schema.tasks.assigneeId, u.id), inArray(schema.tasks.status, [...OPEN_STATUSES]));
  if (f.view === "team") w.push(inArray(schema.tasks.status, [...OPEN_STATUSES]));
  if (f.view === "done") w.push(inArray(schema.tasks.status, ["done", "cancelled"]), sql`coalesce(${schema.tasks.completedAt}, ${schema.tasks.updatedAt}) > now() - interval '30 days'`);
  if (f.who) w.push(eq(schema.tasks.assigneeId, f.who));
  if (f.link) w.push(eq(schema.tasks.linkType, f.link.type), eq(schema.tasks.linkId, f.link.id));
  // Without tasks.manage, only your own and the ones you set.
  if (!canManageAll(u)) w.push(or(eq(schema.tasks.assigneeId, u.id), eq(schema.tasks.createdBy, u.id)));
  const assignee = sql<string>`(SELECT name FROM users WHERE id = ${schema.tasks.assigneeId})`;
  const creator = sql<string>`(SELECT name FROM users WHERE id = ${schema.tasks.createdBy})`;
  return db.select({ t: schema.tasks, assignee, creator }).from(schema.tasks).where(and(...w))
    .orderBy(
      sql`CASE ${schema.tasks.status} WHEN 'done' THEN 1 WHEN 'cancelled' THEN 1 ELSE 0 END`,
      f.view === "done" ? sql`coalesce(${schema.tasks.completedAt}, ${schema.tasks.updatedAt}) DESC` : sql`${schema.tasks.dueDate} ASC NULLS LAST`,
      sql`CASE ${schema.tasks.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END`,
      schema.tasks.createdAt,
    ).limit(300);
}

/** Per person: what's open, what's late, what's due today, what got done this week. The "who's behind" board. */
export async function workload(today = riyadhDate()) {
  const rows = await db.execute<{ id: string; name: string; team: string; open: number; overdue: number; today: number; waiting: number; done7: number; oldest: string | null }>(sql`
    SELECT u.id, u.name, u.team,
      count(*) FILTER (WHERE t.status IN ('open','in_progress','waiting'))::int AS open,
      count(*) FILTER (WHERE t.status IN ('open','in_progress','waiting') AND t.due_date < ${today})::int AS overdue,
      count(*) FILTER (WHERE t.status IN ('open','in_progress','waiting') AND t.due_date = ${today})::int AS today,
      count(*) FILTER (WHERE t.status = 'waiting')::int AS waiting,
      count(*) FILTER (WHERE t.status = 'done' AND t.completed_at > now() - interval '7 days')::int AS done7,
      min(t.due_date) FILTER (WHERE t.status IN ('open','in_progress','waiting') AND t.due_date < ${today})::text AS oldest
    FROM users u LEFT JOIN tasks t ON t.assignee_id = u.id
    WHERE u.active
    GROUP BY u.id
    HAVING count(t.id) > 0
    ORDER BY overdue DESC, today DESC, open DESC, u.name`);
  return rows.map((r) => ({ ...r, open: Number(r.open), overdue: Number(r.overdue), today: Number(r.today), waiting: Number(r.waiting), done7: Number(r.done7) }));
}

/** Open tasks assigned to this person that are late or due today: the sidebar badge and dashboard list. */
export async function myUrgentTasks(userId: string, today = riyadhDate()) {
  return db.select().from(schema.tasks)
    .where(and(eq(schema.tasks.assigneeId, userId), inArray(schema.tasks.status, [...OPEN_STATUSES]), sql`${schema.tasks.dueDate} <= ${today}`))
    .orderBy(schema.tasks.dueDate).limit(20);
}

/** The record a task is about, with a readable label and a link. */
export async function linkedRecord(type: string | null, id: string | null) {
  if (!type || !id) return null;
  if (type === "booking") { const [b] = await db.select({ ref: schema.bookings.ref, pax: schema.bookings.passengers }).from(schema.bookings).where(eq(schema.bookings.id, id)); return b ? { label: `${b.ref} · ${b.pax}`, href: `/adminwork/sales/${id}` } : null; }
  if (type === "client") { const [c] = await db.select({ name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, id)); return c ? { label: c.name, href: `/adminwork/clients/${id}` } : null; }
  if (type === "expense") { const [e] = await db.select({ ref: schema.expenses.ref, d: schema.expenses.description }).from(schema.expenses).where(eq(schema.expenses.id, id)); return e ? { label: `${e.ref} · ${e.d}`, href: `/adminwork/expenses/${id}` } : null; }
  return null;
}
