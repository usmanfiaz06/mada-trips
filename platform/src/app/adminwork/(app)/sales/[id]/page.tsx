import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ArrowLeft, Ban, Building2, CornerUpLeft, Receipt, RotateCcw, ShieldCheck, Ticket } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser, can, isOversight } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { issueCheck } from "@/lib/issuance";
import { ACCOUNT, BOOKING_STATUS, CLIENT_TYPE, METHOD, SERVICE } from "@/lib/labels";
import { fmtDate } from "@/lib/dates";
import { amountInput, sar } from "@/lib/money";
import { Badge, Card, CardHead, InkCard, KV, Money, Table, Td, Th, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { Journey, type JourneyStep } from "@/components/journey";
import { Attachments, Timeline } from "@/components/record";
import { issueBooking, recordPayment, requestRefund, resubmitBooking, returnBooking, voidBooking } from "../actions";
import { LinkedTasks } from "@/components/tasks";

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const u = await requireUser();
  const t = await getT();
  const L = t.locale;
  const [row] = await db.select({ b: schema.bookings, c: schema.clients }).from(schema.bookings)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.bookings.clientId)).where(eq(schema.bookings.id, id));
  if (!row) notFound();
  const { b, c } = row;

  const [payments, people, approvals, cycle] = await Promise.all([
    db.select({ p: schema.payments, name: schema.users.name }).from(schema.payments).innerJoin(schema.users, eq(schema.users.id, schema.payments.recordedBy)).where(eq(schema.payments.bookingId, id)).orderBy(schema.payments.collectedAt),
    db.select({ id: schema.users.id, name: schema.users.name, team: schema.users.team }).from(schema.users),
    db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.entityId, id)).orderBy(desc(schema.approvalRequests.createdAt)),
    b.recognizedCycleId ? db.select().from(schema.settlementCycles).where(eq(schema.settlementCycles.id, b.recognizedCycleId)).then((r) => r[0]) : Promise.resolve(undefined),
  ]);
  const who = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? "—";
  const preparer = people.find((p) => p.id === b.preparedBy);
  if (!can(u, "sales.view_all") && preparer?.team !== u.team) notFound();

  const paid = payments.reduce((s, x) => s + x.p.amount, 0);
  const cleared = payments.filter((x) => x.p.clearedOn).reduce((s, x) => s + x.p.amount, 0);
  const owed = b.sellPrice - paid;
  const margin = b.sellPrice - b.netCost;
  const st = BOOKING_STATUS[b.status];
  const closed = b.status === "void" || b.status === "refunded";
  const issuable = b.status === "pending_issue" && (await issueCheck(db, u, b));
  const credit = approvals.find((a) => a.kind === "credit");
  const refund = approvals.find((a) => a.kind === "refund" && a.status === "pending");
  const path = `/adminwork/sales/${id}`;

  const steps: JourneyStep[] = [
    { label: t("Created"), state: "done", meta: `${who(b.preparedBy).split(" ")[0]} · ${fmtDate(b.createdAt, L, true)}` },
    ...(credit ? [{ label: t("Credit approval"), state: (credit.status === "approved" ? "done" : credit.status === "pending" ? "current" : "failed") as JourneyStep["state"], meta: credit.ref }] : []),
    { label: b.serviceType === "flight" ? t("Issued") : t("Confirmed"), state: b.status === "issued" || b.status === "refunded" ? "done" : b.status === "void" ? "failed" : b.status === "pending_issue" || b.status === "returned" ? "current" : "todo",
      meta: b.issuedAt ? `${who(b.issuedBy).split(" ")[0]} · ${fmtDate(b.issuedAt, L, true)}` : b.status === "returned" ? t("Sent back") : undefined },
    { label: t("Paid"), state: owed <= 0 ? "done" : closed ? "skipped" : paid > 0 ? "current" : "todo", meta: owed > 0 && !closed ? t("{v} owed", { v: sar(owed) }) : undefined },
    { label: t("Cleared in bank"), state: cleared >= b.sellPrice ? "done" : closed ? "skipped" : "todo" },
    { label: t("In settlement"), state: cycle ? "done" : closed ? "skipped" : "todo", meta: cycle?.label },
  ];

  return (
    <>
      <Link href="/adminwork/sales" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Sales & bookings")}</Link>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 animate-rise">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2"><Badge tone={st.tone} dot>{t(st.label)}</Badge><Badge>{t(SERVICE[b.serviceType])}</Badge><Badge>{t(ACCOUNT[b.account])}</Badge></div>
          <h1 className="text-[34px] font-[380] leading-none tracking-[-0.035em]"><span className="num">{b.ref}</span> <span className="text-ink-3">· {b.passengers}</span></h1>
          <p className="mt-2 text-[14px] text-ink-3">{b.description ?? ""}{b.pnr && <> · PNR <span className="num tracking-wider text-ink" dir="ltr">{b.pnr}</span></>}</p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card><Journey steps={steps} /></Card>

          {b.status === "returned" && (
            <Card className="ring-2 ring-bad/30">
              <CardHead title={t("Sent back for fixing")} hint={b.returnNote ?? ""} />
              {(b.preparedBy === u.id || can(u, "sales.edit")) && (
                <ActionForm action={resubmitBooking} className="grid gap-3 sm:grid-cols-4">
                  <input type="hidden" name="id" value={b.id} />
                  <input name="pnr" defaultValue={b.pnr ?? ""} className="field num uppercase" placeholder="PNR" dir="ltr" />
                  <input name="netCost" defaultValue={amountInput(b.netCost)} className="field num" dir="ltr" aria-label={t("Net cost")} />
                  <input name="sellPrice" defaultValue={amountInput(b.sellPrice)} className="field num" dir="ltr" aria-label={t("Selling price")} />
                  <SubmitButton variant="primary">{t("Fix & resubmit")}</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}

          <Card>
            <CardHead title={t("Booking")} />
            <KV cols={3} items={[
              [t("Client"), <Link key="c" href={`/adminwork/clients/${c.id}`} className="inline-flex items-center gap-1.5 hover:underline">{c.type !== "retail" && <Building2 className="size-3.5 text-ink-3" />}{c.name}</Link>],
              [t("Client type"), t(CLIENT_TYPE[c.type].label)],
              [t("Travellers"), `${b.paxCount} · ${b.passengers}`],
              [t("Supplier"), b.supplier],
              [t("Travel date"), fmtDate(b.travelDate, L)],
              [t("Ticket no."), b.ticketNumbers ? <span key="tk" className="num" dir="ltr">{b.ticketNumbers}</span> : "—"],
              [t("Prepared by"), who(b.preparedBy)],
              [t("Business day"), fmtDate(b.businessDate, L)],
              [t("Due date"), b.onCredit ? fmtDate(b.dueDate, L) : t("Paid at sale")],
            ]} />
          </Card>

          <Card pad={false}>
            <div className="p-6 pb-3"><CardHead className="mb-0" title={t("Payments")} hint={owed > 0 && !closed ? t("{v} SAR still owed", { v: sar(owed) }) : t("Fully paid")} /></div>
            {payments.length > 0 && (
              <Table>
                <thead><tr><Th>{t("Date")}</Th><Th>{t("Method")}</Th><Th>{t("Account")}</Th><Th>{t("Recorded by")}</Th><Th>{t("Bank")}</Th><Th align="end">{t("Amount")}</Th></tr></thead>
                <tbody>
                  {payments.map(({ p, name }) => (
                    <tr key={p.id}>
                      <Td>{fmtDate(p.collectedAt, L, true)}</Td><Td>{t(METHOD[p.method])}{p.reference && <span className="block text-[12px] text-ink-3" dir="ltr">{p.reference}</span>}</Td>
                      <Td>{t(ACCOUNT[p.account])}</Td><Td>{name}</Td>
                      <Td>{p.clearedOn ? <Badge tone="ok" dot>{t("Cleared")} {fmtDate(p.clearedOn, L)}</Badge> : <Badge tone="neutral" dot>{t("Not cleared yet")}</Badge>}</Td>
                      <Td align="end"><Money v={p.amount} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {owed > 0 && !closed && b.status !== "awaiting_credit" && (
              <ActionForm action={recordPayment} resetOnOk className="grid gap-2 border-t border-line p-6 sm:grid-cols-[1fr_160px_1fr_auto]">
                <input type="hidden" name="id" value={b.id} />
                <input name="amount" defaultValue={amountInput(owed)} inputMode="decimal" className="field num" dir="ltr" aria-label={t("Amount")} />
                <select name="method" className="field" defaultValue={b.channel === "corporate" ? "transfer" : "mada"}>
                  {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
                </select>
                <input name="reference" className="field" placeholder={t("Reference (optional)")} dir="ltr" />
                <SubmitButton>{t("Record payment")}</SubmitButton>
              </ActionForm>
            )}
          </Card>

          <Timeline entityType="booking" entityId={b.id} path={path} refLabel={b.ref} />
        </div>

        <aside className="space-y-4">
          <InkCard>
            <div className="text-[12.5px] text-tile-ink-3">{t("Margin")}</div>
            <div className={cx("figure mt-2 text-[52px]", margin < 0 && "text-glow-ember")} dir="ltr">{sar(margin)}</div>
            <div className="mt-1 text-[12.5px] text-tile-ink-3 num" dir="ltr">{b.sellPrice ? ((margin / b.sellPrice) * 100).toFixed(1) : "0.0"}%</div>
            <dl className="mt-6 space-y-2.5 border-t border-tile-line pt-5 text-[13.5px]">
              {[[t("Selling price"), b.sellPrice], [t("Net cost"), b.netCost], [t("Received"), paid], [t("Cleared in bank"), cleared]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between"><dt className="text-tile-ink-3">{k}</dt><dd className="num" dir="ltr">{sar(v as number)}</dd></div>
              ))}
            </dl>
          </InkCard>

          {credit && credit.status === "pending" && (
            <Card className="ring-2 ring-warn/30">
              <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 text-warn" />
                <div><div className="text-[15px]">{t("Waiting for credit approval")}</div><div className="mt-1 text-[13px] text-ink-3">{isOversight(u) ? credit.rule : t("Management reviews pay-later sales before they're issued.")}</div>
                  <Link href={`/adminwork/approvals/${credit.id}`} className="mt-3 inline-block text-[13px] text-ink underline decoration-gold decoration-2 underline-offset-4">{isOversight(u) ? t("See votes") : t("See status")} · {credit.ref}</Link></div></div>
            </Card>
          )}

          {issuable && issuable.ok && (
            <Card className="ring-2 ring-gold/40">
              <CardHead title={b.serviceType === "flight" ? t("Issue ticket") : t("Confirm booking")} hint={issuable.delegationId ? t("Under your delegated limit") : t("You have issuing authority")} />
              <ActionForm action={issueBooking} className="space-y-3">
                <input type="hidden" name="id" value={b.id} />
                {b.serviceType === "flight" && <input name="ticketNumbers" required className="field num" placeholder={t("Ticket number(s)")} dir="ltr" />}
                <SubmitButton variant="gold" className="w-full"><Ticket className="size-4" />{b.serviceType === "flight" ? t("Issue now") : t("Confirm now")}</SubmitButton>
              </ActionForm>
              <details className="mt-4 group">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><CornerUpLeft className="size-3.5" />{t("Send back to preparer")}</summary>
                <ActionForm action={returnBooking} className="mt-3 space-y-2">
                  <input type="hidden" name="id" value={b.id} />
                  <textarea name="note" rows={2} className="field" placeholder={t("What needs fixing?")} />
                  <SubmitButton variant="outline" size="sm">{t("Send back")}</SubmitButton>
                </ActionForm>
              </details>
            </Card>
          )}
          {b.status === "pending_issue" && issuable && !issuable.ok && (
            <Card><div className="flex gap-3 text-[13.5px]"><Ticket className="mt-0.5 size-4 text-gold-2" /><div><div>{t("Waiting to issue")}</div><div className="mt-0.5 text-ink-3">{t(issuable.reason)}</div></div></div></Card>
          )}

          {!closed && (
            <Card>
              <CardHead title={t("More actions")} />
              <div className="space-y-4">
                {b.status === "issued" && !refund && (
                  <details><summary className="flex cursor-pointer list-none items-center gap-2 text-[13.5px] text-ink-2 hover:text-ink"><RotateCcw className="size-4" />{t("Request a refund")}</summary>
                    <ActionForm action={requestRefund} className="mt-3 space-y-2"><input type="hidden" name="id" value={b.id} />
                      <textarea name="reason" rows={2} className="field" placeholder={t("Why? Directors approve refunds")} /><SubmitButton variant="outline" size="sm">{t("Send refund request")}</SubmitButton></ActionForm></details>
                )}
                {refund && <Link href={`/adminwork/approvals/${refund.id}`} className="flex items-center gap-2 text-[13.5px] text-ink-2 hover:text-ink"><RotateCcw className="size-4" />{t("Refund requested")} · {refund.ref}</Link>}
                {b.status !== "issued" && paid === 0 && (b.preparedBy === u.id || can(u, "sales.edit")) && (
                  <details><summary className="flex cursor-pointer list-none items-center gap-2 text-[13.5px] text-bad"><Ban className="size-4" />{t("Void this sale")}</summary>
                    <ActionForm action={voidBooking} className="mt-3 space-y-2"><input type="hidden" name="id" value={b.id} />
                      <input name="reason" className="field" placeholder={t("Reason")} /><SubmitButton variant="danger" size="sm">{t("Void sale")}</SubmitButton></ActionForm></details>
                )}
                <Link href={`/adminwork/sales/new?client=${c.id}`} className="flex items-center gap-2 text-[13.5px] text-ink-2 hover:text-ink"><Receipt className="size-4" />{t("New sale for this client")}</Link>
              </div>
            </Card>
          )}

          <LinkedTasks me={u} type="booking" id={b.id} />
          <Attachments entityType="booking" entityId={b.id} path={path} refLabel={b.ref} title={t("Tickets & documents")} />
        </aside>
      </div>
    </>
  );
}
