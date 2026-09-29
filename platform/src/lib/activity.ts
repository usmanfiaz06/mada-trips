import "server-only";
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { isIsoDate, isUuid, likeContains } from "@/lib/security";

export type ActivityFilter = { who?: string; area?: string; q?: string; from?: string; to?: string };

export async function queryActivity(f: ActivityFilter, limit = 200) {
  const w: (SQL | undefined)[] = [];
  // Filters come from the address bar: anything malformed is ignored rather than trusted.
  if (f.who && !isUuid(f.who)) f = { ...f, who: undefined };
  if (f.from && !isIsoDate(f.from)) f = { ...f, from: undefined };
  if (f.to && !isIsoDate(f.to)) f = { ...f, to: undefined };
  if (f.area && !/^[a-z_]{1,30}$/.test(f.area)) f = { ...f, area: undefined };
  if (f.who) w.push(eq(schema.auditEvents.actorId, f.who));
  if (f.area === "auth") w.push(sql`${schema.auditEvents.action} LIKE 'auth.%'`);
  else if (f.area) w.push(eq(schema.auditEvents.entityType, f.area));
  if (f.q) { const like = likeContains(f.q); w.push(or(ilike(schema.auditEvents.summary, like), ilike(schema.auditEvents.entityRef, like), ilike(schema.auditEvents.action, like))); }
  if (f.from) w.push(gte(schema.auditEvents.at, new Date(`${f.from}T00:00:00+03:00`)));
  if (f.to) w.push(lte(schema.auditEvents.at, new Date(`${f.to}T23:59:59+03:00`)));
  const rows = await db.select({ e: schema.auditEvents, name: schema.users.name }).from(schema.auditEvents)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditEvents.actorId)).where(and(...w)).orderBy(desc(schema.auditEvents.at)).limit(limit);
  return rows.map(({ e, name }) => ({ ...e, actorName: name }));
}
