import Link from "next/link";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ListChecks, X } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { riyadhDate, daysBetween } from "@/lib/dates";
import { TEAM } from "@/lib/labels";
import { canViewRecord } from "@/lib/access";
import { isUuid } from "@/lib/security";
import { assignableUsers, canManageAll, dueBucket, linkedRecord, listTasks, OPEN_STATUSES, workload } from "@/lib/tasks";
import { Avatar, Card, CardHead, Empty, PageHeader, Tabs, cx } from "@/components/ui";
import { TaskRow } from "@/components/tasks";
import { TaskForm } from "./task-form";
import { createTask } from "./actions";

export const metadata = { title: "Tasks" };

const GROUPS = [
  { key: "overdue", label: "Overdue", tone: "text-bad" },
  { key: "today", label: "Today", tone: "text-gold-2" },
  { key: "week", label: "Next 7 days", tone: "text-ink" },
  { key: "later", label: "Later", tone: "text-ink" },
  { key: "none", label: "No due date", tone: "text-ink-3" },
] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ tab?: string; who?: string; link?: string }> }) {
  const u = await requireUser();
  const t = await getT();
  const sp = await searchParams;
  const manager = canManageAll(u);
  const today = riyadhDate();
  const tabs = ["mine", "assigned", ...(manager ? ["team"] : []), "done"] as const;
  const view = (tabs as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as "mine" | "assigned" | "team" | "done") : "mine";
  const who = manager && isUuid(sp.who) ? sp.who : undefined;

  // Arriving from a sale, client or expense: the new task is tied to it.
  let link: { type: string; id: string; label: string } | null = null;
  const [lt, lid] = (sp.link ?? "").split(":");
  if (["booking", "client", "expense"].includes(lt) && isUuid(lid) && (await canViewRecord(u, lt, lid))) {
    const r = await linkedRecord(lt, lid);
    if (r) link = { type: lt, id: lid, label: r.label };
  }

  const [rows, people, board, counts] = await Promise.all([
    listTasks(u, { view, who }),
    assignableUsers(u),
    manager ? workload(today) : Promise.resolve([]),
    db.select({
      mine: sql<number>`count(*) FILTER (WHERE ${schema.tasks.assigneeId} = ${u.id})::int`,
      overdue: sql<number>`count(*) FILTER (WHERE ${schema.tasks.assigneeId} = ${u.id} AND ${schema.tasks.dueDate} < ${today})::int`,
      today: sql<number>`count(*) FILTER (WHERE ${schema.tasks.assigneeId} = ${u.id} AND ${schema.tasks.dueDate} = ${today})::int`,
      assigned: sql<number>`count(*) FILTER (WHERE ${schema.tasks.createdBy} = ${u.id} AND ${schema.tasks.assigneeId} <> ${u.id})::int`,
      team: sql<number>`count(*)::int`,
    }).from(schema.tasks).where(and(inArray(schema.tasks.status, [...OPEN_STATUSES]), manager ? undefined : sql`(${schema.tasks.assigneeId} = ${u.id} OR ${schema.tasks.createdBy} = ${u.id})`)).then((r) => r[0]),
  ]);
  const [doneWeek] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.tasks)
    .where(and(eq(schema.tasks.assigneeId, u.id), eq(schema.tasks.status, "done"), sql`${schema.tasks.completedAt} > now() - interval '7 days'`));
  const whoName = who ? people.find((p) => p.id === who)?.name ?? board.find((b) => b.id === who)?.name : null;

  const groups = view === "done" ? [] : GROUPS.map((g) => ({ ...g, items: rows.filter((r) => dueBucket(r.t, today) === g.key) })).filter((g) => g.items.length);
  const showAssignee = view !== "mine";
  const href = (tab: string, extra = "") => `/adminwork/tasks?tab=${tab}${extra}`;

  return (
    <>
      <PageHeader eyebrow={t("Workspace")} title={t("Tasks")}
        subtitle={manager ? t("Hand out work, see where it stands, and spot who needs help before things slip.") : t("Everything on your plate, soonest first. Tick things off as you go.")} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: t("Open for me"), v: counts.mine, tone: "" },
          { label: t("Overdue"), v: counts.overdue, tone: counts.overdue ? "text-bad" : "" },
          { label: t("Due today"), v: counts.today, tone: counts.today ? "text-gold-2" : "" },
          { label: t("Done this week"), v: doneWeek.n, tone: doneWeek.n ? "text-ok" : "" },
        ].map((s) => (
          <Card key={s.label} className="!py-4">
            <div className="text-[12.5px] text-ink-3">{s.label}</div>
            <div className={cx("figure mt-1 text-[32px] leading-none", s.tone)}>{s.v}</div>
          </Card>
        ))}
      </div>

      <div className={cx("grid gap-4", manager && "lg:grid-cols-[minmax(0,1fr)_360px]")}>
        <div className="min-w-0 space-y-4">
          <Card>
            <TaskForm action={createTask} people={people} meId={u.id} today={today} link={link} autoFocus={!!link} />
          </Card>

          <Tabs active={view} items={[
            { key: "mine", label: t("My tasks"), count: counts.mine, href: href("mine") },
            { key: "assigned", label: t("I assigned"), count: counts.assigned, href: href("assigned") },
            ...(manager ? [{ key: "team", label: t("Everyone"), count: counts.team, href: href("team") }] : []),
            { key: "done", label: t("Done"), href: href("done") },
          ]} />

          {whoName && (
            <div className="-mt-2 flex items-center gap-2 text-[13px] text-ink-2">
              {t("Showing tasks for {name}", { name: whoName })}
              <Link href={href(view)} className="grid size-6 place-items-center rounded-full text-ink-3 hover:bg-sunken" aria-label={t("Show everyone")}><X className="size-3.5" /></Link>
            </div>
          )}

          {rows.length === 0 ? (
            <Card><Empty icon={<ListChecks className="size-5" />}
              title={view === "mine" ? t("Nothing on your plate") : view === "assigned" ? t("Nothing you've handed out is still open") : view === "done" ? t("Nothing finished in the last 30 days") : t("No open tasks")}
              hint={view === "mine" ? t("New tasks for you show up here, soonest first.") : t("Add one above. It shows up for the person straight away.")} /></Card>
          ) : view === "done" ? (
            <Card pad={false} className="p-2"><ul>{rows.map((r) => <TaskRow key={r.t.id} task={r.t} assignee={r.assignee} creator={r.creator} me={u} showAssignee />)}</ul></Card>
          ) : (
            groups.map((g) => (
              <section key={g.key}>
                <h2 className={cx("mb-2 flex items-baseline gap-2 px-1 text-[15px] font-[500] tracking-[-0.01em]", g.tone)}>
                  {t(g.label)}<span className="num text-[12.5px] font-normal text-ink-3">{g.items.length}</span>
                </h2>
                <Card pad={false} className={cx("p-2", g.key === "overdue" && "ring-1 ring-bad/25")}>
                  <ul>{g.items.map((r) => <TaskRow key={r.t.id} task={r.t} assignee={r.assignee} creator={r.creator} me={u} showAssignee={showAssignee} />)}</ul>
                </Card>
              </section>
            ))
          )}
        </div>

        {manager && (
          <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
            <Card>
              <CardHead title={t("Who's behind")} hint={t("Open work per person. Late first.")} />
              {board.length === 0 ? <p className="text-[13px] text-ink-3">{t("No one has tasks yet.")}</p> : (
                <ul className="-mx-2 space-y-0.5">
                  {board.map((p) => {
                    const onTime = Math.max(0, p.open - p.overdue - p.today);
                    const lateBy = p.oldest ? daysBetween(p.oldest, today) : 0;
                    return (
                      <li key={p.id}>
                        <Link href={href("team", `&who=${p.id}`)} className={cx("block rounded-2xl px-2 py-2.5 transition hover:bg-surface-2", who === p.id && "bg-surface-2")}>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={p.name} size={30} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="truncate text-[13.5px] text-ink">{p.name}</span>
                                <span className="num shrink-0 text-[12px] text-ink-3">{t("{n} open", { n: p.open })}</span>
                              </div>
                              <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
                                {p.open > 0 && <>
                                  <span className="bg-bad" style={{ width: `${(p.overdue / p.open) * 100}%` }} />
                                  <span className="bg-gold" style={{ width: `${(p.today / p.open) * 100}%` }} />
                                  <span className="bg-ink-4" style={{ width: `${(onTime / p.open) * 100}%` }} />
                                </>}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-2.5 text-[11.5px] text-ink-3">
                                {p.overdue > 0 ? <span className="text-bad">{t("{n} late", { n: p.overdue })}{lateBy > 0 ? ` · ${t("oldest {n}d", { n: lateBy })}` : ""}</span> : <span className="text-ok">{t("On track")}</span>}
                                {p.today > 0 && <span className="text-gold-2">{t("{n} today", { n: p.today })}</span>}
                                {p.waiting > 0 && <span>{t("{n} waiting", { n: p.waiting })}</span>}
                                <span>{t("{n} done this week", { n: p.done7 })}</span>
                              </div>
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-3 text-[11.5px] text-ink-3">
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-bad" />{t("Late")}</span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-gold" />{t("Due today")}</span>
                <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-ink-4" />{t("Upcoming")}</span>
              </div>
            </Card>
            <p className="px-1 text-[12px] text-ink-3">{t("By team")}: {Object.entries(TEAM).map(([k, v]) => `${t(v)} ${board.filter((b) => b.team === k).reduce((s, b) => s + b.open, 0)}`).join(" · ")}</p>
          </aside>
        )}
      </div>
    </>
  );
}
