import "server-only";
import { db, schema, type Tx } from "@/db";
import { appAudit } from "@/db/app-schema";

/*
 * What every desk action shares: who is acting, what they may do, and the two logs it writes.
 * Server actions pass the signed-in Ops user (CurrentUser fits this shape); tests pass one they build.
 */

export const DESK_CAPS = ["desk.view", "desk.act", "desk.issue", "desk.refund", "desk.moderate", "desk.admin"] as const;
export type DeskCap = (typeof DESK_CAPS)[number];
export type DeskActor = { id: string; name: string; permissions: Set<string> | ReadonlySet<string> };

/** A refusal meant for the person on the desk; server actions show the message as it is. */
export class DeskError extends Error {
  constructor(message: string, readonly code: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "VALIDATION" = "VALIDATION") {
    super(message);
  }
}

export const has = (a: DeskActor, cap: DeskCap) => a.permissions.has(cap);
export function assertCap(a: DeskActor, cap: DeskCap) {
  if (!a.permissions.has(cap)) throw new DeskError("You don't have access to do that on the desk", "FORBIDDEN");
}

type Entry = {
  action: string;          // desk.order.confirmed, desk.passport.revealed …
  entityType: string;      // app entity: request | refund | support_thread | app_user | agent | …
  entityId?: string | null;
  summary: string;         // one readable sentence; never a passport number
  data?: Record<string, unknown> | null;
  ref?: string | null;     // what the Ops activity log shows next to it
};

/**
 * Every desk action lands in both trails, in the same transaction as the change: the app's audit (what happened to
 * the traveller's records) and the Ops activity log (what the team did), so neither can disagree with the other.
 */
export async function deskAudit(tx: Tx | typeof db, actor: DeskActor, e: Entry) {
  await tx.insert(appAudit).values({
    actorKind: "agent", actorId: actor.id, action: e.action, entityType: e.entityType,
    entityId: e.entityId ?? null, summary: e.summary, data: e.data ?? null,
  });
  await tx.insert(schema.auditEvents).values({
    actorId: actor.id, action: e.action, entityType: "desk", entityId: e.entityId ?? null,
    entityRef: e.ref ?? null, summary: e.summary, changes: e.data ?? null,
  });
}

/** A short reference people can say on the phone: R-7B21C4. */
export const shortRef = (id: string, prefix = "R") => `${prefix}-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

/** First name plus surname initial, the way the desk names a traveller in lists: "Sara A.". */
export function travellerName(full: string | null | undefined, fallback = "Traveller") {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]}.` : parts[0]!;
}

/** SAR 8,640 the way travellers read it (no ".00"). Amounts are halalas. */
export function sarText(halalas: number) {
  const v = halalas / 100;
  return `SAR ${v.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
}
