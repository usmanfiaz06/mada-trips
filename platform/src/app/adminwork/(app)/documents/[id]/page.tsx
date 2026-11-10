import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ArrowLeft, Pencil, QrCode, FileText, Paperclip } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { isUuid } from "@/lib/security";
import { fmtDate } from "@/lib/dates";
import { Badge } from "@/components/ui";
import { PrintButton } from "../print-button";
import { DocumentSheet } from "../document-sheet";
import { DocumentUpload } from "../document-upload";
import type { DocType, ItineraryData, TransportData, VoucherData, ReceiptData } from "../types";

export const metadata = { title: "Document" };

export default async function DocumentView({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("documents.issue");
  const t = await getT();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [d] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
  if (!d) notFound();
  const files = await db.select({ id: schema.attachments.id, filename: schema.attachments.filename, mime: schema.attachments.mime, at: schema.attachments.createdAt })
    .from(schema.attachments).where(and(eq(schema.attachments.entityType, "document"), eq(schema.attachments.entityId, id))).orderBy(desc(schema.attachments.createdAt));
  const hasQr = !!(d.data as { hasQr?: boolean }).hasQr;

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
        <DocumentSheet type={d.type as DocType} refNo={d.ref} date={d.docDate} data={d.data as ItineraryData | TransportData | VoucherData | ReceiptData} locale={t.locale} />
      </div>

      {/* Original ticket / attachments — e.g. a bus/train PDF that carries a QR code */}
      <div className="no-print mx-auto w-full max-w-[210mm] rounded-2xl border border-line bg-surface p-5">
        <div className="mb-3 flex items-center gap-2">
          <Paperclip className="size-4 text-ink-3" />
          <span className="text-[14px] font-medium">{t("Original ticket & attachments")}</span>
          {hasQr && <Badge tone="gold"><QrCode className="me-1 size-3" />{t("Has QR code")}</Badge>}
        </div>
        <p className="mb-3 text-[12.5px] text-ink-3">{t("If the carrier's ticket has a QR code, upload the original PDF here so it stays intact. Attached files are kept on this record.")}</p>
        {files.length > 0 && (
          <ul className="mb-4 divide-y divide-line/60 rounded-xl border border-line">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3.5 py-2.5">
                <FileText className="size-4 shrink-0 text-ink-3" />
                <a href={`/adminwork/api/files/${f.id}`} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate text-[13.5px] text-ink hover:underline">{f.filename}</a>
                <span className="text-[11.5px] text-ink-4">{fmtDate(f.at, t.locale)}</span>
              </li>
            ))}
          </ul>
        )}
        <DocumentUpload id={id} />
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
