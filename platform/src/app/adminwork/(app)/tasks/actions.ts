"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema, type Tx } from "@/db";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { audit, diff } from "@/lib/audit";
import { nextRef } from "@/lib/refs";
import { canViewRecord } from "@/lib/access";
import { canEditTask, canManageAll, canSeeTask, type ChecklistItem, type Task } from "@/lib/tasks";
import { fmtDate, riyadhDate, addDays } from "@/lib/dates";
import { flash, str, toState, zodError, type ActionState } from "@/lib/actions";
import { isIsoDate, isUuid } from "@/lib/security";

const PRIORITY = ["normal", "high", "urgent"] as const;
const LINKS = ["booking", "client", "expense"] as const;

const Fields = z.object({
  title: z.string().trim().min(2, "Say what needs doing").max(160, "Keep the title under 160 characters"),
  notes: z.string().trim().max(4000, "Keep the notes under 4,000 characters").optional().transform((v) => v || null),
  assigneeId: z.string().uuid("Choose who does it"),
  dueDate: z.string().optional().transform((v) => v || null).refine((v) => v === null || isIsoDate(v), "Pick a valid date"),
  priority: z.enum(PRIORITY).catch("normal"),
});

/** Can this person give work to that person? Themselves or their own team; tasks.manage can assign anyone. */
async function assertAssignable(u: CurrentUser, assigneeId: string) {
  const [a] = await db.select().from(schema.users).where(eq(schema.users.id, assigneeId));
  if (!a || !a.active) throw new Error("Choose who does it");
  if (!canManageAll(u) && a.id !== u.id && a.team !== u.team) throw new Error("You can assign tasks to yourself or your own team");
  return a;
}

const dueText = (d: string | null) => (d ? ` · due ${fmtDate(d, "en")}` : "");

export async function createTask(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const p = Fields.safeParse(Object.fromEntries(fd));
  if (!p.success) return zodError(p.error);
  const v = p.data;
  if (v.dueDate && v.dueDate < addDays(riyadhDate(), -1)) return { error: "The due date is in the past", fields: { dueDate: "x" } };
  const linkType = str(fd, "linkType"), linkId = str(fd, "linkId");
  const hasLink = !!(linkType || linkId);
  if (hasLink && (!(LINKS as readonly string[]).includes(linkType) || !isUuid(linkId))) return { error: "Unknown record" };
  // Checklist: one item per line, from the "steps" box.
  const checklist: ChecklistItem[] = str(fd, "steps").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 30)
    .map((text) => ({ id: randomUUID(), text: text.slice(0, 200), done: false }));
  let ref = "";
  try {
    const a = await assertAssignable(u, v.assigneeId);
    if (hasLink && !(await canViewRecord(u, linkType, linkId))) throw new Error("Unknown record");
    ref = await db.transaction(async (tx) => {
      const ref = await nextRef(tx, "T");
      const [t] = await tx.insert(schema.tasks).values({ ref, ...v, checklist, createdBy: u.id, linkType: hasLink ? linkType : null, linkId: hasLink ? linkId : null }).returning();
      await audit(tx, { actorId: u.id, action: "task.created", entityType: "task", entityId: t.id, entityRef: ref,
        summary: a.id === u.id ? `Added ${ref} for themselves: ${v.title}${dueText(v.dueDate)}` : `Assigned ${ref} to ${a.name}: ${v.title}${dueText(v.dueDate)}` });
      return ref;
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  return { ok: `${ref} added` };
}

/** Lock the task and check the person may act on it. */
async function loadForUpdate(tx: Tx, u: CurrentUser, id: string, need: "move" | "edit") {
  if (!isUuid(id)) throw new Error("Task not found");
  const [t] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, id)).for("update");
  if (!t || !canSeeTask(u, t)) throw new Error("Task not found");
  if (need === "edit" && !canEditTask(u, t)) throw new Error("Only the person who set this task, or a manager, can change it");
  return t;
}

const STATUS_WORD: Record<string, string> = { open: "Reopened", in_progress: "Started", waiting: "Put on hold", done: "Completed" };

async function changeStatus(u: CurrentUser, id: string, to: string, waitingOn: string | null) {
  if (!["open", "in_progress", "waiting", "done"].includes(to)) throw new Error("Unknown status");
  if (to === "waiting" && !waitingOn) throw new Error("Say what it's waiting on");
  if (waitingOn && waitingOn.length > 300) throw new Error("Keep it under 300 characters");
  return db.transaction(async (tx) => {
    const t = await loadForUpdate(tx, u, id, "move");
    if (t.status === "cancelled") throw new Error("This task was cancelled");
    if (t.status === to && to !== "waiting") return t;
    const done = to === "done";
    await tx.update(schema.tasks).set({
      status: to, waitingOn: to === "waiting" ? waitingOn : null, updatedAt: new Date(),
      completedAt: done ? new Date() : null, completedBy: done ? u.id : null,
    }).where(eq(schema.tasks.id, id));
    await audit(tx, { actorId: u.id, action: `task.${to === "open" ? "reopened" : to === "in_progress" ? "started" : to === "done" ? "completed" : "waiting"}`, entityType: "task", entityId: id, entityRef: t.ref,
      summary: `${STATUS_WORD[to]} ${t.ref}: ${t.title}${to === "waiting" ? ` · waiting on "${waitingOn}"` : ""}`, changes: { status: { from: t.status, to } } });
    return t;
  });
}

/** Status buttons on the task page. */
export async function setTaskStatus(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const to = str(fd, "to");
  try {
    const t = await changeStatus(u, str(fd, "id"), to, str(fd, "waitingOn") || null);
    revalidatePath("/adminwork", "layout");
    return { ok: to === "done" ? `${t.ref} done` : to === "open" ? `${t.ref} reopened` : to === "waiting" ? `${t.ref} is on hold` : `${t.ref} started` };
  } catch (e) { return toState(e); }
}

/** The round check button in lists: done, or back to open. */
export async function toggleTaskDone(fd: FormData) {
  const u = await requireUser();
  try {
    const t = await changeStatus(u, str(fd, "id"), str(fd, "to") === "open" ? "open" : "done", null);
    await flash(str(fd, "to") === "open" ? `${t.ref} reopened` : `${t.ref} done`);
  } catch (e) { await flash(e instanceof Error && !("code" in e) ? e.message : "Something went wrong. Please try again."); }
  revalidatePath("/adminwork", "layout");
}

export async function updateTask(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const id = str(fd, "id");
  const p = Fields.safeParse(Object.fromEntries(fd));
  if (!p.success) return zodError(p.error);
  const v = p.data;
  try {
    const a = await assertAssignable(u, v.assigneeId);
    const msg = await db.transaction(async (tx) => {
      const t = await loadForUpdate(tx, u, id, "edit");
      if (t.status === "cancelled" || t.status === "done") throw new Error("Reopen the task before changing it");
      const changes = diff(t as unknown as Record<string, unknown>, v);
      if (!Object.keys(changes).length) return "No changes";
      await tx.update(schema.tasks).set({ ...v, updatedAt: new Date() }).where(eq(schema.tasks.id, id));
      const reassigned = v.assigneeId !== t.assigneeId;
      if (reassigned) {
        const [from] = await tx.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, t.assigneeId));
        changes.assigneeId = { from: from?.name ?? "—", to: a.name };
      }
      await audit(tx, { actorId: u.id, action: reassigned ? "task.assigned" : "task.updated", entityType: "task", entityId: id, entityRef: t.ref,
        summary: reassigned ? `Moved ${t.ref} to ${a.name}: ${v.title}` : `Updated ${t.ref}: ${Object.keys(changes).map((k) => ({ dueDate: "due date", assigneeId: "assignee" } as Record<string, string>)[k] ?? k).join(", ")}`, changes });
      return "Saved";
    });
    revalidatePath("/adminwork", "layout");
    return { ok: msg };
  } catch (e) { return toState(e); }
}

export async function cancelTask(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const id = str(fd, "id"), reason = str(fd, "reason");
  if (!reason) return { error: "Say why it's no longer needed" };
  if (reason.length > 500) return { error: "Keep the reason under 500 characters" };
  try {
    await db.transaction(async (tx) => {
      const t = await loadForUpdate(tx, u, id, "edit");
      if (t.status === "cancelled") throw new Error("Already cancelled");
      await tx.update(schema.tasks).set({ status: "cancelled", waitingOn: null, updatedAt: new Date() }).where(eq(schema.tasks.id, id));
      await tx.insert(schema.remarks).values({ entityType: "task", entityId: id, userId: u.id, body: `Cancelled: ${reason}` });
      await audit(tx, { actorId: u.id, action: "task.cancelled", entityType: "task", entityId: id, entityRef: t.ref, summary: `Cancelled ${t.ref}: ${t.title} · "${reason}"` });
    });
  } catch (e) { return toState(e); }
  await flash("Task cancelled");
  revalidatePath("/adminwork", "layout");
  redirect(`/adminwork/tasks/${id}`);
}

/* ───────── Checklist ───────── */

async function editChecklist(u: CurrentUser, id: string, f: (items: ChecklistItem[], t: Task) => { items: ChecklistItem[]; summary: string } | null) {
  await db.transaction(async (tx) => {
    const t = await loadForUpdate(tx, u, id, "move");
    if (t.status === "cancelled" || t.status === "done") throw new Error("Reopen the task first");
    const r = f(((t.checklist as ChecklistItem[]) ?? []).slice(), t);
    if (!r) return;
    await tx.update(schema.tasks).set({ checklist: r.items, updatedAt: new Date() }).where(eq(schema.tasks.id, id));
    await audit(tx, { actorId: u.id, action: "task.checklist", entityType: "task", entityId: id, entityRef: t.ref, summary: `${t.ref}: ${r.summary}` });
  });
  revalidatePath(`/adminwork/tasks/${id}`);
}

export async function addChecklistItem(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const text = str(fd, "text");
  if (!text) return { error: "Write the step first" };
  if (text.length > 200) return { error: "Keep each step under 200 characters" };
  try {
    await editChecklist(u, str(fd, "id"), (items) => {
      if (items.length >= 30) throw new Error("A task can have up to 30 steps");
      items.push({ id: randomUUID(), text, done: false });
      return { items, summary: `added step "${text}"` };
    });
  } catch (e) { return toState(e); }
  return { ok: "Step added" };
}

export async function toggleChecklistItem(fd: FormData) {
  const u = await requireUser();
  const item = str(fd, "item");
  try {
    await editChecklist(u, str(fd, "id"), (items) => {
      const i = items.find((x) => x.id === item);
      if (!i) return null;
      i.done = !i.done;
      return { items, summary: `${i.done ? "ticked" : "unticked"} "${i.text}"` };
    });
  } catch (e) { await flash(e instanceof Error && !("code" in e) ? e.message : "Something went wrong. Please try again."); }
}

export async function removeChecklistItem(fd: FormData) {
  const u = await requireUser();
  const item = str(fd, "item");
  try {
    await editChecklist(u, str(fd, "id"), (items) => {
      const i = items.find((x) => x.id === item);
      if (!i) return null;
      return { items: items.filter((x) => x.id !== item), summary: `removed step "${i.text}"` };
    });
  } catch (e) { await flash(e instanceof Error && !("code" in e) ? e.message : "Something went wrong. Please try again."); }
}

