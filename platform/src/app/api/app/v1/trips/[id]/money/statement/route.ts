import { appAuditLog } from "@/lib/app/audit";
import { requestContext } from "@/lib/app/context";
import { db } from "@/db";
import { currentLocale } from "@/lib/app/resilience/request";
import { statementHtml, tripMoney } from "@/lib/app/trips/money-view";
import { loadTrip, withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/trips/{id}/money/statement → text/html: the trip statement as a printable page (Save as PDF).
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const trip = await loadTrip(req, userId, id);
  const money = await tripMoney(userId, trip);
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: "trip.statement_opened", entityType: "app_trip", entityId: id, summary: `Opened the statement for ${trip.city}`, ipHash: requestContext(req).ipHash });
  return new Response(statementHtml(money, currentLocale()), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `inline; filename="statement-${trip.city}.html"`, "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" },
  });
});
