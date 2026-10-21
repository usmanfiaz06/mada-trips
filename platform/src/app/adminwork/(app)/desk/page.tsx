import { CheckCircle2, Inbox, Plus } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { sar } from "@/lib/money";
import { agentForOps, loadRota } from "@/lib/app/desk/agents";
import type { InboxFilter } from "@/lib/app/desk/inbox";
import { deskQueue, ticketHref, ticketRef } from "@/lib/app/desk/tickets";
import { available, onShift } from "@/lib/app/desk/routing";
import { DESK_KINDS } from "@/lib/app/desk/sla";
import { Avatar, Card, Empty, LinkButton, PageHeader, Tabs, cx } from "@/components/ui";
import { InboxList, type InboxRow } from "@/components/desk/inbox-list";
import { KIND_META } from "@/components/desk/kinds";
import { AutoRefresh } from "@/components/desk/live";
import { ListFilter, Pager, SummaryStrip, listHref, pageParam } from "@/components/desk/list";
import { takeAction } from "./actions";

export const metadata = { title: "Desk" };

const FILTERS: InboxFilter[] = ["mine", "team", "unassigned", "escalated"];
const KINDS = [...DESK_KINDS, "manual"] as const;

export default async function DeskInbox({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const sp = await searchParams;
  const me = await agentForOps(u.id);
  const filter: InboxFilter = FILTERS.includes(sp.f as InboxFilter) ? (sp.f as InboxFilter) : me ? "mine" : "team";
  const kind = (KINDS as readonly string[]).includes(sp.k ?? "") ? sp.k! : "";
  const { page, offset, size } = pageParam(sp);
  // Every open item on the desk is a ticket (the queue syncs them first), so the filters, search and pages run in SQL.
  const [{ rows: tickets, total, counts }, rota] = await Promise.all([deskQueue({ filter, kind: kind || undefined, q: sp.q, me, limit: size, offset }), loadRota()]);
  const q = (sp.q ?? "").trim();
  const href = listHref("/adminwork/desk", { f: sp.f, k: kind || undefined, q: sp.q });
  const rows: InboxRow[] = tickets.map((x) => ({
    key: x.id, kind: x.kind, id: x.sourceId ?? x.id, title: x.subject, note: x.need, sub: [x.detail || null, !x.sourceId && x.customerName].filter(Boolean).join(" · "), href: x.href ?? ticketHref(x),
    due: x.dueAt.toISOString(), opened: x.slaStartedAt.toISOString(), agentName: x.ownerName, reason: x.ownerReason, tag: x.meta.tag ?? null, reach: x.meta.reach ?? null, link: x.meta.link ?? null,
    escalated: !!x.escalatedAt, escalationNote: x.escalationNote ?? (x.escalationLevel ? t("Past its promise") : null), amount: x.amount ? `SAR ${sar(x.amount)}` : null, mine: !!me && x.ownerAgentId === me.id,
    ticket: { id: x.id, ref: ticketRef(x.number), href: ticketHref(x), priority: x.priority, status: x.status },
  }));

  // Who is on now, and who they cover for: the line the night lead reads first.
  const onNow = rota.agents.filter((a) => onShift(a.id, rota.shifts, rota.now) && a.active);
  const covering = rota.shifts.filter((s) => s.coveringForId && s.startsAt <= rota.now && rota.now < s.endsAt);
  const nameOf = (id: string) => rota.agents.find((a) => a.id === id)?.displayName ?? "—";
  const tabHref = (f: string) => href({ f, page: undefined });

  return (
    <>
      <AutoRefresh every={20} />
      <PageHeader eyebrow={t("App desk · 24/7")} title={t("My queue")} subtitle={t("Everything travellers are waiting on, most urgent first. Orders are confirmed within 4 minutes, chats answered within 10.")}
        actions={<>
          <span className="hidden items-center gap-1.5 text-[12px] text-ink-4 lg:inline-flex"><kbd className="rounded border border-line-strong px-1 text-[10.5px]">?</kbd>{t("Shortcuts")}</span>
          {can(u, "desk.act") && <LinkButton href="/adminwork/desk/tickets/new" variant="outline"><Plus className="size-4" />{t("New ticket")}</LinkButton>}
        </>} />

      <Tabs active={filter} items={FILTERS.map((f) => ({ key: f, href: tabHref(f), count: f === "team" ? counts.all : counts[f],
        label: t(f === "mine" ? "Mine" : f === "team" ? "Whole team" : f === "unassigned" ? "Unassigned" : "Escalations") }))} />

      <Card pad={false} className="overflow-hidden">
        <ListFilter action="/adminwork/desk" q={sp.q} keep={{ f: sp.f }} placeholder={t("Traveller, ref, what they need…")} clear={sp.q || kind ? listHref("/adminwork/desk", { f: sp.f })() : null}>
          <select name="k" defaultValue={kind} className="field w-auto" aria-label={t("Type")}>
            <option value="">{t("Every kind")}</option>
            {KINDS.map((k) => <option key={k} value={k}>{t(KIND_META[k]!.label)}{counts.by[k] ? ` · ${counts.by[k]}` : ""}</option>)}
          </select>
        </ListFilter>
        <SummaryStrip>
          <span>{t("{n} waiting", { n: total })}</span>
          <span className={cx(counts.breached > 0 && "text-bad")}>{t("Late")} <span className="num">{counts.breached}</span></span>
          <span className={cx(counts.soon > 0 && "text-warn")}>{t("Due soon")} <span className="num">{counts.soon}</span></span>
          <span>{t("Unassigned")} <span className={cx("num", counts.unassigned ? "text-warn" : "text-ink")}>{counts.unassigned}</span></span>
          <span className="inline-flex min-w-0 items-center gap-2">
            {t("On the desk now")}
            {onNow.length === 0 ? <span className="text-warn">{t("Nobody is on shift. Travellers see “Replies within 10 minutes, any hour”.")}</span> : onNow.map((a) => {
              const cov = covering.filter((s) => s.agentId === a.id).map((s) => nameOf(s.coveringForId!));
              const up = available(a, rota.shifts, rota.now) && a.status === "online";
              return (
                <span key={a.id} className="inline-flex items-center gap-1.5 text-ink" title={`${cov.length ? t("Covering for {names}", { names: cov.join(", ") }) : t(a.status === "online" ? "Online" : a.status === "away" ? "Away" : "Signed off")} · ${a.languages.map((l) => l.toUpperCase()).join(" ")}`}>
                  <span className="relative"><Avatar name={a.displayName} size={20} /><span className={cx("absolute -bottom-0.5 -end-0.5 size-2 rounded-full ring-2 ring-surface-2", up ? "bg-ok" : a.status === "away" ? "bg-warn" : "bg-ink-4")} /></span>
                  {a.displayName}{me?.id === a.id ? ` · ${t("You")}` : ""}{cov.length ? <span className="text-ink-3">({t("Covering for {names}", { names: cov.join(", ") })})</span> : null}
                </span>
              );
            })}
          </span>
        </SummaryStrip>
        {rows.length === 0 ? (
          <Empty icon={filter === "mine" && !q && !kind ? <CheckCircle2 className="size-5" /> : <Inbox className="size-5" />}
            title={q || kind ? t("Nothing matches") : filter === "mine" ? t("Nothing waiting on you") : t("Nothing here")}
            hint={q || kind ? t("Try a different filter or search.") : filter === "mine" ? t("New work for your travellers lands here first.") : t("When travellers need the desk, it shows up here.")} />
        ) : <InboxList rows={rows} take={takeAction} myAgentId={me?.id ?? null} filterHref={Object.fromEntries(FILTERS.map((f) => [f, tabHref(f)]))} />}
        <Pager page={page} total={total} size={size} href={href} />
      </Card>
    </>
  );
}
