import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { TEAM } from "@/lib/labels";
import { PERMISSIONS, type Permission } from "@/lib/permissions";
import { Avatar, Badge, Card, CardHead, Field, Input } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { ActivityList } from "@/components/activity-list";
import { changePassword, setLanguage } from "./actions";

export const metadata = { title: "My profile" };

export default async function MePage() {
  const u = await requireUser();
  const t = await getT();
  const L = t.locale;
  const events = await db.select().from(schema.auditEvents).where(eq(schema.auditEvents.actorId, u.id)).orderBy(desc(schema.auditEvents.at)).limit(25);
  return (
    <>
      <header className="mb-6 flex items-center gap-5">
        <Avatar name={u.name} size={64} />
        <div><h1 className="text-[34px] font-[380] leading-none tracking-[-0.035em]">{u.name}</h1>
          <div className="mt-2 flex items-center gap-2 text-[13.5px] text-ink-3"><Badge tone="gold">{L === "ar" ? u.role.nameAr : u.role.name}</Badge>{t(TEAM[u.team])} · <span dir="ltr">{u.email}</span></div></div>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Card><CardHead title={t("What you can do")} />
            <div className="flex flex-wrap gap-1.5">{[...u.permissions].map((p) => <span key={p} className="rounded-full bg-surface-2 px-3 py-1 text-[12.5px] text-ink-2 ring-1 ring-line">{L === "ar" ? PERMISSIONS[p as Permission]?.ar : PERMISSIONS[p as Permission]?.en}</span>)}</div></Card>
          <div><h2 className="mb-3 px-1 text-[17px] font-[450] tracking-[-0.02em]">{t("Your recent activity")}</h2><ActivityList items={events.map((e) => ({ ...e, actorName: u.name }))} /></div>
        </div>
        <aside className="space-y-4">
          <Card><CardHead title={t("Language")} />
            <form action={setLanguage} className="grid grid-cols-2 gap-2">
              <button name="locale" value="en" className={`h-11 rounded-full text-[14px] ${L === "en" ? "bg-ink text-bg" : "bg-surface-2 ring-1 ring-line"}`}>English</button>
              <button name="locale" value="ar" className={`h-11 rounded-full text-[14px] ${L === "ar" ? "bg-ink text-bg" : "bg-surface-2 ring-1 ring-line"}`}>العربية</button>
            </form></Card>
          <Card><CardHead title={t("Change password")} hint={t("At least 10 characters.")} />
            <ActionForm action={changePassword} resetOnOk className="space-y-3">
              <Field label={t("Current password")}><Input name="current" type="password" autoComplete="current-password" dir="ltr" /></Field>
              <Field label={t("New password")}><Input name="next" type="password" autoComplete="new-password" dir="ltr" /></Field>
              <Field label={t("Repeat new password")}><Input name="confirm" type="password" autoComplete="new-password" dir="ltr" /></Field>
              <SubmitButton className="w-full">{t("Change password")}</SubmitButton>
            </ActionForm></Card>
        </aside>
      </div>
    </>
  );
}
