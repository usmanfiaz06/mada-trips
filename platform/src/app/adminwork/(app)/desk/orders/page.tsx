import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { listOrders, type OrderStage } from "@/lib/app/desk/adapters";
import { slaFor } from "@/lib/app/desk/sla";
import { Card, Empty, Money, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { ORDER_STAGE, PAY_STATUS, StatusBadge } from "@/components/desk/parts";
import { AutoRefresh, SlaClock } from "@/components/desk/live";

export const metadata = { title: "Orders · Desk" };
const TABS = ["open", "awaiting", "held", "needs_answer", "price_changed", "issued", "not_issued", "all"] as const;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  await requirePerm("desk.view");
  const t = await getT();
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.s ?? "") ? (sp.s as (typeof TABS)[number]) : "open";
  const all = await listOrders({ stage: "all" });
  const open = all.filter((o) => ["awaiting", "held", "needs_answer", "price_changed"].includes(o.stage));
  const rows = tab === "all" ? all : tab === "open" ? open : all.filter((o) => o.stage === tab);
  const n = (s: OrderStage) => all.filter((o) => o.stage === s).length;
  const label: Record<string, string> = { open: "Open", awaiting: "To confirm", held: "To issue", needs_answer: "Waiting on traveller", price_changed: "New price sent", issued: "Issued", not_issued: "Not issued", all: "All" };
  return (
    <>
      <AutoRefresh every={20} />
      <PageHeader eyebrow={t("App desk")} title={t("Orders")} subtitle={t("Bookings from the app. Confirm and hold within 4 minutes, then issue: the card is only captured when tickets are issued.")} />
      <Tabs active={tab} items={TABS.map((s) => ({ key: s, label: t(label[s]!), href: `/adminwork/desk/orders?s=${s}`, count: s === "open" ? open.length : s === "all" ? undefined : n(s as OrderStage) }))} />
      <Card pad={false}>
        {rows.length === 0 ? <Empty icon={<ShoppingBag className="size-5" />} title={t("No orders here")} hint={t("Orders from the app appear the moment a traveller slides to book.")} /> : (
          <Table>
            <thead><tr><Th>{t("Order")}</Th><Th>{t("Traveller")}</Th><Th>{t("Status")}</Th><Th>{t("Card")}</Th><Th>{t("Promise")}</Th><Th align="end">{t("Total")}</Th></tr></thead>
            <tbody>
              {rows.map((o) => {
                const sla = o.stage === "awaiting" ? slaFor("order", o.desk.question?.answeredAt ? new Date(o.desk.question.answeredAt) : o.createdAt)
                  : o.stage === "held" ? slaFor("ticketing", o.desk.heldAt ? new Date(o.desk.heldAt) : o.updatedAt) : null;
                return (
                  <tr key={o.id} className="group hover:bg-surface-2">
                    <Td><Link href={`/adminwork/desk/orders/${o.id}`} className="block">
                      <span className="block text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{o.summary}</span>
                      <span className="block text-[12px] text-ink-3"><span className="num">{o.ref}</span> · {timeAgo(o.createdAt, t.locale)}</span></Link></Td>
                    <Td className="whitespace-nowrap">{o.userName}</Td>
                    <Td><StatusBadge map={ORDER_STAGE} value={o.stage} /></Td>
                    <Td className="whitespace-nowrap">{o.payment ? <StatusBadge map={PAY_STATUS} value={o.payment.status} /> : <span className="text-ink-4">—</span>}</Td>
                    <Td className="whitespace-nowrap">{sla ? <SlaClock due={sla.dueAt.toISOString()} opened={sla.openedAt.toISOString()} /> : <span className="text-[12.5px] text-ink-3">{fmtDate(o.updatedAt, t.locale, true)}</span>}</Td>
                    <Td align="end"><Money v={o.total} /></Td>
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
