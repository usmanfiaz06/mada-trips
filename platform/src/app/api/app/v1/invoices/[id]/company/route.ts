import { CompanyInvoiceRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json } from "@/lib/app/http";
import { draftCompanyInvoice, invoiceDoc } from "@/lib/app/trips/money";
import { withParams } from "@/lib/app/trips/route";

// POST /api/app/v1/invoices/{id}/company { company: { name, vat, cr, address } } → 201 { invoice, html }: a draft full tax
// invoice for the company, for the traveller to check. Saudi VAT numbers: 15 digits, starting and ending with 3.
export const dynamic = "force-dynamic";

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const { company } = await body(req, CompanyInvoiceRequest);
  const draftId = await draftCompanyInvoice(userId, id, company, requestContext(req).ipHash);
  return json(await invoiceDoc(userId, draftId), 201);
});
