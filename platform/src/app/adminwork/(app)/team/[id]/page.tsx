import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { TEAM } from "@/lib/labels";
import { fmtDate, timeAgo } from "@/lib/dates";
import { sar } from "@/lib/money";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { Avatar, Badge, Card, CardHead, Field, Input, Select } from "@/components/ui";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/client";
import { ActivityList } from "@/components/activity-list";
import { resetPassword, setActive, saveCommissionConfig, updateMember } from "../actions";

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const me = await requirePerm("team.manage");
  const t = await getT();
  const L = t.locale;
  const [m] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  if (!m) notFound();
  const [roles, partners, [role], sessions, events, [deleg]] = await Promise.all([
    db.select().from(schema.roles), db.select().from(schema.partners),
    db.select().from(schema.roles).where(eq(schema.roles.id, m.roleId)),
    db.select().from(schema.sessions).where(and(eq(schema.sessions.userId, id), gt(schema.sessions.expiresAt, new Date()))).orderBy(desc(schema.sessions.createdAt)),
    db.select({ e: schema.auditEvents }).from(schema.auditEvents).where(eq(schema.auditEvents.actorId, id)).orderBy(desc(schema.auditEvents.at)).limit(40),
    db.select().from(schema.delegations).where(and(eq(schema.delegations.userId, id), isNull(schema.delegations.revokedAt), gt(schema.delegations.expiresAt, new Date()))),
  ]);

  const isPartner = !!m.partnerId, isSelf = m.id === me.id;
  const locked = isPartner && !isSelf; // another partner's own account
  const partner = partners.find((p) => p.id === m.partnerId);
  const assignable = roles.filter((r) => r.id === m.roleId || (r.key !== "partner" && r.key !== "partner_issuer" && (r.permissions as Permission[]).every((x) => !x.startsWith("issue.") && me.permissions.has(x))));

  return (
    <>
      <Link href="/adminwork/team" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Team")}</Link>
      <header className="mb-6 flex items-center gap-5">
        <Avatar name={m.name} size={64} />
        <div><h1 className="text-[34px] font-[380] leading-none tracking-[-0.035em]">{m.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-ink-3"><Badge tone="gold">{L === "ar" ? role.nameAr : role.name}</Badge>{t(TEAM[m.team])} · <span dir="ltr">{m.email}</span>{!m.active && <Badge tone="bad">{t("Inactive")}</Badge>}</div></div>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card>
            <CardHead title={t("What they can do")} hint={t("From the {role} role. Change the role to change this.", { role: role.name })} action={<Link href={`/adminwork/team/roles/${role.id}`} className="text-[13px] underline decoration-gold decoration-2 underline-offset-4">{t("Edit role")}</Link>} />
            <div className="flex flex-wrap gap-1.5">
              {(role.permissions as Permission[]).map((p) => <span key={p} className="rounded-full bg-surface-2 px-3 py-1 text-[12.5px] text-ink-2 ring-1 ring-line">{L === "ar" ? PERMISSIONS[p]?.ar : PERMISSIONS[p]?.en}</span>)}
            </div>
            {deleg && <p className="mt-4 rounded-2xl bg-gold-soft px-4 py-3 text-[13px] text-gold-2">{t("Delegated issuer: up to SAR {max} per ticket, {cap} a day, until {d}", { max: sar(deleg.maxTicket), cap: sar(deleg.dailyCap), d: fmtDate(deleg.expiresAt, L) })}</p>}
          </Card>
          <div><h2 className="mb-3 px-1 text-[17px] font-[450] tracking-[-0.02em]">{t("Recent activity")}</h2>
            <ActivityList showIp items={events.map(({ e }) => ({ ...e, actorName: m.name }))} /></div>
        </div>
        <aside className="space-y-4">
          <Card>
            <CardHead title={t("Profile & role")} hint={partner ? t("Partner account: {name}", { name: partner.name }) : undefined} />
            {locked ? (
              <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[13px] text-ink-2">{t("Each partner manages their own account. Their role, access and password can't be changed by anyone else.")}</p>
            ) : (
            <ActionForm action={updateMember} className="space-y-3">
              <input type="hidden" name="id" value={m.id} />
              <Field label={t("Full name")}><Input name="name" defaultValue={m.name} /></Field>
              <Field label={t("Email")}><Input name="email" defaultValue={m.email} dir="ltr" /></Field>
              <Field label={t("Phone")}><Input name="phone" defaultValue={m.phone ?? ""} dir="ltr" /></Field>
              {isSelf || isPartner
                ? <input type="hidden" name="roleId" value={m.roleId} />
                : <Field label={t("Role")}><Select name="roleId" defaultValue={m.roleId} options={assignable.map((r) => ({ value: r.id, label: L === "ar" ? r.nameAr : r.name }))} /></Field>}
              <Field label={t("Team")}><Select name="team" defaultValue={m.team} options={Object.entries(TEAM).map(([k, v]) => ({ value: k, label: t(v) }))} /></Field>
              <SubmitButton className="w-full">{t("Save")}</SubmitButton>
            </ActionForm>
            )}
          </Card>
          <Card>
            <CardHead title={t("Commission")} hint={t("Commission is never paid automatically. Turn it on, set a rate, then pay a period in the calculator — a director approves each payout.")}
              action={m.commissionEnabled ? <Link href={`/adminwork/team/${m.id}/commission`} className="text-[13px] underline decoration-gold decoration-2 underline-offset-4">{t("Open calculator")}</Link> : undefined} />
            <ActionForm action={saveCommissionConfig} className="space-y-3">
              <input type="hidden" name="id" value={m.id} />
              <label className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-4 py-3">
                <span className="text-[13.5px]">{t("Commission enabled")}</span>
                <input type="checkbox" name="enabled" defaultChecked={m.commissionEnabled} className="size-4 accent-[var(--gold)]" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Default rate (%)")}</span>
                  <input name="rate" type="number" min={0} max={50} step="0.5" defaultValue={m.commissionBps / 100} className="field num" /></label>
                <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("On")}</span>
                  <select name="basis" defaultValue={m.commissionBasis} className="field h-10"><option value="profit">{t("Profit (margin)")}</option><option value="revenue">{t("Revenue (sales)")}</option></select></label>
              </div>
              <label><span className="mb-1.5 block text-[12.5px] text-ink-3">{t("Earns commission from (leave blank = from the beginning)")}</span>
                <input name="from" type="date" defaultValue={m.commissionFrom ?? ""} className="field" /></label>
              <SubmitButton variant="outline" className="w-full">{t("Save commission settings")}</SubmitButton>
            </ActionForm>
          </Card>
          <Card>
            <CardHead title={t("Sign-in & security")} hint={t("{n} active sessions", { n: sessions.length })} />
            <ul className="mb-4 space-y-2 text-[12.5px] text-ink-3">
              {sessions.slice(0, 4).map((s) => <li key={s.id} className="truncate">{timeAgo(s.createdAt, L)} · <span dir="ltr">{s.ip ?? "?"}</span> · {s.userAgent?.split(")")[0]?.split("(")[1] ?? ""}</li>)}
            </ul>
            {!isPartner && !isSelf && <ActionForm action={resetPassword}><input type="hidden" name="id" value={m.id} /><SubmitButton variant="outline" className="w-full" confirm={t("Reset the password and sign them out everywhere?")}>{t("Reset password")}</SubmitButton></ActionForm>}
            {!isPartner && !isSelf && (
              <div className="mt-3">
                <ConfirmAction action={setActive} fields={{ id: m.id, active: String(!m.active) }} variant={m.active ? "danger" : "outline"} size="md"
                  label={m.active ? t("Deactivate") : t("Reactivate")} confirm={m.active ? t("Deactivate {name}? They'll be signed out immediately.", { name: m.name }) : t("Let {name} sign in again?", { name: m.name })} />
              </div>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
