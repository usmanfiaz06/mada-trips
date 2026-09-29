import Link from "next/link";
import { desc } from "drizzle-orm";
import { ArrowUpRight, CalendarRange } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { computeSettlement, type SettlementFigures } from "@/lib/finance";
import { addDays, businessDate, cycleFor, daysBetween, fmtDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { Badge, Card, CardHead, Empty, InkCard, PageHeader, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { ArcGauge } from "@/components/charts";
import { prepareCycle } from "./actions";

export const metadata = { title: "Day-25 settlement" };
const STATUS = { draft: ["Draft", "neutral"], pending_approval: ["Waiting for signatures", "gold"], approved: ["Approved · pay partners", "info"], paid: ["Paid", "ok"] } as const;

export default async function SettlementList() {
  const u = await requirePerm("finance.view");
  const t = await getT();
  const L = t.locale;
  const s = await getSettings();
  const today = businessDate(new Date(), s.closeHour);
  const current = cycleFor(today, s.cutoffDay);
  const last = cycleFor(addDays(current.start, -1), s.cutoffDay);
  const cycles = await db.select().from(schema.settlementCycles).orderBy(desc(schema.settlementCycles.endDate));
  const lastPrepared = cycles.find((c) => c.endDate === last.end);
  const live = await db.transaction((tx) => computeSettlement(tx, current.start, current.end, {}, s.iataReserveHeld, s.repaymentPctBps, s.iataBuffer, undefined, true));
  const days = daysBetween(current.start, current.end) + 1;

  return (
    <>
      <PageHeader eyebrow={t("Monthly, on the 25th")} title={t("Day-25 settlement")}
        subtitle={t("Only funds cleared in the bank by the 25th count. Then: overheads, the IATA reserve, partner repayments by equity, and dividends by equity.")} />
      <div className="grid gap-4 lg:grid-cols-12">
        <InkCard className="lg:col-span-4">
          <div className="text-[13px] text-tile-ink-3">{t("Current cycle")}</div>
          <div className="mt-1 text-[18px]">{fmtDate(current.start, L)} → {fmtDate(current.end, L)}</div>
          <div className="mt-6"><ArcGauge value={daysBetween(current.start, today) + 1} max={days} ink>
            <div className="figure text-[60px]">{daysBetween(today, current.end)}</div><div className="text-[12px] text-tile-ink-3">{t("days to cut-off")}</div></ArcGauge></div>
        </InkCard>
        <Card className="lg:col-span-8">
          <CardHead title={t("If the cycle closed today")} hint={t("Live estimate from cleared funds so far")} />
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {[[t("Cleared in"), live.clearedByAccount.retail + live.clearedByAccount.corporate], [t("Gross profit"), live.grossProfit], [t("Overheads"), live.overheads], [t("Net profit"), live.netProfit]].map(([k, v]) => (
              <div key={k as string}><div className="text-[12.5px] text-ink-3">{k}</div><div className={cx("figure mt-3 text-[30px]", (v as number) < 0 && "text-bad")} dir="ltr">{sar(v as number, { compact: true })}</div></div>
            ))}
          </div>
          <div className="mt-6 border-t border-line pt-4 text-[13px] text-ink-3">{t("{n} bookings are fully paid and cleared so far. {v} SAR collected but not yet cleared would roll to the next cycle.", { n: live.bookingCount, v: sar(live.rolledOver) })}</div>
        </Card>
      </div>

      {!lastPrepared && can(u, "settlement.run") && today > last.end && (
        <Card className="mt-4 ring-2 ring-gold/40">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><div className="text-[17px] font-[450]">{t("Cycle ending {d} is ready to settle", { d: fmtDate(last.end, L) })}</div>
              <div className="mt-1 text-[13px] text-ink-3">{t("The cut-off has passed. Prepare it, check the numbers, then send it to all directors to sign.")}</div></div>
            <form action={prepareCycle}><input type="hidden" name="end" value={last.end} /><SubmitButton variant="gold" size="lg"><CalendarRange className="size-4" />{t("Prepare settlement")}</SubmitButton></form>
          </div>
        </Card>
      )}

      <h2 className="mb-3 mt-8 px-1 text-[17px] font-[450] tracking-[-0.02em]">{t("Settlements")}</h2>
      {cycles.length === 0 ? <Card><Empty icon={<CalendarRange className="size-5" />} title={t("No settlements yet")} hint={t("The first one appears after the first 25th.")} /></Card> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cycles.map((c) => {
            const f = c.figures as SettlementFigures;
            const [label, tone] = STATUS[c.status as keyof typeof STATUS];
            return (
              <Link key={c.id} href={`/adminwork/settlement/${c.id}`} className="group">
                <Card className="transition group-hover:-translate-y-0.5 group-hover:shadow-float">
                  <div className="flex items-center justify-between"><Badge tone={tone} dot>{t(label)}</Badge><ArrowUpRight className="size-4 text-ink-4 rtl:-scale-x-100" /></div>
                  <div className="mt-4 text-[15px]">{fmtDate(c.startDate, L)} → {fmtDate(c.endDate, L)}</div>
                  <div className="figure mt-4 text-[36px]" dir="ltr">{sar(f.netProfit, { compact: true })}<span className="figure-unit">SAR {t("net")}</span></div>
                  <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[12px] text-ink-3">
                    <span>{t("Reserve")}<span className="num block text-ink" dir="ltr">{sar(f.waterfall[1].amount, { compact: true })}</span></span>
                    <span>{t("Repaid")}<span className="num block text-ink" dir="ltr">{sar(f.waterfall[2].amount, { compact: true })}</span></span>
                    <span>{t("Dividends")}<span className="num block text-ink" dir="ltr">{sar(f.waterfall[3].amount, { compact: true })}</span></span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
