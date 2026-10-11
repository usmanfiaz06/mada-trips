import type { SupplierVoucherResponse } from "@mada/shared";
import type { z } from "zod";
import { json } from "@/lib/app/http";
import { currentLocale } from "@/lib/app/resilience/request";
import { withParams } from "@/lib/app/trips/route";
import { ownVoucherRow, voucherOf } from "@/lib/app/suppliers/hotelbeds/bookings";
import { voucherHtml } from "@/lib/app/suppliers/hotelbeds/voucher";

// GET /api/app/v1/vouchers/{id} → { voucher }. ?format=html&lang=en|ar → the printable voucher page (download, print to PDF).
// The traveller's own bookings only.
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const v = voucherOf(await ownVoucherRow(userId, id));
  const url = new URL(req.url);
  if (url.searchParams.get("format") === "html") {
    const q = url.searchParams.get("lang");
    const lang = q === "ar" || q === "en" ? q : currentLocale();
    return new Response(voucherHtml(v, lang), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Content-Disposition": `inline; filename="voucher-${v.reference.replace(/[^A-Za-z0-9-]/g, "")}.html"` },
    });
  }
  return json({ voucher: v } satisfies z.infer<typeof SupplierVoucherResponse>);
});
