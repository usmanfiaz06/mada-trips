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
import { resetPassword, setActive, updateMember } from "../actions";

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

  return (
    <>
      <Link href="/team" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Team")}</Link>
      <header className="mb-6 flex items-center gap-5">
        <Avatar name={m.name} size={64} />
        <div><h1 className="text-[34px] font-[380] leading-none tracking-[-0.035em]">{m.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-ink-3"><Badge tone="gold">{L === "ar" ? role.nameAr : role.name}</Badge>{t(TEAM[m.team])} · <span dir="ltr">{m.email}</span>{!m.active && <Badge tone="bad">{t("Inactive")}</Badge>}</div></div>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card>
            <CardHead title={t("What they can do")} hint={t("From the {role} role. Change the role to change this.", { role: role.name })} action={<Link href={`/team/roles/${role.id}`} className="text-[13px] underline decoration-gold decoration-2 underline-offset-4">{t("Edit role")}</Link>} />
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
            <CardHead title={t("Profile & role")} />
            <ActionForm action={updateMember} className="space-y-3">
              <input type="hidden" name="id" value={m.id} />
              <Field label={t("Full name")}><Input name="name" defaultValue={m.name} /></Field>
              <Field label={t("Email")}><Input name="email" defaultValue={m.email} dir="ltr" /></Field>
              <Field label={t("Phone")}><Input name="phone" defaultValue={m.phone ?? ""} dir="ltr" /></Field>
              <Field label={t("Role")}><Select name="roleId" defaultValue={m.roleId} options={roles.map((r) => ({ value: r.id, label: L === "ar" ? r.nameAr : r.name }))} /></Field>
              <Field label={t("Team")}><Select name="team" defaultValue={m.team} options={Object.entries(TEAM).map(([k, v]) => ({ value: k, label: t(v) }))} /></Field>
              <Field label={t("Linked partner")}><Select name="partnerId" defaultValue={m.partnerId ?? ""} placeholder={t("None")} options={partners.map((p) => ({ value: p.id, label: p.name }))} /></Field>
              <SubmitButton className="w-full">{t("Save")}</SubmitButton>
            </ActionForm>
          </Card>
          <Card>
            <CardHead title={t("Sign-in & security")} hint={t("{n} active sessions", { n: sessions.length })} />
            <ul className="mb-4 space-y-2 text-[12.5px] text-ink-3">
              {sessions.slice(0, 4).map((s) => <li key={s.id} className="truncate">{timeAgo(s.createdAt, L)} · <span dir="ltr">{s.ip ?? "?"}</span> · {s.userAgent?.split(")")[0]?.split("(")[1] ?? ""}</li>)}
            </ul>
            <ActionForm action={resetPassword}><input type="hidden" name="id" value={m.id} /><SubmitButton variant="outline" className="w-full" confirm={t("Reset the password and sign them out everywhere?")}>{t("Reset password")}</SubmitButton></ActionForm>
            {m.id !== me.id && (
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
