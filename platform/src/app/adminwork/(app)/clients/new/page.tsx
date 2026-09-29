import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { ClientFields } from "@/components/client-fields";
import { createClient } from "../actions";

export const metadata = { title: "New client" };

export default async function NewClient() {
  await requirePerm("clients.manage");
  const t = await getT();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow={t("Clients & credit")} title={t("New client")} />
      <Card>
        <ActionForm action={createClient}>
          <ClientFields withLimit />
          <div className="mt-6 flex justify-end"><SubmitButton>{t("Add client")}</SubmitButton></div>
        </ActionForm>
      </Card>
    </div>
  );
}
