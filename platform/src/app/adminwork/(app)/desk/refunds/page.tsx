import type { ReactNode } from "react";
import Link from "next/link";
import { Undo2, Wallet, CreditCard, Gift, Plus } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { sar } from "@/lib/money";
import { isUuid } from "@/lib/security";
import { getSettings } from "@/lib/settings";
import { autoApproveMax } from "@/lib/app/finance/auto-approve";
import { REFUND_STAGE } from "@/lib/labels";
import { getRefund, pageRefunds, PAGE_SIZE } from "@/lib/app/desk/adapters";
import { slaFor } from "@/lib/app/desk/sla";
import { Badge, Card, CardHead, Empty, Input, KV, LinkButton, Money, PageHeader, Table, Tabs, Td, Textarea, Th, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { StatusBadge } from "@/components/desk/parts";
import { AutoRefresh, SlaClock } from "@/components/desk/live";
import { ListFilter, Pager, SummaryStrip, listHref, pageParam } from "@/components/desk/list";
import { rejectRefundAction } from "../actions";
import { decideRefundAction, markRefundSentAction, refundsGoodwillAction, sendApprovedNowAction } from "../finance-actions";
import { CustomerLink } from "@/components/desk/customer-link";

export const metadata = { title: "Refunds & credits · Desk" };

/*
 * Refunds and credits (DESK-PLAN U6, screen 7). Stages: To decide → (With a lead) → On its way → Sent → Settled, or
 * Declined. Approve all or part, to the card or to the Mada Wallet; over the agent's limits it goes to a lead in Approvals.
 * A card refund moves to Sent when the provider confirms (the finance job), to Settled when the settlement file
 * matches it. Goodwill credit and desk-started cancel-and-refund sit beside it.
 */

const TABS: { key: string; label: string; stages: string[] }[] = [
  { key: "requested", label: "To decide", stages: ["requested"] },
  { key: "lead", label: "With a lead", stages: ["awaiting_lead", "lead_approved"] },
  { key: "approved", label: "On its way", stages: ["approved"] },
  { key: "sent", label: "Sent", stages: ["sent"] },
  { key: "settled", label: "Settled", stages: ["settled"] },
  { key: "declined", label: "Declined", stages: ["rejected", "withdrawn"] },
];
const provider = (m: string) => (m === "tabby" ? "Tabby" : m === "tamara" ? "Tamara" : null);
const amountInput = (h: number) => (h / 100).toFixed(2);

export default async function RefundsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const tab = TABS.find((x) => x.key === sp.s) ?? TABS[0]!;
  const { page, offset } = pageParam(sp, PAGE_SIZE);
  const [data, s, autoMax] = await Promise.all([pageRefunds({ stage: tab.stages, q: sp.q, offset }), getSettings(), autoApproveMax()]);
  const href = listHref("/adminwork/desk/refunds", { s: sp.s, q: sp.q, page: sp.page });
  // The rail shows the refund picked in the table (or sent from the inbox), else the oldest one waiting in this tab.
  const focused = sp.focus && isUuid(sp.focus) ? data.rows.find((f) => f.id === sp.focus) ?? await getRefund(sp.focus) : null;
  const f = focused ?? (tab.key === "requested" ? data.rows.at(-1) ?? null : data.rows[0] ?? null);
  const decide = can(u, "desk.refund");
  const lead = can(u, "desk.admin");
  const inst = f ? provider(f.payment.method) : null;
  const sla = f?.stage === "requested" ? slaFor("refund", f.createdAt) : null;
  const count = (k: (typeof TABS)[number]) => k.stages.reduce((a, st) => a + (data.counts[st] ?? 0), 0);
  return (
    <>
      <AutoRefresh every={30} />
      <PageHeader eyebrow={t("App bookings")} title={t("Refunds & credits")}
        subtitle={t("Approve all or part, to the card it came from or to the Mada Wallet, which is instant and for bookings only. Refunds the rules give back in full, up to {max}, are approved at once and tagged Auto. A card refund shows Sent once the provider confirms it.", { max: `SAR ${sar(autoMax)}` })}
        actions={decide ? <LinkButton href="/adminwork/desk/refunds/new" variant="outline" size="sm"><Plus className="size-4" />{t("Cancel & refund a booking")}</LinkButton> : null} />
      <Tabs active={tab.key} items={TABS.map((x) => ({ key: x.key, label: t(x.label), href: listHref("/adminwork/desk/refunds", { q: sp.q })({ s: x.key === "requested" ? undefined : x.key }), count: x.key === "requested" || x.key === "lead" ? count(x) : undefined }))} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card pad={false} className="min-w-0 self-start">
          <ListFilter action="/adminwork/desk/refunds" q={sp.q} keep={{ s: sp.s }} placeholder={t("Ref, traveller, booking, card…")} clear={sp.q ? listHref("/adminwork/desk/refunds", { s: sp.s })() : null} />
          <SummaryStrip>
            <span>{t("{n} refunds", { n: data.total })}</span>
            <span>{t("Amount")} <span className="num text-ink" dir="ltr">{sar(data.amount)}</span></span>
            {decide && !lead && <span>{t("You approve alone up to {each} each, {daily} a day", { each: `SAR ${sar(s.deskRefundLimit)}`, daily: `SAR ${sar(s.deskRefundDailyLimit)}` })}</span>}
          </SummaryStrip>
          {data.rows.length === 0 ? <Empty icon={<Undo2 className="size-5" />} title={tab.key === "requested" && !sp.q ? t("No refunds waiting") : t("Nothing here")} hint={t("Cancellations and refund requests from the app show up here.")} /> : (
            <Table>
              <thead><tr><Th>{t("Refund")}</Th><Th>{t("Traveller")}</Th><Th>{t("Status")}</Th><Th>{tab.key === "requested" ? t("Promise") : t("Updated")}</Th><Th align="end">{t("Amount")}</Th></tr></thead>
              <tbody>
                {data.rows.map((r) => {
                  const sl = r.stage === "requested" ? slaFor("refund", r.createdAt) : null;
                  return (
                    <tr key={r.id} className={cx("group transition hover:bg-surface-2", f?.id === r.id && "bg-gold-soft/40")}>
                      <Td><Link href={href({ focus: r.id })} scroll={false} className="block" aria-current={f?.id === r.id ? "true" : undefined}>
                        <span className="block max-w-[240px] truncate text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{r.summary ?? (r.orderRef ? t("Booking {ref}", { ref: r.orderRef }) : t("Refund"))}</span>
                        <span className="block text-[12px] text-ink-3"><span className="num">{r.ref}</span> · {timeAgo(r.createdAt, L)}{r.origin === "desk" ? ` · ${t("started by the desk")}` : ""}</span></Link>
                        {r.autoRule ? <Badge tone="info" className="mt-1">{t("Auto")}</Badge> : null}</Td>
                      <Td className="whitespace-nowrap"><CustomerLink id={r.userId} className="block text-ink">{r.userName}</CustomerLink><span className="block text-[12px] text-ink-3">{provider(r.payment.method) ?? r.payment.label ?? r.payment.method}</span></Td>
                      <Td><StatusBadge map={REFUND_STAGE} value={r.stage} /></Td>
                      <Td className="whitespace-nowrap">{sl ? <SlaClock due={sl.dueAt.toISOString()} opened={sl.openedAt.toISOString()} /> : <span className="text-[12.5px] text-ink-3">{fmtDate(r.updatedAt, L, true)}</span>}</Td>
                      <Td align="end"><Money v={r.amount} />{r.requestedAmount && r.requestedAmount !== r.amount ? <span className="block text-[11.5px] text-ink-3">{t("of {amount} asked", { amount: sar(r.requestedAmount) })}</span> : null}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
          <Pager page={page} total={data.total} size={PAGE_SIZE} href={href} />
        </Card>

        <aside className="space-y-4">
          {!f ? null : (
            <Card id={f.id} className={cx((f.stage === "requested" || f.stage === "lead_approved") && "ring-2 ring-gold/40")}>
              <CardHead title={f.summary ?? (f.orderRef ? t("Booking {ref}", { ref: f.orderRef }) : t("Refund"))} hint={<><span className="num">{f.ref}</span> · <CustomerLink id={f.userId}>{f.userName}</CustomerLink> · {timeAgo(f.createdAt, L)}</>}
                action={sla ? <SlaClock due={sla.dueAt.toISOString()} opened={sla.openedAt.toISOString()} /> : <StatusBadge map={REFUND_STAGE} value={f.stage} />} />
              <div className="mb-4 flex items-baseline justify-between border-b border-line pb-4">
                <span className="text-[13px] text-ink-3">{f.stage === "requested" ? t("Asked back") : t("Refund")}</span>
                <span className="text-end"><Money v={f.amount} className="text-[26px] font-[350] tracking-[-0.03em]" />
                  {f.requestedAmount && f.requestedAmount !== f.amount ? <span className="block text-[12px] text-ink-3">{t("of {amount} asked", { amount: sar(f.requestedAmount) })}</span> : null}</span>
              </div>
              <KV items={[
                [t("Paid with"), inst ?? f.payment.label ?? f.payment.method],
                [t("Paid"), <Money key="p" v={f.payment.amount} />],
                [t("Reason given"), f.stage === "rejected" ? "—" : f.reason ?? "—"],
                [t("Booking"), f.requestId ? <Link key="o" href={`/adminwork/desk/orders/${f.requestId}`} className="underline decoration-gold decoration-2 underline-offset-2">{f.orderRef ?? t("Open the order")}</Link> : f.orderRef ?? "—"],
                ...(f.origin === "desk" ? [[t("Started by"), t("the desk")] as [string, string]] : []),
                ...(f.decidedAt ? [[t("Decided"), fmtDate(f.decidedAt, L, true)] as [string, string]] : []),
                ...(f.autoRule ? [[t("Approved by"), <span key="a"><Badge tone="info">{t("Auto")}</Badge> <span className="text-[12px] text-ink-3">{f.autoRule}</span></span>] as [string, ReactNode]] : []),
                ...(f.bankReference ? [[t("Bank reference"), <span key="r" className="num" dir="ltr">{f.bankReference}</span>] as [string, ReactNode]] : []),
                ...(f.sentAt ? [[t("Sent"), fmtDate(f.sentAt, L, true)] as [string, string]] : []),
                ...(f.settledAt ? [[t("Settled"), fmtDate(f.settledAt, L, true)] as [string, string]] : []),
              ]} />
              {f.note && <p className="mt-4 rounded-2xl bg-sunken px-3.5 py-2.5 text-[12.5px] text-ink-2">{f.note}</p>}
              {inst && f.stage === "requested" && <p className="mt-4 rounded-2xl bg-info-soft px-3.5 py-2.5 text-[12.5px] text-info">{t("Paid with {provider}. Refunding to the card cancels the remaining payments with {provider}, and what was paid goes back to their card. The Mada Wallet is instant instead.", { provider: inst })}</p>}
              {f.stage === "rejected" && <p className="mt-4 rounded-2xl bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad">{t("Traveller reads:")} {f.reason}</p>}
              {["approved", "sent", "settled"].includes(f.stage) && <p className="mt-4 text-[12.5px] text-ink-3">{f.destination === "credit" ? t("To the Mada Wallet") : t("To {card}", { card: f.payment.label ?? t("the card") })}{f.stage === "approved" && f.expectedBy ? ` · ${t("expected by {date}", { date: fmtDate(f.expectedBy, L) })}` : ""}{f.stage === "approved" && f.checkedAt ? ` · ${t("asked the provider {when}", { when: timeAgo(f.checkedAt, L) })}` : ""}</p>}

              {f.stage === "awaiting_lead" && (
                <div className="mt-4 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[12.5px] text-warn">
                  {t("Over the agent's limit. A support lead approves it in Approvals, then it is sent.")}
                  {f.approvalId && <> <Link href={`/adminwork/approvals/${f.approvalId}`} className="underline underline-offset-2">{t("Open the approval")}</Link></>}
                </div>
              )}
              {f.stage === "lead_approved" && decide && (
                <ActionForm action={sendApprovedNowAction} className="mt-5 border-t border-line pt-4">
                  <input type="hidden" name="id" value={f.id} />
                  <p className="mb-2 text-[12.5px] text-ink-3">{t("A lead approved it. It goes out within five minutes, or now.")}</p>
                  <SubmitButton variant="gold" className="w-full">{t("Send now")}</SubmitButton>
                </ActionForm>
              )}
              {f.stage === "approved" && f.destination === "original" && decide && (
                <ActionForm action={markRefundSentAction} className="mt-5 space-y-2 border-t border-line pt-4">
                  <input type="hidden" name="id" value={f.id} />
                  <p className="text-[12.5px] text-ink-3">{inst ? t("{provider} doesn't confirm refunds to us yet. When their portal shows it done, mark it sent.", { provider: inst }) : t("Moves to Sent by itself when the provider confirms. If their portal already shows it done, mark it sent.")}</p>
                  <Input name="reference" required minLength={3} maxLength={80} placeholder={t("The bank's reference (ARN) or the provider's refund reference")} dir="ltr" />
                  <SubmitButton variant="outline" className="w-full">{t("Mark sent")}</SubmitButton>
                </ActionForm>
              )}

              {f.stage === "requested" && (decide ? (
                <div className="mt-5 space-y-4 border-t border-line pt-4">
                  <ActionForm action={decideRefundAction} className="space-y-2">
                    <input type="hidden" name="id" value={f.id} />
                    <label className="block text-[12px] text-ink-3" htmlFor={`amt-${f.id}`}>{t("Amount to refund (SAR)")}</label>
                    <Input id={`amt-${f.id}`} name="amount" inputMode="decimal" defaultValue={amountInput(f.amount)} dir="ltr" className="num" />
                    <p className="text-[11.5px] text-ink-3">{t("Less than asked is a partial refund; the traveller sees the amount you approve.")}</p>
                    <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-sunken p-1">
                      {[["original", inst ?? t("Card"), CreditCard], ["credit", t("Mada Wallet"), Wallet]].map(([v, l, I]) => {
                        const Icon = I as typeof Wallet;
                        return (
                          <label key={String(v)} className="block">
                            <input type="radio" name="destination" value={String(v)} defaultChecked={v === (f.destination === "credit" ? "credit" : "original")} className="peer sr-only" />
                            <span className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-[12.5px] text-ink-3 transition peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-card"><Icon className="size-3.5" />{String(l)}</span>
                          </label>
                        );
                      })}
                    </div>
                    <SubmitButton variant="gold" className="w-full">{t("Approve refund")}</SubmitButton>
                  </ActionForm>
                  <ActionForm action={rejectRefundAction} className="space-y-2">
                    <input type="hidden" name="id" value={f.id} />
                    <Textarea name="reason" rows={2} required minLength={10} maxLength={300} placeholder={t("Why not, in words the traveller will read")} />
                    <SubmitButton variant="outline" className="w-full">{t("Decline with reason")}</SubmitButton>
                  </ActionForm>
                </div>
              ) : <p className="mt-4 text-[12.5px] text-ink-3">{t("Refund decisions need the desk refund right.")}</p>)}
            </Card>
          )}

          {f && can(u, "desk.act") && (
            <Card>
              <CardHead title={<span className="inline-flex items-center gap-2"><Gift className="size-4 text-gold" />{t("Goodwill credit")}</span>} hint={t("For {name}, to the Mada Wallet at once", { name: f.userName })} />
              <ActionForm action={refundsGoodwillAction} className="space-y-2" resetOnOk>
                <input type="hidden" name="userId" value={f.userId} />
                <Input name="amount" inputMode="decimal" required placeholder={t("Amount (SAR)")} dir="ltr" className="num" />
                <Textarea name="note" rows={2} required minLength={5} maxLength={200} placeholder={t("Why, in words the traveller will read")} />
                <p className="text-[11.5px] text-ink-3">{lead ? t("Leads give any amount.") : t("Up to {limit} at once, {daily} a day. More goes to a support lead in Approvals.", { limit: `SAR ${sar(s.deskGoodwillLimit)}`, daily: `SAR ${sar(s.deskAgentDailyLimit)}` })}</p>
                <SubmitButton variant="outline" className="w-full">{t("Give goodwill credit")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
