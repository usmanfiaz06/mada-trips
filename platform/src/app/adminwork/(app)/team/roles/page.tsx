import Link from "next/link";
import { eq } from "drizzle-orm";
import { Lock, Plus } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { Avatar, Badge, Card, LinkButton, PageHeader } from "@/components/ui";

export const metadata = { title: "Roles & access" };

export default async function RolesPage() {
  await requirePerm("roles.manage");
  const t = await getT();
  const L = t.locale;
  const roles = await db.select().from(schema.roles).orderBy(schema.roles.createdAt);
  const members = await db.select({ roleId: schema.users.roleId, name: schema.users.name }).from(schema.users).where(eq(schema.users.active, true));
  return (
    <>
      <PageHeader eyebrow={t("People & access")} title={t("Roles & access")} subtitle={t("A role is a named set of permissions. Give each person one role; change the role to change what everyone in it can do.")}
        actions={<LinkButton href="/adminwork/team/roles/new" variant="primary"><Plus className="size-4" />{t("New role")}</LinkButton>} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 stagger">
        {roles.map((r) => {
          const people = members.filter((m) => m.roleId === r.id);
          return (
            <Link key={r.id} href={`/adminwork/team/roles/${r.id}`} className="group">
              <Card className="flex h-full flex-col transition group-hover:-translate-y-0.5 group-hover:shadow-float">
                <div className="flex items-center justify-between">{r.isSystem ? <Badge><Lock className="size-3" />{t("Built-in")}</Badge> : <Badge tone="gold">{t("Custom")}</Badge>}
                  <span className="num text-[12px] text-ink-3">{r.permissions.length}/{ALL_PERMISSIONS.length}</span></div>
                <div className="mt-5 text-[19px] tracking-[-0.02em]">{L === "ar" ? r.nameAr : r.name}</div>
                <p className="mt-1.5 line-clamp-2 text-[13px] text-ink-3">{r.description}</p>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-gold" style={{ width: `${(r.permissions.length / ALL_PERMISSIONS.length) * 100}%` }} /></div>
                <div className="mt-auto flex items-center gap-2 pt-5">
                  <div className="flex -space-x-2 rtl:space-x-reverse">{people.slice(0, 5).map((p) => <Avatar key={p.name} name={p.name} size={28} />)}</div>
                  <span className="text-[12.5px] text-ink-3">{people.length === 0 ? t("Nobody yet") : people.length === 1 ? people[0].name : t("{n} people", { n: people.length })}</span>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}
