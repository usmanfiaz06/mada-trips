import Link from "next/link";
import { LifeBuoy, Plus } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { timeAgo } from "@/lib/dates";
import { TICKET_PRIORITY, TICKET_STATUS } from "@/lib/labels";
import { agentForOps } from "@/lib/app/desk/agents";
import { TICKET_PRIORITIES, ticketSla } from "@/lib/app/desk/sla";
import { listTickets, syncTickets, ticketHref, ticketRef, TICKET_AGES, TICKET_TABS } from "@/lib/app/desk/tickets";
import { Card, Empty, LinkButton, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { StatusBadge } from "@/components/desk/parts";
import { KIND_META } from "@/components/desk/kinds";
import { AutoRefresh, SlaClock } from "@/components/desk/live";
import { ListFilter, Pager, SummaryStrip, listHref, pageParam } from "@/components/desk/list";

export const metadata = { title: "Tickets · Desk" };
const AGE_LABEL: Record<string, string> = { "1h": "Under an hour", "4h": "1 to 4 hours", "24h": "4 to 24 hours", older: "Over a day" };
const LABEL: Record<string, string> = { open: "Open", waiting: "Waiting", resolved: "Resolved", closed: "Closed", all: "All" };

export default async function TicketsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const sp = await searchParams;
  const [me] = await Promise.all([agentForOps(u.id), syncTickets().catch(() => null)]);
  const { page, offset, size } = pageParam(sp);
  // me, none, or one agent's id (from Agents & roles and Performance).
  const owner = sp.o === "me" || sp.o === "none" || /^[0-9a-f-]{36}$/i.test(sp.o ?? "") ? sp.o : undefined;
  // age: how long it has been open, from the desk overview's backlog (1h, 4h, 24h, older).
  const age = (TICKET_AGES as readonly string[]).includes(sp.age ?? "") ? sp.age : undefined;
  const data = await listTickets({ tab: sp.s, q: sp.q, priority: sp.p, owner, age, me, limit: size, offset });
  const href = listHref("/adminwork/desk/tickets", { s: sp.s, q: sp.q, p: sp.p, o: owner, age });
  const filtered = !!(sp.q || sp.p || owner || age);
  return (
    <>
      <AutoRefresh every={30} />
      <PageHeader eyebrow={t("Support")} title={t("Tickets")} subtitle={t("Every ticket on the desk, opened by the queue or by hand. The clock stops while a ticket waits on the customer or a supplier.")}
        actions={can(u, "desk.act") ? <LinkButton href="/adminwork/desk/tickets/new" variant="primary"><Plus className="size-4" />{t("New ticket")}</LinkButton> : null} />
      <Tabs active={data.tab} items={Object.keys(TICKET_TABS).map((s) => ({ key: s, label: t(LABEL[s]!), href: href({ s: s === "open" ? undefined : s, page: undefined }), count: data.counts[s] ?? 0 }))} />
      <Card pad={false}>
        <ListFilter action="/adminwork/desk/tickets" q={sp.q} keep={{ s: sp.s }} placeholder={t("T-000123, subject, traveller, category…")} clear={filtered ? href({ q: undefined, p: undefined, o: undefined, age: undefined, page: undefined }) : null}>
          <select name="p" defaultValue={sp.p ?? ""} className="field w-auto" aria-label={t("Priority")}>
            <option value="">{t("Any priority")}</option>
            {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{t(TICKET_PRIORITY[p]!.label)}</option>)}
          </select>
          <select name="o" defaultValue={owner ?? ""} className="field w-auto" aria-label={t("Owner")}>
            <option value="">{t("Anyone's")}</option>
            {me && <option value="me">{t("Mine")}</option>}
            <option value="none">{t("Unassigned")}</option>
          </select>
          <select name="age" defaultValue={age ?? ""} className="field w-auto" aria-label={t("Open for")}>
            <option value="">{t("Any age")}</option>
            {TICKET_AGES.map((a) => <option key={a} value={a}>{t(AGE_LABEL[a]!)}</option>)}
          </select>
        </ListFilter>
        <SummaryStrip>
          <span>{t("{n} tickets", { n: data.total })}</span>
          <span>{t("Open")} <span className="num text-ink">{data.counts.open ?? 0}</span></span>
          <span>{t("Waiting")} <span className="num text-ink">{data.counts.waiting ?? 0}</span></span>
        </SummaryStrip>
        {data.rows.length === 0 ? (
          <Empty icon={<LifeBuoy className="size-5" />} title={filtered ? t("No tickets match") : t("No tickets here")}
            hint={filtered ? t("Try a different filter or search.") : t("Tickets open by themselves when travellers need the desk, or from “Create ticket” on any order, request or chat.")} />
        ) : (
          <Table>
            <thead><tr><Th>{t("Ticket")}</Th><Th>{t("Traveller")}</Th><Th>{t("Status")}</Th><Th>{t("Priority")}</Th><Th>{t("Owner")}</Th><Th>{t("Promise")}</Th><Th align="end">{t("Last activity")}</Th></tr></thead>
            <tbody>
              {data.rows.map((x) => {
                const running = x.status === "new" || x.status === "open";
                const sla = ticketSla(x);
                return (
                  <tr key={x.id} className="group transition hover:bg-surface-2">
                    <Td><Link href={ticketHref(x)} className="block">
                      <span className="block max-w-[300px] truncate text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4"><bdi>{x.subject}</bdi></span>
                      <span className="block text-[12px] text-ink-3"><span className="num" dir="ltr">{ticketRef(x.number)}</span> · {t(KIND_META[x.kind]?.label ?? x.kind)}{x.category ? ` · ${x.category}` : ""}</span></Link></Td>
                    <Td className="whitespace-nowrap">{x.customerName ? <bdi className="text-ink">{x.customerName}</bdi> : <span className="text-ink-4">—</span>}</Td>
                    <Td><StatusBadge map={TICKET_STATUS} value={x.status} /></Td>
                    <Td><StatusBadge map={TICKET_PRIORITY} value={x.priority} /></Td>
                    <Td className="whitespace-nowrap">{x.ownerName ?? <span className="text-warn">{t("Shared queue")}</span>}</Td>
                    <Td className="whitespace-nowrap">{running ? <SlaClock due={sla.dueAt.toISOString()} opened={sla.openedAt.toISOString()} /> : x.pausedAt ? <span className="text-[12.5px] text-ink-3">{t("Clock paused")}</span> : <span className="text-ink-4">—</span>}</Td>
                    <Td align="end" className="whitespace-nowrap text-[12.5px] text-ink-3">{timeAgo(x.lastActivityAt, t.locale)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pager page={page} total={data.total} size={size} href={href} />
      </Card>
    </>
  );
}
