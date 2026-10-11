import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSupplierBookings } from "@/db/app-schema-hotelbeds";
import { requirePerm } from "@/lib/auth";
import { isUuid } from "@/lib/security";
import { voucherOf } from "@/lib/app/suppliers/hotelbeds/bookings";
import { voucherHtml } from "@/lib/app/suppliers/hotelbeds/voucher";

// The voucher of a Hotelbeds booking for the desk: the same page the traveller downloads (print to PDF).
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePerm("desk.view");
  const { id } = await params;
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  const [row] = await db.select().from(appSupplierBookings).where(eq(appSupplierBookings.id, id));
  if (!row?.supplierRef) return new Response("Not found", { status: 404 });
  const lang = new URL(req.url).searchParams.get("lang") === "ar" ? "ar" : "en";
  return new Response(voucherHtml(voucherOf(row), lang), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
}
