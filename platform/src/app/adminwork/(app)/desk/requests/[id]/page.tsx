import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc } from "drizzle-orm";
import { ArrowLeft, Check, CircleHelp, ListChecks, Phone } from "lucide-react";
import { db } from "@/db";
import { appDeskCanned } from "@/db/app-schema-desk";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { isUuid } from "@/lib/security";
import { agentForOps } from "@/lib/app/desk/agents";
import { CHECKLISTS, destinationOf, getRequestFull } from "@/lib/app/desk/adapters";
import { copyWindowOpen, travellersWithCopy } from "@/lib/app/desk/passport-copy";
import { slaFor } from "@/lib/app/desk/sla";
import { Badge, Card, CardHead, Input, KV, Money, PageHeader, Textarea, btn, cx } from "@/components/ui";
import { Journey, type JourneyStep } from "@/components/journey";
import { ActionForm, SubmitButton } from "@/components/client";
import { HotelbedsCard } from "@/components/desk/hotelbeds";
import { canDeskFinance } from "@/lib/app/finance/access";
import { AssignCard } from "@/components/desk/assign";
import { TicketsCard } from "@/components/desk/tickets";
import { Composer, QuoteBuilder } from "@/components/desk/forms";
import { SlaClock } from "@/components/desk/live";
import { DeskTimeline, StatusBadge, Thread } from "@/components/desk/parts";
import { REQUEST_KIND, REQUEST_STATUS } from "@/lib/labels";
import { askAction, checklistAction, confirmCallAction, doneAction, flightQuoteAction, linkPlanItemAction, quoteAction, replyAction, typingAction } from "../../actions";
import { requestPlan } from "@/lib/app/desk/plans";
import { FlightQuoteBuilder } from "@/components/desk/flight-quote";
import { ContactBadge, FlightQuoteSummary, flightFacts } from "@/components/desk/flight-parts";
import { flightQuoteOf } from "@/lib/app/booking/flight-requests";
import { CONTACT_LABEL, contactPreferenceOf } from "@/lib/app/booking/requests";
import { ActivityCard } from "@/components/desk/activity";
import { OutcomeCard } from "@/components/desk/outcome";
import { progressOfRequest, resultOfRequest } from "@/lib/app/outcomes";
import { CustomerLink } from "@/components/desk/customer-link";

export const metadata = { title: "Request · Desk" };

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [x, me, canned] = await Promise.all([getRequestFull(id), agentForOps(u.id), db.select().from(appDeskCanned).orderBy(appDeskCanned.sort, desc(appDeskCanned.createdAt))]);
  if (!x) notFound();
  if (x.isOrder) redirect(`/adminwork/desk/orders/${id}`);
  const r = x.request, d = x.desk;
  const act = can(u, "desk.act");
  const closed = ["done", "cancelled", "confirmed"].includes(r.status);
  const sla = r.status === "sent" || r.status === "reviewing" ? slaFor("request", r.createdAt, new Date(), { due: r.promisedBy }) : null;
  const checklist = d.checklist ?? (CHECKLISTS[r.kind] ?? []).map((label) => ({ label, done: false }));
  const asked = Object.entries(r.details).filter(([k]) => !["desk", "offer", "place", "message", "activity", "contactPreference", "contactWindow"].includes(k)).slice(0, 12);
  const quote = x.quotes.find((q) => q.status !== "withdrawn");
  const place = r.kind === "destination" ? destinationOf(r.details) : null;
  // Flights by request: the form's answers as facts, fares with the quote builder (components/desk/flight-quote.tsx).
  const fr = x.flightAsk ? flightFacts(r.details, x.travellers, L) : null;
  const flightQuote = quote ? flightQuoteOf(quote.offerSnapshot) : null;
  // How they asked to be reached (Ask chat asks once): a call (with the best time), WhatsApp, or here in the app.
  const reach = contactPreferenceOf(r.details);
  // Passport copies the travellers chose to keep: opened only while this request needs them, each look audited.
  const [copies, copyOpen, planned] = await Promise.all([travellersWithCopy(x.travellers.map((p) => p.id)), copyWindowOpen(r), requestPlan(r.id)]);
  const copyLinks = act && copyOpen ? x.travellers.filter((p) => copies.has(p.id)) : [];

  // Where the request is: asked, quoted, paid, done (or cancelled).
  const st = r.status;
  const paidUp = ["with_agent", "confirmed", "done"].includes(st);
  const steps: JourneyStep[] = [
    { label: t("Asked"), state: "done", meta: fmtDate(r.createdAt, L, true) },
    { label: t(fr ? "Fares sent" : "Quoted"), state: quote || paidUp ? "done" : st === "cancelled" ? "skipped" : "current", meta: quote ? fmtDate(quote.createdAt, L, true) : st === "needs_answer" ? t("Waiting on traveller") : undefined },
    { label: t("Paid"), state: paidUp ? "done" : st === "cancelled" ? "skipped" : quote ? "current" : "todo", meta: st === "awaiting_payment" ? t("Waiting for payment") : undefined },
    { label: t("Done"), state: st === "done" || st === "confirmed" ? "done" : st === "cancelled" ? "failed" : st === "with_agent" ? "current" : "todo", meta: d.doneAt ? fmtDate(d.doneAt, L, true) : st === "cancelled" ? t("Cancelled") : undefined },
  ];

  return (
    <>
      <Link href="/adminwork/desk/requests" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Requests")}</Link>
      <PageHeader eyebrow={<><span className="num">{x.ref}</span> · {t(REQUEST_KIND[r.kind] ?? r.kind)}</>} title={r.summary}>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
          <StatusBadge map={REQUEST_STATUS} value={r.status} />
          {(r.details as { withdrawn?: boolean; withdrawnAt?: string }).withdrawn && <Badge tone="neutral" dot>{t("Withdrawn by the traveller")} · {timeAgo(new Date(String((r.details as { withdrawnAt?: string }).withdrawnAt ?? r.updatedAt)), L)}</Badge>}
          {sla && <SlaClock due={sla.dueAt.toISOString()} opened={sla.openedAt.toISOString()} />}
          <span>{timeAgo(r.createdAt, L)}</span>
          {reach && <Badge tone="info" dot><span data-testid="request-reach">{t(CONTACT_LABEL[reach.preference])}{reach.window ? <> · <bdi>{reach.window}</bdi></> : null}</span></Badge>}
          {x.contact && <ContactBadge contact={x.contact} requestId={r.id} canAct={act} action={confirmCallAction} locale={L} />}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 text-[13.5px] text-ink-3">
          <CustomerLink id={x.user.id} className="text-ink">{x.user.name || t("Traveller")}</CustomerLink>
          {x.user.phone && <a href={`tel:${x.user.phone}`} className="num inline-flex items-center gap-1 hover:text-ink" dir="ltr"><Phone className="size-3.5" />{x.user.phone}</a>}
          {x.travellers.length > 0 && <span>{x.travellers.map((p) => p.name.split(" ")[0]).join(", ")}</span>}
          {copyLinks.map((p) => <a key={p.id} href={`/adminwork/desk/passport-copy/${r.id}/${p.id}`} target="_blank" rel="noopener noreferrer" title={t("Passport copies open while this booking needs them, and every look is logged.")} className="text-info underline-offset-2 hover:underline">{t("Passport copy")} · {p.name.split(" ")[0]}</a>)}
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Card><Journey steps={steps} /></Card>
          {place && (
            <Card className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2"><Badge tone="info">{t("Destination")}</Badge><span className="text-[12.5px] text-ink-3">{t("Plan it with Mada: the team plans and books it by hand.")}</span></div>
                <div className="text-[22px] font-[400] tracking-[-0.02em]">{place.name}{place.country ? `, ${place.country}` : ""}</div>
                {place.airports.length > 0 && <div className="mt-1 text-[13px] text-ink-3">{t("Nearest airports")}: <span className="num" dir="ltr">{place.airports.join(" · ")}</span></div>}
                {place.message && <p className="mt-2 rounded-2xl bg-surface-2 px-3.5 py-2 text-[13.5px] text-ink-2">{place.message}</p>}
              </div>
              <a href={place.guideUrl} target="_blank" rel="noopener noreferrer" className={btn("outline", "sm")}>{t("City guide")} ↗</a>
            </Card>
          )}
          {r.kind === "activity" && <ActivityCard id={r.id} details={r.details} act={act} t={t} />}
          {fr ? (
            <Card>
              <CardHead title={t("What they asked for")} hint={t("Book it in Mada's system, then send the fares from here.")} />
              <KV cols={3} items={fr.rows} />
              {fr.note && <p className="mt-3 rounded-2xl bg-surface-2 px-3.5 py-2 text-[13.5px] text-ink-2">“{fr.note}”</p>}
            </Card>
          ) : (
          <Card>
            <CardHead title={t("What they asked for")} />
            {asked.length ? <KV cols={3} items={asked.map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])} /> : <p className="text-[13.5px] text-ink-2">{r.summary}</p>}
            {r.kind === "umrah" && <p className="mt-3 rounded-2xl bg-info-soft px-3.5 py-2.5 text-[13px] text-info">{t("Every traveller needs their own Nusuk permit.")}</p>}
          </Card>
          )}
          {fr && act && !closed && (
            <Card>
              <CardHead title={quote ? t("Send new fares") : t("Send the fares")} hint={t("A price for each traveller, bags and rules for each fare. The traveller picks one and pays in the app.")} />
              <FlightQuoteBuilder action={flightQuoteAction} requestId={r.id} travellers={fr.travellers} seed={fr.seed} />
            </Card>
          )}

          {planned && (planned.linked || (act && planned.candidates.length > 0)) && (
            <Card data-testid="request-plan-item">
              <CardHead title={t("Plan item")} hint={t("The part of the traveller's plan this request fulfils. Booked by hand? Link it so the plan shows it.")} />
              {planned.linked ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-2 px-3.5 py-2.5 text-[13.5px]">
                  <span className="min-w-0"><bdi>{planned.linked.planTitle}</bdi> · {planned.linked.day == null ? t("Whole trip") : t("Day {n}", { n: planned.linked.day + 1 })} · <bdi className="text-ink">{planned.linked.title}</bdi></span>
                  <Link href={`/adminwork/desk/customers/${x.user.id}?tab=plans`} className="text-info underline-offset-2 hover:underline">{t("Open the plan")}</Link>
                </div>
              ) : (
                <ActionForm action={linkPlanItemAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <select name="itemId" required className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-[13.5px]" defaultValue="">
                    <option value="" disabled>{t("Choose the plan item")}</option>
                    {planned.candidates.map((c) => <option key={c.itemId} value={c.itemId}>{c.label}</option>)}
                  </select>
                  <SubmitButton>{t("Link to plan item")}</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}

          <Card>
            <CardHead title={t("Conversation")} hint={t("Replies go out in your agent name. Notes stay with the team.")} />
            <div className="mb-4 max-h-[520px] overflow-y-auto pe-1"><Thread messages={x.messages} notes={x.notes} travellerName={x.user.name || t("Traveller")} /></div>
            {act && <Composer action={replyAction} typing={typingAction} threadKind="request" threadId={r.id} agentName={me?.displayName ?? u.name.split(" ")[0]!} canned={canned.map((c) => ({ id: c.id, title: c.title, en: c.bodyEn, ar: c.bodyAr }))} locale={L} />}
          </Card>
          <DeskTimeline entityId={r.id} />
        </div>

        <aside className="space-y-4">
          {act && !closed && (
            <Card className="ring-2 ring-gold/40">
              <CardHead title={t("Next step")} hint={fr ? (quote ? t("Fares sent. Answer questions, then finish it once it's booked.") : t("Send the fares from the builder on the left.")) : !quote ? t("A line for each person, so everyone sees their share.") : r.status === "with_agent" ? t("Paid. Book it, then mark it done.") : t("Quote sent. Answer questions, or send a new quote.")} />
              {!fr && !quote && <div className="mb-4"><QuoteBuilder action={quoteAction} requestId={r.id} people={x.travellers.map((p) => p.name.split(" ")[0]!)} defaultKind={r.kind} /></div>}
              {!fr && quote && (
                <details className="mb-3 rounded-2xl bg-surface-2 px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="cursor-pointer text-[13.5px] text-ink">{t("Send a new quote")}</summary>
                  <div className="mt-3"><QuoteBuilder action={quoteAction} requestId={r.id} people={x.travellers.map((p) => p.name.split(" ")[0]!)} defaultKind={r.kind} /></div>
                </details>
              )}
              <details className="mb-3 rounded-2xl bg-surface-2 px-4 py-3 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer items-center gap-2 text-[13.5px] text-ink"><CircleHelp className="size-4 text-ink-3" />{t("Ask the traveller")}</summary>
                <ActionForm action={askAction} className="mt-3 space-y-2">
                  <input type="hidden" name="id" value={r.id} />
                  <Textarea name="question" rows={2} required maxLength={300} placeholder={t("Which date suits you for the VFS appointment?")} />
                  <div className="grid grid-cols-2 gap-2"><Input name="choice" maxLength={40} placeholder={t("Answer 1")} /><Input name="choice" maxLength={40} placeholder={t("Answer 2")} /></div>
                  <SubmitButton variant="outline" className="w-full">{t("Send the question")}</SubmitButton>
                </ActionForm>
              </details>
              <ActionForm action={doneAction}>
                <input type="hidden" name="id" value={r.id} />
                <SubmitButton className="w-full" confirm={t("Mark this request done? The traveller is told.")}><Check className="size-4" />{t("Mark done")}</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {quote && (
            <Card>
              <CardHead title={t("Quote sent")} hint={`${fmtDate(quote.createdAt, L, true)}${quote.expiresAt ? ` · ${t("held until {time}", { time: fmtDate(quote.expiresAt, L, true) })}` : ""}`} action={<Badge tone={quote.status === "accepted" ? "ok" : "info"}>{t(quote.status === "accepted" ? "Accepted" : quote.status === "expired" ? "Expired" : "Open")}</Badge>} />
              {flightQuote ? <FlightQuoteSummary quote={flightQuote} locale={L} /> : null}
              {!flightQuote && <dl className="divide-y divide-line">{quote.lines.map((l, i) => <div key={i} className="flex justify-between gap-3 py-2 text-[13.5px]"><dt className="text-ink-2">{l.label}</dt><dd><Money v={l.amount} /></dd></div>)}</dl>}
              <div className="mt-2 flex justify-between border-t border-line-strong pt-2.5"><span className="text-[13px] text-ink-3">{t(flightQuote ? "From" : "Total")}</span><Money v={quote.total} className="text-[18px]" /></div>
              {quote.cancellation && <p className="mt-2 text-[12.5px] text-ink-3">{quote.cancellation}</p>}
            </Card>
          )}
          {checklist.length > 0 && (
            <Card>
              <CardHead title={t(r.kind === "umrah" ? "Umrah checklist" : r.kind === "visa" ? "Visa checklist" : "Checklist")} hint={t("{done} of {n} ready", { done: checklist.filter((c) => c.done).length, n: checklist.length })} action={<ListChecks className="size-4 text-ink-3" />} />
              <ActionForm action={checklistAction} className="space-y-1.5">
                <input type="hidden" name="id" value={r.id} />
                {checklist.map((c, i) => (
                  <label key={i} className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-2">
                    <input type="hidden" name="item" value={c.label} />
                    <input type="checkbox" name="done" value={String(i)} defaultChecked={c.done} disabled={!act} className="peer sr-only" />
                    <span className={cx("grid size-5 shrink-0 place-items-center rounded-md ring-1 ring-line-strong transition peer-checked:bg-ok peer-checked:ring-ok [&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100")}><Check className="size-3.5 text-white" strokeWidth={3} /></span>
                    <span className="text-[13.5px] text-ink-2">{t(c.label)}</span>
                  </label>
                ))}
                {act && <div className="flex gap-2 pt-2"><Input name="newItem" maxLength={80} placeholder={t("Add an item")} className="min-w-0 flex-1" /><SubmitButton variant="outline">{t("Save")}</SubmitButton></div>}
              </ActionForm>
            </Card>
          )}
          <OutcomeCard requestId={r.id} act={act} open={!closed} result={closed ? resultOfRequest(r) : null} progress={progressOfRequest(r)} t={t} />
          <HotelbedsCard requestId={r.id} details={r.details as Record<string, unknown>} act={act} finance={canDeskFinance(u)} t={t} />
          <AssignCard kind="request" id={r.id} userId={r.ownerId} canAct={act} />
          <TicketsCard about={{ kind: "request", id: r.id }} customerId={r.ownerId} subject={r.summary} canAct={act} />
        </aside>
      </div>
    </>
  );
}
