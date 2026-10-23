import type { ReactNode } from "react";
import { Landmark, TrendingUp, Handshake, Scale } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { periodReport, balanceSheet, monthlyTrend } from "@/lib/reports";
import { addDays, businessDate, cycleFor, fmtDate, riyadhDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { ACCOUNT } from "@/lib/labels";
import { Card, CardHead, Money, PageHeader, cx } from "@/components/ui";

export const metadata = { title: "Overview" };

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

  const [bs, { pl }, trend] = await Promise.all([balanceSheet(), periodReport(undefined, start, end), monthlyTrend(undefined, 6)]);

  const H = 116;
  const vals = trend.map((x) => x.profit);
  const up = Math.max(0, ...vals), down = Math.min(0, ...vals);
  const span = up - down || 1;
  const zero = (up / span) * H;
  const monthLabel = (ym: string) => new Intl.DateTimeFormat(L === "ar" ? "ar" : "en", { month: "short", timeZone: "UTC" }).format(new Date(`${ym}-15`));

  const presets: { label: string; href: string; on: boolean }[] = [
    { label: t("This cycle"), href: "/adminwork/reports?period=cycle", on: period === "cycle" && sp.c !== "prev" },
    { label: t("Last cycle"), href: "/adminwork/reports?period=cycle&c=prev", on: period === "cycle" && sp.c === "prev" },
    { label: t("This month"), href: `/adminwork/reports?period=month&m=${thisMonth}`, on: period === "month" && (sp.m ?? thisMonth) === thisMonth },
    { label: t("Last month"), href: `/adminwork/reports?period=month&m=${prevMonth}`, on: period === "month" && sp.m === prevMonth },
  ];

  // A stat tile: soft neutral icon, muted label, big number, one muted sub-line.
  const Stat = ({ icon, label, v, sub }: { icon: ReactNode; label: string; v: number; sub: string }) => (
    <Card className="flex flex-col">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-sunken text-ink-3">{icon}</span>
        <span className="text-[12.5px] font-medium text-ink-3">{label}</span>
      </div>
      <div className="figure mt-4 text-[27px] leading-none" dir="ltr">{sar(v).split(".")[0]}<span className="text-[0.46em] text-ink-4">.{sar(v).split(".")[1]} SAR</span></div>
      <div className="mt-2 text-[12px] text-ink-4">{sub}</div>
    </Card>
  );

  const Row = ({ label, v, strong }: { label: string; v: number; strong?: boolean }) => (
    <div className={cx("flex items-center justify-between", strong ? "mt-1 border-t border-line pt-3" : "border-b border-line/60 py-2")}>
      <span className={cx(strong ? "text-[14px] font-semibold text-ink" : "py-0.5 text-[13.5px] text-ink-2")}>{label}</span>
      <Money v={v} muted className={cx(strong ? "text-[14.5px] font-semibold" : "text-[13.5px] text-ink-2")} />
    </div>
  );

  const bankSub = bs.cash.map((a) => `${t(ACCOUNT[a.account] ?? a.account).split(" ")[0]} ${sar(a.balance, { compact: true })}`).join(" · ");

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t("Treasury")} title={t("Overview")} subtitle={t("Where the money is, and how the business is doing.")} />

      {/* Headline numbers */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Landmark className="size-[18px]" />} label={t("Cash in the bank")} v={bs.cashTotal} sub={bankSub || t("No accounts yet")} />
        <Stat icon={<TrendingUp className="size-[18px]" />} label={t("Profit this period")} v={pl.netProfit} sub={title} />
        <Stat icon={<Handshake className="size-[18px]" />} label={t("Owners' capital in")} v={bs.owedPartners} sub={t("Still to repay from profit")} />
        <Stat icon={<Scale className="size-[18px]" />} label={t("Overall position")} v={bs.netWorth} sub={t("If everything were settled today")} />
      </div>

      {/* Profit trend */}
      <Card>
        <CardHead title={t("Profit trend")} hint={t("Net profit · last 6 months")} />
        <div className="flex items-end gap-2 sm:gap-4" style={{ height: H + 34 }}>
          {trend.map((x) => {
            const h = Math.max(2, (Math.abs(x.profit) / span) * H);
            const pos = x.profit >= 0;
            return (
              <div key={x.ym} className="flex flex-1 flex-col items-center">
                <div className="relative w-full" style={{ height: H }}>
                  <div className="absolute inset-x-0 border-t border-dashed border-line-strong/70" style={{ top: zero }} />
                  <div className="absolute start-1/2 w-6 -translate-x-1/2 rounded-md sm:w-8" dir="ltr"
                    style={{ top: pos ? zero - h : zero, height: h, background: pos ? "var(--gold)" : "var(--bad)" }} />
                  <div className="absolute inset-x-0 text-center text-[10.5px] text-ink-4" style={{ top: pos ? Math.max(0, zero - h - 16) : zero + h + 2 }}>
                    {sar(x.profit, { compact: true })}
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-ink-3">{monthLabel(x.ym)}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Balance: what we have vs owe */}
        <Card>
          <CardHead title={t("Where the money stands")} hint={t("Right now")} />
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-4">{t("What we have")}</div>
          {bs.cash.map((a) => <Row key={a.account} label={`${t("Cash")} · ${t(ACCOUNT[a.account] ?? a.account)}`} v={a.balance} />)}
          <Row label={t("Clients still owe us")} v={bs.receivable} />
          <Row label={t("Total we have")} v={bs.assets} strong />
          <div className="mb-1 mt-6 text-[11px] font-semibold uppercase tracking-wide text-ink-4">{t("What we owe")}</div>
          <Row label={t("Suppliers & IATA to pay")} v={bs.owedSuppliers + bs.owedBsp} />
          <Row label={t("Owners' capital to repay")} v={bs.owedPartners} />
          <Row label={t("Total we owe")} v={bs.liabilities} strong />
          <Row label={t("Overall position")} v={bs.netWorth} strong />
        </Card>

        {/* Profit & loss for a period */}
        <Card>
          <CardHead title={t("Profit & loss")} hint={title} action={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {presets.map((p) => (
                <a key={p.href} href={p.href} className={cx("rounded-full px-3 py-1.5 text-[12px] font-medium transition", p.on ? "bg-ink text-bg" : "bg-surface-2 text-ink-3 hover:text-ink")}>{p.label}</a>
              ))}
            </div>
          } />
          <Row label={t("Revenue")} v={pl.revenue} />
          <Row label={t("Supplier cost")} v={-pl.directCost} />
          <Row label={t("Gross profit")} v={pl.grossProfit} strong />
          {pl.feesEarned - pl.feesLost !== 0 && <Row label={t("Cancellation fees (net)")} v={pl.feesEarned - pl.feesLost} />}
          {pl.commissions > 0 && <Row label={t("Team commission")} v={-pl.commissions} />}
          {pl.expensesTotal > 0 && <Row label={t("Expenses")} v={-pl.expensesTotal} />}
          <Row label={t("Net profit")} v={pl.netProfit} strong />
          {pl.startupCosts > 0 && <>
            <Row label={t("Startup / capital costs")} v={-pl.startupCosts} />
            <Row label={t("After startup costs")} v={pl.afterStartup} strong />
          </>}
          <form action="/adminwork/reports" method="get" className="mt-4 flex items-center gap-2">
            <input type="hidden" name="period" value="custom" />
            <input type="date" name="from" defaultValue={period === "custom" ? start : ""} className="field h-8 w-[140px] text-[12.5px]" dir="ltr" />
            <span className="text-ink-4">–</span>
            <input type="date" name="to" defaultValue={period === "custom" ? end : ""} className="field h-8 w-[140px] text-[12.5px]" dir="ltr" />
            <button className="rounded-full bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-ink-3 hover:text-ink">{t("Custom range")}</button>
          </form>
        </Card>
      </div>

      <p className="text-[12px] leading-relaxed text-ink-4">
        {t("“Owners' capital” is money the partners put in (startup costs and advances), repaid from profit over time. The overall position only turns positive once the business has earned it back — so a negative figure early on is normal.")}
      </p>
    </div>
  );
}
