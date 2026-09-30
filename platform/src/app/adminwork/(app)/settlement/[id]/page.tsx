import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, ArrowUpRight, Check } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { voteBoard } from "@/lib/approval-view";
import type { SettlementFigures, SettlementInputs } from "@/lib/finance";
import { EXPENSE_CATEGORY } from "@/lib/labels";
import { fmtDate } from "@/lib/dates";
import { amountInput, pct, sar } from "@/lib/money";
import { Avatar, Card, CardHead, Field, InkCard, Input, Select, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { Journey } from "@/components/journey";
import { Waterfall } from "@/components/waterfall";
import { VoteDots } from "@/components/votes";
import { Timeline } from "@/components/record";
import { markPaid, recompute, submitSettlement } from "../actions";
import { ACCOUNT, ACCOUNTS } from "@/lib/labels";

export default async function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const u = await requirePerm("finance.view");
  const t = await getT();
  const L = t.locale;
  const [c] = await db.select().from(schema.settlementCycles).where(eq(schema.settlementCycles.id, id));
  if (!c) notFound();
  const f = c.figures as SettlementFigures & { transferRefs?: Record<string, string> };
  const inp = c.inputs as SettlementInputs;
  const [req] = c.approvalId ? await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, c.approvalId)) : [];
  const board = req ? (await voteBoard([req])).get(req.id) : undefined;
  const partners = await db.select().from(schema.partners).orderBy(schema.partners.sort);
  const draft = c.status === "draft" && can(u, "settlement.run");
  const labels = { gross: t("Gross profit"), overheads: t("P1 · Overheads"), reserve: t("P2 · IATA reserve"), repayment: t("P3 · Repayments"), dividend: t("P4 · Dividends") };

  return (
    <>
      <Link href="/adminwork/settlement" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Day-25 settlement")}</Link>
      <header className="mb-6">
        <h1 className="text-[34px] font-[380] leading-none tracking-[-0.035em]">{fmtDate(c.startDate, L)} → {fmtDate(c.endDate, L)}</h1>
        <p className="mt-2 text-[14px] text-ink-3">{t("Cut-off on cleared bank funds. Receipts cleared after the 25th roll into the next cycle.")}</p>
      </header>
      <Card className="mb-4"><Journey steps={[
        { label: t("Cut-off"), state: "done", meta: fmtDate(c.endDate, L) },
        { label: t("Prepared"), state: "done", meta: fmtDate(c.createdAt, L) },
        { label: t("Directors sign"), state: c.status === "draft" ? "todo" : c.status === "pending_approval" ? "current" : "done", meta: req?.ref },
        { label: t("Partners paid"), state: c.status === "paid" ? "done" : c.status === "approved" ? "current" : "todo", meta: c.paidAt ? fmtDate(c.paidAt, L) : undefined },
      ]} /></Card>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-4">
          <CardHead title={t("1 · Cleared funds")} hint={t("Deposits cleared by {d}", { d: fmtDate(c.endDate, L) })} />
          <div className="figure text-[40px]" dir="ltr">{sar(f.clearedByAccount.retail + f.clearedByAccount.corporate, { compact: true })}<span className="figure-unit">SAR</span></div>
          <div className="mt-5 space-y-2.5 text-[13px]">
            <div className="flex justify-between border-t border-line pt-2.5"><span className="text-ink-3">{t(ACCOUNT.retail)}</span><span className="num" dir="ltr">{sar(f.clearedByAccount.retail)}</span></div>
            <div className="flex justify-between border-t border-line pt-2.5"><span className="text-ink-3">{t(ACCOUNT.corporate)}</span><span className="num" dir="ltr">{sar(f.clearedByAccount.corporate)}</span></div>
            <div className="flex justify-between border-t border-line pt-2.5"><span className="text-ink-3">{t("Rolls to next cycle")}</span><span className="num text-ink-3" dir="ltr">{sar(f.rolledOver)}</span></div>
          </div>
          <p className="mt-4 text-[12px] text-ink-3">{t("Most of this belongs to IATA and airlines. Profit is below.")}</p>
        </Card>
        <Card className="lg:col-span-8">
          <CardHead title={t("2 · Net profit")} hint={t("{n} bookings fully paid and cleared by the cut-off", { n: f.bookingCount })} action={<span className={cx("figure text-[40px]", f.netProfit < 0 && "text-bad")} dir="ltr">{sar(f.netProfit)}</span>} />
          <div className="grid gap-x-8 md:grid-cols-2">
            <dl className="space-y-2.5 text-[13.5px]">
              {[[t("Revenue from settled bookings"), f.revenue], [t("Direct supplier / IATA cost"), -f.directCost], [t("Gross operating profit"), f.grossProfit], [t("Fixed overheads"), -f.overheads]].map(([k, v], i) => (
                <div key={k as string} className={cx("flex justify-between border-t border-line pt-2.5", i === 2 && "font-medium")}><dt className="text-ink-2">{k}</dt><dd className="num" dir="ltr">{sar(v as number)}</dd></div>
              ))}
            </dl>
            <dl className="space-y-2.5 text-[13px]">
              {Object.entries(f.overheadsByCategory).map(([k, v]) => (
                <div key={k} className="flex justify-between border-t border-line pt-2.5"><dt className="text-ink-3">{t(EXPENSE_CATEGORY[k] ?? k)}</dt><dd className="num text-ink-2" dir="ltr">{sar(v)}</dd></div>
              ))}
              {Object.keys(f.overheadsByCategory).length === 0 && <div className="border-t border-line pt-2.5 text-ink-3">{t("No overheads in this cycle")}</div>}
            </dl>
          </div>
        </Card>

        {(f.commissions ?? []).length > 0 && (
          <Card className="lg:col-span-12">
            <CardHead title={t("Team commission")} hint={t("Share of margin on each person's settled sales. Included in P1 overheads and paid with salaries.")} />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(f.commissions ?? []).map((c) => (
                <div key={c.userId} className="rounded-2xl bg-surface-2 p-4">
                  <div className="text-[14px]">{c.name}</div>
                  <div className="figure mt-3 text-[28px]" dir="ltr">{sar(c.amount)}</div>
                  <div className="mt-1 text-[12px] text-ink-3">{t("{n} settled sales", { n: c.bookings })}</div>
                </div>
              ))}
            </div>
          </Card>
        )}
        <Card className="lg:col-span-8">
          <CardHead title={t("3 · Cash allocation waterfall")} hint={t("Each priority is paid in full before the next gets anything.")} />
          <Waterfall gross={Math.max(0, f.grossProfit)} steps={f.waterfall} labels={labels} />
          {f.shortfall > 0 && <p className="mt-2 rounded-2xl bg-bad-soft px-4 py-3 text-[13.5px] text-bad">{t("Overheads exceed gross profit by {v} SAR. Nothing is distributed this cycle.", { v: sar(f.shortfall) })}</p>}
        </Card>
        <Card className="lg:col-span-4">
          <CardHead title={t("Levers")} hint={draft ? t("Adjust and recalculate. Everything is logged.") : t("Locked once sent for signature.")} />
          <ActionForm action={recompute} className="space-y-3">
            <input type="hidden" name="id" value={c.id} />
            <Field label={t("P2 · IATA reserve top-up (SAR)")} hint={t("Suggested {v}: upcoming BSP {b} + buffer − held {h}", { v: sar(f.suggestedReserve), b: sar(f.upcomingBsp), h: sar(f.reserveHeldBefore) })}>
              <Input name="reserveTopUp" defaultValue={amountInput(inp.reserveTopUp)} disabled={!draft} dir="ltr" /></Field>
            <Field label={t("P3 · Share of the rest for repayments (%)")}><Input name="repaymentPct" type="number" min={0} max={100} step="1" defaultValue={inp.repaymentPctBps / 100} disabled={!draft} /></Field>
            <Field label={t("Pay partners from")}><Select name="payoutAccount" defaultValue={inp.payoutAccount} disabled={!draft} options={ACCOUNTS.map((a) => ({ value: a.value, label: t(a.label) }))} /></Field>
            {draft && <SubmitButton variant="outline" className="w-full">{t("Recalculate")}</SubmitButton>}
          </ActionForm>
        </Card>

        <Card className="lg:col-span-12" pad={false}>
          <div className="p-6 pb-2"><CardHead title={t("4 · What each partner receives")} hint={t("Repayments and dividends both follow equity. Repayments never exceed what a partner is owed.")} /></div>
          <div className="grid gap-px bg-line md:grid-cols-3">
            {partners.map((p) => {
              const rep = f.repayments.find((r) => r.partnerId === p.id);
              const div = f.dividends.find((d) => d.partnerId === p.id);
              const total = (rep?.amount ?? 0) + (div?.amount ?? 0);
              return (
                <div key={p.id} className="bg-surface p-6">
                  <div className="flex items-center gap-3"><Avatar name={p.name} size={36} /><div><div className="text-[15px]">{t.locale === "ar" ? p.nameAr : p.name}</div><div className="text-[12px] text-ink-3">{t("Equity")} {pct(p.equityBps)}</div></div></div>
                  <div className="figure mt-6 text-[40px]" dir="ltr">{sar(total)}</div>
                  <dl className="mt-4 space-y-2 text-[13px]">
                    <div className="flex justify-between"><dt className="text-ink-3">{t("Repayment")}</dt><dd className="num" dir="ltr">{sar(rep?.amount ?? 0)}</dd></div>
                    <div className="flex justify-between"><dt className="text-ink-3">{t("Dividend")}</dt><dd className="num" dir="ltr">{sar(div?.amount ?? 0)}</dd></div>
                    <div className="flex justify-between border-t border-line pt-2"><dt className="text-ink-3">{t("Still owed after")}</dt><dd className="num text-ink-3" dir="ltr">{sar(Math.max(0, (rep?.outstandingBefore ?? 0) - (rep?.amount ?? 0)))}</dd></div>
                    {f.transferRefs?.[p.id] && <div className="flex justify-between"><dt className="text-ink-3">{t("Transfer ref")}</dt><dd className="num" dir="ltr">{f.transferRefs[p.id]}</dd></div>}
                  </dl>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-8"><Timeline entityType="settlement" entityId={c.id} path={`/adminwork/settlement/${c.id}`} refLabel={c.label} /></div>
        <aside className="space-y-4 lg:col-span-4">
          {draft && (
            <InkCard>
              <div className="text-[17px]">{t("5 · Send for signature")}</div>
              <p className="mt-1 text-[13px] text-tile-ink-3">{t("All directors must approve. Once signed, repayments and dividends are posted to the partner ledger.")}</p>
              <form action={submitSettlement} className="mt-5"><input type="hidden" name="id" value={c.id} /><SubmitButton variant="gold" className="w-full">{t("Send to directors")}</SubmitButton></form>
            </InkCard>
          )}
          {req && board && (
            <Card>
              <CardHead title={t("Signatures")} action={<Link href={`/adminwork/approvals/${req.id}`} className="flex items-center gap-1 text-[12.5px] text-ink-3 hover:text-ink">{req.ref}<ArrowUpRight className="size-3.5 rtl:-scale-x-100" /></Link>} />
              <VoteDots approvers={board.approvers} required={req.requiredApprovals} />
              {req.status === "pending" && board.approvers.some((a) => a.id === u.id && !a.decision) && <Link href={`/adminwork/approvals/${req.id}`} className="mt-4 inline-flex h-10 items-center rounded-full bg-gold px-5 text-[14px] text-[#1a140a]">{t("Review & sign")}</Link>}
            </Card>
          )}
          {c.status === "approved" && can(u, "settlement.run") && (
            <Card className="ring-2 ring-gold/40">
              <CardHead title={t("Record transfers")} hint={t("Wire each partner, then enter the bank reference.")} />
              <ActionForm action={markPaid} className="space-y-3">
                <input type="hidden" name="id" value={c.id} />
                {partners.map((p) => {
                  const total = (f.repayments.find((r) => r.partnerId === p.id)?.amount ?? 0) + (f.dividends.find((d) => d.partnerId === p.id)?.amount ?? 0);
                  return <Field key={p.id} label={`${p.name} · ${sar(total)} SAR`}><Input name={`ref_${p.id}`} placeholder={total > 0 ? t("Transfer reference") : t("Nothing to pay")} disabled={total === 0} dir="ltr" /></Field>;
                })}
                <SubmitButton variant="gold" className="w-full"><Check className="size-4" />{t("Mark all paid")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
