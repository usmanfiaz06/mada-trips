import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { riyadhDate } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import { DocumentBuilder } from "../document-builder";

export const metadata = { title: "New document" };

export default async function NewDocumentPage() {
  await requirePerm("documents.issue");
  const t = await getT();
  return (
    <div className="space-y-4">
      <div className="no-print">
        <PageHeader eyebrow={t("Documents")} title={t("New document")}
          subtitle={t("Create a Mada-branded ticket, hotel voucher or receipt, then print or save it as PDF. Every one is logged.")} />
      </div>
      <DocumentBuilder today={riyadhDate()} />
    </div>
  );
}
