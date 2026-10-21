import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { Card, CardHead, PageHeader } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { NewTicketFields } from "@/components/desk/tickets";
import { createTicketAction } from "../../actions";

export const metadata = { title: "New ticket · Desk" };

/** A blank ticket: something the team must follow up that no order, request or chat stands for yet. */
export default async function NewTicketPage() {
  await requirePerm("desk.act");
  const t = await getT();
  return (
    <>
      <PageHeader eyebrow={t("Tickets")} title={t("New ticket")} subtitle={t("For anything the team must follow up. It's yours once it's open, and due by its priority: urgent in 30 minutes, high in 4 hours, normal in a day, low in 3 days.")} />
      <Card className="max-w-[720px]">
        <CardHead title={t("What it's about")} />
        <ActionForm action={createTicketAction} className="grid gap-4">
          <NewTicketFields blank />
          <div><SubmitButton>{t("Create ticket")}</SubmitButton></div>
        </ActionForm>
      </Card>
    </>
  );
}
