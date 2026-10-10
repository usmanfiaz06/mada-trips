import { requestContext } from "@/lib/app/context";
import { json } from "@/lib/app/http";
import { invoiceDoc, issueDraft } from "@/lib/app/trips/money";
import { withParams } from "@/lib/app/trips/route";

// POST /api/app/v1/invoices/{id}/issue → { invoice, html }: issues a draft tax invoice. Final: it gets its number and can't be edited.
export const dynamic = "force-dynamic";

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  await issueDraft(userId, id, requestContext(req).ipHash);
  return json(await invoiceDoc(userId, id));
});
