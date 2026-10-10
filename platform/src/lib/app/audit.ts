import "server-only";
import { db, type Tx } from "@/db";
import { appAudit } from "@/db/app-schema";

export type AppAuditInput = {
  actorKind: "user" | "agent" | "system";
  actorId: string | null;
  action: string; // auth.otp_sent, auth.signed_in, person.created, passport.saved …
  entityType: string;
  entityId?: string | null;
  summary: string; // one readable sentence; never a passport number, code or token
  data?: Record<string, unknown> | null;
  ipHash?: string | null;
};

/** One row in the app's append-only audit trail. Call inside the same transaction as the change. */
export async function appAuditLog(tx: Tx | typeof db, e: AppAuditInput) {
  await tx.insert(appAudit).values({
    actorKind: e.actorKind, actorId: e.actorId, action: e.action, entityType: e.entityType,
    entityId: e.entityId ?? null, summary: e.summary, data: e.data ?? null, ipHash: e.ipHash ?? null,
  });
}
