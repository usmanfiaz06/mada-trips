import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft, Flag, Check } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { dailyReport } from "@/lib/daily";
import { fmtDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { CLOSE_STATUS } from "@/lib/labels";
import { Badge, Card, CardHead, KV, PageHeader, Tabs, cx } from "@/components/ui";
import { ActionForm, PrintButton, SubmitButton } from "@/components/client";
import { ReportTable, ReportTotals } from "@/components/daily-report";
import { verifyClose } from "../actions";

export default async function CloseDay({ params, searchParams }: { params: Promise<{ date: string }>; searchParams: Promise<{ team?: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const u = await requireUser();
  const t = await getT();
  const L = t.locale;
  const team = (await searchParams).team === "pakistan" ? "pakistan" : "riyadh";
  if (!can(u, "close.verify") && u.team !== team && u.team !== "management") notFound();
  const [c] = await db.select().from(schema.dailyCloses).where(and(eq(schema.dailyCloses.businessDate, date), eq(schema.dailyCloses.team, team)));
  const people = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users);
  const who = (id: string | null) => people.find((p) => p.id === id)?.name ?? "—";
  // A submitted close shows the locked snapshot; later edits to sales don't rewrite what was reported.
  const snap = c?.snapshot as Awaited<ReturnType<typeof dailyReport>> | undefined;
  const report = snap && "rows" in snap ? snap : await dailyReport(db, date, team);
  const variance = c ? c.cashCounted - c.cashExpected : 0;

  return (
    <>
      <Link href={`/adminwork/close?team=${team}`} className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink print:hidden"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Daily close")}</Link>
      <PageHeader eyebrow={t(team === "riyadh" ? "Riyadh office" : "Pakistan desk")} title={t("Daily report · {date}", { date: fmtDate(date, L) })}
        subtitle={c ? t("Submitted by {name} at {time}", { name: who(c.submittedBy), time: fmtDate(c.submittedAt, L, true) }) : t("Not submitted yet. Showing live figures.")}
        actions={<>{c && <Badge tone={CLOSE_STATUS[c.status].tone} dot>{t(CLOSE_STATUS[c.status].label)}</Badge>}{c?.lateSubmission && <Badge tone="warn">{t("Late")}</Badge>}
          <PrintButton label={t("Print")} /></>} />
      <div className="print:hidden"><Tabs active={team} items={[{ key: "riyadh", label: t("Riyadh office"), href: `/adminwork/close/${date}?team=riyadh` }, { key: "pakistan", label: t("Pakistan desk"), href: `/adminwork/close/${date}?team=pakistan` }]} /></div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card pad={false}><div className="p-6 pb-4"><ReportTotals r={report} /></div><ReportTable r={report} /></Card>
        <aside className="space-y-4">
          {c && (
            <Card>
              <CardHead title={t("Submission")} />
              <KV cols={1} items={[
                ...(team === "riyadh" ? [[t("Cash expected"), <span key="e" className="num" dir="ltr">{sar(c.cashExpected)}</span>], [t("Cash counted"), <span key="c" className="num" dir="ltr">{sar(c.cashCounted)}</span>],
                  [t("Difference"), <span key="d" className={cx("num", variance !== 0 && "text-bad")} dir="ltr">{sar(variance, { sign: true })}</span>]] as [string, React.ReactNode][] : []),
                [t("Team note"), c.note], [t("Verified by"), c.verifiedBy ? `${who(c.verifiedBy)} · ${fmtDate(c.verifiedAt, L, true)}` : "—"], [t("Verifier note"), c.verifyNote],
              ]} />
            </Card>
          )}
          {c && c.status === "submitted" && can(u, "close.verify") && c.submittedBy !== u.id && (
            <Card className="ring-2 ring-gold/30 print:hidden">
              <CardHead title={t("Verify against the bank")} hint={t("Tick it off once receipts match both bank accounts.")} />
              <ActionForm action={verifyClose} className="space-y-3">
                <input type="hidden" name="id" value={c.id} /><input type="hidden" name="date" value={date} /><input type="hidden" name="team" value={team} />
                <textarea name="verifyNote" rows={2} className="field" placeholder={t("Note (required to flag)")} />
                <div className="grid grid-cols-2 gap-2">
                  <SubmitButton name="outcome" value="flag" variant="outline"><Flag className="size-4" />{t("Flag")}</SubmitButton>
                  <SubmitButton name="outcome" value="verify" variant="gold"><Check className="size-4" />{t("Verify")}</SubmitButton>
                </div>
              </ActionForm>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
