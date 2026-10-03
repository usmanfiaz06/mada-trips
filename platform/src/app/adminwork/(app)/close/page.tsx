import Link from "next/link";
import { and, desc, eq, gte } from "drizzle-orm";
import { AlertTriangle, Check, CheckCircle2, MoonStar } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { dailyReport } from "@/lib/daily";
import { addDays, businessDate, fmtDate } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { amountInput, sar } from "@/lib/money";
import { Card, CardHead, Empty, InkCard, PageHeader, Tabs, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { ReportTable, ReportTotals } from "@/components/daily-report";
import { submitClose } from "./actions";

export const metadata = { title: "Daily close" };

export default async function ClosePage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const u = await requireUser();
  const t = await getT();
  const L = t.locale;
  const s = await getSettings();
  const today = businessDate(new Date(), s.closeHour);
  const sp = await searchParams;
  const team = u.team === "management" ? (sp.team === "pakistan" ? "pakistan" : "riyadh") : u.team;
  const canSubmit = can(u, "close.submit");

  const [existing] = await db.select().from(schema.dailyCloses).where(and(eq(schema.dailyCloses.businessDate, today), eq(schema.dailyCloses.team, team)));
  const report = await dailyReport(db, today, team);
  const from = addDays(today, -13);
  const history = await db.select({ c: schema.dailyCloses, name: schema.users.name }).from(schema.dailyCloses).innerJoin(schema.users, eq(schema.users.id, schema.dailyCloses.submittedBy))
    .where(gte(schema.dailyCloses.businessDate, from)).orderBy(desc(schema.dailyCloses.businessDate));
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, -i));

  return (
    <>
      <PageHeader eyebrow={t("10:00 PM, every day")} title={t("Daily close")}
        subtitle={t("Both teams close their day by 10 PM Riyadh time. The report goes to Abdulaziz, who checks it against the bank.")} />
      {u.team === "management" && <Tabs active={team} items={[{ key: "riyadh", label: t("Riyadh office"), href: "/adminwork/close?team=riyadh" }, { key: "pakistan", label: t("Pakistan desk"), href: "/adminwork/close?team=pakistan" }]} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card pad={false}>
            <div className="p-6 pb-4"><CardHead className="mb-4" title={t("Today · {date}", { date: fmtDate(today, L) })} hint={t("Updates live as the team works.")} /><ReportTotals r={report} /></div>
            {report.rows.length ? <ReportTable r={report} /> : <Empty icon={<MoonStar className="size-5" />} title={t("No sales yet today")} />}
          </Card>
        </div>

        <aside className="space-y-4">
          {existing ? (
            <InkCard>
              <CheckCircle2 className="size-6 text-glow-mint" />
              <div className="mt-4 text-[22px] font-[400] tracking-[-0.02em]">{t("Today is closed")}</div>
              <p className="mt-1 text-[13px] text-tile-ink-3">{t("Submitted {time}. You can still record sales; they'll belong to tomorrow after 10 PM.", { time: fmtDate(existing.submittedAt, L, true) })}</p>
              <Link href={`/adminwork/close/${today}?team=${team}`} className="mt-5 inline-block text-[13px] underline decoration-[var(--glow-gold)] decoration-2 underline-offset-4">{t("Open the report")}</Link>
            </InkCard>
          ) : canSubmit && (u.team === team || u.team === "management") ? (
            <Card className="ring-2 ring-gold/30">
              <CardHead title={t("Close today")} hint={t("Go through the list, count the cash, then submit.")} />
              <ul className="mb-5 space-y-2">
                {report.issues.length === 0 ? (
                  <li className="flex items-center gap-2 rounded-2xl bg-ok-soft px-3.5 py-2.5 text-[13.5px] text-ok"><Check className="size-4" />{t("Everything is complete")}</li>
                ) : report.issues.map((i) => (
                  <li key={i.id}><Link href={`/adminwork/sales/${i.id}`} className="flex items-center gap-2 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13.5px] text-warn hover:brightness-95"><AlertTriangle className="size-4 shrink-0" /><span className="num">{i.ref}</span> · {t(i.why)}</Link></li>
                ))}
              </ul>
              <ActionForm action={submitClose} className="space-y-4">
                <input type="hidden" name="date" value={today} />
                <input type="hidden" name="team" value={team} />
                {team === "riyadh" && (
                  <div className="rounded-2xl bg-surface-2 p-4 ring-1 ring-line">
                    <div className="flex justify-between text-[13px]"><span className="text-ink-3">{t("Cash expected in drawer")}</span><span className="num" dir="ltr">{sar(report.totals.cash)}</span></div>
                    <label className="mt-3 block"><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Cash you counted")}</span>
                      <input name="cashCounted" defaultValue={amountInput(report.totals.cash)} inputMode="decimal" className="field field-lg" dir="ltr" /></label>
                  </div>
                )}
                <label className="block"><span className="mb-1.5 block text-[12.5px] text-ink-3">{report.issues.length ? t("Note (required: explain the open items)") : t("Note (optional)")}</span>
                  <textarea name="note" rows={3} className="field" /></label>
                <SubmitButton variant="gold" size="lg" className="w-full">{t("Submit today's close")}</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}

          <Card>
            <CardHead title={t("Last 14 days")} />
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2 text-[13px]">
              <span /><span className="text-[11.5px] text-ink-3">{t("Riyadh")}</span><span className="text-[11.5px] text-ink-3">{t("Pakistan")}</span>
              {days.map((d) => (
                <div key={d} className="contents">
                  <span className="text-ink-2">{fmtDate(d, L)}</span>
                  {(["riyadh", "pakistan"] as const).map((tm) => {
                    const h = history.find((x) => x.c.businessDate === d && x.c.team === tm);
                    const tone = !h ? (d === today ? "bg-sunken text-ink-3" : "bg-bad-soft text-bad") : h.c.status === "verified" ? "bg-ok-soft text-ok" : h.c.status === "flagged" ? "bg-bad-soft text-bad" : "bg-gold-soft text-gold-2";
                    const label = !h ? (d === today ? t("Open") : t("Missing")) : h.c.status === "verified" ? t("Verified") : h.c.status === "flagged" ? t("Flagged") : t("Submitted");
                    return <Link key={tm} href={`/adminwork/close/${d}?team=${tm}`} className={cx("rounded-full px-2.5 py-1 text-center text-[11.5px] transition hover:brightness-95", tone)}>{label}{h?.c.lateSubmission ? " ·" + t("late") : ""}</Link>;
                  })}
                </div>
              ))}
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
