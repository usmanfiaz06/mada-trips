import Link from "next/link";
import { ChartLine, RefreshCw } from "lucide-react";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { APP_PRODUCT, COST_BASIS } from "@/lib/labels";
import { requireDeskFinance } from "@/lib/app/finance/access";
import { PRODUCTS } from "@/lib/app/finance/costs";
import { costLines, marginBps, periodOf, revenueReport } from "@/lib/app/finance/revenue";
import { appSalesInSettlement } from "@/lib/app/finance/ops-posting";
import { Badge, Card, CardHead, Empty, InkCard, Input, Money, Notice, PageHeader, Select, Table, Tabs, Td, Th, cx } from "@/components/ui";
import { DotColumns, SplitBar } from "@/components/charts";
import { ActionForm, SubmitButton } from "@/components/client";
import { Pager, SummaryStrip, listHref, pageParam } from "@/components/desk/list";
import { CustomerLink } from "@/components/desk/customer-link";
import { refreshFinanceAction, setLineCostAction } from "../finance-actions";

export const metadata = { title: "App revenue & margin · Desk" };

/*
 * App revenue and margin (DESK-PLAN U6, screen 8): what the app captured, its VAT, what the suppliers charge us and
 * what is left, by product and by day or month, then the lines behind any number. Every figure is a sum of
 * app_order_costs lines (lib/app/finance/revenue.ts); finance types a cost where the supplier gave none.
 */

const COLORS: Record<string, string> = { flight: "var(--chart-1)", stay: "var(--chart-2)", esim: "var(--info)", transfer: "var(--warn)", activity: "var(--ok)", request: "var(--gold)", other: "var(--ink-4)" };
const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireDeskFinance();
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const p = periodOf(sp);
  const product = sp.product && (PRODUCTS as string[]).includes(sp.product) ? sp.product : undefined;
  const drill = !!(sp.bucket || sp.missing || sp.lines);
  const { page, offset } = pageParam(sp, 50);
  const [r, lines] = await Promise.all([revenueReport(p, { product }), drill ? costLines(p, { product, bucket: sp.bucket, missing: !!sp.missing, q: sp.q, offset }) : null]);
  const keep = { from: sp.from, to: sp.to, by: sp.by, product: sp.product };
  const href = listHref("/adminwork/desk/finance", { ...keep, bucket: sp.bucket, missing: sp.missing, lines: sp.lines, q: sp.q, page: sp.page });
  const base = listHref("/adminwork/desk/finance", keep);
  const days = [...new Set(r.rows.map((x) => x.bucket))].sort().slice(-14);
  const perDay = days.map((d) => ({ label: p.by === "month" ? d : fmtDate(d, "en").split(" ").slice(0, 2).join(" "), value: r.rows.filter((x) => x.bucket === d).reduce((a, x) => a + Math.max(0, x.margin), 0) }));
  const unit = Math.max(10_000, ...perDay.map((x) => x.value)) / 10;
  return (
    <>
      <PageHeader eyebrow={t("App finance")} title={t("App revenue & margin")}
        subtitle={t("What the app captured, less VAT and what the suppliers charge us. Each number is the sum of the order lines behind it.")}
        actions={<ActionForm action={refreshFinanceAction}><SubmitButton variant="outline" size="sm"><RefreshCw className="size-4" />{t("Update now")}</SubmitButton></ActionForm>} />
      <Tabs active="revenue" items={[{ key: "revenue", label: t("Revenue & margin"), href: "/adminwork/desk/finance" }, { key: "vat", label: t("VAT"), href: "/adminwork/desk/finance/vat" }]} />

      <div className="grid gap-4 lg:grid-cols-12 stagger">
        <InkCard className="lg:col-span-8">
          <div className="night-grid pointer-events-none absolute inset-0 opacity-50" />
          <div className="relative">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <h2 className="text-[20px] font-[420] tracking-[-0.02em]">{product ? t(APP_PRODUCT[product]!) : t("All app sales")}</h2>
                <p className="mt-1 text-[12.5px] text-tile-ink-3">{fmtDate(p.from, L)} → {fmtDate(p.to, L)}</p>
              </div>
              <div className="flex flex-wrap gap-8">
                {[
                  [t("Taken in the app"), <Money key="g" v={r.total.gross} compact muted />],
                  [t("Margin"), <Money key="m" v={r.total.margin} compact muted />],
                  [t("Margin %"), <span key="p" className="num" dir="ltr">{pct(marginBps(r.total))}</span>],
                  [t("Refunded"), <Money key="r" v={r.refunds.amount} compact muted />],
                ].map(([k, v], i) => (
                  <div key={i}><div className="text-[12px] text-tile-ink-3">{k}</div><div className="figure mt-1.5 text-[30px]">{v}</div></div>
                ))}
              </div>
            </div>
            <div className="mt-8">
              {perDay.length ? <DotColumns ink rows={10} unit={unit * 10} data={perDay.map((x) => ({ ...x, display: `${t("Margin")} SAR ${sar(x.value)}` }))} /> : <p className="text-[13px] text-tile-ink-3">{t("No app sales in this period")}</p>}
            </div>
          </div>
        </InkCard>
        <Card className="flex flex-col lg:col-span-4">
          <CardHead title={t("By product")} hint={t("Revenue before VAT")} />
          <SplitBar parts={PRODUCTS.filter((k) => r.products[k].net > 0).map((k) => ({ label: t(APP_PRODUCT[k]!), value: r.products[k].net, color: COLORS[k]!, display: `${sar(r.products[k].net, { compact: true })} · ${pct(marginBps(r.products[k]))}` }))} />
          <p className="mt-auto pt-5 text-[11.5px] text-ink-3">{appSalesInSettlement() ? t("App sales count in the Day-25 partner settlement.") : t("App sales post to Ops as channel App. They stay out of the partner settlement until the owner says yes.")}</p>
        </Card>
      </div>

      {r.total.missing > 0 && (
        <div className="mt-4"><Notice tone="warn" title={t("{n} lines have no supplier cost yet", { n: r.total.missing })}>
          {t("Their margin shows as everything sold. Type what the supplier charged.")} <Link href={base({ missing: "1" })} className="underline underline-offset-2">{t("Show them")}</Link>
        </Notice></div>
      )}

      <Card pad={false} className="mt-4">
        <form className="flex flex-wrap items-end gap-2 p-4" action="/adminwork/desk/finance">
          <label className="text-[12px] text-ink-3">{t("From")}<Input type="date" name="from" defaultValue={p.from} className="mt-1" /></label>
          <label className="text-[12px] text-ink-3">{t("To")}<Input type="date" name="to" defaultValue={p.to} className="mt-1" /></label>
          <label className="text-[12px] text-ink-3">{t("By")}<Select name="by" defaultValue={p.by} options={[{ value: "day", label: t("Day") }, { value: "month", label: t("Month") }]} className="mt-1" /></label>
          <label className="text-[12px] text-ink-3">{t("Product")}<Select name="product" defaultValue={product ?? ""} options={[{ value: "", label: t("All") }, ...PRODUCTS.map((k) => ({ value: k, label: t(APP_PRODUCT[k]!) }))]} className="mt-1" /></label>
          <button className="h-[42px] rounded-full bg-ink px-5 text-[13.5px] text-bg">{t("Filter")}</button>
        </form>
        <SummaryStrip>
          <span>{t("Gross")} <span className="num text-ink" dir="ltr">{sar(r.total.gross)}</span></span>
          <span>{t("VAT")} <span className="num text-ink" dir="ltr">{sar(r.total.vat)}</span></span>
          <span>{t("Supplier cost")} <span className="num text-ink" dir="ltr">{sar(r.total.cost)}</span></span>
          <span>{t("Margin")} <span className="num text-ink" dir="ltr">{sar(r.total.margin)}</span></span>
          <span>{t("{n} lines", { n: r.total.lines })}</span>
        </SummaryStrip>
        {r.rows.length === 0 ? <Empty icon={<ChartLine className="size-5" />} title={t("No app sales in this period")} hint={t("Captured payments show here within five minutes.")} /> : (
          <Table>
            <thead><tr><Th>{p.by === "month" ? t("Month") : t("Day")}</Th><Th>{t("Product")}</Th><Th align="end">{t("Gross")}</Th><Th align="end">{t("VAT")}</Th><Th align="end">{t("Net")}</Th><Th align="end">{t("Supplier cost")}</Th><Th align="end">{t("Margin")}</Th><Th align="end">{t("Margin %")}</Th></tr></thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={`${x.bucket}:${x.product}`} className={cx("group transition hover:bg-surface-2", sp.bucket === x.bucket && (sp.product ?? x.product) === x.product && "bg-gold-soft/40")}>
                  <Td><Link href={base({ bucket: x.bucket, product: x.product })} className="num text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4" dir="ltr">{p.by === "month" ? x.bucket : fmtDate(x.bucket, L)}</Link></Td>
                  <Td>{t(APP_PRODUCT[x.product] ?? "Other")}{x.missing > 0 && <Badge tone="bad" className="ms-2">{t("{n} without cost", { n: x.missing })}</Badge>}</Td>
                  <Td align="end"><Money v={x.gross} /></Td><Td align="end"><Money v={x.vat} /></Td><Td align="end"><Money v={x.net} /></Td><Td align="end"><Money v={x.cost} /></Td>
                  <Td align="end"><Money v={x.margin} className={x.margin < 0 ? "text-bad" : undefined} /></Td>
                  <Td align="end"><span className="num" dir="ltr">{pct(marginBps(x))}</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {lines && (
        <Card pad={false} className="mt-4" id="lines">
          <div className="flex flex-wrap items-center justify-between gap-2 p-6 pb-2">
            <CardHead className="mb-0" title={t("Order lines")} hint={[sp.bucket, product ? t(APP_PRODUCT[product]!) : null, sp.missing ? t("No cost yet") : null].filter(Boolean).join(" · ")} />
            <Link href={base()} className="text-[13px] text-ink-3 hover:text-ink">{t("Close")}</Link>
          </div>
          <SummaryStrip><span>{t("{n} lines", { n: lines.total })}</span></SummaryStrip>
          {lines.rows.length === 0 ? <Empty title={t("Nothing here")} /> : (
            <Table>
              <thead><tr><Th>{t("Line")}</Th><Th>{t("Traveller")}</Th><Th>{t("Supplier")}</Th><Th align="end">{t("Sold")}</Th><Th align="end">{t("Cost")}</Th><Th align="end">{t("Margin")}</Th><Th>{t("Cost from")}</Th></tr></thead>
              <tbody>
                {lines.rows.map((l) => (
                  <tr key={l.id} className="align-top">
                    <Td><span className="block max-w-[260px] truncate text-ink">{l.label}</span><span className="block text-[12px] text-ink-3">{l.requestId ? <Link href={`/adminwork/desk/orders/${l.requestId}`} className="num hover:text-ink">{l.ref ?? "—"}</Link> : <span className="num">{l.ref ?? "—"}</span>} · {fmtDate(l.businessDate, L)}</span></Td>
                    <Td className="whitespace-nowrap"><CustomerLink id={l.ownerId}>{l.owner}</CustomerLink></Td>
                    <Td className="whitespace-nowrap text-[12.5px]">{l.supplier ?? "—"}{l.supplierRef ? <span className="block text-ink-3 num">{l.supplierRef}</span> : null}</Td>
                    <Td align="end"><Money v={l.sell} />{l.vat > 0 && <span className="block text-[11.5px] text-ink-3">{t("VAT")} {sar(l.vat)}</span>}</Td>
                    <Td align="end"><Money v={l.netSar} />{l.currency !== "SAR" && <span className="block text-[11.5px] text-ink-3 num" dir="ltr">{l.netAmount} {l.currency} @ {Number(l.fxRate).toFixed(4)}</span>}</Td>
                    <Td align="end"><Money v={l.margin} className={l.margin < 0 ? "text-bad" : undefined} /></Td>
                    <Td>
                      <Badge tone={COST_BASIS[l.basis]?.tone ?? "neutral"}>{t(COST_BASIS[l.basis]?.label ?? l.basis)}</Badge>
                      {(l.basis === "missing" || l.basis === "estimated") && (
                        <ActionForm action={setLineCostAction} className="mt-2 flex items-center gap-1.5">
                          <input type="hidden" name="id" value={l.id} />
                          <Input name="net" inputMode="decimal" required placeholder={t("Cost")} className="h-8 w-24 text-[12.5px] num" dir="ltr" />
                          <Input name="currency" defaultValue="SAR" maxLength={3} className="h-8 w-14 text-[12.5px] uppercase" dir="ltr" aria-label={t("Currency")} />
                          <SubmitButton variant="outline" size="sm">{t("Save")}</SubmitButton>
                        </ActionForm>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pager page={page} total={lines.total} size={50} href={href} />
        </Card>
      )}
    </>
  );
}
