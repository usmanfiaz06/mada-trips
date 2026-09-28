import { getCurrentUser } from "@/lib/auth";
import { queryActivity } from "@/lib/activity";
import { audit } from "@/lib/audit";
import { db } from "@/db";

const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** CSV export of the activity log, with the current filters. The export itself is logged. */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u || !u.permissions.has("activity.view")) return new Response("Forbidden", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const rows = await queryActivity({ who: sp.get("who") || undefined, area: sp.get("area") || undefined, q: sp.get("q") || undefined, from: sp.get("from") || undefined, to: sp.get("to") || undefined }, 20000);
  await audit(db, { actorId: u.id, action: "activity.exported", entityType: "activity", summary: `Exported ${rows.length} activity entries` });
  const lines = [["time_riyadh", "person", "action", "record_type", "record", "summary", "ip"].join(",")];
  for (const r of rows) lines.push([new Date(r.at.getTime() + 3 * 3600_000).toISOString().replace("T", " ").slice(0, 19), r.actorName, r.action, r.entityType, r.entityRef, r.summary, r.ip].map(cell).join(","));
  return new Response("﻿" + lines.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="mada-activity-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
