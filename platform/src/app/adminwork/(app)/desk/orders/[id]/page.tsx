import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { ArrowLeft, BadgeCheck, CircleHelp, Phone, PlaneTakeoff, Ticket, TrendingUp, XCircle } from "lucide-react";
import { db } from "@/db";
import { appDeskCanned } from "@/db/app-schema-desk";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { amountInput, sar } from "@/lib/money";
import { isUuid } from "@/lib/security";
import { agentForOps } from "@/lib/app/desk/agents";
import { getRequestFull } from "@/lib/app/desk/adapters";
import { slaFor } from "@/lib/app/desk/sla";
import { Badge, Card, CardHead, Field, Input, Money, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { AssignCard } from "@/components/desk/assign";
import { Composer } from "@/components/desk/forms";
import { PassportReveal, SlaClock } from "@/components/desk/live";
import { DeskTimeline, Facts, ORDER_STAGE, PAY_STATUS, StatusBadge, Thread } from "@/components/desk/parts";
import { askAction, failAction, holdAction, issueAction, priceAction, replyAction, revealAction, typingAction } from "../../actions";

export const metadata = { title: "Order · Desk" };

const hm = (local: string) => local.slice(11, 16);
const EVENT: Record<string, string> = {
  created: "Order placed", authorised: "Card authorised", held: "Seats held", pnr: "PNR recorded", price_locked: "Fare confirmed", question: "Question sent", answered: "Traveller answered",
  fare_changed: "New fare sent", issuing: "Issuing", tickets: "Ticket numbers entered", captured: "Card captured", confirmed: "Confirmed", ticketing_failed: "Ticketing failed", voided: "Card hold released", cancelled: "Cancelled",
};

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [o, me, canned] = await Promise.all([getRequestFull(id), agentForOps(u.id), db.select().from(appDeskCanned).orderBy(appDeskCanned.sort, desc(appDeskCanned.createdAt))]);
  if (!o) notFound();
  if (!o.isOrder) redirect(`/adminwork/desk/requests/${id}`);
  const r = o.request, d = o.desk, pay = o.payment;
  const act = can(u, "desk.act"), issue = can(u, "desk.issue");
  const open = ["awaiting", "held", "needs_answer", "price_changed", "failed"].includes(o.stage);
  const ev = o.events ?? [];
  const question = d.question ?? (o.order?.question ? { text: o.order.question.text, choices: o.order.question.options.map((x) => (x === "yes" ? "Yes" : x === "call" ? "Call me" : x)), askedAt: (ev.filter((e) => e.kind === "question").at(-1)?.createdAt ?? o.order.updatedAt).toISOString() } : null);
  const sla = o.stage === "awaiting" ? slaFor("order", d.question?.answeredAt ? new Date(d.question.answeredAt) : r.createdAt) : o.stage === "held" ? slaFor("ticketing", d.heldAt ? new Date(d.heldAt) : r.updatedAt) : null;
  const quote = o.quotes.find((q) => q.status !== "withdrawn") ?? o.quotes[0] ?? null;
  const total = pay?.amount ?? quote?.total ?? 0;
  const tripEnd = o.trip?.endDate ?? o.trip?.startDate ?? null;
  const ticketNames = r.kind === "stay" ? [] : o.travellers.map((p) => p.name);
  const offer = (r.details as Record<string, unknown>).offer as Record<string, unknown> | undefined;

  return (
    <>
      <Link href="/adminwork/desk/orders" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Orders")}</Link>
      <header className="mb-6 animate-rise">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
          <span className="num">{o.ref}</span>
          <StatusBadge map={ORDER_STAGE} value={o.stage} />
          {pay && <StatusBadge map={PAY_STATUS} value={pay.status} />}
          {sla && <SlaClock due={sla.dueAt.toISOString()} opened={sla.openedAt.toISOString()} />}
          <span>· {timeAgo(r.createdAt, L)}</span>
        </div>
        <h1 className="mt-2 text-[32px] font-[380] leading-tight tracking-[-0.03em]">{r.summary}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-ink-3">
          <span className="text-ink">{o.user.name || t("Traveller")}</span>
          {o.user.phone && <a href={`tel:${o.user.phone}`} className="num inline-flex items-center gap-1 hover:text-ink" dir="ltr"><Phone className="size-3.5" />{o.user.phone}</a>}
          {r.agentName && <span>{t("Named agent: {name}", { name: r.agentName })}</span>}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHead title={t("Trip")} hint={o.trip ? `${o.trip.city}${o.trip.country ? `, ${o.trip.country}` : ""} · ${fmtDate(o.trip.startDate, L)}${o.trip.endDate ? ` → ${fmtDate(o.trip.endDate, L)}` : ""}` : undefined} />
            {o.segments.length > 0 ? (
              <ol className="space-y-2">
                {o.segments.map((s) => (
                  <li key={s.id} className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-surface-2 p-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-info-soft text-info"><PlaneTakeoff className="size-4" /></span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-[14.5px] text-ink"><span className="num font-medium" dir="ltr">{s.fromAirport} → {s.toAirport}</span><span className="text-[12.5px] text-ink-3">{s.carrierName} · <span className="num">{s.flightNumber}</span> · {t(s.cabin === "business" ? "Business" : s.cabin === "first" ? "First" : "Economy")}</span></div>
                      <div className="text-[12.5px] text-ink-3">{fmtDate(s.departLocal.slice(0, 10), L)} · <span className="num" dir="ltr">{hm(s.departLocal)} → {hm(s.arriveLocal)}</span> · {Math.floor(s.durationMin / 60)}h {s.durationMin % 60}m{s.baggage ? ` · ${s.baggage}` : ""}</div>
                    </div>
                    {s.pnr ? <Badge tone="ok">{s.pnr}</Badge> : <span className="text-[12px] text-ink-4">{t(s.direction === "back" ? "Return" : "Outbound")}</span>}
                  </li>
                ))}
              </ol>
            ) : offer ? <Facts rows={Object.entries(offer).slice(0, 8).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])} /> : <p className="text-[13px] text-ink-3">{t("No flight details on this order")}</p>}
          </Card>

          <Card pad={false}>
            <div className="px-6 pt-6"><CardHead title={t("Travellers")} hint={issue ? t("Full passport numbers open for 30 seconds, and every look is logged.") : t("Passport numbers are masked. Issuing rights show them in full.")} /></div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13.5px]">
                <thead><tr className="text-[12px] text-ink-3">{[t("Name"), t("Born"), t("Nationality"), t("Passport"), t("Expires")].map((h) => <th key={h} className="whitespace-nowrap border-b border-line px-4 py-2.5 text-start font-normal first:ps-6 last:pe-6">{h}</th>)}</tr></thead>
                <tbody>
                  {o.travellers.map((p) => {
                    const short = !!p.passportExpiry && !!tripEnd && new Date(p.passportExpiry).getTime() - new Date(tripEnd).getTime() < 182 * 86400_000;
                    return (
                      <tr key={p.id} className="[&>td]:border-b [&>td]:border-line last:[&>td]:border-0">
                        <td className="px-4 py-3 ps-6"><span className="block text-ink">{p.name}</span><span className="block text-[12px] text-ink-3">{t(p.relation === "self" ? "Account holder" : p.relation[0]!.toUpperCase() + p.relation.slice(1))}</span></td>
                        <td className="num whitespace-nowrap px-4 py-3 text-ink-2">{p.dateOfBirth ? fmtDate(p.dateOfBirth, L) : "—"}</td>
                        <td className="px-4 py-3 text-ink-2">{p.nationality ?? "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3">{p.passportMasked ? <PassportReveal masked={p.passportMasked} can={issue && p.hasPassport} reveal={revealAction.bind(null, p.id, r.id)} /> : <span className="text-warn">{t("Missing")}</span>}</td>
                        <td className="whitespace-nowrap px-4 py-3 pe-6">{p.passportExpiry ? <span className={short ? "text-bad" : "text-ink-2"}>{fmtDate(p.passportExpiry, L)}{short ? ` · ${t("under 6 months")}` : ""}</span> : "—"}</td>
                      </tr>
                    );
                  })}
                  {o.travellers.length === 0 && <tr><td colSpan={5} className="px-6 py-4 text-ink-3">{t("No travellers on this order")}</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHead title={t("Price and payment")} hint={pay ? `${pay.label ?? pay.method}${pay.instalments > 1 ? ` · ${t("{n} payments", { n: pay.instalments })}` : ""}` : undefined}
              action={pay ? <StatusBadge map={PAY_STATUS} value={pay.status} /> : undefined} />
            {quote && (
              <dl className="divide-y divide-line">
                {quote.lines.map((l, i) => <div key={i} className="flex justify-between gap-4 py-2 text-[13.5px]"><dt className="text-ink-2">{l.label}</dt><dd><Money v={l.amount} /></dd></div>)}
              </dl>
            )}
            <div className="mt-3 flex items-baseline justify-between border-t border-line-strong pt-3">
              <span className="text-[13px] text-ink-3">{t("All-in total")}</span><Money v={total} className="text-[22px] font-[420] tracking-[-0.02em]" />
            </div>
            {d.priceChange && <p className="mt-3 rounded-2xl bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">{t("New price sent: SAR {from} → SAR {to}", { from: sar(d.priceChange.from), to: sar(d.priceChange.to) })}{d.priceChange.reason ? ` · ${d.priceChange.reason}` : ""}</p>}
            {pay?.method === "tabby" || pay?.method === "tamara" ? <p className="mt-3 text-[12.5px] text-ink-3">{t("Instalments: captured in full from the provider when tickets are issued. Releasing the hold cancels the plan.")}</p> : null}
          </Card>

          <Card>
            <CardHead title={t("Conversation")} hint={t("What the traveller sees in the order's thread. Notes stay with the team.")} />
            <div className="mb-4 max-h-[520px] overflow-y-auto pe-1"><Thread messages={o.messages} notes={o.notes} travellerName={o.user.name || t("Traveller")} /></div>
            {act && <Composer action={replyAction} typing={typingAction} threadKind="request" threadId={r.id} agentName={me?.displayName ?? u.name.split(" ")[0]!} canned={canned.map((c) => ({ id: c.id, title: c.title, en: c.bodyEn, ar: c.bodyAr }))} locale={L} />}
          </Card>

          {ev.length > 0 && (
            <Card>
              <CardHead title={t("Order timeline")} hint={o.order?.ref ? `${t("Booking")} ${o.order.ref}` : undefined} />
              <ol className="space-y-2">
                {ev.map((e) => (
                  <li key={e.id} className="flex items-baseline gap-3 text-[13.5px]">
                    <span className="num w-[52px] shrink-0 text-[12px] text-ink-3" dir="ltr">{fmtDate(e.createdAt, L, true).split(", ").at(-1)}</span>
                    <span className="text-ink">{t(EVENT[e.kind] ?? e.kind)}</span>
                    <span className="truncate text-ink-3">{e.actorName ?? t(e.actorKind === "user" ? "Traveller" : "System")}</span>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <DeskTimeline entityId={r.id} />
        </div>

        <aside className="space-y-4">
          {o.stage === "issued" && (
            <Card className="bg-ok-soft/40">
              <div className="mb-3 flex items-center gap-2 text-ok"><BadgeCheck className="size-5" /><span className="text-[15px] font-medium">{t("Confirmed by {name} at Mada", { name: r.agentName ?? "—" })}</span></div>
              <Facts rows={[[t("PNR"), <span key="p" className="num" dir="ltr">{d.pnr}</span>], ...(d.tickets ?? []).map((tk, i) => [ticketNames[i] ?? t("Ticket"), <span key={i} className="num" dir="ltr">{tk}</span>] as [string, React.ReactNode]), [t("Issued"), d.issuedAt ? fmtDate(d.issuedAt, L, true) : "—"]]} />
            </Card>
          )}
          {o.stage === "not_issued" && (
            <Card className="bg-bad-soft/40">
              <div className="mb-2 flex items-center gap-2 text-bad"><XCircle className="size-5" /><span className="text-[15px] font-medium">{t("Not issued · card hold released")}</span></div>
              <p className="text-[13.5px] text-ink-2">{d.failReason}</p>
            </Card>
          )}
          {o.stage === "needs_answer" && question && (
            <Card>
              <CardHead title={t("Waiting on the traveller")} hint={t("Asked {ago}", { ago: timeAgo(question.askedAt, L) })} />
              <p className="text-[14px] text-ink">{question.text}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">{question.choices.map((c) => <Badge key={c}>{t(c)}</Badge>)}</div>
            </Card>
          )}

          {open && act && (
            <Card>
              <CardHead title={t("Next step")} hint={o.stage === "awaiting" ? t("Check names against passports, then hold the seats.") : o.stage === "held" ? t("Seats are held. Issue to capture the card.") : t("Waiting on the traveller. You can still act.")} />
              <div className="space-y-4">
                {o.stage === "awaiting" && (
                  <ActionForm action={holdAction} className="space-y-2">
                    <input type="hidden" name="id" value={r.id} />
                    <Field label={t("PNR from the GDS (optional)")}><Input name="pnr" maxLength={8} className="num uppercase" dir="ltr" placeholder="X7K2QD" /></Field>
                    <SubmitButton variant="gold" className="w-full"><BadgeCheck className="size-4" />{t("Confirm and hold")}</SubmitButton>
                  </ActionForm>
                )}
                {(o.stage === "awaiting" || o.stage === "held") && (issue ? (
                  <ActionForm action={issueAction} className="space-y-2 border-t border-line pt-4">
                    <input type="hidden" name="id" value={r.id} />
                    <Field label={t("PNR")} required><Input name="pnr" required maxLength={8} defaultValue={d.heldPnr ?? ""} className="num uppercase" dir="ltr" /></Field>
                    {ticketNames.map((n, i) => <Field key={i} label={t("Ticket for {name}", { name: n })} required><Input name="ticket" required inputMode="numeric" maxLength={17} className="num" dir="ltr" placeholder="065 1234567890" /></Field>)}
                    <SubmitButton className="w-full" confirm={t("Issue and capture SAR {amount}?", { amount: sar(total) })}><Ticket className="size-4" />{t("Issue tickets and capture")}</SubmitButton>
                  </ActionForm>
                ) : <p className="border-t border-line pt-4 text-[12.5px] text-ink-3">{t("Issuing needs the desk issuing right. Hold the seats and hand it to someone who has it.")}</p>)}

                <details className="group rounded-2xl bg-surface-2 px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer items-center gap-2 text-[13.5px] text-ink"><CircleHelp className="size-4 text-ink-3" />{t("Ask the traveller")}</summary>
                  <ActionForm action={askAction} className="mt-3 space-y-2">
                    <input type="hidden" name="id" value={r.id} />
                    <Textarea name="question" rows={2} required maxLength={300} placeholder={t("Is the name on Ahmed's ticket AHMED ALHARBI, as on his passport?")} />
                    <div className="grid grid-cols-2 gap-2">{[t("Yes"), t("No")].map((c, i) => <Input key={i} name="choice" defaultValue={c} maxLength={40} aria-label={t("Answer {n}", { n: i + 1 })} />)}<Input name="choice" maxLength={40} placeholder={t("Another answer")} className="col-span-2" /></div>
                    <p className="text-[12px] text-ink-3">{t("It appears on their waiting screen with these one-tap answers.")}</p>
                    <SubmitButton variant="outline" className="w-full">{t("Send the question")}</SubmitButton>
                  </ActionForm>
                </details>

                {(o.stage === "awaiting" || o.stage === "held" || o.stage === "needs_answer") && (
                  <details className="group rounded-2xl bg-surface-2 px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
                    <summary className="flex cursor-pointer items-center gap-2 text-[13.5px] text-ink"><TrendingUp className="size-4 text-ink-3" />{t("Price changed")}</summary>
                    <ActionForm action={priceAction} className="mt-3 space-y-2">
                      <input type="hidden" name="id" value={r.id} />
                      <Field label={t("New all-in total (SAR)")}><Input name="total" required inputMode="decimal" defaultValue={amountInput(total)} className="num" dir="ltr" /></Field>
                      <Input name="reason" maxLength={140} placeholder={t("Why, for the team (optional)")} />
                      <p className="text-[12px] text-ink-3">{t("The current card hold is released. The traveller takes the new price or picks again.")}</p>
                      <SubmitButton variant="outline" className="w-full">{t("Send the new price")}</SubmitButton>
                    </ActionForm>
                  </details>
                )}

                <details className="group rounded-2xl bg-bad-soft/50 px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer items-center gap-2 text-[13.5px] text-bad"><XCircle className="size-4" />{t("Ticketing failed")}</summary>
                  <ActionForm action={failAction} className="mt-3 space-y-2">
                    <input type="hidden" name="id" value={r.id} />
                    <Textarea name="reason" rows={2} required maxLength={300} placeholder={t("What happened, for the team")} />
                    <p className="text-[12px] text-ink-3">{t("Releases the card hold and tells the traveller nothing was charged.")}</p>
                    <SubmitButton variant="danger" className="w-full" confirm={t("Release the card hold and close this order?")}>{t("Release the hold and close")}</SubmitButton>
                  </ActionForm>
                </details>
              </div>
            </Card>
          )}

          {open && <AssignCard kind={o.stage === "held" ? "ticketing" : "order"} id={r.id} userId={r.ownerId} canAct={act} />}

          {pay && (
            <Card>
              <CardHead title={t("Card hold")} />
              <Facts rows={[
                [t("Method"), pay.method === "tabby" ? "Tabby" : pay.method === "tamara" ? "Tamara" : pay.label ?? pay.method],
                [t("Amount"), <Money key="a" v={pay.amount} />],
                [t("Status"), <StatusBadge key="s" map={PAY_STATUS} value={pay.status} />],
                [t("Provider ref"), <span key="r" className="num text-[12px]" dir="ltr">{pay.providerRef ?? "—"}</span>],
                [t("Authorised"), fmtDate(pay.createdAt, L, true)],
              ]} />
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
