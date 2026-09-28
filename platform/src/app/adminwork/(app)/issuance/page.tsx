import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { CornerUpLeft, Ticket, TicketCheck, ShieldCheck, Clock3 } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { canSeeIssuance, issueCheck } from "@/lib/issuance";
import { businessDate, fmtDate, timeAgo } from "@/lib/dates";
import { sar } from "@/lib/money";
import { SERVICE } from "@/lib/labels";
import { Avatar, Badge, Card, CardHead, Empty, Field, Input, Meter, PageHeader, Select, cx } from "@/components/ui";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/client";
import { issueBooking, returnBooking } from "../sales/actions";
import { grantDelegation, revokeDelegation } from "./actions";

export const metadata = { title: "Issuance" };

export default async function IssuancePage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const u = await requireUser();
  if (!(await canSeeIssuance(u))) redirect("/adminwork?denied=1");
  const t = await getT();
  const L = t.locale;
  const { focus } = await searchParams;

  const queue = await db.select({ b: schema.bookings, client: schema.clients.name, clientType: schema.clients.type, preparer: schema.users.name, team: schema.users.team })
    .from(schema.bookings).innerJoin(schema.clients, eq(schema.clients.id, schema.bookings.clientId)).innerJoin(schema.users, eq(schema.users.id, schema.bookings.preparedBy))
    .where(eq(schema.bookings.status, "pending_issue")).orderBy(schema.bookings.createdAt);
  const checks = await Promise.all(queue.map((q) => issueCheck(db, u, q.b)));

  const today = businessDate();
  const delegations = can(u, "issue.delegate") ? await db.select({ d: schema.delegations, name: schema.users.name, team: schema.users.team })
    .from(schema.delegations).innerJoin(schema.users, eq(schema.users.id, schema.delegations.userId))
    .where(and(isNull(schema.delegations.revokedAt), gt(schema.delegations.expiresAt, new Date()))).orderBy(desc(schema.delegations.createdAt)) : [];
  const usage = await Promise.all(delegations.map(async ({ d }) => (await db.select({ total: sql<number>`coalesce(sum(${schema.bookings.sellPrice}),0)::bigint`.mapWith(Number), n: sql<number>`count(*)::int` })
    .from(schema.bookings).where(and(eq(schema.bookings.issuedUnderDelegation, d.id), sql`(${schema.bookings.issuedAt} AT TIME ZONE 'Asia/Riyadh')::date = ${today}`)))[0]));
  const staff = can(u, "issue.delegate") ? await db.select({ id: schema.users.id, name: schema.users.name, team: schema.users.team }).from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId)).where(and(eq(schema.users.active, true), sql`NOT ('issue.unlimited' = ANY(${schema.roles.permissions}))`)) : [];
  const recent = await db.select({ b: schema.bookings, issuer: schema.users.name }).from(schema.bookings).innerJoin(schema.users, eq(schema.users.id, schema.bookings.issuedBy))
    .where(sql`${schema.bookings.issuedAt} > now() - interval '2 days'`).orderBy(desc(schema.bookings.issuedAt)).limit(8);

  return (
    <>
      <PageHeader eyebrow={t("Ticketing control")} title={t("Issuance")}
        subtitle={t("The remote team prepares; only Bader or a delegated issuer can issue. Every issue is logged against the person who did it.")} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-[17px] font-[450] tracking-[-0.02em]">{t("Waiting to issue")}</h2>
            <span className="text-[13px] text-ink-3">{t("{n} in queue · oldest first", { n: queue.length })}</span>
          </div>
          {queue.length === 0 && <Card><Empty icon={<TicketCheck className="size-5" />} title={t("Queue is clear")} hint={t("New bookings from the Riyadh office and the Pakistan desk will appear here.")} /></Card>}
          {queue.map(({ b, client, clientType, preparer, team }, i) => {
            const chk = checks[i];
            const margin = b.sellPrice - b.netCost;
            const ageMin = (Date.now() - b.createdAt.getTime()) / 60000;
            return (
              <Card key={b.id} className={cx("animate-rise", focus === b.id && "ring-2 ring-gold")}>
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/adminwork/sales/${b.id}`} className="num text-[15px] font-medium hover:underline">{b.ref}</Link>
                      <Badge>{t(SERVICE[b.serviceType])}</Badge>
                      <Badge tone={b.channel === "retail" ? "neutral" : "info"}>{t(b.channel === "retail" ? "Retail" : "Corporate")}</Badge>
                      <span className={cx("flex items-center gap-1 text-[12px]", ageMin > 120 ? "text-warn" : "text-ink-3")}><Clock3 className="size-3" />{timeAgo(b.createdAt, L)}</span>
                    </div>
                    <div className="mt-2 text-[18px] tracking-[-0.01em]">{b.passengers} <span className="text-ink-3">· {b.description}</span></div>
                    <div className="mt-1 text-[13px] text-ink-3">{client} · {t("prepared by {name}", { name: preparer })} ({t(team === "pakistan" ? "Pakistan" : team === "riyadh" ? "Riyadh" : "Management")})</div>
                  </div>
                  <div className="grid grid-cols-3 gap-5 text-end">
                    <div><div className="text-[11.5px] text-ink-3">PNR</div><div className="num mt-0.5 tracking-wider" dir="ltr">{b.pnr ?? "—"}</div></div>
                    <div><div className="text-[11.5px] text-ink-3">{t("Sell")}</div><div className="num mt-0.5" dir="ltr">{sar(b.sellPrice)}</div></div>
                    <div><div className="text-[11.5px] text-ink-3">{t("Margin")}</div><div className={cx("num mt-0.5", margin < 0 && "text-bad")} dir="ltr">{sar(margin)}</div></div>
                  </div>
                </div>
                {chk.ok ? (
                  <div className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-[1fr_auto_auto]">
                    <ActionForm action={issueBooking} className="contents">
                      <input type="hidden" name="id" value={b.id} /><input type="hidden" name="back" value="/adminwork/issuance" />
                      {b.serviceType === "flight" ? <input name="ticketNumbers" required className="field num" placeholder={t("Ticket number(s)")} dir="ltr" /> : <span className="self-center text-[13px] text-ink-3">{t("No ticket number needed")}</span>}
                      <SubmitButton variant="gold"><Ticket className="size-4" />{b.serviceType === "flight" ? t("Issue") : t("Confirm")}</SubmitButton>
                    </ActionForm>
                    <details className="relative">
                      <summary className="flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-full px-4 text-[13.5px] text-ink-2 ring-1 ring-line hover:bg-surface-2"><CornerUpLeft className="size-4" />{t("Send back")}</summary>
                      <div className="absolute end-0 top-12 z-20 w-80 rounded-2xl bg-surface p-4 shadow-float ring-1 ring-line">
                        <ActionForm action={returnBooking} className="space-y-2">
                          <input type="hidden" name="id" value={b.id} /><input type="hidden" name="back" value="/adminwork/issuance" />
                          <textarea name="note" rows={3} className="field" placeholder={t("What needs fixing?")} autoFocus />
                          <SubmitButton variant="primary" size="sm">{t("Send back")}</SubmitButton>
                        </ActionForm>
                      </div>
                    </details>
                  </div>
                ) : (
                  <div className="mt-4 border-t border-line pt-3 text-[13px] text-ink-3">{t(chk.reason)}</div>
                )}
              </Card>
            );
          })}
        </div>

        <aside className="space-y-4">
          {can(u, "issue.delegate") && (
            <Card>
              <CardHead title={t("Delegated issuers")} hint={t("Riyadh staff who can issue within limits")} action={<ShieldCheck className="size-5 text-gold-2" />} />
              <ul className="space-y-4">
                {delegations.map(({ d, name }, i) => (
                  <li key={d.id} className="rounded-2xl bg-surface-2 p-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={name} size={32} />
                      <div className="min-w-0 flex-1"><div className="truncate text-[14px]">{name}</div>
                        <div className="text-[12px] text-ink-3">{t(d.scope === "retail" ? "Retail only" : "Retail & corporate")} · {t("until {d}", { d: fmtDate(d.expiresAt, L) })}</div></div>
                      <ConfirmAction action={revokeDelegation} fields={{ id: d.id }} label={t("Revoke")} confirm={t("Revoke issuing rights from {name}?", { name })} />
                    </div>
                    <div className="mt-3 flex justify-between text-[12px] text-ink-3"><span>{t("Used today")}</span><span className="num" dir="ltr">{sar(usage[i].total)} / {sar(d.dailyCap)}</span></div>
                    <div className="mt-1.5"><Meter value={usage[i].total} max={d.dailyCap} tone={usage[i].total / d.dailyCap > 0.8 ? "warn" : "gold"} /></div>
                    <div className="mt-2 text-[12px] text-ink-3">{t("Max per ticket")} <span className="num text-ink" dir="ltr">{sar(d.maxTicket)}</span></div>
                  </li>
                ))}
                {delegations.length === 0 && <li className="text-[13px] text-ink-3">{t("Nobody else can issue right now.")}</li>}
              </ul>
              <details className="mt-4 border-t border-line pt-4">
                <summary className="cursor-pointer list-none text-[13.5px] text-ink underline decoration-gold decoration-2 underline-offset-4">{t("Grant issuing rights")}</summary>
                <ActionForm action={grantDelegation} resetOnOk className="mt-4 space-y-3">
                  <Field label={t("Person")}><Select name="userId" placeholder={t("Choose…")} options={staff.map((s) => ({ value: s.id, label: s.name }))} /></Field>
                  <Field label={t("Scope")}><Select name="scope" options={[{ value: "retail", label: t("Retail only") }, { value: "all", label: t("Retail & corporate") }]} /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t("Max per ticket (SAR)")}><Input name="maxTicket" inputMode="decimal" defaultValue="8000" dir="ltr" /></Field>
                    <Field label={t("Daily cap (SAR)")}><Input name="dailyCap" inputMode="decimal" defaultValue="40000" dir="ltr" /></Field>
                  </div>
                  <Field label={t("Valid until")}><Input name="expiresAt" type="date" /></Field>
                  <Field label={t("Note")}><Input name="note" placeholder={t("e.g. covering evenings this month")} /></Field>
                  <SubmitButton className="w-full">{t("Grant")}</SubmitButton>
                </ActionForm>
              </details>
            </Card>
          )}
          <Card>
            <CardHead title={t("Issued in the last 48h")} />
            <ul className="space-y-3">
              {recent.map(({ b, issuer }) => (
                <li key={b.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <Link href={`/adminwork/sales/${b.id}`} className="min-w-0"><span className="num text-ink">{b.ref}</span> <span className="text-ink-3">· {b.passengers}</span></Link>
                  <span className="shrink-0 text-ink-3">{issuer.split(" ")[0]} · {timeAgo(b.issuedAt!, L)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
