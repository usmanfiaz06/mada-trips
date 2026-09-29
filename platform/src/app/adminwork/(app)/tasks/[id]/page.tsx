import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, Check, CircleDot, Hourglass, Link2, Play, RotateCcw, X } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo, riyadhDate } from "@/lib/dates";
import { isUuid } from "@/lib/security";
import { assignableUsers, canEditTask, canSeeTask, linkedRecord, type ChecklistItem } from "@/lib/tasks";
import { Attachments, Timeline } from "@/components/record";
import { Avatar, Badge, Card, CardHead, Field, Input, KV, Select, Textarea, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { dueText, PRIORITY_LABEL, STATUS_LABEL } from "@/components/tasks";
import { addChecklistItem, cancelTask, removeChecklistItem, setTaskStatus, toggleChecklistItem, updateTask } from "../actions";

export const metadata = { title: "Task" };

const STATUS_TONE = { open: "neutral", in_progress: "info", waiting: "warn", done: "ok", cancelled: "neutral" } as const;

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const t = await getT();
  const L = t.locale;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  if (!task || !canSeeTask(u, task)) notFound();
  const editable = canEditTask(u, task);
  const closed = task.status === "done" || task.status === "cancelled";
  const [people, link, names] = await Promise.all([
    editable ? assignableUsers(u) : Promise.resolve([]),
    linkedRecord(task.linkType, task.linkId),
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users),
  ]);
  const nameOf = (x: string | null) => names.find((n) => n.id === x)?.name ?? "—";
  // The current assignee always appears in the list, even if they're outside the editor's team.
  const options = people.some((p) => p.id === task.assigneeId) ? people : [{ id: task.assigneeId, name: nameOf(task.assigneeId), team: "" }, ...people];
  const steps = (task.checklist as ChecklistItem[]) ?? [];
  const due = dueText(t, task.dueDate, task.status);
  const path = `/adminwork/tasks/${task.id}`;
  const status = (to: string, label: string, icon: React.ReactNode, variant: "primary" | "outline" = "outline") => (
    <ActionForm action={setTaskStatus}>
      <input type="hidden" name="id" value={task.id} /><input type="hidden" name="to" value={to} />
      <SubmitButton variant={variant} className="w-full">{icon}{label}</SubmitButton>
    </ActionForm>
  );

  return (
    <>
      <Link href="/adminwork/tasks" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Tasks")}</Link>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
          <span className="num">{task.ref}</span>
          <Badge tone={STATUS_TONE[task.status as keyof typeof STATUS_TONE] ?? "neutral"} dot>{t(STATUS_LABEL[task.status])}</Badge>
          {task.priority !== "normal" && <Badge tone={task.priority === "urgent" ? "bad" : "warn"}>{t(PRIORITY_LABEL[task.priority])}</Badge>}
          {!closed && <span className={due.tone}>{due.text}</span>}
        </div>
        <h1 className={cx("mt-2 max-w-[900px] text-[32px] font-[380] leading-tight tracking-[-0.03em]", closed && "text-ink-3")}>{task.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px] text-ink-3">
          <Avatar name={nameOf(task.assigneeId)} size={24} />
          <span>{task.createdBy === task.assigneeId ? t("{name}'s own task", { name: nameOf(task.assigneeId) }) : t("For {a}, from {c}", { a: nameOf(task.assigneeId), c: nameOf(task.createdBy) })} · {timeAgo(task.createdAt, L)}</span>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Card>
            {task.status === "waiting" && (
              <div className="mb-4 flex items-start gap-2.5 rounded-2xl bg-warn-soft px-4 py-3 text-[14px] text-warn"><Hourglass className="mt-0.5 size-4 shrink-0" /><span><strong className="font-[550]">{t("Waiting on")}:</strong> {task.waitingOn}</span></div>
            )}
            {task.status === "done" && (
              <div className="mb-4 flex items-start gap-2.5 rounded-2xl bg-ok-soft px-4 py-3 text-[14px] text-ok"><Check className="mt-0.5 size-4 shrink-0" />{t("Done by {name}", { name: nameOf(task.completedBy) })} · {task.completedAt ? fmtDate(task.completedAt, L, true) : ""}{task.dueDate && task.completedAt && riyadhDate(task.completedAt) > task.dueDate ? ` · ${t("after the due date")}` : ""}</div>
            )}
            {task.status === "cancelled" ? (
              <p className="text-[14px] text-ink-3">{t("This task was cancelled. The reason is in the timeline below.")}</p>
            ) : task.status === "done" ? (
              <div className="max-w-[220px]">{status("open", t("Reopen"), <RotateCcw className="size-4" />)}</div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                {status("done", t("Mark done"), <Check className="size-4" />, "primary")}
                {task.status === "open" && status("in_progress", t("Start"), <Play className="size-4" />)}
                {task.status === "waiting" && status("in_progress", t("Resume"), <CircleDot className="size-4" />)}
                {task.status === "in_progress" && status("open", t("Back to to-do"), <RotateCcw className="size-4" />)}
                <ActionForm action={setTaskStatus} className="flex gap-2 sm:col-span-3">
                  <input type="hidden" name="id" value={task.id} /><input type="hidden" name="to" value="waiting" />
                  <input name="waitingOn" maxLength={300} placeholder={t("Stuck? Say what it's waiting on…")} className="field flex-1" />
                  <SubmitButton variant="outline"><Hourglass className="size-4" />{t("Put on hold")}</SubmitButton>
                </ActionForm>
              </div>
            )}
          </Card>

          <Card>
            <CardHead title={t("Steps")} hint={steps.length ? t("{d} of {n} done", { d: steps.filter((s) => s.done).length, n: steps.length }) : t("Break it into steps if it helps")} />
            {steps.length > 0 && (
              <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-sunken"><div className="h-full bg-ok transition-all" style={{ width: `${(steps.filter((s) => s.done).length / steps.length) * 100}%` }} /></div>
            )}
            <ul className="-mx-2 mb-3">
              {steps.map((s) => (
                <li key={s.id} className="group flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-surface-2">
                  <form action={toggleChecklistItem}>
                    <input type="hidden" name="id" value={task.id} /><input type="hidden" name="item" value={s.id} />
                    <button disabled={closed} aria-label={s.done ? t("Untick") : t("Tick")} className={cx("grid size-5 place-items-center rounded-md ring-[1.5px] transition", s.done ? "bg-ok text-white ring-ok" : "ring-line-strong hover:ring-ok")}>{s.done && <Check className="size-3" strokeWidth={3} />}</button>
                  </form>
                  <span className={cx("flex-1 text-[14px]", s.done && "text-ink-3 line-through decoration-ink-4")}>{s.text}</span>
                  {!closed && (
                    <form action={removeChecklistItem}>
                      <input type="hidden" name="id" value={task.id} /><input type="hidden" name="item" value={s.id} />
                      <button aria-label={t("Remove step")} className="grid size-6 place-items-center rounded-full text-ink-4 opacity-0 transition hover:bg-sunken hover:text-ink group-hover:opacity-100 focus:opacity-100"><X className="size-3.5" /></button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {!closed && (
              <ActionForm action={addChecklistItem} resetOnOk className="flex gap-2">
                <input type="hidden" name="id" value={task.id} />
                <input name="text" maxLength={200} placeholder={t("Add a step…")} className="field flex-1" />
                <SubmitButton variant="outline">{t("Add")}</SubmitButton>
              </ActionForm>
            )}
          </Card>

          {task.notes && <Card><CardHead title={t("Notes")} /><p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{task.notes}</p></Card>}
          <Timeline entityType="task" entityId={task.id} path={path} refLabel={task.ref} />
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHead title={t("Details")} />
            <KV cols={1} items={[
              [t("Assigned to"), nameOf(task.assigneeId)],
              [t("Set by"), nameOf(task.createdBy)],
              [t("Due"), task.dueDate ? fmtDate(task.dueDate, L) : t("No date")],
              [t("Priority"), t(PRIORITY_LABEL[task.priority])],
              ...(link ? [[t("About"), <Link key="l" href={link.href} className="inline-flex items-center gap-1 underline decoration-gold decoration-2 underline-offset-4"><Link2 className="size-3.5" />{link.label}</Link>] as [string, React.ReactNode]] : []),
            ]} />
          </Card>

          {editable && !closed && (
            <Card>
              <CardHead title={t("Change")} hint={t("Everyone involved sees the change in the timeline.")} />
              <ActionForm action={updateTask} className="space-y-3">
                <input type="hidden" name="id" value={task.id} />
                <Field label={t("Title")}><Input name="title" defaultValue={task.title} maxLength={160} /></Field>
                <Field label={t("Assigned to")}><Select name="assigneeId" defaultValue={task.assigneeId} options={options.map((p) => ({ value: p.id, label: p.id === u.id ? `${p.name} (${t("Me")})` : p.name }))} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("Due")}><Input name="dueDate" type="date" defaultValue={task.dueDate ?? ""} /></Field>
                  <Field label={t("Priority")}><Select name="priority" defaultValue={task.priority} options={Object.entries(PRIORITY_LABEL).map(([v, l]) => ({ value: v, label: t(l) }))} /></Field>
                </div>
                <Field label={t("Notes")}><Textarea name="notes" rows={4} maxLength={4000} defaultValue={task.notes ?? ""} /></Field>
                <SubmitButton className="w-full">{t("Save")}</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Attachments entityType="task" entityId={task.id} path={path} refLabel={task.ref} title={t("Files")} canAdd={!closed} />

          {editable && task.status !== "cancelled" && (
            <Card>
              <CardHead title={t("Cancel task")} hint={t("For work that's no longer needed. It stays on record.")} />
              <ActionForm action={cancelTask} className="space-y-2">
                <input type="hidden" name="id" value={task.id} />
                <Input name="reason" maxLength={500} placeholder={t("Why it's no longer needed")} />
                <SubmitButton variant="danger" className="w-full" confirm={t("Cancel this task?")}>{t("Cancel task")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
