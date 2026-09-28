import Link from "next/link";
import { Plus, Search, ReceiptText } from "lucide-react";
import { requireUser, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { querySales } from "@/lib/sales-query";
import { BOOKING_STATUS, SERVICE } from "@/lib/labels";
import { fmtDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { Badge, Card, Empty, LinkButton, PageHeader, Table, Td, Th, Tabs, cx } from "@/components/ui";

export const metadata = { title: "Sales & bookings" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser();
  const t = await getT();
  const sp = await searchParams;
  const status = sp.status ?? "all";
  const page = Math.max(1, Number(sp.page ?? 1));
  const data = await querySales(u, { status, q: sp.q, channel: sp.channel, from: sp.from, to: sp.to, page });
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...o }).filter(([, v]) => v) as [string, string][]);
    return `/sales?${p}`;
  };
  const tabs = [
    { key: "all", label: t("All") }, { key: "pending_issue", label: t("Waiting to issue") }, { key: "awaiting_credit", label: t("Awaiting credit") },
    { key: "returned", label: t("Sent back") }, { key: "unpaid", label: t("Unpaid") }, { key: "issued", label: t("Issued") }, { key: "void", label: t("Void") },
  ];
  const pages = Math.ceil(data.total / 50);

  return (
    <>
      <PageHeader eyebrow={can(u, "sales.view_all") ? t("All teams") : t("Your team")} title={t("Sales & bookings")}
        subtitle={t("Every sale with its PNR, price, margin and payment. Search by reference, PNR, ticket, passenger or client.")}
        actions={can(u, "sales.create") && <LinkButton href="/sales/new" variant="primary"><Plus className="size-4" />{t("New sale")}</LinkButton>} />

      <Tabs active={status} items={tabs.map((x) => ({ ...x, href: qs({ status: x.key === "all" ? undefined : x.key, page: undefined }) }))} />

      <Card pad={false}>
        <form className="flex flex-wrap items-center gap-2 p-4" action="/sales">
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input name="q" defaultValue={sp.q} placeholder={t("Ref, PNR, ticket, passenger, client…")} className="field ps-10" />
          </div>
          <select name="channel" defaultValue={sp.channel ?? ""} className="field w-auto">
            <option value="">{t("All channels")}</option><option value="retail">{t("Retail")}</option><option value="corporate">{t("Corporate")}</option>
          </select>
          <input type="date" name="from" defaultValue={sp.from} className="field w-auto" aria-label={t("From")} />
          <input type="date" name="to" defaultValue={sp.to} className="field w-auto" aria-label={t("To")} />
          <button className="h-[42px] rounded-full bg-ink px-5 text-[13.5px] text-bg">{t("Filter")}</button>
          {(sp.q || sp.channel || sp.from || sp.to) && <Link href={qs({ q: undefined, channel: undefined, from: undefined, to: undefined, page: undefined })} className="px-2 text-[13px] text-ink-3 hover:text-ink">{t("Clear")}</Link>}
        </form>
        <div className="flex flex-wrap gap-8 border-y border-line bg-surface-2 px-6 py-3 text-[13px]">
          <span className="text-ink-3">{t("{n} sales", { n: data.total })}</span>
          <span className="text-ink-3">{t("Sold")} <span className="num text-ink" dir="ltr">{sar(data.sell)}</span></span>
          <span className="text-ink-3">{t("Margin")} <span className="num text-ink" dir="ltr">{sar(data.margin)}</span></span>
        </div>
        {data.rows.length === 0 ? (
          <Empty icon={<ReceiptText className="size-5" />} title={t("No sales match")} hint={t("Try a different filter or search.")} />
        ) : (
          <Table>
            <thead><tr>
              <Th>{t("Sale")}</Th><Th>{t("Client · passenger")}</Th><Th>{t("Service")}</Th><Th>PNR</Th>
              <Th align="end">{t("Sell")}</Th><Th align="end">{t("Margin")}</Th><Th>{t("Payment")}</Th><Th>{t("Status")}</Th>
            </tr></thead>
            <tbody>
              {data.rows.map((r) => {
                const margin = r.sell_price - r.net_cost;
                const st = BOOKING_STATUS[r.status];
                const fully = r.paid >= r.sell_price;
                return (
                  <tr key={r.id} className="group transition hover:bg-surface-2">
                    <Td><Link href={`/sales/${r.id}`} className="block"><span className="num whitespace-nowrap font-medium text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{r.ref}</span>
                      <span className="block text-[12px] text-ink-3">{fmtDate(r.business_date, t.locale)} · {r.preparer.split(" ")[0]}</span></Link></Td>
                    <Td><span className="block max-w-[220px] truncate text-ink">{r.client_name}</span><span className="block max-w-[220px] truncate text-[12px] text-ink-3">{r.passengers}</span></Td>
                    <Td><span className="block">{t(SERVICE[r.service_type])}</span><span className="block max-w-[160px] truncate text-[12px] text-ink-3">{r.description}</span></Td>
                    <Td><span className="num tracking-wider" dir="ltr">{r.pnr ?? "—"}</span></Td>
                    <Td align="end"><span className="num text-ink" dir="ltr">{sar(r.sell_price)}</span></Td>
                    <Td align="end"><span className={cx("num", margin < 0 ? "text-bad" : "text-ink-2")} dir="ltr">{sar(margin)}</span></Td>
                    <Td>{r.status === "void" ? <span className="text-ink-4">—</span> : fully ? <Badge tone="ok" dot>{t("Paid")}</Badge> : r.paid > 0 ? <Badge tone="warn" dot>{t("Part paid")}</Badge> : r.on_credit ? <Badge tone="info" dot>{t("On credit")}</Badge> : <Badge tone="bad" dot>{t("Unpaid")}</Badge>}</Td>
                    <Td><Badge tone={st.tone}>{t(st.label)}</Badge></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-6 py-3 text-[13px] text-ink-3">
            <span>{t("Page {p} of {n}", { p: page, n: pages })}</span>
            <div className="flex gap-2">
              {page > 1 && <LinkButton href={qs({ page: String(page - 1) })} variant="outline" size="sm">{t("Previous")}</LinkButton>}
              {page < pages && <LinkButton href={qs({ page: String(page + 1) })} variant="outline" size="sm">{t("Next")}</LinkButton>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
