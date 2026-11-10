import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { riyadhDate } from "@/lib/dates";
import { isUuid } from "@/lib/security";
import { PageHeader } from "@/components/ui";
import { DocumentBuilder } from "../../document-builder";
import type { DocType, ItineraryData, TransportData, VoucherData, ReceiptData } from "../../types";

export const metadata = { title: "Edit document" };

export default async function EditDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("documents.issue");
  const t = await getT();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [d] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
  if (!d) notFound();

  return (
    <div className="space-y-4">
      <div className="no-print">
        <Link href={`/adminwork/documents/${id}`} className="mb-3 inline-flex items-center gap-1.5 text-[13.5px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />{d.ref}</Link>
        <PageHeader eyebrow={t("Documents")} title={t("Edit document")}
          subtitle={t("Fix anything and save — the same document ({ref}) is updated, so there's no duplicate. Every change is logged.", { ref: d.ref })} />
      </div>
      <DocumentBuilder today={riyadhDate()} edit={{ id: d.id, type: d.type as DocType, date: d.docDate, data: d.data as ItineraryData | TransportData | VoucherData | ReceiptData }} />
    </div>
  );
}
