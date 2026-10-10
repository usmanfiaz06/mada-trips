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
import { slaFor } from "@/lib/app/desk/sla";
import { Badge, Card, CardHead, Input, Money, Textarea, btn, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { AssignCard } from "@/components/desk/assign";
import { Composer, QuoteBuilder } from "@/components/desk/forms";
import { SlaClock } from "@/components/desk/live";
import { DeskTimeline, Facts, REQUEST_STATUS, StatusBadge, Thread } from "@/components/desk/parts";
import { askAction, checklistAction, doneAction, quoteAction, replyAction, typingAction } from "../../actions";

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
  const asked = Object.entries(r.details).filter(([k]) => !["desk", "offer", "place", "message"].includes(k)).slice(0, 12);
  const quote = x.quotes.find((q) => q.status !== "withdrawn");
  const place = r.kind === "destination" ? destinationOf(r.details) : null;

  return (
    <>
      <Link href="/adminwork/desk/requests" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Requests")}</Link>
      <header className="mb-6 animate-rise">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
          <span className="num">{x.ref}</span><StatusBadge map={REQUEST_STATUS} value={r.status} />
          {sla && <SlaClock due={sla.dueAt.toISOString()} opened={sla.openedAt.toISOString()} />}
          <span>· {timeAgo(r.createdAt, L)}</span>
        </div>
        <h1 className="mt-2 text-[32px] font-[380] leading-tight tracking-[-0.03em]">{r.summary}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 text-[13.5px] text-ink-3">
          <span className="text-ink">{x.user.name || t("Traveller")}</span>
          {x.user.phone && <a href={`tel:${x.user.phone}`} className="num inline-flex items-center gap-1 hover:text-ink" dir="ltr"><Phone className="size-3.5" />{x.user.phone}</a>}
          {x.travellers.length > 0 && <span>{x.travellers.map((p) => p.name.split(" ")[0]).join(", ")}</span>}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
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
          <Card>
            <CardHead title={t("What they asked for")} />
            {asked.length ? <Facts rows={asked.map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])} /> : <p className="text-[13.5px] text-ink-2">{r.summary}</p>}
            {r.kind === "umrah" && <p className="mt-3 rounded-2xl bg-info-soft px-3.5 py-2.5 text-[13px] text-info">{t("Every traveller needs their own Nusuk permit.")}</p>}
          </Card>

          <Card>
            <CardHead title={t("Conversation")} hint={t("Replies go out in your agent name. Notes stay with the team.")} />
            <div className="mb-4 max-h-[520px] overflow-y-auto pe-1"><Thread messages={x.messages} notes={x.notes} travellerName={x.user.name || t("Traveller")} /></div>
            {act && <Composer action={replyAction} typing={typingAction} threadKind="request" threadId={r.id} agentName={me?.displayName ?? u.name.split(" ")[0]!} canned={canned.map((c) => ({ id: c.id, title: c.title, en: c.bodyEn, ar: c.bodyAr }))} locale={L} />}
          </Card>
          <DeskTimeline entityId={r.id} />
        </div>

        <aside className="space-y-4">
          {quote && (
            <Card>
              <CardHead title={t("Quote sent")} hint={`${fmtDate(quote.createdAt, L, true)}${quote.expiresAt ? ` · ${t("held until {time}", { time: fmtDate(quote.expiresAt, L, true) })}` : ""}`} action={<Badge tone={quote.status === "accepted" ? "ok" : "info"}>{t(quote.status === "accepted" ? "Accepted" : quote.status === "expired" ? "Expired" : "Open")}</Badge>} />
              <dl className="divide-y divide-line">{quote.lines.map((l, i) => <div key={i} className="flex justify-between gap-3 py-2 text-[13.5px]"><dt className="text-ink-2">{l.label}</dt><dd><Money v={l.amount} /></dd></div>)}</dl>
              <div className="mt-2 flex justify-between border-t border-line-strong pt-2.5"><span className="text-[13px] text-ink-3">{t("Total")}</span><Money v={quote.total} className="text-[18px]" /></div>
              {quote.cancellation && <p className="mt-2 text-[12.5px] text-ink-3">{quote.cancellation}</p>}
            </Card>
          )}
          {act && !closed && (
            <Card>
              <CardHead title={quote ? t("Send a new quote") : t("Build the quote")} hint={t("A line for each person, so everyone sees their share.")} />
              <QuoteBuilder action={quoteAction} requestId={r.id} people={x.travellers.map((p) => p.name.split(" ")[0]!)} defaultKind={r.kind} />
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
          {act && !closed && (
            <Card>
              <CardHead title={t("Ask or finish")} />
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
          <AssignCard kind="request" id={r.id} userId={r.ownerId} canAct={act} />
        </aside>
      </div>
    </>
  );
}
