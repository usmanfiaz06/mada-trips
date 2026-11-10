import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { ArrowLeft, Pencil } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { isUuid } from "@/lib/security";
import { PrintButton } from "../print-button";
import { DocumentSheet } from "../document-sheet";
import type { DocType, ItineraryData, VoucherData, ReceiptData } from "../types";

export const metadata = { title: "Document" };

export default async function DocumentView({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("documents.issue");
  const t = await getT();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [d] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
  if (!d) notFound();

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-3">
        <Link href="/adminwork/documents" className="inline-flex items-center gap-1.5 text-[13.5px] text-ink-3 hover:text-ink"><ArrowLeft className="size-4" />{t("All documents")}</Link>
        <div className="text-[13.5px] text-ink-2"><span className="num font-medium text-ink">{d.ref}</span> · {d.title}</div>
        <div className="ms-auto flex items-center gap-2">
          <Link href={`/adminwork/documents/${id}/edit`} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3.5 py-2 text-[13px] font-medium text-ink-2 hover:border-ink/40 hover:text-ink"><Pencil className="size-3.5" />{t("Edit")}</Link>
          <PrintButton />
        </div>
      </div>

      <div className="print-area overflow-auto">
        <DocumentSheet type={d.type as DocType} refNo={d.ref} date={d.docDate} data={d.data as ItineraryData | VoucherData | ReceiptData} locale={t.locale} />
      </div>

      <style>{`
        .sheet { width: 210mm; min-height: 297mm; }
        @media print {
          @page { size: A4; margin: 0; }
          body * { visibility: hidden !important; }
          .print-area, .print-area * { visibility: visible !important; }
          .print-area { position: absolute; inset: 0; overflow: visible !important; }
          /* Only as tall as the content when printing, so a one-page ticket never bleeds onto a 2nd page. */
          .sheet { box-shadow: none !important; margin: 0 !important; min-height: auto !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
