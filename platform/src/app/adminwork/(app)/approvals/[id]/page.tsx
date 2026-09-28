import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, ArrowUpRight, Check, Clock3, X } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { entityHref, voteBoard } from "@/lib/approval-view";
import { APPROVAL_KIND, APPROVAL_STATUS } from "@/lib/labels";
import { fmtDate, timeAgo } from "@/lib/dates";
import { sar } from "@/lib/money";
import { Avatar, Badge, Card, CardHead, InkCard, cx } from "@/components/ui";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/client";
import { Timeline } from "@/components/record";
import { vote, withdraw } from "../actions";

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const u = await requireUser();
  const t = await getT();
  const L = t.locale;
  const [r] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, id));
  if (!r) notFound();
  const v = (await voteBoard([r])).get(r.id)!;
  const [requester] = await db.select().from(schema.users).where(eq(schema.users.id, r.requestedBy));
  const me = v.approvers.find((a) => a.id === u.id);
  const oversight = u.permissions.has("approvals.decide") || u.permissions.has("expenses.verify") || u.permissions.has("finance.view");
  if (!oversight && !me && r.requestedBy !== u.id) notFound();
  const canVote = r.status === "pending" && !!me && !me.decision;
  const st = APPROVAL_STATUS[r.status];
  const remaining = Math.max(0, r.requiredApprovals - v.approvals);

  return (
    <>
      <Link href="/adminwork/approvals" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Approvals")}</Link>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <InkCard className="p-8">
            <div className="night-grid pointer-events-none absolute inset-0 opacity-40" />
            <div className="relative">
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="rounded-full bg-white/10 px-2.5 py-1">{t(APPROVAL_KIND[r.kind])}</span>
                <span className="num text-tile-ink-3">{r.ref}</span>
                <span className="ms-auto rounded-full bg-white/10 px-2.5 py-1">{t(st.label)}</span>
              </div>
              <h1 className="mt-6 max-w-2xl text-[26px] font-[400] leading-tight tracking-[-0.03em]">{r.title}</h1>
              <div className="figure mt-6 text-[72px]" dir="ltr">{sar(r.amount).split(".")[0]}<span className="text-[0.35em] opacity-50">.{sar(r.amount).split(".")[1]} SAR</span></div>
              {r.reason && <p className="mt-6 max-w-2xl rounded-2xl bg-white/[0.06] p-4 text-[14.5px] leading-relaxed text-tile-ink/90">“{r.reason}”</p>}
              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-tile-ink-3">
                <span>{t("Requested by {name}", { name: requester?.name ?? "—" })} · {fmtDate(r.createdAt, L, true)}</span>
                <Link href={entityHref(r)} className="flex items-center gap-1 text-tile-ink underline decoration-[var(--glow-gold)] decoration-2 underline-offset-4">{t("Open the record")}<ArrowUpRight className="size-3.5 rtl:-scale-x-100" /></Link>
              </div>
            </div>
          </InkCard>
          <Timeline entityType="approval" entityId={r.id} path={`/adminwork/approvals/${r.id}`} refLabel={r.ref} />
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHead title={t("Votes")} hint={t(r.rule)} />
            <div className="mb-5 flex items-center gap-3">
              <div className="flex-1">
                <div className="flex h-2 gap-1">
                  {Array.from({ length: r.requiredApprovals }).map((_, i) => <span key={i} className={cx("flex-1 rounded-full transition", i < v.approvals ? "bg-ok" : "bg-sunken")} />)}
                </div>
              </div>
              <span className="num text-[13px] text-ink-2">{v.approvals}/{r.requiredApprovals}</span>
            </div>
            <ul className="space-y-3">
              {v.approvers.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <Avatar name={a.name} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[14px]">{a.name}{a.id === u.id && <span className="text-ink-3"> · {t("you")}</span>}</span>
                      {a.decision === "approve" ? <Badge tone="ok"><Check className="size-3" />{t("Approved")}</Badge>
                        : a.decision === "reject" ? <Badge tone="bad"><X className="size-3" />{t("Rejected")}</Badge>
                        : <Badge><Clock3 className="size-3" />{r.status === "pending" ? t("Waiting") : t("Didn't vote")}</Badge>}
                    </div>
                    {a.remark && <p className="mt-1.5 rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-ink-2">“{a.remark}”</p>}
                    {a.at && <div className="mt-1 text-[11.5px] text-ink-3">{timeAgo(a.at, L)}</div>}
                  </div>
                </li>
              ))}
            </ul>
            {r.status === "pending" && <p className="mt-5 border-t border-line pt-4 text-[13px] text-ink-3">{remaining === 1 ? t("1 more approval needed.") : t("{n} more approvals needed.", { n: remaining })}</p>}
          </Card>

          {canVote && (
            <Card className="ring-2 ring-gold/40">
              <CardHead title={t("Your decision")} hint={t("A remark is required to reject and optional to approve.")} />
              <ActionForm action={vote} className="space-y-3">
                <input type="hidden" name="id" value={r.id} />
                <textarea name="remark" rows={3} className="field" placeholder={t("Remark for the requester and other directors…")} />
                <div className="grid grid-cols-2 gap-2">
                  <SubmitButton name="decision" value="reject" variant="outline"><X className="size-4" />{t("Reject")}</SubmitButton>
                  <SubmitButton name="decision" value="approve" variant="gold"><Check className="size-4" />{t("Approve")}</SubmitButton>
                </div>
              </ActionForm>
            </Card>
          )}
          {r.status === "pending" && r.requestedBy === u.id && (
            <Card><div className="flex items-center justify-between gap-3"><span className="text-[13.5px] text-ink-2">{t("Changed your mind?")}</span>
              <ConfirmAction action={withdraw} fields={{ id: r.id }} label={t("Withdraw request")} confirm={t("Withdraw this request?")} /></div></Card>
          )}
          {r.status === "pending" && !me && r.requestedBy !== u.id && <Card><p className="text-[13.5px] text-ink-3">{t("You're not an approver for this request.")}</p></Card>}
        </aside>
      </div>
    </>
  );
}
