import { appAuditLog } from "@/lib/app/audit";
import { requestContext } from "@/lib/app/context";
import { db } from "@/db";
import { invoiceDoc } from "@/lib/app/trips/money";
import { withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/invoices/{id}/document → text/html: the invoice as a printable page (Save as PDF from any browser).
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const { invoice, html } = await invoiceDoc(userId, id);
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: "invoice.downloaded", entityType: "app_invoice", entityId: id, summary: `Opened ${invoice.number}`, ipHash: requestContext(req).ipHash });
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `inline; filename="${invoice.number}.html"`, "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" },
  });
});
