import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { PageHeader } from "@/components/ui";
import { ConfirmAction } from "@/components/client";
import { RoleForm } from "@/components/role-form";
import { deleteRole } from "../../actions";

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("roles.manage");
  const t = await getT();
  const { id } = await params;
  const back = <Link href="/team/roles" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4 rtl:rotate-180" />{t("Roles & access")}</Link>;
  if (id === "new") return (<>{back}<PageHeader title={t("New role")} subtitle={t("Start from nothing and switch on only what this role needs.")} /><RoleForm /></>);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [r] = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
  if (!r) notFound();
  return (
    <>
      {back}
      <PageHeader title={t.locale === "ar" ? r.nameAr : r.name} subtitle={r.description ?? undefined}
        actions={!r.isSystem && <ConfirmAction action={deleteRole} fields={{ id: r.id }} label={t("Delete role")} confirm={t("Delete this role?")} />} />
      <RoleForm role={r} />
    </>
  );
}
