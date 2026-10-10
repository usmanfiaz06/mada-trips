import Link from "next/link";
import { Receipt } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { listRequests } from "@/lib/app/desk/adapters";
import { slaFor } from "@/lib/app/desk/sla";
import { Card, Empty, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { REQUEST_STATUS, StatusBadge } from "@/components/desk/parts";
import { AutoRefresh, SlaClock } from "@/components/desk/live";

export const metadata = { title: "Requests · Desk" };
const KIND: Record<string, string> = { visa: "Visa", umrah: "Umrah", car: "Car", restaurant: "Restaurant", activity: "Things to do", change: "Change", cancel: "Cancel", refund: "Refund", general: "General" };
const TABS = ["open", "quote", "quoted", "done", "all"] as const;

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await requirePerm("desk.view");
  const t = await getT();
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.s ?? "") ? (sp.s as (typeof TABS)[number]) : "open";
  const all = await listRequests();
  const OPEN = ["sent", "reviewing", "needs_answer", "quoted", "awaiting_payment", "with_agent"];
  const pick = (s: string) => s === "open" ? all.filter((r) => OPEN.includes(r.status)) : s === "quote" ? all.filter((r) => ["sent", "reviewing"].includes(r.status))
    : s === "quoted" ? all.filter((r) => ["quoted", "awaiting_payment"].includes(r.status)) : s === "done" ? all.filter((r) => ["done", "confirmed", "cancelled"].includes(r.status)) : all;
  const rows = pick(tab);
  const label: Record<string, string> = { open: "Open", quote: "Needs a quote", quoted: "Quote sent", done: "Closed", all: "All" };
  return (
    <>
      <AutoRefresh every={30} />
      <PageHeader eyebrow={t("App desk")} title={t("Requests")} subtitle={t("Visas, Umrah, cars, tables and anything else travellers ask Mada to arrange. Quote within the promised time.")} />
      <Tabs active={tab} items={TABS.map((s) => ({ key: s, label: t(label[s]!), href: `/adminwork/desk/requests?s=${s}`, count: s === "all" ? undefined : pick(s).length }))} />
      <Card pad={false}>
        {rows.length === 0 ? <Empty icon={<Receipt className="size-5" />} title={t("No requests here")} hint={t("Requests sent from the app land here with what the traveller asked for.")} /> : (
          <Table>
            <thead><tr><Th>{t("Request")}</Th><Th>{t("Type")}</Th><Th>{t("Traveller")}</Th><Th>{t("Status")}</Th><Th>{t("Promise")}</Th><Th>{t("Agent")}</Th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const live = r.status === "sent" || r.status === "reviewing";
                const sla = live ? slaFor("request", r.createdAt, new Date(), { due: r.promisedBy }) : null;
                return (
                  <tr key={r.id} className="group hover:bg-surface-2">
                    <Td><Link href={`/adminwork/desk/requests/${r.id}`} className="block">
                      <span className="block text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{r.summary}</span>
                      <span className="block text-[12px] text-ink-3"><span className="num">{r.ref}</span> · {timeAgo(r.createdAt, t.locale)}</span></Link></Td>
                    <Td className="whitespace-nowrap">{t(KIND[r.kind] ?? r.kind)}</Td>
                    <Td className="whitespace-nowrap">{r.userName}</Td>
                    <Td><StatusBadge map={REQUEST_STATUS} value={r.status} /></Td>
                    <Td className="whitespace-nowrap">{sla ? <SlaClock due={sla.dueAt.toISOString()} opened={sla.openedAt.toISOString()} /> : <span className="text-[12.5px] text-ink-3">{fmtDate(r.updatedAt, t.locale, true)}</span>}</Td>
                    <Td className="whitespace-nowrap">{r.agentName ?? <span className="text-ink-4">—</span>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
