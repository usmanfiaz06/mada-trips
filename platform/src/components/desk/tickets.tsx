import Link from "next/link";
import { LifeBuoy, Plus } from "lucide-react";
import { getT } from "@/lib/i18n";
import { timeAgo } from "@/lib/dates";
import { TICKET_PRIORITY, TICKET_STATUS } from "@/lib/labels";
import { ticketHref, ticketRef, ticketsFor, type LinkKind } from "@/lib/app/desk/tickets";
import { TICKET_PRIORITIES } from "@/lib/app/desk/sla";
import { Badge, Card, CardHead, Field } from "../ui";
import { ActionForm, SubmitButton } from "../client";
import { createTicketAction } from "@/app/adminwork/(app)/desk/actions";

/* The ticket pieces other desk pages use: the Tickets card on an order, request, chat or customer, and the form. */

/** The fields of a new ticket. With `about`, it's opened from that thing and linked to it (and its traveller). */
export async function NewTicketFields({ about, customerId, subject, blank }: { about?: { kind: LinkKind; id: string } | null; customerId?: string | null; subject?: string; blank?: boolean }) {
  const t = await getT();
  return (
    <div className="grid gap-3">
      {about && <><input type="hidden" name="aboutKind" value={about.kind} /><input type="hidden" name="aboutId" value={about.id} /></>}
      {customerId && <input type="hidden" name="customerId" value={customerId} />}
      <Field label={t("Subject")} required><input name="subject" defaultValue={subject} className="field" maxLength={200} required minLength={3} placeholder={t("What needs doing?")} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("Priority")}>
          <select name="priority" defaultValue="normal" className="field">
            {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{t(TICKET_PRIORITY[p]!.label)}</option>)}
          </select>
        </Field>
        <Field label={t("Category")}><input name="category" className="field" maxLength={60} placeholder={t("Change, complaint, visa…")} /></Field>
      </div>
      {blank && !customerId && <Field label={t("Traveller")} hint={t("Their phone or email, if it's about someone")}><input name="customer" className="field" dir="ltr" maxLength={120} placeholder="+9665… / name@…" /></Field>}
      <Field label={t("Note for the team")} hint={t("Only the team sees this")}><textarea name="note" rows={3} className="field" maxLength={2000} /></Field>
    </div>
  );
}

/** The open tickets about one thing, and "Create ticket" for it. */
export async function TicketsCard({ about, customerId, subject, canAct }: { about: { kind: LinkKind; id: string }; customerId?: string | null; subject?: string; canAct: boolean }) {
  const t = await getT();
  const open = await ticketsFor(about.kind, about.id);
  return (
    <Card>
      <CardHead title={t("Tickets")} hint={open.length ? t("{n} open", { n: open.length }) : t("No open ticket")} />
      {open.length > 0 && (
        <ul className="mb-4 divide-y divide-line">
          {open.map((x) => (
            <li key={x.id} className="py-2.5 first:pt-0">
              <Link href={ticketHref(x)} className="group flex items-start gap-2.5">
                <LifeBuoy className="mt-0.5 size-4 shrink-0 text-gold" />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13.5px] text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4"><bdi>{x.subject}</bdi></span>
                  <span className="mt-0.5 block text-[12px] text-ink-3"><span className="num" dir="ltr">{ticketRef(x.number)}</span> · {timeAgo(x.lastActivityAt, t.locale)}</span>
                </span>
                <Badge tone={TICKET_STATUS[x.status]?.tone ?? "neutral"}>{t(TICKET_STATUS[x.status]?.label ?? x.status)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canAct && (
        <details className="group" data-testid="create-ticket">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13.5px] text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            <Plus className="size-4 text-gold transition group-open:rotate-45" />{t("Create ticket")}
          </summary>
          <ActionForm action={createTicketAction} className="mt-3 grid gap-3">
            <NewTicketFields about={about} customerId={customerId} subject={subject} />
            <SubmitButton variant="outline">{t("Create ticket")}</SubmitButton>
          </ActionForm>
        </details>
      )}
    </Card>
  );
}
