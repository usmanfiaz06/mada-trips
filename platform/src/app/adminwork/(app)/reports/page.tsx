import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { periodReport, balanceSheet } from "@/lib/reports";
import { addDays, businessDate, cycleFor, fmtDate, riyadhDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { ACCOUNT, EXPENSE_CATEGORY } from "@/lib/labels";
import { Card, CardHead, InkCard, Money, PageHeader, cx } from "@/components/ui";

export const metadata = { title: "Reports" };

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

  const [bs, { pl }] = await Promise.all([balanceSheet(), periodReport(undefined, start, end)]);

  const presets: { label: string; href: string; on: boolean }[] = [
    { label: t("This cycle"), href: "/adminwork/reports?period=cycle", on: period === "cycle" && sp.c !== "prev" },
    { label: t("Last cycle"), href: "/adminwork/reports?period=cycle&c=prev", on: period === "cycle" && sp.c === "prev" },
    { label: t("This month"), href: `/adminwork/reports?period=month&m=${thisMonth}`, on: period === "month" && (sp.m ?? thisMonth) === thisMonth },
    { label: t("Last month"), href: `/adminwork/reports?period=month&m=${prevMonth}`, on: period === "month" && sp.m === prevMonth },
  ];

  const Row = ({ label, v, sub, sign, strong, muted, indent }: { label: string; v: number; sub?: string; sign?: boolean; strong?: boolean; muted?: boolean; indent?: boolean }) => (
    <div className={cx("flex items-center justify-between py-2", strong ? "border-t border-line mt-1 pt-3" : "border-b border-line/60")}>
      <span className={cx(indent && "ps-4", strong ? "text-[14px] font-semibold" : "text-[13.5px]", muted ? "text-ink-3" : "text-ink-2")}>{label}{sub && <span className="ms-2 text-[12px] text-ink-4">{sub}</span>}</span>
      <Money v={v} sign={sign} className={cx(strong ? "text-[15px] font-semibold" : "text-[13.5px]", muted && "text-ink-3")} />
    </div>
  );

  return (
    <div className="space-y-10">
      <PageHeader eyebrow={t("Treasury")} title={t("Reports")} subtitle={t("Where the company stands today, and how it did over a chosen period.")} />

      {/* ───── Balance sheet: where we stand ───── */}
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-ink">{t("Where the company stands")} <span className="text-ink-4 font-normal">· {t("today")}</span></h2>

        <InkCard className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[12px] font-medium uppercase tracking-wide text-white/55">{t("Net worth")}</div>
            <div className="mt-2 figure text-[44px] leading-none" dir="ltr">{sar(bs.netWorth).split(".")[0]}<span className="text-[0.38em] opacity-50">.{sar(bs.netWorth).split(".")[1]} SAR</span></div>
          </div>
          <p className="max-w-sm text-[12.5px] leading-relaxed text-white/55">
            {bs.netWorth < 0
              ? t("If the company collected everything owed to it and paid off everyone — suppliers, IATA and the partners — it would still be short this much. That's normal while partner capital hasn't been earned back yet.")
              : t("If the company collected everything owed to it and paid off everyone — suppliers, IATA and the partners — this is what would be left over.")}
          </p>
        </InkCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHead title={t("What we have")} hint={t("Cash and money owed to us")} />
            {bs.cash.map((a) => <Row key={a.account} label={`${t("Cash")} · ${t(ACCOUNT[a.account] ?? a.account)}`} v={a.balance} />)}
            <Row label={t("Money clients still owe us")} v={bs.receivable} />
            <Row label={t("Total we have")} v={bs.assets} strong />
          </Card>
          <Card>
            <CardHead title={t("What we owe")} hint={t("Money going out to others")} />
            <Row label={t("Suppliers (not yet paid)")} v={bs.owedSuppliers} />
            <Row label={t("IATA / BSP (coming up)")} v={bs.owedBsp} />
            <Row label={t("Partners (their capital)")} v={bs.owedPartners} />
            <Row label={t("Total we owe")} v={bs.liabilities} strong />
          </Card>
        </div>
        <p className="text-[12px] leading-relaxed text-ink-4">
          {t("“Partners (their capital)” is money the owners put in — startup costs and advances — which the company repays from profit over time. It's counted as owed back, so net worth only turns positive once the business has earned back what the owners invested.")}
        </p>
      </section>

      {/* ───── Profit & loss: how we did over a period ───── */}
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-ink">{t("How we did")} <span className="text-ink-4 font-normal">· {title}</span></h2>

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

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
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
            {pl.startupCosts > 0 && <>
              <Row label={t("Startup / capital costs")} v={-pl.startupCosts} muted indent />
              <Row label={t("After startup costs")} v={pl.afterStartup} strong />
              <p className="mt-3 text-[12px] leading-relaxed text-ink-4">
                {t("Startup / capital costs are one-time investments partners paid in (registration, licences, lease, furnishing). They sit outside operating profit and are tracked on the Partners page as money owed back, repaid from profit over time.")}
              </p>
            </>}
          </Card>

          <div className="space-y-4">
            <InkCard>
              <div className="text-[12px] font-medium uppercase tracking-wide text-white/55">{t("Net profit")}</div>
              <div className="mt-2 figure text-[34px] leading-none" dir="ltr">{sar(pl.netProfit).split(".")[0]}<span className="text-[0.4em] opacity-50">.{sar(pl.netProfit).split(".")[1]} SAR</span></div>
              <div className="mt-2 text-[12.5px] text-white/50">{title}</div>
            </InkCard>
            <Card>
              <div className="text-[12px] font-medium uppercase tracking-wide text-ink-4">{t("Gross profit")}</div>
              <div className="mt-2"><Money v={pl.grossProfit} className="text-[24px] font-semibold" /></div>
              <div className="mt-1 text-[12.5px] text-ink-4">{t("{n} sales recognised", { n: pl.salesCount })}{pl.refundCount > 0 ? ` · ${t("{n} refunded", { n: pl.refundCount })}` : ""}</div>
            </Card>
          </div>
        </div>
      </section>
    </div>
  );
}
