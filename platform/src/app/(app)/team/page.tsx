import Link from "next/link";
import { eq } from "drizzle-orm";
import { ShieldCheck, UserPlus } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { TEAM } from "@/lib/labels";
import { timeAgo } from "@/lib/dates";
import { Avatar, Badge, Card, CardHead, Field, Input, LinkButton, PageHeader, Select, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { addMember } from "./actions";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const u = await requirePerm("team.manage");
  const t = await getT();
  const L = t.locale;
  const [members, roles, partners] = await Promise.all([
    db.select({ m: schema.users, role: schema.roles.name, roleAr: schema.roles.nameAr, partner: schema.partners.name }).from(schema.users)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId)).leftJoin(schema.partners, eq(schema.partners.id, schema.users.partnerId)).orderBy(schema.users.createdAt),
    db.select().from(schema.roles).orderBy(schema.roles.createdAt),
    db.select().from(schema.partners).orderBy(schema.partners.sort),
  ]);
  const teams = ["management", "riyadh", "pakistan"] as const;
  const online = (d: Date | null) => !!d && Date.now() - d.getTime() < 5 * 60_000;

  return (
    <>
      <PageHeader eyebrow={t("People & access")} title={t("Team")} subtitle={t("Who can sign in, what role they hold, and when they were last active. Every change here is logged.")}
        actions={can(u, "roles.manage") && <LinkButton href="/team/roles" variant="outline"><ShieldCheck className="size-4" />{t("Roles & access")}</LinkButton>} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {teams.map((tm) => {
            const list = members.filter((x) => x.m.team === tm);
            if (!list.length) return null;
            return (
              <section key={tm}>
                <h2 className="mb-3 px-1 text-[13px] text-ink-3">{t(TEAM[tm])} · {list.length}</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {list.map(({ m, role, roleAr, partner }) => (
                    <Link key={m.id} href={`/team/${m.id}`} className="group">
                      <Card className={cx("flex items-center gap-4 transition group-hover:-translate-y-0.5 group-hover:shadow-float", !m.active && "opacity-55")}>
                        <span className="relative"><Avatar name={m.name} size={44} />{online(m.lastSeenAt) && <span className="absolute bottom-0 end-0 size-3 rounded-full bg-ok ring-2 ring-surface" />}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2"><span className="truncate text-[15px]">{m.name}</span>{partner && <Badge tone="gold">{t("Partner")}</Badge>}{!m.active && <Badge tone="bad">{t("Inactive")}</Badge>}</div>
                          <div className="truncate text-[12.5px] text-ink-3">{L === "ar" ? roleAr : role}</div>
                          <div className="mt-0.5 text-[12px] text-ink-4">{m.lastSeenAt ? (online(m.lastSeenAt) ? t("Online now") : t("Active {ago}", { ago: timeAgo(m.lastSeenAt, L) })) : t("Never signed in")}</div>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        <Card className="self-start lg:sticky lg:top-24">
          <CardHead title={t("Add a team member")} hint={t("They get a temporary password to change on first sign-in.")} action={<UserPlus className="size-5 text-gold-2" />} />
          <ActionForm action={addMember} resetOnOk className="space-y-3">
            <Field label={t("Full name")} required><Input name="name" /></Field>
            <Field label={t("Work email")} required><Input name="email" type="email" dir="ltr" /></Field>
            <Field label={t("Phone")}><Input name="phone" dir="ltr" /></Field>
            <Field label={t("Role")} required hint={t("Decides everything they can see and do.")}><Select name="roleId" placeholder={t("Choose…")} options={roles.map((r) => ({ value: r.id, label: L === "ar" ? r.nameAr : r.name }))} /></Field>
            <Field label={t("Team")}><Select name="team" defaultValue="riyadh" options={teams.map((x) => ({ value: x, label: t(TEAM[x]) }))} /></Field>
            <Field label={t("Linked partner")} hint={t("Only for the three partners.")}><Select name="partnerId" placeholder={t("None")} options={partners.map((p) => ({ value: p.id, label: p.name }))} /></Field>
            <SubmitButton className="w-full">{t("Add member")}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
