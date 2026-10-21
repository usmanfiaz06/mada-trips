import Link from "next/link";
import { Receipt } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { REQUEST_KIND, REQUEST_STATUS } from "@/lib/labels";
import { pageRequests, PAGE_SIZE, REQUEST_TABS } from "@/lib/app/desk/adapters";
import { slaFor } from "@/lib/app/desk/sla";
import { Badge, Card, Empty, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { StatusBadge } from "@/components/desk/parts";
import { AutoRefresh, SlaClock } from "@/components/desk/live";
import { ListFilter, Pager, SummaryStrip, listHref, pageParam } from "@/components/desk/list";
import { CustomerLink } from "@/components/desk/customer-link";

export const metadata = { title: "Requests · Desk" };
const TABS = Object.keys(REQUEST_TABS);
const LABEL: Record<string, string> = { open: "Open", quote: "Needs a quote", quoted: "Quote sent", done: "Closed", all: "All" };

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePerm("desk.view");
  const t = await getT();
  const sp = await searchParams;
  const tab = TABS.includes(sp.s ?? "") ? sp.s! : "open";
  const kind = sp.kind && REQUEST_KIND[sp.kind] ? sp.kind : undefined;
  const { page, offset } = pageParam(sp, PAGE_SIZE);
  const data = await pageRequests({ tab, kind, q: sp.q, offset });
  const href = listHref("/adminwork/desk/requests", { s: sp.s, q: sp.q, kind });
  return (
    <>
      <AutoRefresh every={30} />
      <PageHeader eyebrow={t("App bookings")} title={t("Requests")} subtitle={t("Visas, Umrah, cars, tables and anything else travellers ask Mada to arrange. Quote within the promised time.")} />
      <Tabs active={tab} items={TABS.map((s) => ({ key: s, label: t(LABEL[s]!), href: href({ s: s === "open" ? undefined : s, page: undefined }), count: s === "all" ? undefined : data.counts[s] ?? 0 }))} />
      <Card pad={false}>
        <ListFilter action="/adminwork/desk/requests" q={sp.q} keep={{ s: sp.s }} placeholder={t("Ref, traveller, phone, what they asked…")} clear={sp.q || kind ? href({ q: undefined, kind: undefined, page: undefined }) : null}>
          <select name="kind" defaultValue={kind ?? ""} className="field w-auto" aria-label={t("Type")}>
            <option value="">{t("All types")}</option>
            {Object.entries(REQUEST_KIND).map(([k, l]) => <option key={k} value={k}>{t(l)}{data.kinds[k] ? ` · ${data.kinds[k]}` : ""}</option>)}
          </select>
        </ListFilter>
        <SummaryStrip>
          <span>{t("{n} requests", { n: data.total })}</span>
          <span>{t("Needs a quote")} <span className="num text-ink">{data.counts.quote ?? 0}</span></span>
          <span>{t("Quote sent")} <span className="num text-ink">{data.counts.quoted ?? 0}</span></span>
        </SummaryStrip>
        {data.rows.length === 0 ? <Empty icon={<Receipt className="size-5" />} title={sp.q || kind ? t("No requests match") : t("No requests here")} hint={sp.q || kind ? t("Try a different filter or search.") : t("Requests sent from the app land here with what the traveller asked for.")} /> : (
          <Table>
            <thead><tr><Th>{t("Request")}</Th><Th>{t("Type")}</Th><Th>{t("Traveller")}</Th><Th>{t("Status")}</Th><Th>{t("Promise")}</Th><Th>{t("Agent")}</Th></tr></thead>
            <tbody>
              {data.rows.map((r) => {
                const live = r.status === "sent" || r.status === "reviewing";
                const sla = live ? slaFor("request", r.createdAt, new Date(), { due: r.promisedBy }) : null;
                return (
                  <tr key={r.id} className="group transition hover:bg-surface-2">
                    <Td><Link href={`/adminwork/desk/requests/${r.id}`} className="block">
                      <span className="block max-w-[360px] truncate text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{r.summary}</span>
                      <span className="block text-[12px] text-ink-3"><span className="num">{r.ref}</span> · {timeAgo(r.createdAt, t.locale)}</span></Link></Td>
                    <Td className="whitespace-nowrap">{t(REQUEST_KIND[r.kind] ?? r.kind)}</Td>
                    <Td className="whitespace-nowrap"><CustomerLink id={r.ownerId}>{r.userName}</CustomerLink></Td>
                    <Td>{(r.details as { withdrawn?: boolean } | null)?.withdrawn ? <Badge tone="neutral" dot>{t("Withdrawn by the traveller")}</Badge> : <StatusBadge map={REQUEST_STATUS} value={r.status} />}</Td>
                    <Td className="whitespace-nowrap">{sla ? <SlaClock due={sla.dueAt.toISOString()} opened={sla.openedAt.toISOString()} /> : <span className="text-[12.5px] text-ink-3">{fmtDate(r.updatedAt, t.locale, true)}</span>}</Td>
                    <Td className="whitespace-nowrap">{r.agentName ?? <span className="text-ink-4">—</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pager page={page} total={data.total} size={PAGE_SIZE} href={href} />
      </Card>
    </>
  );
}
