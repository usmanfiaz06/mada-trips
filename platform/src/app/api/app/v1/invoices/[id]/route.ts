import { json } from "@/lib/app/http";
import { invoiceDoc } from "@/lib/app/trips/money";
import { withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/invoices/{id} → { invoice, html }: the VAT invoice (simplified, a company's tax invoice, or a credit
// note) with its lines, totals and ZATCA QR payload, and the printable page the app turns into a PDF.
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (_req, { id }, { userId }) => json(await invoiceDoc(userId, id)));
