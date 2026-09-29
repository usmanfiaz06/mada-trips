import Link from "next/link";
import { Check, CircleDot, Hourglass, Link2, ListChecks, Plus } from "lucide-react";
import { getT } from "@/lib/i18n";
import { daysBetween, fmtDate, riyadhDate } from "@/lib/dates";
import { dueBucket, listTasks, type ChecklistItem, type Task } from "@/lib/tasks";
import { toggleTaskDone } from "@/app/adminwork/(app)/tasks/actions";
import type { CurrentUser } from "@/lib/auth";
import { Avatar, Card, CardHead, cx } from "./ui";

type T = Awaited<ReturnType<typeof getT>>;

/** "Overdue 3 days", "Today", "Tomorrow", "Thu 2 Oct": the due date said the way people say it. */
export function dueText(t: T, d: string | null, status: string, today = riyadhDate()) {
  if (!d) return { text: t("No date"), tone: "text-ink-4" };
  if (status === "done" || status === "cancelled") return { text: fmtDate(d, t.locale), tone: "text-ink-3" };
  const n = daysBetween(today, d);
  if (n < 0) return { text: n === -1 ? t("Overdue since yesterday") : t("Overdue {n} days", { n: -n }), tone: "text-bad" };
  if (n === 0) return { text: t("Due today"), tone: "text-gold-2" };
  if (n === 1) return { text: t("Due tomorrow"), tone: "text-ink-2" };
  const wd = new Intl.DateTimeFormat(t.locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  return { text: wd, tone: "text-ink-2" };
}

export const PRIORITY_LABEL: Record<string, string> = { normal: "Normal", high: "High", urgent: "Urgent" };
export const STATUS_LABEL: Record<string, string> = { open: "To do", in_progress: "In progress", waiting: "Waiting", done: "Done", cancelled: "Cancelled" };

/** One task in a list: tick it off in place, open it for everything else. */
export async function TaskRow({ task, assignee, creator, me, showAssignee }: { task: Task; assignee: string; creator: string; me: CurrentUser; showAssignee?: boolean }) {
  const t = await getT();
  const closed = task.status === "done" || task.status === "cancelled";
  const due = dueText(t, task.dueDate, task.status);
  const steps = (task.checklist as ChecklistItem[]) ?? [];
  const doneSteps = steps.filter((s) => s.done).length;
  const late = dueBucket(task) === "overdue";
  return (
    <li className={cx("group flex items-start gap-3 rounded-2xl px-3 py-3 transition hover:bg-surface-2", late && "bg-bad-soft/40")}>
      <form action={toggleTaskDone} className="pt-0.5">
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="to" value={closed ? "open" : "done"} />
        <button type="submit" disabled={task.status === "cancelled"} aria-label={closed ? t("Reopen") : t("Mark done")} title={closed ? t("Reopen") : t("Mark done")}
          className={cx("grid size-[22px] place-items-center rounded-full ring-[1.5px] transition",
            task.status === "done" ? "bg-ok text-white ring-ok" : task.status === "cancelled" ? "ring-line text-ink-4" : task.priority === "urgent" ? "ring-bad hover:bg-bad-soft" : task.priority === "high" ? "ring-warn hover:bg-warn-soft" : "ring-line-strong hover:bg-ok-soft hover:ring-ok")}>
          {task.status === "done" ? <Check className="size-3.5" strokeWidth={3} /> : <Check className="size-3 opacity-0 transition group-hover:opacity-40" strokeWidth={3} />}
        </button>
      </form>
      <Link href={`/adminwork/tasks/${task.id}`} className="min-w-0 flex-1">
        <div className={cx("text-[14.5px] leading-snug", closed ? "text-ink-3 line-through decoration-ink-4" : "text-ink")}>{task.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-ink-3">
          <span className="num">{task.ref}</span>
          {task.priority !== "normal" && !closed && <span className={cx("rounded-full px-2 py-px text-[11px] font-medium", task.priority === "urgent" ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn")}>{t(PRIORITY_LABEL[task.priority])}</span>}
          {task.status === "in_progress" && <span className="inline-flex items-center gap-1 text-info"><CircleDot className="size-3" />{t("In progress")}</span>}
          {task.status === "waiting" && <span className="inline-flex max-w-[260px] items-center gap-1 truncate text-warn"><Hourglass className="size-3 shrink-0" />{t("Waiting on")} {task.waitingOn}</span>}
          {task.status === "cancelled" && <span>{t("Cancelled")}</span>}
          {steps.length > 0 && <span className="inline-flex items-center gap-1"><ListChecks className="size-3" /><span className="num">{doneSteps}/{steps.length}</span></span>}
          {task.linkType && <Link2 className="size-3" aria-label={t("Linked to a record")} />}
          {!showAssignee && task.createdBy !== me.id && <span>{t("from {name}", { name: creator })}</span>}
        </div>
      </Link>
      <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
        <span className={cx("text-[12.5px]", due.tone)}>{due.text}</span>
        {showAssignee && <span className="flex max-w-[170px] items-center gap-1.5 text-[12px] text-ink-3"><Avatar name={assignee} size={18} /><span className="truncate">{assignee}</span></span>}
      </div>
    </li>
  );
}

/** Open tasks about a sale, client or expense, with a one-click way to add another. */
export async function LinkedTasks({ me, type, id }: { me: CurrentUser; type: "booking" | "client" | "expense"; id: string }) {
  const t = await getT();
  const rows = (await listTasks(me, { view: "team", link: { type, id } }));
  return (
    <Card>
      <CardHead title={t("Tasks")} hint={rows.length ? t("{n} open", { n: rows.length }) : t("Follow-ups for this record")}
        action={<Link href={`/adminwork/tasks?link=${type}:${id}`} className="inline-flex items-center gap-1 text-[13px] underline decoration-gold decoration-2 underline-offset-4"><Plus className="size-3.5" />{t("Add task")}</Link>} />
      {rows.length > 0 && <ul className="-mx-3 -mb-2">{rows.map((r) => <TaskRow key={r.t.id} task={r.t} assignee={r.assignee} creator={r.creator} me={me} showAssignee />)}</ul>}
    </Card>
  );
}

