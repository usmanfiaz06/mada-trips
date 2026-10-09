import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { periodReport } from "@/lib/reports";
import { addDays, businessDate, cycleFor, fmtDate, riyadhDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { ACCOUNT, EXPENSE_CATEGORY } from "@/lib/labels";
import { Card, CardHead, InkCard, Money, PageHeader, cx } from "@/components/ui";

export const metadata = { title: "Profit & reports" };

type SP = { period?: string; c?: string; m?: string; from?: string; to?: string };

const monthEnd = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePerm("finance.view");
  const t = await getT();
  const L = t.locale;
  const s = await getSettings();
  const sp = await searchParams;

  const today = businessDate(new Date(), s.closeHour);
  const thisCycle = cycleFor(today, s.cutoffDay);
  const prevCycle = cycleFor(addDays(thisCycle.start, -1), s.cutoffDay);
  const thisMonth = riyadhDate().slice(0, 7);
  const prevMonth = riyadhDate(new Date(Date.UTC(Number(thisMonth.slice(0, 4)), Number(thisMonth.slice(5, 7)) - 2, 15))).slice(0, 7);

  const period = sp.period === "month" || sp.period === "custom" ? sp.period : "cycle";
  let start: string, end: string, title: string;
  if (period === "month") {
    const m = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : thisMonth;
    start = `${m}-01`; end = monthEnd(m);
    title = new Intl.DateTimeFormat(L === "ar" ? "ar" : "en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-15`));
  } else if (period === "custom" && isDate(sp.from) && isDate(sp.to) && sp.from <= sp.to) {
    start = sp.from; end = sp.to;
    title = `${fmtDate(start, L)} – ${fmtDate(end, L)}`;
  } else {
    const base = sp.c === "prev" ? prevCycle : thisCycle;
    start = base.start; end = base.end;
    title = `${fmtDate(start, L)} – ${fmtDate(end, L)}`;
  }

  const r = await periodReport(undefined, start, end);
  const { pl, flow } = r;

  const presets: { label: string; href: string; on: boolean }[] = [
    { label: t("This cycle"), href: "/adminwork/reports?period=cycle", on: period === "cycle" && sp.c !== "prev" },
    { label: t("Last cycle"), href: "/adminwork/reports?period=cycle&c=prev", on: period === "cycle" && sp.c === "prev" },
    { label: t("This month"), href: `/adminwork/reports?period=month&m=${thisMonth}`, on: period === "month" && (sp.m ?? thisMonth) === thisMonth },
    { label: t("Last month"), href: `/adminwork/reports?period=month&m=${prevMonth}`, on: period === "month" && sp.m === prevMonth },
  ];

  const FLOW_IN: Record<string, string> = { receipts: t("Client receipts (cleared)"), deposits: t("Deposits"), transfersIn: t("Transfers in"), feesKept: t("Cancellation fees kept") };
  const FLOW_OUT: Record<string, string> = { supplier: t("Supplier payments"), bsp: t("IATA / BSP payments"), expenses: t("Expenses"), withdrawals: t("Withdrawals"), transfersOut: t("Transfers out"), supplierFees: t("Supplier cancellation fees"), payouts: t("Partner repayments & dividends") };

  const Row = ({ label, v, sign, strong, muted, indent }: { label: string; v: number; sign?: boolean; strong?: boolean; muted?: boolean; indent?: boolean }) => (
    <div className={cx("flex items-center justify-between py-2", strong && "border-t border-line mt-1 pt-3", !strong && "border-b border-line/60")}>
      <span className={cx(indent && "ps-4", strong ? "text-[14px] font-semibold" : "text-[13.5px]", muted ? "text-ink-3" : "text-ink-2")}>{label}</span>
      <Money v={v} sign={sign} className={cx(strong ? "text-[15px] font-semibold" : "text-[13.5px]", muted && "text-ink-3")} />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={t("Treasury")} title={t("Profit & reports")} subtitle={t("Profit and cash flow for a period. Refunded sales fall out of profit; cancellation fees show as their own line.")} />

      {/* Period picker */}
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((p) => (
          <a key={p.href} href={p.href} className={cx("rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition", p.on ? "border-ink bg-ink text-white" : "border-line text-ink-2 hover:border-ink/40")}>{p.label}</a>
        ))}
        <form action="/adminwork/reports" method="get" className="ms-auto flex items-center gap-2">
          <input type="hidden" name="period" value="custom" />
          <input type="date" name="from" defaultValue={period === "custom" ? start : ""} className="field h-9 w-[150px]" dir="ltr" />
          <span className="text-ink-4">–</span>
          <input type="date" name="to" defaultValue={period === "custom" ? end : ""} className="field h-9 w-[150px]" dir="ltr" />
          <button className="rounded-full border border-line px-3.5 py-1.5 text-[13px] font-medium text-ink-2 hover:border-ink/40">{t("Apply")}</button>
        </form>
      </div>

      {/* Headline tiles */}
      <div className="grid gap-4 sm:grid-cols-3">
        <InkCard>
          <div className="text-[12px] font-medium uppercase tracking-wide text-white/55">{t("Net profit")}</div>
          <div className="mt-2 figure text-[40px]" dir="ltr">{sar(pl.netProfit).split(".")[0]}<span className="text-[0.4em] opacity-50">.{sar(pl.netProfit).split(".")[1]} SAR</span></div>
          <div className="mt-1 text-[12.5px] text-white/50">{title}</div>
        </InkCard>
        <Card>
          <div className="text-[12px] font-medium uppercase tracking-wide text-ink-4">{t("Gross profit")}</div>
          <div className="mt-2"><Money v={pl.grossProfit} className="text-[28px] font-semibold" /></div>
          <div className="mt-1 text-[12.5px] text-ink-4">{t("{n} sales recognised", { n: pl.salesCount })}{pl.refundCount > 0 ? ` · ${t("{n} refunded", { n: pl.refundCount })}` : ""}</div>
        </Card>
        <Card>
          <div className="text-[12px] font-medium uppercase tracking-wide text-ink-4">{t("Net cash change")}</div>
          <div className="mt-2"><Money v={flow.net} sign className="text-[28px] font-semibold" /></div>
          <div className="mt-1 text-[12.5px] text-ink-4">{t("In {in} · out {out}", { in: sar(flow.totalIn, { compact: true }), out: sar(flow.totalOut, { compact: true }) })}</div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* P&L */}
        <Card>
          <CardHead title={t("Profit & loss")} hint={t("Recognised when a sale is fully paid and cleared")} />
          <Row label={t("Revenue")} v={pl.revenue} />
          <Row label={t("Direct cost (supplier)")} v={-pl.directCost} />
          <Row label={t("Gross profit")} v={pl.grossProfit} strong />
          {pl.feesEarned > 0 && <Row label={t("Cancellation fees kept")} v={pl.feesEarned} muted indent />}
          {pl.feesLost > 0 && <Row label={t("Cancellation fees lost")} v={-pl.feesLost} muted indent />}
          {pl.commissions > 0 && <Row label={t("Team commission")} v={-pl.commissions} muted indent />}
          {pl.expenses.map((e) => <Row key={e.category} label={t(EXPENSE_CATEGORY[e.category] ?? e.category)} v={-e.total} muted indent />)}
          {pl.expenses.length === 0 && pl.commissions === 0 && pl.feesEarned === 0 && pl.feesLost === 0 && (
            <div className="py-3 text-[13px] text-ink-4">{t("No fees, commission or expenses in this period.")}</div>
          )}
          <Row label={t("Net profit")} v={pl.netProfit} strong />
        </Card>

        {/* Money flow */}
        <Card>
          <CardHead title={t("Money flow")} hint={t("Cash that actually moved in this period")} />
          <div className="grid gap-x-8 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-emerald-700/80 dark:text-emerald-400/80">{t("Money in")}</div>
              {flow.in.length ? flow.in.map((x) => <Row key={x.key} label={FLOW_IN[x.key] ?? x.key} v={x.amount} />) : <div className="py-3 text-[13px] text-ink-4">{t("Nothing came in.")}</div>}
              <Row label={t("Total in")} v={flow.totalIn} strong />
            </div>
            <div>
              <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-rose-700/80 dark:text-rose-400/80">{t("Money out")}</div>
              {flow.out.length ? flow.out.map((x) => <Row key={x.key} label={FLOW_OUT[x.key] ?? x.key} v={x.amount} />) : <div className="py-3 text-[13px] text-ink-4">{t("Nothing went out.")}</div>}
              <Row label={t("Total out")} v={flow.totalOut} strong />
            </div>
          </div>
          {flow.byAccount.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-1 text-[12px] font-medium uppercase tracking-wide text-ink-4">{t("Net change by account")}</div>
              {flow.byAccount.map((a) => <Row key={a.account} label={t(ACCOUNT[a.account] ?? a.account)} v={a.net} sign />)}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
