import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { sar } from "@/lib/money";
import { ORDER_STAGE, PAY_STATUS } from "@/lib/labels";
import { pageOrders, PAGE_SIZE } from "@/lib/app/desk/adapters";
import { slaFor } from "@/lib/app/desk/sla";
import { Card, Empty, Money, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { StatusBadge } from "@/components/desk/parts";
import { AutoRefresh, SlaClock } from "@/components/desk/live";
import { ListFilter, Pager, SummaryStrip, listHref, pageParam } from "@/components/desk/list";

export const metadata = { title: "Orders · Desk" };
const TABS = ["open", "awaiting", "held", "needs_answer", "price_changed", "failed", "issued", "not_issued", "all"] as const;
const LABEL: Record<string, string> = { open: "Open", awaiting: "To confirm", held: "To issue", needs_answer: "Waiting on traveller", price_changed: "New price sent", failed: "Ticketing failed", issued: "Issued", not_issued: "Not issued", all: "All" };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePerm("desk.view");
  const t = await getT();
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.s ?? "") ? (sp.s as (typeof TABS)[number]) : "open";
  const { page, offset } = pageParam(sp, PAGE_SIZE);
  const data = await pageOrders({ tab, q: sp.q, offset });
  const href = listHref("/adminwork/desk/orders", { s: sp.s, q: sp.q });
  return (
    <>
      <AutoRefresh every={20} />
      <PageHeader eyebrow={t("App bookings")} title={t("Orders")} subtitle={t("Bookings from the app. Confirm and hold within 4 minutes, then issue: the card is only captured when tickets are issued.")} />
      <Tabs active={tab} items={TABS.map((s) => ({ key: s, label: t(LABEL[s]!), href: href({ s: s === "open" ? undefined : s, page: undefined }), count: s === "all" ? undefined : data.counts[s] ?? 0 }))} />
      <Card pad={false}>
        <ListFilter action="/adminwork/desk/orders" q={sp.q} keep={{ s: sp.s }} placeholder={t("Ref, PNR, traveller, phone, trip…")} clear={sp.q ? href({ q: undefined, page: undefined }) : null} />
        <SummaryStrip>
          <span>{t("{n} orders", { n: data.total })}</span>
          <span>{t("Value")} <span className="num text-ink" dir="ltr">{sar(data.value)}</span></span>
          {tab !== "open" && <span>{t("Open")} <span className="num text-ink">{data.counts.open ?? 0}</span></span>}
        </SummaryStrip>
        {data.rows.length === 0 ? <Empty icon={<ShoppingBag className="size-5" />} title={sp.q ? t("No orders match") : t("No orders here")} hint={sp.q ? t("Try a different filter or search.") : t("Orders from the app appear the moment a traveller slides to book.")} /> : (
          <Table>
            <thead><tr><Th>{t("Order")}</Th><Th>{t("Traveller")}</Th><Th>{t("Status")}</Th><Th>{t("Card")}</Th><Th>PNR</Th><Th>{t("Promise")}</Th><Th align="end">{t("Total")}</Th></tr></thead>
            <tbody>
              {data.rows.map((o) => {
                const sla = o.stage === "awaiting" ? slaFor("order", o.desk.question?.answeredAt ? new Date(o.desk.question.answeredAt) : o.createdAt)
                  : o.stage === "held" ? slaFor("ticketing", o.desk.heldAt ? new Date(o.desk.heldAt) : o.updatedAt) : null;
                const pnr = o.desk.pnr ?? o.desk.heldPnr ?? null;
                return (
                  <tr key={o.id} className="group transition hover:bg-surface-2">
                    <Td><Link href={`/adminwork/desk/orders/${o.id}`} className="block">
                      <span className="block max-w-[340px] truncate text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{o.summary}</span>
                      <span className="block text-[12px] text-ink-3"><span className="num">{o.ref}</span> · {timeAgo(o.createdAt, t.locale)}</span></Link></Td>
                    <Td className="whitespace-nowrap"><bdi className="block text-ink">{o.userName}</bdi>{o.phone && <span className="num block text-[12px] text-ink-3" dir="ltr">{o.phone}</span>}</Td>
                    <Td><StatusBadge map={ORDER_STAGE} value={o.stage} /></Td>
                    <Td className="whitespace-nowrap">{o.payment ? <StatusBadge map={PAY_STATUS} value={o.payment.status} /> : <span className="text-ink-4">—</span>}</Td>
                    <Td><span className="num tracking-wider" dir="ltr">{pnr ?? "—"}</span></Td>
                    <Td className="whitespace-nowrap">{sla ? <SlaClock due={sla.dueAt.toISOString()} opened={sla.openedAt.toISOString()} /> : <span className="text-[12.5px] text-ink-3">{fmtDate(o.updatedAt, t.locale, true)}</span>}</Td>
                    <Td align="end"><Money v={o.total} /></Td>
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
