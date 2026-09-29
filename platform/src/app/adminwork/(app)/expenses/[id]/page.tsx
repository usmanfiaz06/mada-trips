import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft, Ban, Check, Undo2, X } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser, can, isOversight } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { voteBoard } from "@/lib/approval-view";
import { EXPENSE_CATEGORY, EXPENSE_STATUS, PAID_BY } from "@/lib/labels";
import { fmtDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { Badge, Card, CardHead, InkCard, KV } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { Journey } from "@/components/journey";
import { VoteDots } from "@/components/votes";
import { Attachments, Timeline } from "@/components/record";
import { vote } from "../../approvals/actions";
import { voidExpense, withdrawExpense } from "../actions";

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const u = await requireUser();
  const t = await getT();
  const L = t.locale;
  const [row] = await db.select({ e: schema.expenses, name: schema.users.name, partner: schema.partners.name }).from(schema.expenses)
    .innerJoin(schema.users, eq(schema.users.id, schema.expenses.submittedBy)).leftJoin(schema.partners, eq(schema.partners.id, schema.expenses.partnerId)).where(eq(schema.expenses.id, id));
  if (!row) notFound();
  const { e } = row;
  if (!can(u, "expenses.view_all") && e.submittedBy !== u.id) notFound();
  const [req] = e.approvalId ? await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, e.approvalId)) : [];
  const board = req ? (await voteBoard([req])).get(req.id)! : null;
  const me = board?.approvers.find((a) => a.id === u.id);
  const canVote = req?.status === "pending" && me && !me.decision;
  const [proof] = await db.select({ id: schema.attachments.id, mime: schema.attachments.mime }).from(schema.attachments).where(and(eq(schema.attachments.entityType, "expense"), eq(schema.attachments.entityId, id))).limit(1);
  const st = EXPENSE_STATUS[e.status];
  const path = `/adminwork/expenses/${id}`;

  return (
    <>
      <Link href="/adminwork/expenses" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Expenses")}</Link>
      <header className="mb-6">
        <div className="flex flex-wrap gap-2"><Badge tone={st.tone} dot>{t(st.label)}</Badge><Badge>{t(EXPENSE_CATEGORY[e.category])}</Badge>{e.isStartup && <Badge tone="info">{t("Startup cost")}</Badge>}</div>
        <h1 className="mt-2 text-[34px] font-[380] leading-none tracking-[-0.035em]">{e.description}</h1>
        <p className="mt-2 text-[14px] text-ink-3"><span className="num">{e.ref}</span> · {t("submitted by {name}", { name: row.name })}</p>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card><Journey steps={[
            { label: t("Submitted"), state: "done", meta: fmtDate(e.createdAt, L, true) },
            { label: t("Verified"), state: e.status === "approved" ? "done" : ["rejected", "withdrawn", "void"].includes(e.status) ? "failed" : "current", meta: req?.decidedAt ? fmtDate(req.decidedAt, L, true) : undefined },
            ...(e.paidBy === "partner" ? [{ label: t("In partner ledger"), state: e.status === "approved" ? "done" as const : "todo" as const, meta: row.partner ?? undefined }, { label: t("Repaid via Day-25"), state: "todo" as const }] : [{ label: t("Counted in overheads"), state: e.status === "approved" ? "done" as const : "todo" as const }]),
          ]} /></Card>
          <Card><CardHead title={t("Details")} /><KV cols={2} items={[
            [t("Business justification"), e.justification], [t("Vendor"), e.vendor],
            [t("Date paid"), fmtDate(e.expenseDate, L)], [t("Paid by"), e.paidBy === "partner" ? `${row.partner} · ${t("personally")}` : t(PAID_BY[e.paidBy])],
            [t("VAT"), <span key="v" className="num" dir="ltr">{sar(e.vatAmount)}</span>], [t("Type"), e.isStartup ? t("Capital advance (startup)") : t("Operating overhead")],
          ]} /></Card>
          {proof && proof.mime.startsWith("image/") && (
            <Card pad={false} className="overflow-hidden"><a href={`/adminwork/api/files/${proof.id}`} target="_blank" rel="noopener"><img src={`/adminwork/api/files/${proof.id}`} alt={t("Proof of payment")} className="max-h-[520px] w-full object-contain bg-sunken" /></a></Card>
          )}
          <Timeline entityType="expense" entityId={e.id} path={path} refLabel={e.ref} />
        </div>
        <aside className="space-y-4">
          <InkCard><div className="text-[12.5px] text-tile-ink-3">{t("Amount")}</div><div className="figure mt-3 text-[56px]" dir="ltr">{sar(e.amount)}</div><div className="mt-1 text-[12.5px] text-tile-ink-3">SAR</div></InkCard>
          {req && board && (
            <Card>
              <CardHead title={t("Verification")} hint={isOversight(u) ? t(req.rule) : undefined} action={<Link href={`/adminwork/approvals/${req.id}`} className="num text-[12.5px] text-ink-3 hover:text-ink">{req.ref}</Link>} />
              {isOversight(u) ? <VoteDots approvers={board.approvers} required={req.requiredApprovals} /> : <Badge tone={EXPENSE_STATUS[e.status].tone} dot>{t(EXPENSE_STATUS[e.status].label)}</Badge>}
              {board.approvers.filter((a) => a.remark).map((a) => <p key={a.id} className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-[13px]">{isOversight(u) && <span className="text-ink-3">{a.name}: </span>}“{a.remark}”</p>)}
              {canVote && (
                <ActionForm action={vote} className="mt-4 space-y-2 border-t border-line pt-4">
                  <input type="hidden" name="id" value={req.id} /><input type="hidden" name="next" value={path} />
                  <textarea name="remark" rows={2} className="field" placeholder={t("Remark (required to reject)")} />
                  <div className="grid grid-cols-2 gap-2">
                    <SubmitButton name="decision" value="reject" variant="outline"><X className="size-4" />{t("Reject")}</SubmitButton>
                    <SubmitButton name="decision" value="approve" variant="gold"><Check className="size-4" />{t("Verify")}</SubmitButton>
                  </div>
                </ActionForm>
              )}
            </Card>
          )}
          {((e.status === "pending" && e.submittedBy === u.id) || (e.status === "approved" && can(u, "expenses.verify"))) && (
            <Card>
              {e.status === "pending" ? (
                <details>
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] text-ink-2 hover:text-ink"><Undo2 className="size-4" />{t("Withdraw this expense")}</summary>
                  <p className="mt-2 text-[12.5px] text-ink-3">{t("It stops counting and leaves the verification queue. The record stays in the activity log.")}</p>
                  <ActionForm action={withdrawExpense} className="mt-3 space-y-2">
                    <input type="hidden" name="id" value={e.id} />
                    <input name="reason" className="field" placeholder={t("Reason (optional)")} />
                    <SubmitButton variant="outline" size="sm" confirm={t("Withdraw this expense?")}>{t("Withdraw")}</SubmitButton>
                  </ActionForm>
                </details>
              ) : (
                <details>
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] text-bad"><Ban className="size-4" />{t("Void this expense")}</summary>
                  <p className="mt-2 text-[12.5px] text-ink-3">{t("For mistakes. It stops counting as an overhead and, if a partner paid it, their ledger is reversed. The record stays in the activity log.")}</p>
                  <ActionForm action={voidExpense} className="mt-3 space-y-2">
                    <input type="hidden" name="id" value={e.id} />
                    <input name="reason" className="field" placeholder={t("Reason (required)")} />
                    <SubmitButton variant="danger" size="sm" confirm={t("Void this expense?")}>{t("Void")}</SubmitButton>
                  </ActionForm>
                </details>
              )}
            </Card>
          )}
          <Attachments entityType="expense" entityId={e.id} path={path} refLabel={e.ref} title={t("Proof & files")} canAdd={e.status === "pending"} />
        </aside>
      </div>
    </>
  );
}
