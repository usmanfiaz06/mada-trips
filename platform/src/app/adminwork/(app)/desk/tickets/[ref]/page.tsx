import Link from "next/link";
import { notFound } from "next/navigation";
import { desc } from "drizzle-orm";
import { ArrowUpRight, Clock, Flag, GitMerge, Hand, LifeBuoy, PauseCircle, PlayCircle, RotateCcw, CheckCircle2 } from "lucide-react";
import { db } from "@/db";
import { appDeskCanned } from "@/db/app-schema-desk";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { TICKET_PRIORITY, TICKET_STATUS } from "@/lib/labels";
import { agentForOps, loadRota } from "@/lib/app/desk/agents";
import { travellerName } from "@/lib/app/desk/core";
import { TICKET_PRIORITIES, ticketSla } from "@/lib/app/desk/sla";
import { getTicket, linkHref, syncTickets } from "@/lib/app/desk/tickets";
import { Avatar, Badge, Card, CardHead, KV, LinkButton, Money, PageHeader, Table, Td, Th, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { Journey, type JourneyStep } from "@/components/journey";
import { Composer } from "@/components/desk/forms";
import { KIND_META } from "@/components/desk/kinds";
import { AutoRefresh, SlaClock } from "@/components/desk/live";
import { DeskTimeline, StatusBadge, Thread } from "@/components/desk/parts";
import { assignTicketAction, mergeTicketAction, moveTicketAction, replyAction, takeTicketAction, ticketPropsAction, typingAction } from "../../actions";

export const metadata = { title: "Ticket · Desk" };

const LINK_LABEL: Record<string, string> = {
  order: "Order", request: "Request", chat: "Chat", refund: "Refund", esim: "eSIM", disruption: "Disruption", moderation: "Moderation",
  recovery: "Account recovery", ask_thread: "Ask thread", customer: "Customer", ticket: "Merged ticket",
};
const WAITING: Record<string, string> = { waiting_customer: "Waiting on customer", waiting_supplier: "Waiting on supplier" };

export default async function TicketPage({ params }: { params: Promise<{ ref: string }> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const { ref } = await params;
  // Up to date with its source first: an order issued a moment ago shows its ticket resolved.
  await syncTickets().catch(() => null);
  const [x, me, rota, canned] = await Promise.all([getTicket(decodeURIComponent(ref)), agentForOps(u.id), loadRota(), db.select().from(appDeskCanned).orderBy(appDeskCanned.sort, desc(appDeskCanned.createdAt))]);
  if (!x) notFound();
  const k = x.ticket;
  const act = can(u, "desk.act");
  const manage = can(u, "desk.tickets.manage");
  const running = k.status === "new" || k.status === "open";
  const waiting = k.status === "waiting_customer" || k.status === "waiting_supplier";
  const mine = !!me && k.ownerAgentId === me.id;
  const theirs = k.ownerReason === "manual" && !!k.ownerAgentId && !mine;
  const sla = ticketSla(k);
  const traveller = x.user ? x.user.name || t("Traveller") : null;
  const order = ["new", "open", "waiting", "resolved", "closed"];
  const at = order.indexOf(waiting ? "waiting" : k.status);
  const steps: JourneyStep[] = [
    { label: t("New"), state: at > 0 ? "done" : "current", meta: fmtDate(k.openedAt, L, true) },
    { label: t("Open"), state: at > 1 ? "done" : at === 1 ? "current" : "todo", meta: k.firstResponseAt ? t("First reply {when}", { when: timeAgo(k.firstResponseAt, L) }) : undefined },
    { label: t(WAITING[k.status] ?? "Waiting"), state: waiting ? "current" : at > 2 ? "done" : k.status === "closed" && k.mergedIntoId ? "skipped" : "todo", meta: waiting && k.pausedAt ? t("Clock paused {when}", { when: timeAgo(k.pausedAt, L) }) : undefined },
    { label: t("Resolved"), state: at > 3 ? "done" : at === 3 ? "current" : "todo", meta: k.resolvedAt ? fmtDate(k.resolvedAt, L, true) : undefined },
    { label: k.mergedIntoId ? t("Merged") : t("Closed"), state: at === 4 ? "done" : "todo", meta: x.mergedInto ? x.mergedInto : k.closedAt ? fmtDate(k.closedAt, L, true) : undefined },
  ];
  const M = KIND_META[k.kind] ?? KIND_META.manual!;
  const agents = rota.agents.filter((a) => a.active);
  const say = (s: string | null) => (s ? t(s) : "");

  return (
    <>
      <AutoRefresh every={20} />
      <PageHeader eyebrow={<><span className="num" dir="ltr">{x.ref}</span> · {t(M.label)}{k.category ? ` · ${k.category}` : ""}</>} title={<bdi>{k.subject}</bdi>}
        actions={<>
          <StatusBadge map={TICKET_STATUS} value={k.status} />
          <StatusBadge map={TICKET_PRIORITY} value={k.priority} />
          {k.reopenedCount > 0 && <Badge tone="warn">{t("Reopened {n}×", { n: k.reopenedCount })}</Badge>}
        </>} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Card><Journey steps={steps} /></Card>

          <Card>
            <CardHead title={t("Conversation")} hint={x.thread ? (x.thread.kind === "request" ? t("The order's or request's thread with the traveller") : t("The traveller's support chat")) : x.user ? t("Your first reply opens a support chat with the traveller") : t("Notes for the team only: this ticket has no traveller")}
              action={x.thread ? <Link href={`/adminwork/desk/chats?t=${x.thread.kind}:${x.thread.id}`} className="text-[12.5px] text-ink-3 underline decoration-gold decoration-2 underline-offset-4 hover:text-ink">{t("Open in Chats")}</Link> : null} />
            <div className="max-h-[560px] overflow-y-auto pe-1">
              <Thread messages={x.messages} notes={x.notes} travellerName={traveller ?? t("Traveller")} empty={t("No messages yet. Notes you add show here for the team.")} />
            </div>
            {act && k.status !== "closed" && (
              <div className="mt-4 border-t border-line pt-4">
                <Composer action={replyAction} typing={typingAction} threadKind="ticket" threadId={k.id} agentName={me?.displayName ?? u.name.split(" ")[0]!}
                  canned={canned.map((c) => ({ id: c.id, title: c.title, en: c.bodyEn, ar: c.bodyAr }))} locale={L} />
              </div>
            )}
          </Card>

          <Card pad={false}>
            <div className="p-6 pb-3"><CardHead className="mb-0" title={t("Linked records")} hint={t("{n} linked", { n: x.links.length })} /></div>
            {x.links.length === 0 ? <p className="px-6 pb-6 text-[13px] text-ink-3">{t("Nothing linked yet.")}</p> : (
              <Table>
                <thead><tr><Th>{t("Type")}</Th><Th>{t("Record")}</Th><Th align="end">{t("Linked")}</Th></tr></thead>
                <tbody>
                  {x.links.map((l) => {
                    const href = l.entityKind === "ticket" ? `/adminwork/desk/tickets/${l.label ?? l.entityId}` : linkHref(l.entityKind, l.entityId);
                    const label = l.entityKind === "customer" && x.user?.id === l.entityId ? traveller : l.label ?? (l.entityKind === k.sourceKind && l.entityId === k.sourceId ? k.subject : l.entityId.slice(0, 18));
                    return (
                      <tr key={`${l.entityKind}:${l.entityId}`} className="group transition hover:bg-surface-2">
                        <Td className="whitespace-nowrap">{t(LINK_LABEL[l.entityKind] ?? l.entityKind)}</Td>
                        <Td>{href ? <Link href={href} className="inline-flex items-center gap-1 text-ink decoration-gold decoration-2 underline-offset-4 hover:underline"><bdi className="max-w-[360px] truncate">{label}</bdi><ArrowUpRight className="size-3.5 text-ink-3 rtl:-scale-x-100" /></Link> : <bdi>{label}</bdi>}</Td>
                        <Td align="end" className="whitespace-nowrap text-[12.5px] text-ink-3">{timeAgo(l.createdAt, L)}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHead title={t("Ticket history")} action={<span className="text-[12px] text-ink-3">{t("{n} entries", { n: x.events.length })}</span>} />
            <ol className="relative space-y-4 before:absolute before:inset-y-2 before:start-[13px] before:w-px before:bg-line">
              {x.events.map(({ e, name }) => (
                <li key={e.id} className="relative flex gap-3" data-testid="ticket-event">
                  <span className="relative z-[1] mt-1 grid size-7 shrink-0 place-items-center"><span className={cx("size-2.5 rounded-full border-2 border-surface ring-4 ring-surface", e.kind === "escalated" ? "bg-bad" : e.kind === "note" ? "bg-gold" : "bg-ink-4")} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-ink-3"><span className="font-medium text-ink">{name ?? t("Mada desk")}</span><span title={fmtDate(e.at, L, true)}>{timeAgo(e.at, L)}</span></div>
                    <div className="mt-0.5 text-[13.5px] text-ink-2">
                      {e.kind === "created" ? t("Opened") : e.kind === "status" ? `${t(TICKET_STATUS[e.from ?? ""]?.label ?? e.from ?? "")} → ${t(TICKET_STATUS[e.to ?? ""]?.label ?? e.to ?? "")}`
                        : e.kind === "reopened" ? t("Reopened") : e.kind === "assigned" ? (e.to ? t("Gave it to {name}", { name: e.to }) : t("Back on the rota"))
                        : e.kind === "priority" ? t("Priority: {from} → {to}", { from: t(TICKET_PRIORITY[e.from ?? ""]?.label ?? ""), to: t(TICKET_PRIORITY[e.to ?? ""]?.label ?? "") })
                        : e.kind === "category" ? t("Category: {to}", { to: e.to ?? "—" }) : e.kind === "tags" ? t("Tags: {to}", { to: e.to ?? "—" })
                        : e.kind === "note" ? t("Added a note") : e.kind === "reply" ? (e.data?.first ? t("First reply to the traveller") : t("Replied to the traveller"))
                        : e.kind === "escalated" ? (e.to === "cleared" ? t("Cleared the escalation") : t("Escalated")) : e.kind === "merged" ? t("Merged") : e.kind}
                      {e.body && e.kind !== "assigned" && <span className="text-ink-3"> · {e.actorId && (e.kind === "note" || e.kind === "escalated" || e.kind === "status") ? e.body : say(e.body)}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card className="ring-2 ring-gold/40" data-testid="next-action">
            <CardHead title={t("Next")} hint={k.status === "closed" ? (x.mergedInto ? t("Merged into {ref}", { ref: x.mergedInto }) : t("Closed for good. A new message opens a new ticket.")) : k.status === "resolved" ? t("Resolved. It reopens if the traveller writes again or its source needs the desk.") : waiting ? t("The clock is paused while we wait. Resume it when they answer.") : k.need ? t(k.need) : t("Work it, reply, then resolve.")} />
            {running && (
              <div className="mb-4 flex items-center justify-between rounded-2xl bg-surface-2 px-3.5 py-2.5 text-[13px]">
                <span className="inline-flex items-center gap-1.5 text-ink-3"><Clock className="size-3.5" />{t("Promise")}</span>
                <SlaClock due={sla.dueAt.toISOString()} opened={sla.openedAt.toISOString()} />
              </div>
            )}
            {k.escalatedAt && running && <div className="mb-4 flex gap-2 rounded-2xl bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad"><Flag className="mt-0.5 size-3.5 shrink-0" /><span>{k.escalationNote ?? (k.escalationLevel >= 2 ? t("Twice past its promise: the partners are told") : t("Past its promise: the lead is told"))}</span></div>}
            {act && (
              <div className="grid gap-2">
                {running && k.href && <LinkButton href={k.href} variant="gold" className="w-full">{t(k.need || "Open it")}<ArrowUpRight className="size-4 rtl:-scale-x-100" /></LinkButton>}
                {running && !mine && me && (!theirs || manage) && (
                  <ActionForm action={takeTicketAction}><input type="hidden" name="id" value={k.id} /><SubmitButton variant={k.href ? "outline" : "primary"} className="w-full"><Hand className="size-4" />{t("Take it")}</SubmitButton></ActionForm>
                )}
                {k.status !== "closed" && (
                  <ActionForm action={moveTicketAction} className="grid gap-2">
                    <input type="hidden" name="id" value={k.id} />
                    {running && <div className="grid grid-cols-2 gap-2">
                      <SubmitButton name="move" value="wait_customer" variant="soft" size="sm"><PauseCircle className="size-3.5" />{t("Wait on customer")}</SubmitButton>
                      <SubmitButton name="move" value="wait_supplier" variant="soft" size="sm"><PauseCircle className="size-3.5" />{t("Wait on supplier")}</SubmitButton>
                    </div>}
                    {waiting && <SubmitButton name="move" value={k.status === "waiting_supplier" ? "supplier_answered" : "customer_replied"} variant="primary"><PlayCircle className="size-4" />{t(k.status === "waiting_supplier" ? "Supplier answered" : "Customer answered")}</SubmitButton>}
                    {(running || waiting) && <SubmitButton name="move" value="resolve" variant={k.href ? "ghost" : "outline"}><CheckCircle2 className="size-4" />{t("Resolve")}</SubmitButton>}
                    {k.status === "resolved" && <div className="grid grid-cols-2 gap-2">
                      <SubmitButton name="move" value="reopen" variant="outline" size="sm"><RotateCcw className="size-3.5" />{t("Reopen")}</SubmitButton>
                      <SubmitButton name="move" value="close" variant="ghost" size="sm">{t("Close now")}</SubmitButton>
                    </div>}
                  </ActionForm>
                )}
              </div>
            )}
            {x.mergedInto && <LinkButton href={`/adminwork/desk/tickets/${x.mergedInto}`} variant="outline" className="mt-2 w-full"><GitMerge className="size-4" />{x.mergedInto}</LinkButton>}
          </Card>

          <Card>
            <CardHead title={t("Properties")} />
            <KV cols={2} items={[
              [t("Opened"), <span key="o" title={fmtDate(k.openedAt, L, true)}>{timeAgo(k.openedAt, L)}</span>],
              [t("First reply"), k.firstResponseAt ? <span key="f" title={fmtDate(k.firstResponseAt, L, true)}>{timeAgo(k.firstResponseAt, L)}</span> : "—"],
              [t("Promise"), t("{n} min", { n: k.slaMinutes })],
              [t("Due"), k.pausedAt ? t("Paused") : <span key="d" title={fmtDate(k.dueAt, L, true)}>{fmtDate(k.dueAt, L, true)}</span>],
              ...(k.amount ? [[t("Value"), <Money key="v" v={k.amount} />] as [string, React.ReactNode]] : []),
              ...(k.csat ? [[t("Rating"), `${k.csat}/5`] as [string, React.ReactNode]] : []),
            ]} />
            {act && k.status !== "closed" && (
              <div className="mt-5 space-y-3 border-t border-line pt-4">
                <ActionForm action={assignTicketAction} className="flex gap-2">
                  <input type="hidden" name="id" value={k.id} />
                  <select name="agentId" defaultValue={k.ownerReason === "manual" ? k.ownerAgentId ?? "rota" : "rota"} className="field min-w-0 flex-1" aria-label={t("Owner")} disabled={theirs && !manage}>
                    <option value="rota">{t("Follow the rota")}{k.ownerReason !== "manual" && x.owner ? ` · ${x.owner.displayName}` : ""}</option>
                    {agents.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
                  </select>
                  {(!theirs || manage) && <SubmitButton variant="outline">{t("Hand on")}</SubmitButton>}
                </ActionForm>
                {theirs && !manage && <p className="text-[12px] text-ink-3">{t("Only a lead can move someone else's ticket")}</p>}
                <ActionForm action={ticketPropsAction} className="grid gap-2">
                  <input type="hidden" name="id" value={k.id} />
                  {!k.sourceId && <input name="subject" defaultValue={k.subject} className="field" maxLength={200} aria-label={t("Subject")} />}
                  <div className="grid grid-cols-2 gap-2">
                    <select name="priority" defaultValue={k.priority} className="field" aria-label={t("Priority")}>
                      {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{t(TICKET_PRIORITY[p]!.label)}</option>)}
                    </select>
                    <input name="category" defaultValue={k.category ?? ""} className="field" maxLength={60} placeholder={t("Category")} aria-label={t("Category")} />
                  </div>
                  <input name="tags" defaultValue={k.tags.join(", ")} className="field" placeholder={t("Tags, comma separated")} aria-label={t("Tags")} />
                  <SubmitButton variant="soft" size="sm">{t("Save")}</SubmitButton>
                </ActionForm>
              </div>
            )}
            {!act && k.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{k.tags.map((g) => <Badge key={g}>{g}</Badge>)}</div>}
          </Card>

          <Card>
            <CardHead title={t("Who has it")} />
            <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
              {x.owner ? <Avatar name={x.owner.displayName} size={36} /> : <span className="grid size-9 place-items-center rounded-full bg-warn-soft text-warn"><LifeBuoy className="size-4" /></span>}
              <div className="min-w-0 text-[13.5px] leading-tight">
                <div className="text-ink">{x.owner?.displayName ?? t("Shared queue")}{mine ? ` · ${t("You")}` : ""}</div>
                <div className="text-[12px] text-ink-3">{t(k.ownerReason === "primary" ? "Their agent, on shift" : k.ownerReason === "covering" ? "Covering tonight" : k.ownerReason === "manual" ? "Assigned by hand" : "First free hand takes it")}</div>
              </div>
            </div>
          </Card>

          {x.user && (
            <Card>
              <CardHead title={t("Customer")} />
              <div className="flex items-center gap-3">
                <Avatar name={traveller ?? "?"} size={40} />
                <div className="min-w-0 leading-tight">
                  <Link href={`/adminwork/desk/customers/${x.user.id}`} className="block truncate text-[14.5px] text-ink decoration-gold decoration-2 underline-offset-4 hover:underline"><bdi>{travellerName(x.user.name)}</bdi></Link>
                  {x.user.phone && <span className="num block text-[12.5px] text-ink-3" dir="ltr">{x.user.phone}</span>}
                  {x.user.email && <span className="block truncate text-[12.5px] text-ink-3" dir="ltr">{x.user.email}</span>}
                </div>
              </div>
            </Card>
          )}

          {manage && k.status !== "closed" && (
            <Card>
              <CardHead title={t("Merge")} hint={t("Same problem twice? Merge this ticket into the other: its links and notes move there, and this one closes.")} />
              <ActionForm action={mergeTicketAction} className="flex gap-2">
                <input type="hidden" name="id" value={k.id} />
                <input name="into" className="field num min-w-0 flex-1" placeholder="T-000123" dir="ltr" required aria-label={t("Ticket to merge into")} />
                <SubmitButton variant="outline" confirm={t("Merge {ref} into the other ticket? This one closes.", { ref: x.ref })}><GitMerge className="size-4" />{t("Merge")}</SubmitButton>
              </ActionForm>
              {x.merged.length > 0 && <p className="mt-3 text-[12.5px] text-ink-3">{t("Merged in: {refs}", { refs: x.merged.map((m) => `T-${String(m.number).padStart(6, "0")}`).join(", ") })}</p>}
            </Card>
          )}

          <DeskTimeline entityId={k.id} />
        </aside>
      </div>
    </>
  );
}
