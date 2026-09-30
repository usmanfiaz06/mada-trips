import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, Link2, Mail, MessageCircle, Phone, UserPlus } from "lucide-react";
import { db, schema } from "@/db";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { isUuid } from "@/lib/security";
import { LEAD_SOURCE, LEAD_STATUS, LEAD_STATUSES, leadAssignees, telLink, waLink } from "@/lib/leads-server";
import { Timeline } from "@/components/record";
import { Badge, Card, CardHead, Field, KV, Select, Textarea, btn } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { createClientFromLead, updateLead } from "../actions";

export const metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePerm("leads.view");
  const t = await getT();
  const L = t.locale;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [row] = await db.select({ l: schema.leads, assignee: schema.users.name, client: schema.clients.name }).from(schema.leads)
    .leftJoin(schema.users, eq(schema.users.id, schema.leads.assignedTo))
    .leftJoin(schema.clients, eq(schema.clients.id, schema.leads.clientId))
    .where(eq(schema.leads.id, id));
  if (!row) notFound();
  const { l } = row;
  const manage = can(u, "leads.manage");
  const people = manage ? await leadAssignees() : [];
  // The current assignee always appears in the list, even if they've since lost access.
  const options = l.assignedTo && !people.some((p) => p.id === l.assignedTo) ? [{ id: l.assignedTo, name: row.assignee ?? "—" }, ...people] : people;
  const details = Object.entries((l.details as Record<string, string>) ?? {});
  const questions = (l.questions as string[]) ?? [];
  const wa = waLink(l.phone);

  return (
    <>
      <Link href="/adminwork/leads" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Leads")}</Link>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
          <span className="num">{l.ref}</span>
          <Badge tone={LEAD_STATUS[l.status]?.tone ?? "neutral"} dot>{t(LEAD_STATUS[l.status]?.label ?? l.status)}</Badge>
          <span>{t(LEAD_SOURCE[l.source] ?? l.source)} · {timeAgo(l.createdAt, L)}</span>
        </div>
        <h1 className="mt-2 text-[32px] font-[380] leading-tight tracking-[-0.03em]">{l.name || t("No name given")}</h1>
        <div className="mt-4 flex flex-wrap gap-2">
          {l.phone && <a href={telLink(l.phone)} className={btn("outline", "sm")}><Phone className="size-3.5" /><span className="num" dir="ltr">{l.phone}</span></a>}
          {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className={btn("soft", "sm")}><MessageCircle className="size-3.5" />WhatsApp</a>}
          {l.email && <a href={`mailto:${l.email}`} className={btn("outline", "sm")}><Mail className="size-3.5" /><span dir="ltr">{l.email}</span></a>}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHead title={t("Enquiry")} />
            <KV items={[
              [t("Services"), l.services.length ? l.services.join(", ") : "—"],
              [t("Language"), l.lang === "ar" ? "العربية" : l.lang === "en" ? "English" : "—"],
              [t("Received"), fmtDate(l.createdAt, L, true)],
              [t("Last update"), fmtDate(l.updatedAt, L, true)],
            ]} />
            {details.length > 0 && (
              <dl className="mt-5 divide-y divide-line rounded-2xl bg-surface-2 px-4">
                {details.map(([k, v]) => (
                  <div key={k} className="grid gap-1 py-2.5 sm:grid-cols-[200px_1fr] sm:gap-4">
                    <dt className="text-[12.5px] text-ink-3">{k}</dt>
                    <dd className="whitespace-pre-wrap break-words text-[14px] text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          {l.message && <Card><CardHead title={t("Message")} /><p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink-2">{l.message}</p></Card>}

          {questions.length > 0 && (
            <Card>
              <CardHead title={t("Questions asked")} hint={t("What they asked the website chat")} />
              <ul className="space-y-2">
                {questions.map((q, i) => <li key={i} className="inline-block max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-ss-md bg-sunken px-3.5 py-2 text-[14px] text-ink me-2">{q}</li>)}
              </ul>
            </Card>
          )}

          <Timeline entityType="lead" entityId={l.id} path={`/adminwork/leads/${l.id}`} refLabel={l.ref} />
        </div>

        <aside className="space-y-4">
          {manage ? (
            <Card>
              <CardHead title={t("Follow-up")} hint={t("Everyone involved sees the change in the timeline.")} />
              <ActionForm action={updateLead} className="space-y-3">
                <input type="hidden" name="id" value={l.id} />
                <Field label={t("Status")}><Select name="status" defaultValue={l.status} options={LEAD_STATUSES.map((s) => ({ value: s, label: t(LEAD_STATUS[s].label) }))} /></Field>
                <Field label={t("Assigned to")}><Select name="assignedTo" defaultValue={l.assignedTo ?? ""} placeholder={t("No one yet")} options={options.map((p) => ({ value: p.id, label: p.id === u.id ? `${p.name} (${t("Me")})` : p.name }))} /></Field>
                <Field label={t("Notes")}><Textarea name="notes" rows={4} maxLength={4000} defaultValue={l.notes ?? ""} /></Field>
                <SubmitButton className="w-full">{t("Save")}</SubmitButton>
              </ActionForm>
            </Card>
          ) : (
            <Card>
              <CardHead title={t("Follow-up")} />
              <KV cols={1} items={[[t("Assigned to"), row.assignee ?? t("No one yet")], [t("Notes"), l.notes ?? "—"]]} />
            </Card>
          )}

          <Card>
            <CardHead title={t("Client")} />
            {l.clientId ? (
              <Link href={`/adminwork/clients/${l.clientId}`} className="inline-flex items-center gap-1.5 text-[14px] underline decoration-gold decoration-2 underline-offset-4"><Link2 className="size-3.5" />{row.client}</Link>
            ) : manage && can(u, "clients.manage") ? (
              <ActionForm action={createClientFromLead} className="space-y-2">
                <input type="hidden" name="id" value={l.id} />
                <p className="text-[13px] text-ink-3">{t("Adds them as a retail client, or links the client who already has this phone or email.")}</p>
                <SubmitButton variant="outline" className="w-full"><UserPlus className="size-4" />{t("Create client")}</SubmitButton>
              </ActionForm>
            ) : <p className="text-[13px] text-ink-3">{t("Not a client yet")}</p>}
          </Card>

          <Card>
            <CardHead title={t("Where it came from")} />
            <KV cols={1} items={[
              [t("Source"), t(LEAD_SOURCE[l.source] ?? l.source)],
              [t("Page"), l.page ? <span dir="ltr">{l.page}</span> : "—"],
              [t("Device"), l.userAgent ? <span title={l.userAgent} className="text-[12.5px]">{l.userAgent}</span> : "—"],
            ]} />
          </Card>
        </aside>
      </div>
    </>
  );
}
