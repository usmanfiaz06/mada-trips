import "server-only";
import { schema, type Tx, db } from "@/db";
import { clientIp } from "./auth";

type AuditInput = {
  actorId: string | null;
  action: string;           // e.g. booking.issued, expense.approved, role.updated
  entityType: string;       // booking | expense | client | approval | user | role | ...
  entityId?: string | null;
  entityRef?: string | null;
  summary: string;          // one readable sentence
  changes?: Record<string, { from: unknown; to: unknown }> | Record<string, unknown> | null;
};

/** Write one activity-log row. Call inside the same transaction as the change it describes. */
export async function audit(tx: Tx | typeof db, e: AuditInput) {
  await tx.insert(schema.auditEvents).values({
    actorId: e.actorId, action: e.action, entityType: e.entityType,
    entityId: e.entityId ?? null, entityRef: e.entityRef ?? null,
    summary: e.summary, changes: e.changes ?? null, ip: await clientIp().catch(() => null),
  });
}

/** Field-level diff for the log: only what actually changed. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    const a = before[k], b = after[k];
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);
    if (JSON.stringify(norm(a)) !== JSON.stringify(norm(b))) out[k] = { from: norm(a), to: norm(b) };
  }
  return out;
}
