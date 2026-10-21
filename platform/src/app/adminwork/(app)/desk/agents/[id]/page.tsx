import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, CalendarClock, History, NotebookPen, Ticket, UserX } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, riyadhTime, timeAgo } from "@/lib/dates";
import { TICKET_STATUS } from "@/lib/labels";
import { isUuid } from "@/lib/security";
import { agentProfile, otherActiveAgents, supportRoles } from "@/lib/app/desk/agent-admin";
import { agentForOps } from "@/lib/app/desk/agents";
import { ticketHref, ticketRef } from "@/lib/app/desk/tickets";
import { Avatar, Badge, Card, CardHead, Empty, Field, Input, KV, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { ProfileFields, RoleTeamFields } from "@/components/desk/agent-fields";
import { deactivateAgentAction, reactivateAgentAction, updateAgentAction } from "../../agent-actions";

export const metadata = { title: "Agent · Desk" };

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [p, me, roles, others] = await Promise.all([agentProfile(id), agentForOps(u.id), supportRoles(), otherActiveAgents([id])]);
  if (!p) notFound();
  const admin = can(u, "desk.admin");
  // Other people's history is for leads (desk.reports); everyone sees their own.
  const mine = me?.id === p.agent.id;
  const full = mine || can(u, "desk.reports") || admin;
  const a = p.agent;
  const supportRole = roles.some((r) => r.key === p.role.key);
  return (
    <>
      <PageHeader eyebrow={<Link href="/adminwork/desk/agents" className="hover:text-ink">{t("Agents & roles")}</Link>} title={<span className="flex items-center gap-3"><Avatar name={a.displayName} size={44} /><bdi>{a.displayName}</bdi>{a.displayNameAr && <span className="text-[22px] text-ink-3">{a.displayNameAr}</span>}</span>}
        subtitle={<>{p.user.name} · <span dir="ltr">{p.user.email}</span> · {L === "ar" ? p.role.nameAr : p.role.name}</>}
        actions={<div className="flex items-center gap-2">{!a.active ? <Badge tone="neutral">{t("Deactivated")}</Badge> : <Badge tone={a.status === "online" ? "ok" : a.status === "away" ? "warn" : "neutral"} dot>{t(a.status === "online" ? "Online" : a.status === "away" ? "Away" : "Signed off")}</Badge>}
          {full && <Link href={`/adminwork/desk/performance?agent=${a.id}`} className="inline-flex h-9 items-center gap-2 rounded-full bg-surface px-4 text-[13px] text-ink-2 shadow-card hover:text-ink"><Activity className="size-4" />{t("Performance")}</Link>}</div>} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label={t("Open tickets")} value={<span className="num">{p.stats.open}</span>} href={`/adminwork/desk/tickets?o=${a.id}`} />
            <Stat label={t("Handled, 30 days")} value={<span className="num">{p.stats.handled30}</span>} href={`/adminwork/desk/tickets?o=${a.id}&s=resolved`} />
            <Stat label={t("CSAT, 30 days")} value={<span className="num">{p.stats.csatAvg == null ? "—" : p.stats.csatAvg.toFixed(1)}</span>} sub={t("{n} ratings", { n: p.stats.csatN })} />
            <Stat label={t("Reply time they promise")} value={<span className="num">{a.replyMinutes}</span>} sub={t("minutes")} />
          </div>

          <Card pad={false}>
            <div className="px-6 pt-6"><CardHead title={t("Tickets")} hint={t("The latest tickets they own.")} action={<Ticket className="size-4 text-ink-3" />} /></div>
            {p.tickets.length === 0 ? <Empty title={t("No tickets yet")} /> : (
              <Table>
                <thead><tr><Th>{t("Ticket")}</Th><Th>{t("Status")}</Th><Th>{t("Opened")}</Th><Th>{t("Resolved")}</Th><Th align="end">CSAT</Th></tr></thead>
                <tbody>
                  {p.tickets.map((x) => (
                    <tr key={x.id} className="group transition hover:bg-surface-2">
                      <Td><Link href={ticketHref(x)} className="block max-w-[340px]"><span className="num text-[12px] text-ink-3">{ticketRef(x.number)}</span> <span className="text-ink group-hover:underline">{x.subject}</span></Link></Td>
                      <Td><Badge tone={TICKET_STATUS[x.status]?.tone ?? "neutral"}>{t(TICKET_STATUS[x.status]?.label ?? x.status)}</Badge></Td>
                      <Td className="whitespace-nowrap text-ink-2">{fmtDate(x.openedAt, L, true)}</Td>
                      <Td className="whitespace-nowrap text-ink-2">{x.resolvedAt ? fmtDate(x.resolvedAt, L, true) : "—"}</Td>
                      <Td align="end" className="num">{x.csat ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {full && (
            <Card>
              <CardHead title={t("Notes they wrote")} hint={t("Internal notes on tickets and threads; travellers never see these.")} action={<NotebookPen className="size-4 text-ink-3" />} />
              {p.notes.length === 0 ? <p className="text-[13px] text-ink-3">{t("None yet")}</p> : (
                <ul className="space-y-2">
                  {p.notes.map((n) => (
                    <li key={n.id} className="rounded-2xl bg-surface-2 px-3.5 py-2.5">
                      <div className="line-clamp-3 whitespace-pre-wrap text-[13.5px] text-ink">{n.body}</div>
                      <div className="mt-1 text-[12px] text-ink-3">{n.number ? <Link className="hover:underline" href={ticketHref({ number: n.number })}>{ticketRef(n.number)}</Link> : t(n.threadKind === "request" ? "Request thread" : "Support chat")} · {timeAgo(n.createdAt, L)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {full && (
            <Card>
              <CardHead title={t("History")} hint={t("Everything they did on the desk and every change to their account, newest first.")} action={<History className="size-4 text-ink-3" />} />
              {p.audit.length === 0 ? <p className="text-[13px] text-ink-3">{t("Nothing yet")}</p> : (
                <ol className="space-y-2.5">
                  {p.audit.map((e) => (
                    <li key={e.id} className="flex gap-3 text-[13px]">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold" />
                      <div className="min-w-0"><div className="text-ink">{e.summary}</div><div className="text-[12px] text-ink-3"><span dir="ltr">{e.action}</span>{e.entityRef ? ` · ${e.entityRef}` : ""} · {fmtDate(e.at, L, true)}</div></div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          {admin && a.active && (
            <Card className="ring-2 ring-gold/40">
              <CardHead title={t("Edit")} hint={supportRole ? t("Role and team change their Ops login; the rest is what travellers see.") : t("Their Ops role is managed from Team.")} />
              <ActionForm action={updateAgentAction} className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="agentId" value={a.id} />
                {supportRole ? <RoleTeamFields t={t} roles={roles} role={p.role.key} team={p.user.team} /> : null}
                <ProfileFields t={t} a={a} />
                <Field label={t("Usual reply time (min)")}><Input name="replyMinutes" type="number" min={1} max={30} defaultValue={a.replyMinutes} /></Field>
                <SubmitButton className="sm:col-span-2">{t("Save")}</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card>
            <CardHead title={t("Account")} />
            <KV cols={1} items={[
              [t("Ops login"), <span key="e" dir="ltr">{p.user.email}</span>],
              [t("Phone"), <span key="p" dir="ltr" className="num">{p.user.phone ?? "—"}</span>],
              [t("Team"), p.user.team === "pakistan" ? t("Pakistan") : p.user.team === "riyadh" ? t("Riyadh") : t("Management")],
              [t("Languages"), a.languages.map((l) => l.toUpperCase()).join(" · ")],
              [t("Login"), p.user.active ? (p.user.mustChangePassword ? t("Invited: hasn't signed in yet") : t("Active")) : t("Off")],
              [t("Last seen"), p.user.lastSeenAt ? timeAgo(p.user.lastSeenAt, L) : "—"],
              [t("On the desk since"), fmtDate(a.createdAt, L)],
            ]} />
          </Card>

          <Card>
            <CardHead title={t("Coming shifts")} action={<CalendarClock className="size-4 text-ink-3" />} />
            {p.shifts.length === 0 ? <p className="text-[13px] text-ink-3">{t("Nothing on the rota.")} <Link className="text-ink underline" href="/adminwork/desk/rota">{t("Rota & time")}</Link></p> : (
              <ul className="space-y-1.5">
                {p.shifts.map((s) => <li key={s.id} className="flex items-center justify-between rounded-2xl bg-surface-2 px-3 py-2 text-[13px]"><span className="text-ink-2">{fmtDate(s.startsAt, L)}</span><span className="num text-ink" dir="ltr">{riyadhTime(s.startsAt)}–{riyadhTime(s.endsAt)}</span>{s.repeat === "weekly" && <Badge>{t("Weekly")}</Badge>}</li>)}
              </ul>
            )}
          </Card>

          {admin && !mine && (a.active ? (
            <Card>
              <CardHead title={t("Deactivate")} hint={t("Their login and desk profile go off, their open tickets and travellers go to the person you choose (or back to the queue), and their future shifts come off the rota. History stays.")} action={<UserX className="size-4 text-ink-3" />} />
              <ActionForm action={deactivateAgentAction} className="space-y-2">
                <input type="hidden" name="agentId" value={a.id} />
                <Field label={t("Hand their work to")}><Select name="toAgentId" placeholder={t("The queue")} options={others.map((o) => ({ value: o.id, label: o.name }))} /></Field>
                <SubmitButton variant="danger" className="w-full" confirm={t("Deactivate {name}? They're signed out everywhere.", { name: a.displayName })}>{t("Deactivate")}</SubmitButton>
              </ActionForm>
            </Card>
          ) : (
            <Card>
              <CardHead title={t("Deactivated")} hint={t("Bring them back: they start signed off, with nothing routed until they're on the rota.")} />
              <form action={reactivateAgentAction}><input type="hidden" name="agentId" value={a.id} /><SubmitButton variant="outline" className="w-full">{t("Reactivate")}</SubmitButton></form>
            </Card>
          ))}
        </aside>
      </div>
    </>
  );
}
