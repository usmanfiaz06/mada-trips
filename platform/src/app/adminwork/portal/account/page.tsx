import { requireClientUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { Card, CardHead, Field, Input, Notice, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { changePassword } from "../../(app)/me/actions";

export const metadata = { title: "Your account" };

export default async function Account({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const u = await requireClientUser();
  const t = await getT();
  const { welcome } = await searchParams;
  return (
    <>
      <PageHeader title={welcome || u.mustChangePassword ? t("Welcome, {name}", { name: u.name.split(" ")[0] }) : t("Your account")} subtitle={u.email} />
      <div className="max-w-xl space-y-4">
        {u.mustChangePassword && <Notice tone="gold" title={t("Choose your own password")}>{t("You signed in with a temporary password. Pick your own to open your workspace.")}</Notice>}
        <Card>
          <CardHead title={t("Password")} hint={t("At least 10 characters. Changing it signs you out on other devices.")} />
          <ActionForm action={changePassword} resetOnOk className="space-y-3">
            <Field label={t("Current password")}><Input name="current" type="password" autoComplete="current-password" required /></Field>
            <Field label={t("New password")}><Input name="next" type="password" autoComplete="new-password" required /></Field>
            <Field label={t("Repeat new password")}><Input name="confirm" type="password" autoComplete="new-password" required /></Field>
            <SubmitButton>{t("Save password")}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
